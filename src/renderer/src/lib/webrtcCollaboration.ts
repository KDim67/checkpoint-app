/**
 * WebRTC P2P Board Collaboration Coordinator.
 * Ephemeral signaling lobby over ntfy.sh.
 * Syncs workspace baseline on connect and broadcasts drag & drop, edits, deletes in real-time.
 */

import { useAppStore } from '../store/appStore'
import { deriveKey, deriveTopic, encryptData, decryptData, COLLAB_SALT } from './webrtcCrypto'
import {
  sendFramed,
  FrameAssembler,
  waitForIceGathering,
  onConnectionFailed,
  iceServers
} from './webrtcTransport'
import { normalizeCollabMessage, type CollabMessage } from '../../../shared/collabProtocol'
import { readSignalingMessage } from '../../../shared/signalingPayload'

interface CollabOptions {
  pairingCode: string
  isHost: boolean
  context: string
  mode: 'collaborative' | 'readonly'
  onProgress: (progress: string) => void
  onConnect: () => void
  onDisconnect: () => void
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  /**
   * Anything can arrive here: a caught unknown, or an RTCErrorEvent, which is
   * not an Error at all. Read it with errorMessage rather than reaching for
   * .message.
   */
  onError: (err: unknown) => void
  /**
   * Asked before the host's board replaces the local one. Joining wipes every
   * card and task in the target context, so this is the user's only chance to
   * stop it. Returning false aborts the join with the local board intact.
   */
  onConfirmBaseline: (info: { context: string; incomingItems: number }) => Promise<boolean>
}

export class WebRTCCollaborationCoordinator {
  private pc: RTCPeerConnection | null = null
  private dataChannel: RTCDataChannel | null = null
  private sse: EventSource | null = null
  private key: CryptoKey | null = null
  private options: CollabOptions
  
  private isApplyingRemote = false
  private connectionActive = false
  private assembler = new FrameAssembler()

  constructor(options: CollabOptions) {
    this.options = options
  }

