import net from 'net'
import dgram from 'dgram'
import fs from 'fs'
import path from 'path'
import os from 'os'
import crypto from 'crypto'
import { getDb } from './db'
import type { SyncPayload } from '../shared/types'
import { filterSyncableSettings, isSyncableSettingKey } from '../shared/syncSettings'
import { SYNC_TCP_PORT } from '../shared/ports'

const DEFAULT_TCP_PORT = SYNC_TCP_PORT
const DEFAULT_UDP_PORT = 5740
const DISCOVERY_INTERVAL_MS = 5000

interface DiscoveredPeer {
  name: string
  ip: string
  port: number
  lastSeen: number
}

interface FileMetadata {
  relPath: string
  mtime: number
  size: number
  sha256: string
}

// in shared/types so preload and the collab coordinator share the wire format
type DatabasePayload = SyncPayload

/** low enough that guessing six digits is hopeless, high enough for a typo */
const MAX_AUTH_ATTEMPTS = 5

/** === on a secret leaks how much matched through timing; constant-time is free */
export function sameSecret(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex')
  const right = Buffer.from(b, 'hex')
  // timingSafeEqual throws on length mismatch, so check length first
  return left.length === right.length && crypto.timingSafeEqual(left, right)
}

export class SyncService {
  private tcpServer: net.Server | null = null
  private udpSocket: dgram.Socket | null = null
  private discoveryInterval: NodeJS.Timeout | null = null
  private clientSockets = new Set<net.Socket>()
  
  private tcpPort = DEFAULT_TCP_PORT
  private udpPort = DEFAULT_UDP_PORT
  private pairingCode = ''
  /** cleared when the host restarts */
  private failedAttempts = new Map<string, number>()
  private isServerActive = false
  private syncProgress = ''
  private isSyncing = false
  
  private discoveredPeers: Map<string, DiscoveredPeer> = new Map()
  
  public getStatus() {
    return {
      active: this.isServerActive,
      port: this.tcpPort,
      pairingCode: this.pairingCode,
      progress: this.syncProgress,
      isSyncing: this.isSyncing
    }
  }

  public getDiscoveredPeers(): DiscoveredPeer[] {
    const now = Date.now()
    // drop peers not seen for 15s
    const list: DiscoveredPeer[] = []
    for (const [key, peer] of this.discoveredPeers.entries()) {
      if (now - peer.lastSeen < 15000) {
        list.push(peer)
      } else {
        this.discoveredPeers.delete(key)
      }
    }
    return list
  }

  /** CSPRNG: the code keys the signaling exchange and the socket HMAC; randomInt also avoids modulo bias */
  private generatePairingCode(): string {
    return crypto.randomInt(100000, 1000000).toString()
  }

  public startHost(port = DEFAULT_TCP_PORT): void {
    if (this.isServerActive) this.stopHost()

    this.tcpPort = port
    this.pairingCode = this.generatePairingCode()
    // new code, clean slate: blocked callers were guessing a code that's gone
    this.failedAttempts.clear()
    this.syncProgress = 'Host started. Waiting for connections...'
    
    this.tcpServer = net.createServer((socket) => this.handleClientConnection(socket))
    this.tcpServer.listen(port, '0.0.0.0', () => {
      console.log(`[SyncService] TCP Server listening on port ${port}`)
    })

    this.startDiscovery()
    
    this.isServerActive = true
  }

  public stopHost(): void {
    if (this.discoveryInterval) {
      clearInterval(this.discoveryInterval)
      this.discoveryInterval = null
    }

    // force-close clients so tcpServer.close() resolves now
    for (const socket of this.clientSockets) {
      try { socket.destroy() } catch {}
    }
    this.clientSockets.clear()

    if (this.udpSocket) {
      try {
        this.udpSocket.close()
      } catch {}
      this.udpSocket = null
    }

    if (this.tcpServer) {
      try {
        this.tcpServer.close()
      } catch {}
      this.tcpServer = null
    }

    this.isServerActive = false
    this.pairingCode = ''
    this.syncProgress = 'Sync server stopped.'
    this.isSyncing = false
    console.log('[SyncService] Host stopped.')
  }

