/**
 * WebRTC P2P Board Collaboration Coordinator.
 * Ephemeral signaling lobby over ntfy.sh.
 * Syncs workspace baseline on connect and broadcasts drag & drop, edits, deletes in real-time.
 */

import { useAppStore } from '../store/appStore'
import { deriveKey, encryptData, decryptData, COLLAB_SALT } from './webrtcCrypto'

interface CollabOptions {
  pairingCode: string
  isHost: boolean
  context: string
  mode: 'collaborative' | 'readonly'
  onProgress: (progress: string) => void
  onConnect: () => void
  onDisconnect: () => void
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onError: (err: any) => void
}

export class WebRTCCollaborationCoordinator {
  private pc: RTCPeerConnection | null = null
  private dataChannel: RTCDataChannel | null = null
  private sse: EventSource | null = null
  private key: CryptoKey | null = null
  private options: CollabOptions
  
  private isApplyingRemote = false
  private connectionActive = false

  constructor(options: CollabOptions) {
    this.options = options
  }

  public async start(): Promise<void> {
    try {
      this.cleanup()
      this.key = await deriveKey(this.options.pairingCode, COLLAB_SALT)
      this.options.onProgress('Deriving security key...')

      const signalingRoom = `checkpoint-collab-${this.options.pairingCode}`
      
      if (this.options.isHost) {
        this.setupHostSignaling(signalingRoom)
      } else {
        await this.setupClientConnection(signalingRoom)
      }
    } catch (err) {
      this.options.onError(err)
    }
  }

  // Host: Listen for client offer
  private setupHostSignaling(room: string): void {
    this.sse = new EventSource(`https://ntfy.sh/${room}/sse`)
    this.options.onProgress('Waiting for client connection...')

    this.sse.onmessage = async (e) => {
      try {
        if (!this.key) return
        const payload = JSON.parse(e.data)
        if (!payload.text || payload.title === 'host-reply') return

        this.options.onProgress('Connecting with client...')
        const decryptedOffer = await decryptData(payload.text, this.key)
        const { sdp } = JSON.parse(decryptedOffer)

        this.pc = new RTCPeerConnection({
          iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
        })

        this.pc.ondatachannel = (event) => {
          this.dataChannel = event.channel
          this.setupDataChannelHandlers()
        }

        this.pc.onicecandidate = (event) => {
          if (!event.candidate) {
            this.sendHostAnswer(room)
          }
        }

        await this.pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp }))
        const answer = await this.pc.createAnswer()
        await this.pc.setLocalDescription(answer)
      } catch (err) {
        console.error('[Collab Host] signaling error:', err)
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
    this.pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    })

    this.dataChannel = this.pc.createDataChannel('collab-channel', { ordered: true })
    this.setupDataChannelHandlers()

    const offer = await this.pc.createOffer()
    await this.pc.setLocalDescription(offer)

    this.pc.onicecandidate = (event) => {
      if (!event.candidate) {
        this.publishClientOffer(room)
      }
    }

    this.sse = new EventSource(`https://ntfy.sh/${room}/sse`)
    this.sse.onmessage = async (e) => {
      try {
        if (!this.key) return
        const payload = JSON.parse(e.data)
        if (payload.title !== 'host-reply') return

        this.options.onProgress('Securing collab link...')
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

    this.dataChannel.onmessage = async (event) => {
      try {
        const msg = JSON.parse(event.data)
        await this.handleIncomingMessage(msg)
      } catch (err) {
        console.error('[Collab Coordinator] error parsing message:', err)
      }
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const items = (fullDb as any).items.filter((i: any) => i.context === this.options.context && (i.type === 'card' || i.type === 'task'))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tags = (fullDb as any).tags
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const itemTags = (fullDb as any).item_tags.filter((it: any) => items.some((item: any) => item.id === it.item_id))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const relations = (fullDb as any).relations.filter((r: any) => items.some((item: any) => item.id === r.from_id || item.id === r.to_id))

      this.send({
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

    // Filter mutations. If it's item-related, check if context is correct.
    if (detail.item && detail.item.context !== this.options.context) return
    
    this.send({
      type: 'db-mutation-event',
      mutation: detail
    })
  }

  // Handle incoming messages
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async handleIncomingMessage(msg: any): Promise<void> {
    if (!this.dataChannel) return

    switch (msg.type) {
      case 'board-baseline': {
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private send(msg: any): void {
    if (this.dataChannel && this.dataChannel.readyState === 'open') {
      this.dataChannel.send(JSON.stringify(msg))
    }
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