  public async start(): Promise<void> {
    try {
      this.cleanup()
      this.key = await deriveKey(this.options.pairingCode, COLLAB_SALT)
      this.options.onProgress('Deriving security key...')

      // Hashed, so the pairing code never appears in the public topic name.
      const signalingRoom = `checkpoint-collab-${await deriveTopic(this.options.pairingCode, COLLAB_SALT)}`

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
    onConnectionFailed(pc, reason => this.options.onError(new Error(reason)))
    return pc
  }

  // Host: Listen for client offer
  private setupHostSignaling(room: string): void {
    this.sse = new EventSource(`https://ntfy.sh/${room}/sse`)
    this.options.onProgress('Waiting for client connection...')

    this.sse.onmessage = async (e) => {
      try {
        if (!this.key) return
        const signal = readSignalingMessage(e.data)
        if (!signal || signal.title === 'host-reply') return
        // A second offer would otherwise overwrite the connection being built.
        if (this.pc) return

        this.options.onProgress('Connecting with client...')

        let sdp: string
        try {
          const decryptedOffer = await decryptData(signal.body, this.key)
          sdp = JSON.parse(decryptedOffer).sdp
        } catch {
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
      
      if (this.sse) {
        this.sse.close()
        this.sse = null
      }
    } catch (err) {
      this.options.onError(err)
    }
  }

  // Client: Create offer
  private async setupClientConnection(room: string): Promise<void> {
    this.pc = this.newPeerConnection()

    this.dataChannel = this.pc.createDataChannel('collab-channel', { ordered: true })
    this.setupDataChannelHandlers()

    // Subscribe before publishing: ntfy's SSE stream only carries messages
    // posted after subscription, so publishing first can miss the host's reply.
    this.sse = new EventSource(`https://ntfy.sh/${room}/sse`)
    this.sse.onmessage = async (e) => {
      try {
        if (!this.key) return
        const signal = readSignalingMessage(e.data)
        if (!signal || signal.title !== 'host-reply') return
        if (!this.pc || this.pc.signalingState === 'stable') return

        this.options.onProgress('Securing collab link...')

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

      await fetch(`https://ntfy.sh/${room}`, {
        method: 'POST',
        headers: { 'Title': 'client-offer' },
        body: encryptedSdp
      })
      this.options.onProgress('Offer sent. Awaiting host pairing...')
    } catch (err) {
      this.options.onError(err)
    }
  }

  // Data channel handlers
  private setupDataChannelHandlers(): void {
    if (!this.dataChannel) return

    this.dataChannel.onopen = () => {
      this.connectionActive = true
      this.options.onConnect()
      this.sendBaselineIfHost()
    }

    // Serialized: mutations must apply in the order they were sent, and each
    // handler awaits IPC into the main process.
    let queue: Promise<void> = Promise.resolve()
    this.dataChannel.onmessage = (event) => {
      queue = queue.then(async () => {
        try {
          const msg = this.assembler.accept(event.data)
          if (msg !== null) await this.handleIncomingMessage(msg)
        } catch (err) {
          console.error('[Collab Coordinator] error handling message:', err)
          this.options.onError(err)
        }
      })
    }

    this.dataChannel.onclose = () => {
      this.options.onDisconnect()
      this.cleanup()
    }

    this.dataChannel.onerror = (err) => {
      this.options.onError(err)
    }
  }

  // Send baseline data if Host
  private async sendBaselineIfHost(): Promise<void> {
    if (!this.options.isHost || !this.dataChannel) return
    this.options.onProgress('Sending initial board state baseline...')

    try {
      // 1. Gather all database records for this context
      const fullDb = await window.electronAPI.sync.getDbPayload()
      const items = fullDb.items.filter(
        i => i.context === this.options.context && (i.type === 'card' || i.type === 'task')
      )
      const tags = fullDb.tags
      const itemTags = fullDb.item_tags.filter(it => items.some(item => item.id === it.item_id))
      const relations = fullDb.relations.filter(
        r => items.some(item => item.id === r.from_id || item.id === r.to_id)
      )

      await this.send({
        type: 'board-baseline',
        context: this.options.context,
        items,
        tags,
        itemTags,
        relations,
        mode: this.options.mode
      })

      // Bind local changes listener
      window.addEventListener('db-mutation', this.handleLocalMutation)
    } catch (err) {
      console.error('[Collab Host] Failed to compile baseline:', err)
    }
  }

  // Dispatch local changes to peer
  private handleLocalMutation = (event: Event): void => {
    if (this.isApplyingRemote || !this.connectionActive) return
    
    const e = event as CustomEvent
    const { detail } = e

    // Only this session's workspace goes over the wire.
    //
    // Create and update events carry the whole item, so the workspace is on
    // `detail.item.context`. A delete has no item (it is gone), so the
    // preload attaches the context it read just before deleting. Without that
    // this check simply did not apply to deletes, and deleting anything in any
    // other workspace was broadcast to the peer.
    const mutationContext: string | null =
      detail.item?.context ?? (typeof detail.context === 'string' ? detail.context : null)
    if (mutationContext !== null && mutationContext !== this.options.context) return


    // Event handlers cannot await; a failed broadcast must not become an
    // unhandled rejection.
    void this.send({ type: 'db-mutation-event', mutation: detail }).catch(err => {
      console.error('[Collab Coordinator] Failed to broadcast local change:', err)
    })
  }

  /**
   * Everything a peer sends arrives here, and nothing else does. The argument
   * is `unknown` on purpose: what came off the wire is only a message once it
   * has been through the normalizer.
   */
  private async handleIncomingMessage(raw: unknown): Promise<void> {
    if (!this.dataChannel) return

    const msg = normalizeCollabMessage(raw)
    if (!msg) {
      // Not applied and not fatal. A peer on a different build sending
      // something this one does not know is the ordinary case, and dropping the
      // session over it would be worse than ignoring the message.
      console.warn('[Collab Coordinator] Ignored a message this build does not understand.')
      return
    }

    switch (msg.type) {
      case 'board-baseline': {
        // applyBoardBaseline deletes every card and task in the target context
        // before seeding the host's. That is unrecoverable, and it used to run
        // the instant the channel opened. A user joining a session while
        // holding their own board of the same name simply lost it. Ask first.
        const accepted = await this.options.onConfirmBaseline({
          context: msg.context,
          incomingItems: msg.items.length
        })
        if (!accepted) {
          this.options.onProgress('Join cancelled: your local board was left untouched.')
          this.cleanup()
          this.options.onDisconnect()
          break
        }

        this.options.onProgress('Applying board baseline...')
        this.isApplyingRemote = true

        try {
          // Switch local workspace context and view to match shared board!
          const store = useAppStore.getState()
          store.setContext(msg.context)
          store.setView('kanban')

          // Wipe context items and seed
          await window.electronAPI.sync.applyBoardBaseline(msg.context, msg.items, msg.tags, msg.itemTags, msg.relations)
          
          window.dispatchEvent(new CustomEvent('kanban-refresh'))
          this.options.onProgress(`Joined board: ${msg.context}. Ready!`)
          
          // If collaborative mode, bind local writes listener
          if (msg.mode === 'collaborative') {
            window.addEventListener('db-mutation', this.handleLocalMutation)
          }
        } catch (err) {
          console.error('[Collab Client] Failed to seed baseline:', err)
        } finally {
          this.isApplyingRemote = false
        }
        break
      }

      case 'db-mutation-event': {
        this.isApplyingRemote = true
        try {
          await window.electronAPI.sync.applyRemoteMutation(msg.mutation)
          window.dispatchEvent(new CustomEvent('kanban-refresh'))
        } catch (err) {
          console.error('[Collab Coordinator] Failed to apply remote mutation:', err)
        } finally {
          this.isApplyingRemote = false
        }
        break
      }
    }
  }

  /**
   * A board baseline exceeds the 256 KB single-message ceiling on any board of
   * real size, so everything goes through the framing transport.
   */
  private async send(msg: CollabMessage): Promise<void> {
    if (!this.dataChannel || this.dataChannel.readyState !== 'open') return
    await sendFramed(this.dataChannel, msg)
  }

  public cleanup(): void {
    this.connectionActive = false
    window.removeEventListener('db-mutation', this.handleLocalMutation)
    
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
