/** WAN sync: ntfy.sh signalling, db rows and note files over data channels */

import { deriveKey, deriveTopic, encryptData, decryptData, base64ToBytes, bytesToBase64, SYNC_SALT } from './webrtcCrypto'
import { readSignalingMessage, signalingPublishError } from '../../../shared/signalingPayload'
import { signalingPublishUrl, signalingStreamUrl } from '../../../shared/signalingHost'
import {
  sendFramed,
  FrameAssembler,
  flushChannel,
  waitForIceGathering,
  onConnectionFailed,
  iceServers
} from './webrtcTransport'
import * as syncApi from '../data/sync'

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

      // hashed, the pairing code never appears in the public topic
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

  /** failure paths every peer connection needs */
  private newPeerConnection(): RTCPeerConnection {
    const pc = new RTCPeerConnection({ iceServers: iceServers() })
    onConnectionFailed(pc, reason => {
      if (!this.finished) this.options.onError(new Error(reason))
    })
    return pc
  }

  // host: answer the client's offer
  private setupHostSignaling(room: string): void {
    const sseUrl = signalingStreamUrl(room)
    this.sse = new EventSource(sseUrl)

    this.options.onProgress(`Host active. Send passcode to peer...`)

    this.sse.onmessage = async (e) => {
      try {
        if (!this.key) return
        // skips our replies, keepalives and empty events
        const signal = readSignalingMessage(e.data)
        if (!signal || signal.title === 'host-reply') return

        // a second offer used to overwrite this.pc and orphan the handshake
        if (this.pc) return

        this.options.onProgress('Received connection offer. Establishing tunnel...')

        let sdp: string
        try {
          const decryptedOffer = await decryptData(signal.body, this.key)
          sdp = JSON.parse(decryptedOffer).sdp
        } catch {
          // almost always a wrong passcode; it used to be swallowed and the host waited forever
          this.options.onError(
            new Error('Could not read the incoming offer: the peer entered a different passcode.')
          )
          return
        }

        this.pc = this.newPeerConnection()

        this.pc.ondatachannel = (event) => {
          this.dataChannel = event.channel
          this.setupDataChannelHandlers()
        }

        await this.pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp }))
        const answer = await this.pc.createAnswer()
        await this.pc.setLocalDescription(answer)

        // bounded wait, a null-candidate event may never come
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

      const res = await fetch(signalingPublishUrl(room), {
        method: 'POST',
        headers: { 'Title': 'host-reply' },
        body: encryptedSdp
      })
      const failure = signalingPublishError(res.status)
      if (failure) {
        this.options.onError(new Error(failure))
        return
      }
      this.options.onProgress('Signaling completed. Activating WebRTC data link...')
      
      if (this.sse) {
        this.sse.close()
        this.sse = null
      }
    } catch (err) {
      this.options.onError(err)
    }
  }

  // client: offer and wait for the answer
  private async setupClientConnection(room: string): Promise<void> {
    this.pc = this.newPeerConnection()

    this.dataChannel = this.pc.createDataChannel('sync-channel', { ordered: true })
    this.setupDataChannelHandlers()

    // subscribe before publishing, ntfy's SSE only carries later messages
    this.sse = new EventSource(signalingStreamUrl(room))
    this.sse.onmessage = async (e) => {
      try {
        if (!this.key) return
        const signal = readSignalingMessage(e.data)
        if (!signal || signal.title !== 'host-reply') return
        // ignore a duplicate answer, setting it twice throws mid-connection
        if (!this.pc || this.pc.signalingState === 'stable') return

        this.options.onProgress('Response answer received. Securing direct connection...')

        let sdp: string
        try {
          const decryptedAnswer = await decryptData(signal.body, this.key)
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

      const res = await fetch(signalingPublishUrl(room), {
        method: 'POST',
        headers: { 'Title': 'client-offer' },
        body: encryptedSdp
      })
      const failure = signalingPublishError(res.status)
      if (failure) {
        this.options.onError(new Error(failure))
        return
      }
      this.options.onProgress('Offer sent. Waiting for peer authorization...')
    } catch (err) {
      this.options.onError(err)
    }
  }

  private setupDataChannelHandlers(): void {
    if (!this.dataChannel) return

    this.dataChannel.onopen = () => {
      this.options.onProgress('Direct P2P Link Established. Starting database sync...')
      this.isHostSync()
    }

    // serialised: handlers await IPC and share counters, so merges can't interleave
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

  private async isHostSync(): Promise<void> {
    if (!this.options.isHost || !this.dataChannel) return
    
    this.options.onProgress('Exchanging local database states...')
    const dbPayload = await syncApi.getDbPayload()
    const notesIndex = await syncApi.getFileIndex('notes')
    const mediaIndex = await syncApi.getFileIndex('media')

    await this.send({
      type: 'db-payload-offer',
      dbPayload,
      notesIndex,
      mediaIndex
    })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async handleIncomingMessage(msg: any): Promise<void> {
    if (!this.dataChannel) return

    switch (msg.type) {
      case 'db-payload-offer': {
        this.options.onProgress('Merging peer database and files...')
        
        const result = await syncApi.applyDbPayload(msg.dbPayload)
        this.dbUpdatesCount += result.pulledNewerCount
        this.options.onProgress(`Merged database: ${result.pulledNewerCount} records integrated.`)

        await this.alignFilesAndSync('notes', msg.notesIndex)
        await this.alignFilesAndSync('media', msg.mediaIndex)

        const clientDbPayload = await syncApi.getDbPayload()
        const clientNotesIndex = await syncApi.getFileIndex('notes')
        const clientMediaIndex = await syncApi.getFileIndex('media')

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
        const result = await syncApi.applyDbPayload(msg.dbPayload)
        this.dbUpdatesCount += result.pulledNewerCount

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
        // the transport reassembles frames, the file arrives whole
        this.options.onProgress(`Writing ${msg.relPath}...`)
        const bytes = base64ToBytes(msg.data)
        await syncApi.writeFileChunk(
          msg.subDir,
          msg.relPath,
          bytes.buffer as ArrayBuffer,
          msg.mtime
        )
        this.filesSyncedCount++
        break
      }

      case 'request-file': {
        await this.sendFile(msg.subDir, msg.relPath)
        break
      }

      case 'delete-file': {
        await syncApi.deleteFile(msg.subDir, msg.relPath)
        this.filesSyncedCount++
        break
      }
    }
  }

  // compare indexes, request missing or push newer
  private async alignFilesAndSync(subDir: 'notes' | 'media', peerIndex: FileMetadata[]): Promise<void> {
    const localIndex = await syncApi.getFileIndex(subDir)
    const localMap = new Map(localIndex.map(f => [f.relPath, f]))
    const peerMap = new Map(peerIndex.map(f => [f.relPath, f]))

    for (const peerFile of peerIndex) {
      const localFile = localMap.get(peerFile.relPath)
      if (!localFile) {
        await this.send({ type: 'request-file', subDir, relPath: peerFile.relPath })
      } else if (peerFile.mtime > localFile.mtime && peerFile.sha256 !== localFile.sha256) {
        await this.send({ type: 'request-file', subDir, relPath: peerFile.relPath })
      }
    }

    // fetched once; inside the loop 100 missing files meant 100 full table dumps
    const deletedRelPaths = new Set(
      (await syncApi.getDbPayload()).tombstones
        .filter((t: { table_name: string }) => t.table_name === 'notes')
        .map((t: { id: string }) => t.id)
    )

    for (const localFile of localIndex) {
      const peerFile = peerMap.get(localFile.relPath)
      if (!peerFile) {
        // missing on the peer: deleted here (tell them) or new here (send it)
        if (deletedRelPaths.has(localFile.relPath)) {
          await this.send({ type: 'delete-file', subDir, relPath: localFile.relPath })
        } else {
          await this.sendFile(subDir, localFile.relPath)
        }
      } else if (localFile.mtime > peerFile.mtime && localFile.sha256 !== peerFile.sha256) {
        await this.sendFile(subDir, localFile.relPath)
      }
    }
  }

  /** one logical message, the transport frames it with backpressure; hand-chunking overran the 16 MB buffer */
  private async sendFile(subDir: 'notes' | 'media', relPath: string): Promise<void> {
    const fileBytes = await syncApi.readFileChunk(subDir, relPath)
    if (!fileBytes) return

    this.options.onProgress(`Sending ${relPath}...`)
    await this.send({
      type: 'file',
      subDir,
      relPath,
      data: bytesToBase64(fileBytes)
    })
  }

  /** sendFramed splits past 256 KB and waits on the queue */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async send(msg: any): Promise<void> {
    if (!this.dataChannel || this.dataChannel.readyState !== 'open') return
    await sendFramed(this.dataChannel, msg)
  }

  /** send the last message before closing, close() drops what's buffered */
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
