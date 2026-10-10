/** WAN sync: paired through an ntfy.sh room with CPace, then db rows and note files over a data channel */

import { base64ToBytes, bytesToBase64 } from './webrtcCrypto'
import { GuestPairingRoom, HostPairing } from './pairingRoom'
import { BAD_CODE_MESSAGE, MAX_PAIRING_FAILURES, newGuestId, parseInternetCode } from '../../../shared/internetPairing'
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

/** the sdp out of sealed connection details; anything else is refused */
function sdpOf(details: string): string {
  const parsed: unknown = JSON.parse(details)
  const sdp = parsed && typeof parsed === 'object' ? (parsed as { sdp?: unknown }).sdp : undefined
  if (typeof sdp !== 'string' || !sdp) throw new Error('The other computer sent connection details Checkpoint could not read.')
  return sdp
}

export class WebRTCSyncCoordinator {
  private pc: RTCPeerConnection | null = null
  private dataChannel: RTCDataChannel | null = null
  private pairing: HostPairing | GuestPairingRoom | null = null
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
      const code = parseInternetCode(this.options.pairingCode)
      if (!code) throw new Error(BAD_CODE_MESSAGE)
      this.options.onProgress('Opening the pairing room...')

      if (this.options.isHost) {
        const pairing = new HostPairing({
          code,
          purpose: 'sync',
          onOffer: (_guest, details, answer) => {
            this.answerOffer(details, answer).catch(err => this.options.onError(err))
          },
          onRefused: (failures, spent) => {
            if (spent) this.options.onError(new Error(`${MAX_PAIRING_FAILURES} wrong codes were tried, so this code no longer works. Start again for a new one.`))
            else this.options.onProgress(`Someone tried a wrong code (${failures} of ${MAX_PAIRING_FAILURES}). Still waiting.`)
          },
          onError: err => this.options.onError(err)
        })
        this.pairing = pairing
        await pairing.start()
        this.options.onProgress('Waiting in the pairing room. Enter this code on the other computer.')
      } else {
        await this.join(code)
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

  // host: the guest proved the code, so answer its offer
  private async answerOffer(details: string, answer: (details: string) => Promise<void>): Promise<void> {
    // one guest per session; a second offer used to overwrite this.pc and orphan the handshake
    if (this.pc) return
    const sdp = sdpOf(details)
    this.options.onProgress('The other computer has the code. Connecting directly...')
    const pc = this.newPeerConnection()
    this.pc = pc

    pc.ondatachannel = (event) => {
      this.dataChannel = event.channel
      this.setupDataChannelHandlers()
    }

    await pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp }))
    await pc.setLocalDescription(await pc.createAnswer())
    // bounded wait, a null-candidate event may never come
    await waitForIceGathering(pc)
    await answer(JSON.stringify({ sdp: pc.localDescription?.sdp }))
    this.pairing?.close()
    this.pairing = null
    this.options.onProgress('Paired. Activating the direct link...')
  }

  // guest: offer, sealed, once the host has answered the code
  private async join(code: NonNullable<ReturnType<typeof parseInternetCode>>): Promise<void> {
    const pc = this.newPeerConnection()
    this.pc = pc
    this.dataChannel = pc.createDataChannel('sync-channel', { ordered: true })
    this.setupDataChannelHandlers()

    // gathered while the pairing runs, so the offer is ready when the keys are
    const offer = (async () => {
      await pc.setLocalDescription(await pc.createOffer())
      await waitForIceGathering(pc)
      return JSON.stringify({ sdp: pc.localDescription?.sdp })
    })()
    offer.catch(() => {})

    const pairing = new GuestPairingRoom({
      code,
      purpose: 'sync',
      guest: newGuestId(),
      offer,
      onAnswer: details => {
        this.options.onProgress('Paired. Securing the direct connection...')
        pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: sdpOf(details) }))
          .catch(err => this.options.onError(err))
      },
      onError: err => this.options.onError(err)
    })
    this.pairing = pairing
    await pairing.start()
    this.options.onProgress('Code sent. Waiting for the other computer...')
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
    this.pairing?.close()
    this.pairing = null
    if (this.pc) {
      this.pc.close()
      this.pc = null
    }
    this.dataChannel = null
  }
}
