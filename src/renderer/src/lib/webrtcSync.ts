/**
 * WebRTC P2P Sync Coordinator for internet/WAN sync.
 * Uses ntfy.sh for ephemeral, E2E encrypted signaling room matching,
 * and exchanges SQLite database records & note files over direct RTCDataChannels.
 */

import { deriveKey, deriveTopic, encryptData, decryptData, base64ToBytes, bytesToBase64, SYNC_SALT } from './webrtcCrypto'
import {
  sendFramed,
  FrameAssembler,
  flushChannel,
  waitForIceGathering,
  onConnectionFailed,
  iceServers
} from './webrtcTransport'

interface FileMetadata {
  relPath: string
  mtime: number
  size: number
  sha256: string
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

  private assembler = new FrameAssembler()
  private finished = false

  constructor(options: WebRTCSyncOptions) {
    this.options = options
  }

  public async start(): Promise<void> {
    try {
      this.cleanup()
      this.finished = false
      this.options.onProgress('Deriving security key...')
      this.key = await deriveKey(this.options.pairingCode, SYNC_SALT)

      // Hashed, so the pairing code never appears in the public topic name.
      const signalingRoom = `checkpoint-sync-${await deriveTopic(this.options.pairingCode, SYNC_SALT)}`
      this.options.onProgress('Security key derived. Connecting signaling lobby...')

      if (this.options.isHost) {
        this.setupHostSignaling(signalingRoom)
      } else {
        await this.setupClientConnection(signalingRoom)
      }
    } catch (err) {
      this.options.onError(err)
    }
  }

