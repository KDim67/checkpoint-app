/**
 * WebRTC P2P Sync Coordinator for internet/WAN sync.
 * Uses ntfy.sh for ephemeral, E2E encrypted signaling room matching,
 * and exchanges SQLite database records & note files over direct RTCDataChannels.
 */

interface FileMetadata {
  relPath: string
  mtime: number
  size: number
  sha256: string
}

// Encryption utilities using Web Crypto API
async function deriveKey(passcode: string): Promise<CryptoKey> {
  const enc = new TextEncoder()
  const salt = enc.encode('checkpoint-sync-salt-v1')
  const baseKey = await window.crypto.subtle.importKey(
    'raw',
    enc.encode(passcode),
    'PBKDF2',
    false,
    ['deriveKey']
  )
  return window.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: 1000,
      hash: 'SHA-256'
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

async function encryptData(data: string, key: CryptoKey): Promise<string> {
  const enc = new TextEncoder()
  const iv = window.crypto.getRandomValues(new Uint8Array(12))
  const encrypted = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv },
    key,
    enc.encode(data)
  )
  const combined = new Uint8Array(iv.length + encrypted.byteLength)
  combined.set(iv, 0)
  combined.set(new Uint8Array(encrypted), iv.length)
  return btoa(String.fromCharCode(...combined))
}

async function decryptData(base64Data: string, key: CryptoKey): Promise<string> {
  const combined = new Uint8Array(
    atob(base64Data).split('').map(c => c.charCodeAt(0))
  )
  const iv = combined.slice(0, 12)
  const ciphertext = combined.slice(12)
  const decrypted = await window.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv },
    key,
    ciphertext
  )
  return new TextDecoder().decode(decrypted)
}

interface WebRTCSyncOptions {
  pairingCode: string
  isHost: boolean
  onProgress: (progress: string) => void
  onComplete: (stats: { dbUpdates: number; filesSynced: number }) => void
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onError: (err: any) => void
}

export class WebRTCSyncCoordinator {
  private pc: RTCPeerConnection | null = null
  private dataChannel: RTCDataChannel | null = null
  private sse: EventSource | null = null
  private key: CryptoKey | null = null
  private options: WebRTCSyncOptions
  
  private dbUpdatesCount = 0
  private filesSyncedCount = 0
  
  // File chunking accumulator
  private fileChunksBuffer: Map<string, { chunks: string[]; received: number; total: number }> = new Map()

  constructor(options: WebRTCSyncOptions) {
    this.options = options
  }

  public async start(): Promise<void> {
    try {
      this.cleanup()
      this.key = await deriveKey(this.options.pairingCode)
      this.options.onProgress('Security key derived. Connecting signaling lobby...')

      const signalingRoom = `checkpoint-sync-${this.options.pairingCode}`
      
      if (this.options.isHost) {
        this.setupHostSignaling(signalingRoom)
      } else {
        await this.setupClientConnection(signalingRoom)
      }
    } catch (err) {
      this.options.onError(err)
    }
  }