  private startDiscovery(): void {
    try {
      this.udpSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true })
      
      this.udpSocket.on('message', (msg, rinfo) => {
        try {
          const data = JSON.parse(msg.toString())
          if (data.type === 'checkpoint-discover' && data.name && data.port) {
            const peerKey = `${rinfo.address}:${data.port}`
            // skip ourselves
            if (rinfo.address === this.getLocalIp() && data.port === this.tcpPort) {
              return
            }
            this.discoveredPeers.set(peerKey, {
              name: data.name,
              ip: rinfo.address,
              port: data.port,
              lastSeen: Date.now()
            })
          }
        } catch {}
      })

      this.udpSocket.bind(this.udpPort, '0.0.0.0', () => {
        if (this.udpSocket) {
          this.udpSocket.setBroadcast(true)
        }
      })

      this.discoveryInterval = setInterval(() => {
        if (!this.udpSocket || !this.isServerActive) return

        // drop peers not seen for 15s
        const now = Date.now()
        for (const [key, peer] of this.discoveredPeers.entries()) {
          if (now - peer.lastSeen >= 15000) this.discoveredPeers.delete(key)
        }

        const broadcastData = JSON.stringify({
          type: 'checkpoint-discover',
          name: os.hostname(),
          port: this.tcpPort
        })
        const buffer = Buffer.from(broadcastData)
        try {
          this.udpSocket.send(buffer, 0, buffer.length, this.udpPort, '255.255.255.255')
        } catch (err) {
          console.error('[SyncService] UDP broadcast failed:', err)
        }
      }, DISCOVERY_INTERVAL_MS)

    } catch (err) {
      console.error('[SyncService] Failed to initialize UDP Discovery:', err)
    }
  }

  private getLocalIp(): string {
    const interfaces = os.networkInterfaces()
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name] || []) {
        if (iface.family === 'IPv4' && !iface.internal) {
          return iface.address
        }
      }
    }
    return '127.0.0.1'
  }

  public getFileIndex(subDir: 'notes' | 'media', dataPath: string): FileMetadata[] {
    const targetDir = path.join(dataPath, subDir)
    if (!fs.existsSync(targetDir)) return []

    const list: FileMetadata[] = []
    const files = fs.readdirSync(targetDir)
    for (const file of files) {
      const filePath = path.join(targetDir, file)
      const stat = fs.statSync(filePath)
      if (stat.isFile()) {
        const fileBuffer = fs.readFileSync(filePath)
        const hash = crypto.createHash('sha256').update(fileBuffer).digest('hex')
        list.push({
          relPath: file,
          mtime: stat.mtimeMs,
          size: stat.size,
          sha256: hash
        })
      }
    }
    return list
  }

  public getDatabasePayload(): DatabasePayload {
    const db = getDb()
    
    // cast at the query, the only place the row shape is known
    const items = db.prepare('SELECT * FROM items').all() as SyncPayload['items']
    const tags = db.prepare('SELECT * FROM tags').all() as SyncPayload['tags']
    const item_tags = db.prepare('SELECT * FROM item_tags').all() as SyncPayload['item_tags']
    const relations = db.prepare('SELECT * FROM relations').all() as SyncPayload['relations']
    
    // drops credentials and machine-specific settings, see shared/syncSettings
    const rawSettings = db.prepare('SELECT * FROM app_settings').all() as { key: string, value: string }[]
    const app_settings = filterSyncableSettings(rawSettings)
    
    const focus_sessions = db.prepare('SELECT * FROM focus_sessions').all() as SyncPayload['focus_sessions']
    const clipboard_items = db.prepare('SELECT * FROM clipboard_items').all() as SyncPayload['clipboard_items']
    const tombstones = db.prepare('SELECT * FROM sync_tombstones').all() as SyncPayload['tombstones']

    return {
      items,
      tags,
      item_tags,
      relations,
      app_settings,
      focus_sessions,
      clipboard_items,
      tombstones
    }
  }

  // one transaction
  public applyDatabasePayload(payload: DatabasePayload): { pulledNewerCount: number } {
    const db = getDb()
    let pulledNewerCount = 0

    db.transaction(() => {
      const tombstones = payload.tombstones || []
      const insertTombstoneStmt = db.prepare(
        'INSERT OR REPLACE INTO sync_tombstones (id, table_name, deleted_at) VALUES (?, ?, ?)'
      )
      
      for (const tomb of tombstones) {
        insertTombstoneStmt.run(tomb.id, tomb.table_name, tomb.deleted_at)
        
        if (tomb.table_name === 'items') {
          db.prepare('DELETE FROM items WHERE id = ?').run(tomb.id)
        } else if (tomb.table_name === 'tags') {
          db.prepare('DELETE FROM tags WHERE id = ?').run(tomb.id)
        } else if (tomb.table_name === 'relations') {
          db.prepare('DELETE FROM relations WHERE id = ?').run(tomb.id)
        }
      }

      // local tombstones guard the inserts
      const localTombstones = new Set(
        (db.prepare('SELECT id FROM sync_tombstones').all() as { id: string }[]).map(t => t.id)
      )

      // items: last write wins
      const items = payload.items || []
      const stmtGetItem = db.prepare('SELECT updated_at FROM items WHERE id = ?')
      const stmtInsertItem = db.prepare(`
        INSERT INTO items (id, type, context, title, body, status, priority, position, created_at, updated_at, due_at, metadata)
        VALUES (@id, @type, @context, @title, @body, @status, @priority, @position, @created_at, @updated_at, @due_at, @metadata)
      `)
      const stmtUpdateItem = db.prepare(`
        UPDATE items SET 
          type = @type, context = @context, title = @title, body = @body, status = @status,
          priority = @priority, position = @position, created_at = @created_at,
          updated_at = @updated_at, due_at = @due_at, metadata = @metadata
        WHERE id = @id
      `)

      for (const item of items) {
        if (localTombstones.has(item.id)) continue // deleted locally

        const local = stmtGetItem.get(item.id) as { updated_at: number } | undefined
        if (!local) {
          stmtInsertItem.run(item)
          pulledNewerCount++
        } else if (item.updated_at > local.updated_at) {
          stmtUpdateItem.run(item)
          pulledNewerCount++
        }
      }

      // tags: insert or update color
      const tags = payload.tags || []
      const stmtGetTag = db.prepare('SELECT id FROM tags WHERE id = ?')
      const stmtInsertTag = db.prepare('INSERT INTO tags (id, name, color) VALUES (@id, @name, @color)')
      const stmtUpdateTag = db.prepare('UPDATE tags SET name = @name, color = @color WHERE id = @id')

      for (const tag of tags) {
        if (localTombstones.has(tag.id)) continue
        const local = stmtGetTag.get(tag.id)
        if (!local) {
          // tag names are unique
          const nameConflict = db.prepare('SELECT id FROM tags WHERE name = ?').get(tag.name)
          if (!nameConflict) {
            stmtInsertTag.run(tag)
          }
        } else {
          stmtUpdateTag.run(tag)
        }
      }

      // item_tags: merge only
      const item_tags = payload.item_tags || []
      const stmtInsertItemTag = db.prepare('INSERT OR IGNORE INTO item_tags (item_id, tag_id) VALUES (?, ?)')
      for (const it of item_tags) {
        // both item and tag must exist locally
        const itemExists = db.prepare('SELECT id FROM items WHERE id = ?').get(it.item_id)
        const tagExists = db.prepare('SELECT id FROM tags WHERE id = ?').get(it.tag_id)
        if (itemExists && tagExists) {
          stmtInsertItemTag.run(it.item_id, it.tag_id)
        }
      }

      const relations = payload.relations || []
      const stmtInsertRelation = db.prepare(
        'INSERT OR IGNORE INTO relations (id, from_id, to_id, type) VALUES (@id, @from_id, @to_id, @type)'
      )
      for (const rel of relations) {
        if (localTombstones.has(rel.id)) continue
        const fromExists = db.prepare('SELECT id FROM items WHERE id = ?').get(rel.from_id)
        const toExists = db.prepare('SELECT id FROM items WHERE id = ?').get(rel.to_id)
        if (fromExists && toExists) {
          stmtInsertRelation.run(rel)
        }
      }

      // settings re-filtered on the way in: older peers still send backup paths and window geometry
      const settings = payload.app_settings || []
      const stmtSetSetting = db.prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)')
      for (const s of settings) {
        if (!isSyncableSettingKey(s.key)) continue
        stmtSetSetting.run(s.key, s.value)
      }

      // focus sessions: merge new
      const focus = payload.focus_sessions || []
      const stmtInsertFocus = db.prepare(`
        INSERT OR IGNORE INTO focus_sessions (id, context, duration_ms, completed_at, notes, tasks_json)
        VALUES (@id, @context, @duration_ms, @completed_at, @notes, @tasks_json)
      `)
      for (const f of focus) {
        stmtInsertFocus.run(f)
      }

      // clipboard items: merge history
      const clip = payload.clipboard_items || []
      const stmtInsertClip = db.prepare(`
        INSERT OR IGNORE INTO clipboard_items (id, content, is_pinned, label, created_at)
        VALUES (@id, @content, @is_pinned, @label, @created_at)
      `)
      for (const c of clip) {
        stmtInsertClip.run(c)
      }

    })()

    return { pulledNewerCount }
  }

  private handleClientConnection(socket: net.Socket): void {
    console.log(`[SyncService] Client connected from ${socket.remoteAddress}`)

    // six digits is an afternoon of guessing, so an address is ignored after a few misses until a new code
    const origin = socket.remoteAddress ?? 'unknown'
    if ((this.failedAttempts.get(origin) ?? 0) >= MAX_AUTH_ATTEMPTS) {
      this.syncProgress = `Refused ${origin}: too many failed codes.`
      socket.destroy()
      return
    }

    // tracked so stopHost() can force-close it
    this.clientSockets.add(socket)
    socket.once('close', () => this.clientSockets.delete(socket))

    let authenticated = false
    const salt = crypto.randomBytes(16).toString('hex')
    this.isSyncing = true
    this.syncProgress = 'Client connected. Exchanging security challenge...'

    socket.write(`auth-challenge:${salt}\n`)

    let buffer = ''
    socket.on('data', (data) => {
      buffer += data.toString()
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (!line.trim()) continue

        if (!authenticated) {
          if (line.startsWith('auth-response:')) {
            const clientHash = line.substring('auth-response:'.length).trim()
            const expectedHash = crypto
              .createHmac('sha256', this.pairingCode)
              .update(salt)
              .digest('hex')

            if (sameSecret(clientHash, expectedHash)) {
              authenticated = true
              this.failedAttempts.delete(origin)
              socket.write('auth-success\n')
              this.syncProgress = 'Authenticated successfully. Exchanging index...'
            } else {
              const failures = (this.failedAttempts.get(origin) ?? 0) + 1
              this.failedAttempts.set(origin, failures)
              socket.write('auth-failed\n')
              socket.destroy()
              this.syncProgress = failures >= MAX_AUTH_ATTEMPTS
                ? `Authentication failed. ${origin} is now blocked until the host restarts.`
                : 'Authentication failed: invalid code.'
              this.isSyncing = false
            }
          }
          continue
        }

        if (line.startsWith('sync-request')) {
          this.syncProgress = 'Syncing database payload...'
          const dbPayload = this.getDatabasePayload()
          socket.write(`sync-db-payload:${JSON.stringify(dbPayload)}\n`)
        } else if (line.startsWith('sync-db-payload:')) {
          const rawPayload = line.substring('sync-db-payload:'.length)
          try {
            const payload = JSON.parse(rawPayload)
            const result = this.applyDatabasePayload(payload)
            socket.write(`sync-db-applied:${result.pulledNewerCount}\n`)
            this.syncProgress = 'Database merged successfully. Syncing files...'
          } catch {
            socket.write('sync-error:failed to merge database\n')
            socket.destroy()
            this.isSyncing = false
          }
        } else if (line.startsWith('sync-db-applied:')) {
          // db done, host asks for notes next
          this.syncProgress = 'Database sync completed. Syncing notes...'
          socket.write('notes-sync-done\n')
        } else if (line === 'notes-sync-done') {
          this.syncProgress = 'Sync complete!'
          this.isSyncing = false
          socket.write('sync-complete\n')
          socket.end()
        }
      }
    })

    socket.on('error', (err) => {
      console.error('[SyncService] Client socket error:', err)
      this.isSyncing = false
      this.syncProgress = `Sync error: ${err.message}`
    })

    socket.on('close', () => {
      console.log('[SyncService] Socket connection closed')
      this.isSyncing = false
    })
  }

  public connectAndSync(hostIp: string, port: number, pairingCode: string, dataPath: string): Promise<{ dbUpdates: number; filesSynced: number }> {
    return new Promise((resolve, reject) => {
      this.isSyncing = true
      this.syncProgress = `Connecting to peer at ${hostIp}:${port}...`
      
      const socket = net.createConnection(port, hostIp)
      let dbUpdates = 0
      let salt = ''

      let buffer = ''
      socket.on('data', async (data) => {
        buffer += data.toString()
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.trim()) continue

          if (line.startsWith('auth-challenge:')) {
            salt = line.substring('auth-challenge:'.length).trim()
            const responseHash = crypto
              .createHmac('sha256', pairingCode)
              .update(salt)
              .digest('hex')
            socket.write(`auth-response:${responseHash}\n`)
          } else if (line === 'auth-success') {
            this.syncProgress = 'Authenticated successfully. Fetching host database...'
            socket.write('sync-request\n')
          } else if (line === 'auth-failed') {
            socket.destroy()
            this.isSyncing = false
            this.syncProgress = 'Authentication failed. Please verify pairing code.'
            reject(new Error('Authentication failed'))
          } else if (line.startsWith('sync-db-payload:')) {
            const rawPayload = line.substring('sync-db-payload:'.length)
            try {
              const payload = JSON.parse(rawPayload)
              
              // bidirectional: apply theirs, then send ours back
              const result = this.applyDatabasePayload(payload)
              dbUpdates += result.pulledNewerCount
              
              const clientPayload = this.getDatabasePayload()
              socket.write(`sync-db-payload:${JSON.stringify(clientPayload)}\n`)
              
              this.syncProgress = `Database merge: integrated ${result.pulledNewerCount} updates.`
            } catch (err) {
              console.error('[SyncService] Client merge failed:', err)
              socket.destroy()
              this.isSyncing = false
              reject(err)
            }
          } else if (line.startsWith('sync-db-applied:')) {
            this.syncProgress = 'Notes sync in progress...'
            
            try {
              await this.syncNotesFiles(socket, dataPath)
            } catch (err) {
              console.error('[SyncService] Notes folder sync failed:', err)
            }
            
            socket.write('notes-sync-done\n')
          } else if (line === 'sync-complete') {
            this.syncProgress = 'Sync completed successfully!'
            this.isSyncing = false
            socket.destroy()
            resolve({ dbUpdates, filesSynced: 0 })
          }
        }
      })

      socket.on('error', (err) => {
        this.isSyncing = false
        this.syncProgress = `Connection error: ${err.message}`
        socket.destroy()   // release the OS handle now
        reject(err)
      })

      socket.on('close', () => {
        // closed on error/timeout before resolving
        this.isSyncing = false
      })

      // give up if the peer goes silent for 30s
      socket.setTimeout(30000)
      socket.on('timeout', () => {
        console.warn('[SyncService] Sync socket timed out after 30s')
        socket.destroy()
        this.isSyncing = false
        reject(new Error('Sync connection timed out'))
      })
    })
  }

  private async syncNotesFiles(_socket: net.Socket, _dataPath: string): Promise<void> {
    // stub: note files aren't synced over the LAN socket yet
  }
}