  /** Wires the failure paths every peer connection needs. */
  private newPeerConnection(): RTCPeerConnection {
    const pc = new RTCPeerConnection({ iceServers: iceServers() })
    onConnectionFailed(pc, reason => {
      if (!this.finished) this.options.onError(new Error(reason))
    })
    return pc
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
        // Skip our own replies, ntfy's keepalive/open events, and anything
        // without a body.
        if (!payload.text || payload.title === 'host-reply') return

        // A second offer arriving while one is already being answered used to
        // overwrite this.pc, orphaning the half-built connection and leaving
        // the client waiting on an answer that would never come.
        if (this.pc) return

        this.options.onProgress('Received connection offer. Establishing tunnel...')

        let sdp: string
        try {
          const decryptedOffer = await decryptData(payload.text, this.key)
          sdp = JSON.parse(decryptedOffer).sdp
        } catch {
          // Almost always a mismatched passcode. Previously this was logged to
          // the console and swallowed, so the host sat on "Host active..."
          // forever while the user assumed it was still connecting.
          this.options.onError(
            new Error('Could not read the incoming offer: the peer entered a different passcode.')
          )
          return
        }

        this.pc = this.newPeerConnection()

        // Capture data channel when client connects
        this.pc.ondatachannel = (event) => {
          this.dataChannel = event.channel
          this.setupDataChannelHandlers()
        }

        await this.pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp }))
        const answer = await this.pc.createAnswer()
        await this.pc.setLocalDescription(answer)

        // Bounded wait rather than relying on a null-candidate event that may
        // never arrive; proceed with whatever was gathered.
        await waitForIceGathering(this.pc)
        await this.sendHostAnswer(room)
      } catch (err) {
        this.options.onError(err)
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
    this.pc = this.newPeerConnection()

    this.dataChannel = this.pc.createDataChannel('sync-channel', { ordered: true })
    this.setupDataChannelHandlers()

    // Subscribe BEFORE publishing the offer. The host answers as soon as it
    // sees the offer, and ntfy's SSE stream only carries messages published
    // after subscription, so publishing first risks missing the reply
    // entirely and waiting forever.
    this.sse = new EventSource(`https://ntfy.sh/${room}/sse`)
    this.sse.onmessage = async (e) => {
      try {
        if (!this.key) return
        const payload = JSON.parse(e.data)
        if (payload.title !== 'host-reply' || !payload.text) return
        // Ignore a duplicate answer once negotiation is done; setting a remote
        // description twice throws in the middle of an active connection.
        if (!this.pc || this.pc.signalingState === 'stable') return

        this.options.onProgress('Response answer received. Securing direct connection...')

        let sdp: string
        try {
          const decryptedAnswer = await decryptData(payload.text, this.key)
          sdp = JSON.parse(decryptedAnswer).sdp
        } catch {
          this.options.onError(
            new Error('Could not read the host reply: check that both sides use the same passcode.')
          )
          return
        }

        await this.pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp }))

        if (this.sse) {
          this.sse.close()
          this.sse = null
        }
      } catch (err) {
        this.options.onError(err)
      }
    }

    const offer = await this.pc.createOffer()
    await this.pc.setLocalDescription(offer)
    await waitForIceGathering(this.pc)
    await this.publishClientOffer(room)
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

    // Messages arrive faster than they can be applied (each handler awaits IPC
    // into the main process), and the handlers mutate shared counters and the
    // database. Serializing them on a promise chain keeps ordering intact and
    // stops two merges from interleaving.
    let queue: Promise<void> = Promise.resolve()
    this.dataChannel.onmessage = (event) => {
      queue = queue.then(async () => {
        try {
          const message = this.assembler.accept(event.data)
          if (message !== null) await this.handleIncomingMessage(message)
        } catch (err) {
          console.error('[WebRTC Sync] Error handling P2P message:', err)
          this.options.onError(err)
        }
      })
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

    await this.send({
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

        await this.send({
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
        await this.send({ type: 'sync-finished' })
        await this.finish()
        break
      }

      case 'sync-finished': {
        this.options.onProgress('Sync completed successfully!')
        await this.finish()
        break
      }

      case 'file': {
        // The transport reassembles the frames, so a file arrives here whole.
        this.options.onProgress(`Writing ${msg.relPath}...`)
        const bytes = base64ToBytes(msg.data)
        await window.electronAPI.sync.writeFileChunk(
          msg.subDir,
          msg.relPath,
          bytes.buffer as ArrayBuffer,
          msg.mtime
        )
        this.filesSyncedCount++
        break
      }

      case 'request-file': {
        // Peer requested a file. Read it and send it.
        await this.sendFile(msg.subDir, msg.relPath)
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
        await this.send({ type: 'request-file', subDir, relPath: peerFile.relPath })
      } else if (peerFile.mtime > localFile.mtime && peerFile.sha256 !== localFile.sha256) {
        // Peer has a newer version. Request it
        await this.send({ type: 'request-file', subDir, relPath: peerFile.relPath })
      }
    }

    // Tombstones are needed only to tell "deleted locally" from "new on this
    // side", and they do not change during the pass. This used to be fetched
    // inside the loop below, so a peer missing 100 files triggered 100 full
    // dumps of every table in the database across IPC.
    const deletedRelPaths = new Set(
      (await window.electronAPI.sync.getDbPayload()).tombstones
        .filter((t: { table_name: string }) => t.table_name === 'notes')
        .map((t: { id: string }) => t.id)
    )

    // 2. Scan local index. Check if we need to delete or push file
    for (const localFile of localIndex) {
      const peerFile = peerMap.get(localFile.relPath)
      if (!peerFile) {
        // Absent on the peer: either we deleted it (tell them) or it is new
        // here (send it).
        if (deletedRelPaths.has(localFile.relPath)) {
          await this.send({ type: 'delete-file', subDir, relPath: localFile.relPath })
        } else {
          await this.sendFile(subDir, localFile.relPath)
        }
      } else if (localFile.mtime > peerFile.mtime && localFile.sha256 !== peerFile.sha256) {
        // Local has a newer version. Push to peer.
        await this.sendFile(subDir, localFile.relPath)
      }
    }
  }

  /**
   * Reads a file and hands it to the transport as one logical message.
   *
   * Chunking used to live here: it computed a chunk count from the raw byte
   * length, then sliced the (33% larger) base64 string that many ways, and
   * pushed every piece in a tight loop with no regard for the send queue.
   * That overran the 16 MB buffer and lost frames outright. Framing now
   * belongs to the transport, which also applies backpressure.
   */
  private async sendFile(subDir: 'notes' | 'media', relPath: string): Promise<void> {
    const fileBytes = await window.electronAPI.sync.readFileChunk(subDir, relPath)
    if (!fileBytes) return

    this.options.onProgress(`Sending ${relPath}...`)
    await this.send({
      type: 'file',
      subDir,
      relPath,
      data: bytesToBase64(fileBytes)
    })
  }

  /**
   * All outbound traffic goes through here. sendFramed splits anything past
   * the 256 KB SCTP message ceiling and waits on the send queue, so callers
   * never have to think about either limit.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async send(msg: any): Promise<void> {
    if (!this.dataChannel || this.dataChannel.readyState !== 'open') return
    await sendFramed(this.dataChannel, msg)
  }

  /**
   * Ends the session cleanly. The final message has to reach the wire before
   * the connection closes: close() discards whatever is still buffered, so
   * signalling completion and tearing down in the same breath meant the peer
   * frequently never learned the sync had finished.
   */
  private async finish(): Promise<void> {
    if (this.finished) return
    this.finished = true
    if (this.dataChannel) await flushChannel(this.dataChannel)
    this.cleanup()
    this.options.onComplete({ dbUpdates: this.dbUpdatesCount, filesSynced: this.filesSyncedCount })
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