  // HOST: Listen for incoming client offer, decrypt it, and reply with answer
  private setupHostSignaling(room: string): void {
    const sseUrl = `https://ntfy.sh/${room}/sse`
    this.sse = new EventSource(sseUrl)

    this.options.onProgress(`Host active. Send passcode to peer...`)

    this.sse.onmessage = async (e) => {
      try {
        if (!this.key) return
        const payload = JSON.parse(e.data)
        // Skip messages we published or invalid ones
        if (!payload.text || payload.title === 'host-reply') return

        this.options.onProgress('Received connection offer. Establishing tunnel...')
        const decryptedOffer = await decryptData(payload.text, this.key)
        const { sdp } = JSON.parse(decryptedOffer)

        // Setup RTCPeerConnection
        this.pc = new RTCPeerConnection({
          iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
        })

        // Capture data channel when client connects
        this.pc.ondatachannel = (event) => {
          this.dataChannel = event.channel
          this.setupDataChannelHandlers()
        }

        // Gather ICE Candidates
        this.pc.onicecandidate = (event) => {
          if (!event.candidate) {
            // Once all candidates gathered, send response answer
            this.sendHostAnswer(room)
          }
        }

        await this.pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp }))
        const answer = await this.pc.createAnswer()
        await this.pc.setLocalDescription(answer)

      } catch (err) {
        console.error('[WebRTC Host] Signaling error:', err)
      }
    }
  }

  private async sendHostAnswer(room: string): Promise<void> {
    if (!this.key) return
    try {
      const sdpData = JSON.stringify({ sdp: this.pc?.localDescription?.sdp })
      const encryptedSdp = await encryptData(sdpData, this.key)

      await fetch(`https://ntfy.sh/${room}`, {
        method: 'POST',
        headers: { 'Title': 'host-reply' },
        body: encryptedSdp
      })
      this.options.onProgress('Signaling completed. Activating WebRTC data link...')
      
      // Close SSE signaling once handshake completes
      if (this.sse) {
        this.sse.close()
        this.sse = null
      }
    } catch (err) {
      this.options.onError(err)
    }
  }

  // CLIENT: Create offer, publish it, and listen for answer reply
  private async setupClientConnection(room: string): Promise<void> {
    this.pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    })

    this.dataChannel = this.pc.createDataChannel('sync-channel', { ordered: true })
    this.setupDataChannelHandlers()

    // Create SDP Offer
    const offer = await this.pc.createOffer()
    await this.pc.setLocalDescription(offer)

    // Wait for ICE gathering
    this.pc.onicecandidate = (event) => {
      if (!event.candidate) {
        this.publishClientOffer(room)
      }
    }

    // Subscribe to host's response
    this.sse = new EventSource(`https://ntfy.sh/${room}/sse`)
    this.sse.onmessage = async (e) => {
      try {
        if (!this.key) return
        const payload = JSON.parse(e.data)
        if (payload.title !== 'host-reply') return

        this.options.onProgress('Response answer received. Securing direct connection...')
        const decryptedAnswer = await decryptData(payload.text, this.key)
        const { sdp } = JSON.parse(decryptedAnswer)

        await this.pc?.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp }))

        if (this.sse) {
          this.sse.close()
          this.sse = null
        }
      } catch (err) {
        this.options.onError(err)
      }
    }
  }

  private async publishClientOffer(room: string): Promise<void> {
    if (!this.key) return
    try {
      const sdpData = JSON.stringify({ sdp: this.pc?.localDescription?.sdp })
      const encryptedSdp = await encryptData(sdpData, this.key)

      await fetch(`https://ntfy.sh/${room}`, {
        method: 'POST',
        headers: { 'Title': 'client-offer' },
        body: encryptedSdp
      })
      this.options.onProgress('Offer sent. Waiting for peer authorization...')
    } catch (err) {
      this.options.onError(err)
    }
  }

  // Setup DataChannel listeners
  private setupDataChannelHandlers(): void {
    if (!this.dataChannel) return

    this.dataChannel.onopen = () => {
      this.options.onProgress('Direct P2P Link Established. Starting database sync...')
      this.isHostSync()
    }

    this.dataChannel.onmessage = async (event) => {
      try {
        const message = JSON.parse(event.data)
        await this.handleIncomingMessage(message)
      } catch (err) {
        console.error('[WebRTC Sync] Error parsing P2P message:', err)
      }
    }

    this.dataChannel.onerror = (err) => {
      this.options.onError(err)
    }

    this.dataChannel.onclose = () => {
      console.log('[WebRTC Sync] Connection closed')
    }
  }

  // Host starts the sync handshake
  private async isHostSync(): Promise<void> {
    if (!this.options.isHost || !this.dataChannel) return
    
    // Retrieve host db payload & files list
    this.options.onProgress('Exchanging local database states...')
    const dbPayload = await window.electronAPI.sync.getDbPayload()
    const notesIndex = await window.electronAPI.sync.getFileIndex('notes')
    const mediaIndex = await window.electronAPI.sync.getFileIndex('media')

    this.send({
      type: 'db-payload-offer',
      dbPayload,
      notesIndex,
      mediaIndex
    })
  }

  // Message dispatcher
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async handleIncomingMessage(msg: any): Promise<void> {
    if (!this.dataChannel) return

    switch (msg.type) {
      case 'db-payload-offer': {
        this.options.onProgress('Merging peer database and files...')
        
        // 1. Merge Database payload
        const result = await window.electronAPI.sync.applyDbPayload(msg.dbPayload)
        this.dbUpdatesCount += result.pulledNewerCount
        this.options.onProgress(`Merged database: ${result.pulledNewerCount} records integrated.`)

        // 2. Align Notes & Media files
        await this.alignFilesAndSync('notes', msg.notesIndex)
        await this.alignFilesAndSync('media', msg.mediaIndex)

        // 3. Send client response back to host
        const clientDbPayload = await window.electronAPI.sync.getDbPayload()
        const clientNotesIndex = await window.electronAPI.sync.getFileIndex('notes')
        const clientMediaIndex = await window.electronAPI.sync.getFileIndex('media')

        this.send({
          type: 'db-payload-reply',
          dbPayload: clientDbPayload,
          notesIndex: clientNotesIndex,
          mediaIndex: clientMediaIndex
        })
        break
      }

      case 'db-payload-reply': {
        this.options.onProgress('Merging client database updates...')
        const result = await window.electronAPI.sync.applyDbPayload(msg.dbPayload)
        this.dbUpdatesCount += result.pulledNewerCount
        
        // Align host files
        await this.alignFilesAndSync('notes', msg.notesIndex)
        await this.alignFilesAndSync('media', msg.mediaIndex)

        this.options.onProgress('Sync completed successfully!')
        this.send({ type: 'sync-finished' })
        this.cleanup()
        this.options.onComplete({ dbUpdates: this.dbUpdatesCount, filesSynced: this.filesSyncedCount })
        break
      }

      case 'sync-finished': {
        this.options.onProgress('Sync completed successfully!')
        this.cleanup()
        this.options.onComplete({ dbUpdates: this.dbUpdatesCount, filesSynced: this.filesSyncedCount })
        break
      }

      case 'file-chunk': {
        const fileKey = `${msg.subDir}:${msg.relPath}`
        let fileObj = this.fileChunksBuffer.get(fileKey)
        if (!fileObj) {
          fileObj = { chunks: new Array(msg.totalChunks), received: 0, total: msg.totalChunks }
          this.fileChunksBuffer.set(fileKey, fileObj)
        }

        fileObj.chunks[msg.chunkIndex] = msg.data
        fileObj.received++

        this.options.onProgress(`Transferring file ${msg.relPath} (${Math.round((fileObj.received / fileObj.total) * 100)}%)`)

        if (fileObj.received === fileObj.total) {
          // Reassemble buffer
          const combinedBase64 = fileObj.chunks.join('')
          const binaryString = atob(combinedBase64)
          const bytes = new Uint8Array(binaryString.length)
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i)
          }

          // Write file to filesystem via Electron main process
          await window.electronAPI.sync.writeFileChunk(msg.subDir, msg.relPath, bytes.buffer, msg.mtime)
          this.filesSyncedCount++
          this.fileChunksBuffer.delete(fileKey)
        }
        break
      }

      case 'request-file': {
        // Peer requested a file. Read it and send in chunks.
        await this.sendFileInChunks(msg.subDir, msg.relPath)
        break
      }

      case 'delete-file': {
        // Peer deleted note/media file
        await window.electronAPI.sync.deleteFile(msg.subDir, msg.relPath)
        this.filesSyncedCount++
        break
      }
    }
  }

  // Compare file indexes and request missing files or push newer ones
  private async alignFilesAndSync(subDir: 'notes' | 'media', peerIndex: FileMetadata[]): Promise<void> {
    const localIndex = await window.electronAPI.sync.getFileIndex(subDir)
    const localMap = new Map(localIndex.map(f => [f.relPath, f]))
    const peerMap = new Map(peerIndex.map(f => [f.relPath, f]))

    // 1. Scan peer index. Check if we need to request file
    for (const peerFile of peerIndex) {
      const localFile = localMap.get(peerFile.relPath)
      if (!localFile) {
        // Missing file. Request it from peer
        this.send({ type: 'request-file', subDir, relPath: peerFile.relPath })
      } else if (peerFile.mtime > localFile.mtime && peerFile.sha256 !== localFile.sha256) {
        // Peer has a newer version. Request it
        this.send({ type: 'request-file', subDir, relPath: peerFile.relPath })
      }
    }

    // 2. Scan local index. Check if we need to delete or push file
    for (const localFile of localIndex) {
      const peerFile = peerMap.get(localFile.relPath)
      if (!peerFile) {
        // Host has the note, but client deleted it. Keep or delete?
        // SQLite sync_tombstones table handles database deletes. If note delete tombstone exists:
        const dbPayload = await window.electronAPI.sync.getDbPayload()
        const isDeleted = dbPayload.tombstones.some(
          (t: { id: string; table_name: string }) => t.id === localFile.relPath && t.table_name === 'notes'
        )
        
        if (isDeleted) {
          this.send({ type: 'delete-file', subDir, relPath: localFile.relPath })
        } else {
          // Push new file to peer
          await this.sendFileInChunks(subDir, localFile.relPath)
        }
      } else if (localFile.mtime > peerFile.mtime && localFile.sha256 !== peerFile.sha256) {
        // Local has a newer version. Push to peer.
        await this.sendFileInChunks(subDir, localFile.relPath)
      }
    }
  }

  // Read file and send over DataChannel in 32KB chunks
  private async sendFileInChunks(subDir: 'notes' | 'media', relPath: string): Promise<void> {
    const fileBytes = await window.electronAPI.sync.readFileChunk(subDir, relPath)
    if (!fileBytes) return

    const CHUNK_SIZE = 32768 // 32KB
    const totalChunks = Math.ceil(fileBytes.length / CHUNK_SIZE)

    // Convert Uint8Array to string base64 for reliable JSON packaging
    const binary = Array.from(fileBytes).map(b => String.fromCharCode(b)).join('')
    const base64Content = btoa(binary)

    const totalLength = base64Content.length
    const base64ChunkSize = Math.ceil(totalLength / totalChunks)

    for (let i = 0; i < totalChunks; i++) {
      const start = i * base64ChunkSize
      const end = Math.min(start + base64ChunkSize, totalLength)
      const chunkData = base64Content.substring(start, end)

      this.send({
        type: 'file-chunk',
        subDir,
        relPath,
        chunkIndex: i,
        totalChunks,
        data: chunkData
      })
    }
  }

  // Safe packaging & sending via DataChannel
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private send(msg: any): void {
    if (this.dataChannel && this.dataChannel.readyState === 'open') {
      this.dataChannel.send(JSON.stringify(msg))
    }
  }

  public cleanup(): void {
    if (this.sse) {
      this.sse.close()
      this.sse = null
    }
    if (this.pc) {
      this.pc.close()
      this.pc = null
    }
    this.dataChannel = null
  }
}
