/**
 * WebRTC P2P Board Collaboration Coordinator.
 * Ephemeral signaling lobby over ntfy.sh.
 * Syncs workspace baseline on connect and broadcasts drag & drop, edits, deletes in real-time.
 */

import { useAppStore } from '../store/appStore'
import { deriveKey, deriveTopic, encryptData, decryptData, COLLAB_SALT } from './webrtcCrypto'
import {
  sendFramed,
  closeGracefully,
  describeChannelError,
  FrameAssembler,
  waitForIceGathering,
  onConnectionFailed,
  iceServers
} from './webrtcTransport'
import {
  normalizeCollabMessage,
  normalizeRemoteMutation,
  retargetMutation,
  type BoardBaselineMessage,
  type CollabMessage,
  type CollabMode,
  type MergeProposalMessage
} from '../../../shared/collabProtocol'
import { describeMerge, mergeBoards, mergeImpact, type MergeImpact } from '../../../shared/boardMerge'
import type { Item } from '../../../shared/types'
import { INSTALL_ID_KEY, newInstallId, readInstallId } from '../../../shared/identity'
import { readSignalingMessage, signalingPublishError } from '../../../shared/signalingPayload'
import { registerSharedWorkspace } from './createWorkspace'
import { BOARD_CONFIG_EVENT, loadBoardConfig, saveBoardConfig } from './boardConfig'
import { normalizeBoardConfig } from '../../../shared/boardModel'

interface CollabOptions {
  pairingCode: string
  isHost: boolean
  context: string
  mode: CollabMode
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
   * Asked only when the incoming board would land on top of one that already
   * exists here. Replacing wipes every card and task under that slug, so this
   * is the user's one chance to say no, or to take the board as a copy and
   * keep what they had.
   */
  onResolveBaseline: (
    info: { context: string; incomingItems: number; mode: CollabMode }
  ) => Promise<BaselineChoice>
  /** Your name, sent with a deliberate goodbye so the peer can say who left. */
  displayName?: string
  /** One guest went away. The session stays open for them to come back. */
  onPeerLeft?: (name: string) => void
  /** Everyone currently in the room. The host knows; the guests are told. */
  onRoster?: (members: { id: string; name: string }[]) => void
  /**
   * What this side is allowed to do, as the host has it. Arrives with the
   * board, and again whenever the host changes its mind.
   */
  onMode?: (mode: CollabMode) => void
  /** The host showed this side the door. Not the same as them leaving. */
  onRemoved?: (by: string) => void
  /**
   * A guest merged its copy with the board it joined and is offering the
   * result. Asked of the host only, whose answer is the room's: see
   * BoardResetMessage. Answering no leaves this board exactly as it is.
   */
  onMergeProposed?: (info: { by: string; impact: MergeImpact }) => Promise<boolean>
  /** What the host did with the merge this side offered. */
  onMergeAnswer?: (accepted: boolean, by: string, reason: string) => void
  /** The host took someone's merge, and this is the board now. */
  onBoardReset?: (by: string) => void
}

/** The tables whose tombstones hold a row id, and so mean something to a merge. */
const MERGEABLE_TABLES = new Set(['items', 'tags', 'relations'])

/**
 * Where the board is remembered as it stood when two copies were last the same.
 *
 * Written every time the two sides are known to agree: when a baseline arrives,
 * and when a merge is taken. A later merge of the same pair reads it as the
 * common ancestor and can tell a card somebody changed from a card somebody
 * merely saved.
 *
 * Per workspace and per peer. The workspace is what a session is about, and the
 * peer is who the agreement was with: boards called "default" are everywhere,
 * and an ancestor borrowed from a different person decides conflicts by a
 * history the two of you never had. Peerless keys the name alone, which is
 * where a board agreed with a build that sends no id still lands.
 */
const mergeBaseKey = (context: string, peer: string): string =>
  peer ? `merge_base_${context}_${peer}` : `merge_base_${context}`

/** Just enough of each card to say whether it has moved since. */
interface BaseCard {
  id: string
  updated_at: number
  metadata: string
}

async function readMergeBase(context: string, peer: string): Promise<Map<string, Item>> {
  try {
    const raw = await window.electronAPI.db.getSetting(mergeBaseKey(context, peer))
    if (!Array.isArray(raw)) return new Map()
    const base = new Map<string, Item>()
    for (const entry of raw as BaseCard[]) {
      if (!entry || typeof entry.id !== 'string') continue
      // Only the three fields the comparison reads are stored, so the rest is
      // filled in to satisfy the shape and never looked at.
      base.set(entry.id, {
        id: entry.id,
        updated_at: typeof entry.updated_at === 'number' ? entry.updated_at : 0,
        metadata: typeof entry.metadata === 'string' ? entry.metadata : '{}'
      } as Item)
    }
    return base
  } catch (err) {
    console.warn('[Collab] Could not read the merge base:', err)
    return new Map()
  }
}

/**
 * Records what both sides hold right now.
 *
 * Only the stamp and the metadata, because that is all the comparison reads and
 * a whole board copy in a settings row would be the same data stored twice.
 */
async function writeMergeBase(context: string, peer: string, items: Item[]): Promise<void> {
  try {
    const base: BaseCard[] = items.map(item => ({
      id: item.id,
      updated_at: item.updated_at,
      metadata: item.metadata
    }))
    await window.electronAPI.db.setSetting(mergeBaseKey(context, peer), base)
  } catch (err) {
    console.warn('[Collab] Could not record the merge base:', err)
  }
}

/**
 * What to do with an arriving board.
 *
 * 'copy' carries its own slug rather than deriving one here: the caller holds
 * the workspace list, and two places computing the same name is two places
 * that can disagree about it.
 */
export type BaselineChoice =
  | { action: 'replace' }
  | { action: 'copy'; slug: string }
  /** Keep this side's board and fold theirs into it. Loses nothing either way. */
  | { action: 'merge' }
  | { action: 'cancel' }

/**
 * One connection to one peer.
 *
 * A host holds several, a guest holds the one to its host. That is the whole of
 * the difference between the two roles at this level.
 */
interface PeerLink {
  id: string
  pc: RTCPeerConnection
  channel: RTCDataChannel | null
  /** Frames arrive interleaved per connection, so the reassembly is per link. */
  assembler: FrameAssembler
  /** As they call themselves. Empty until they have said hello. */
  name: string
  /** Their install, which is what a removal is remembered against. Empty for an older peer. */
  install: string
  /** Messages apply in the order they arrived, and each one awaits IPC. */
  queue: Promise<void>
  open: boolean
}

/** The one link a guest has. A guest never holds more than the host. */
const HOST_LINK = 'host'

/** Short enough to fit an ntfy title, long enough not to collide. */
function newPeerId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/** This install's id, minted on first use and kept from then on. */
async function loadInstallId(): Promise<string> {
  try {
    const stored = readInstallId(await window.electronAPI.db.getSetting(INSTALL_ID_KEY))
    if (stored) return stored
    const minted = newInstallId()
    await window.electronAPI.db.setSetting(INSTALL_ID_KEY, minted)
    return minted
  } catch (err) {
    // Without one this side simply cannot be blocked, which is the old
    // behaviour rather than a reason to refuse the session.
    console.warn('[Collab Coordinator] Could not read this install id:', err)
    return ''
  }
}

export class WebRTCCollaborationCoordinator {
  /**
   * Every peer this side is talking to, by id.
   *
   * The host answers each offer with its own connection rather than ignoring
   * every offer after the first, which is what made the session two people.
   */
  private links = new Map<string, PeerLink>()

  /**
   * Removed, and refused if they come back.
   *
   * Keyed on the other side's install id, which survives them restarting. The
   * id published for signalling is minted per attempt, so blocking that alone
   * made a removal last only until they reopened the app.
   */
  private blocked = new Set<string>()

  /** This install's own id, read once so an offer can carry it. */
  private installId = ''

  /** This side's own id, published with its offer so answers can be addressed. */
  private myPeerId = newPeerId()

  private sse: EventSource | null = null
  private key: CryptoKey | null = null
  private options: CollabOptions

  private isApplyingRemote = false

  /**
   * The workspace this session is actually working in, and the name both peers
   * call it on the wire. They differ only for someone who joined a shared board
   * as a copy, which is why they are two fields rather than one.
   *
   * The local one used to be read from options.context, which for a joiner is
   * whatever workspace they happened to be sitting in when they clicked Join.
   * The baseline lands in the host's workspace and switches to it, so that
   * comparison was against the wrong name and every edit the joiner made was
   * filtered out and never sent.
   */
  private sessionContext: string
  private wireContext: string

  /** Kept so a host whose guest left can reopen the same room rather than mint a new code. */
  private signalingRoom = ''

  /** Set once the session is deliberately over, so its own closing events say nothing. */
  private ended = false

  /** Which installation is hosting, as the peer key a joiner files its board under. */
  private hostInstall = ''

  /**
   * A merge is being decided on right now.
   *
   * One at a time, and the rest are refused rather than queued. Every proposal
   * is the whole board as its author found it, so a second one decided after
   * the first went in would put back exactly what the first took away, and the
   * author of it never saw the board they are overwriting.
   */
  private decidingMerge = false

  /** This side offered a merge, so an answer to one is addressed to it. */
  private offeredMerge = false

  constructor(options: CollabOptions) {
    this.options = options
    this.sessionContext = options.context
    this.wireContext = options.context
  }

  public async start(): Promise<void> {
    try {
      this.cleanup()
      // After the cleanup, which sets it. Left standing it would silence every
      // close event of the session about to begin: no disconnect ever reported,
      // and a host that never reopened its room.
      this.ended = false
      this.installId = await loadInstallId()
      this.key = await deriveKey(this.options.pairingCode, COLLAB_SALT)
      this.options.onProgress('Deriving security key...')

      // Hashed, so the pairing code never appears in the public topic name.
      const signalingRoom = `checkpoint-collab-${await deriveTopic(this.options.pairingCode, COLLAB_SALT)}`
      this.signalingRoom = signalingRoom

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

  private openLink(id: string, install = ''): PeerLink {
    const link: PeerLink = {
      id,
      pc: this.newPeerConnection(),
      channel: null,
      assembler: new FrameAssembler(),
      name: '',
      install,
      queue: Promise.resolve(),
      open: false
    }
    this.links.set(id, link)
    return link
  }

  /** Everyone currently connected, in the order they arrived. */
  private roster(): { id: string; name: string }[] {
    // The host first, and always. A list built only from the host's own
    // connections shows a guest every other guest and not the person actually
    // sharing the board, which is the one name they came for.
    return [
      { id: HOST_LINK, name: this.options.displayName ?? '' },
      ...[...this.links.values()]
        .filter(link => link.open)
        .map(link => ({ id: link.id, name: link.name }))
    ]
  }

  /**
   * Tells everyone who is in the room.
   *
   * Only the host knows: the guests are connected to it and not to each other,
   * so the list has to come from the middle. Sent on every change rather than
   * asked for, because a guest with a stale list is a guest who thinks someone
   * is still here.
   */
  private publishRoster(): void {
    if (!this.options.isHost) return
    const members = this.roster()
    // Nobody is shown to themselves. The host is the entry under HOST_LINK, and
    // each guest is the entry under the id it published its own offer with.
    this.options.onRoster?.(members.filter(member => member.id !== HOST_LINK))
    void this.broadcast({ type: 'roster', members }).catch(err => {
      console.warn('[Collab Host] Could not send the roster:', err)
    })
  }

  // Host: Listen for client offers, one connection each

  /**
   * Who an offer or an answer is for.
   *
   * A guest publishes under `offer:<its id>` and the host replies under
   * `answer:<that id>`, so several guests can share one signalling room without
   * reading each other's half of the handshake. A build that predates this
   * sends the bare titles, and is answered the old way as the one unnamed
   * guest: never be stricter than the sender.
   */
  private static offerIdFrom(title: string): string | null {
    if (title.startsWith('offer:')) return title.slice('offer:'.length) || null
    return title === 'client-offer' ? 'legacy' : null
  }

  private setupHostSignaling(room: string): void {
    // A host reopens the room every time it loses a guest, and without this
    // each reopening left the previous stream running: a leaked connection per
    // guest, and two live handlers racing to answer the next offer.
    this.sse?.close()
    this.sse = new EventSource(`https://ntfy.sh/${room}/sse`)
    this.options.onProgress('Waiting for someone to join...')

    this.sse.onmessage = async (e) => {
      try {
        if (!this.key) return
        const signal = readSignalingMessage(e.data)
        if (!signal) return

        const peerId = WebRTCCollaborationCoordinator.offerIdFrom(signal.title)
        // Not an offer at all: this room also carries the host's own answers.
        if (!peerId) return
        // Removed earlier in this session, and not on the way back in.
        if (this.blocked.has(peerId)) return
        // Already connected, or the same frame delivered twice.
        if (this.links.has(peerId)) return

        this.options.onProgress('Connecting with someone...')

        // Claimed before the first await, not after. Decrypting yields, and two
        // deliveries of one offer would both have passed the check above and
        // built a connection each, the second orphaning the first.
        const link = this.openLink(peerId)

        const release = (): void => {
          this.links.delete(peerId)
          link.pc.close()
        }

        let sdp: string
        try {
          const decryptedOffer = await decryptData(signal.body, this.key)
          const offer = JSON.parse(decryptedOffer)
          sdp = offer.sdp
          link.install = readInstallId(offer.install)
        } catch {
          release()
          this.options.onError(
            new Error('Could not read the incoming offer: the peer entered a different passcode.')
          )
          return
        }

        // Read here rather than on hello, so a removed guest is turned away
        // before it is handed the board.
        if (link.install && this.blocked.has(link.install)) {
          release()
          return
        }

        link.pc.ondatachannel = (event) => {
          link.channel = event.channel
          this.setupDataChannelHandlers(link)
        }

        await link.pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp }))
        const answer = await link.pc.createAnswer()
        await link.pc.setLocalDescription(answer)
        await waitForIceGathering(link.pc)
        await this.sendHostAnswer(room, link, peerId === 'legacy')
      } catch (err) {
        this.options.onError(err)
      }
    }
  }

  private async sendHostAnswer(room: string, link: PeerLink, legacy: boolean): Promise<void> {
    if (!this.key) return
    try {
      const sdpData = JSON.stringify({ sdp: link.pc.localDescription?.sdp })
      const encryptedSdp = await encryptData(sdpData, this.key)

      const res = await fetch(`https://ntfy.sh/${room}`, {
        method: 'POST',
        headers: { 'Title': legacy ? 'host-reply' : `answer:${link.id}` },
        body: encryptedSdp
      })
      const failure = signalingPublishError(res.status)
      if (failure) {
        this.options.onError(new Error(failure))
        return
      }

      // The stream stays open. Closing it after the first answer is exactly
      // what made this a two-person feature: nobody else could ever be heard.
    } catch (err) {
      this.options.onError(err)
    }
  }

  // Client: Create offer
  private async setupClientConnection(room: string): Promise<void> {
    const link = this.openLink(HOST_LINK)
    link.channel = link.pc.createDataChannel('collab-channel', { ordered: true })
    this.setupDataChannelHandlers(link)

    // Subscribe before publishing: ntfy's SSE stream only carries messages
    // posted after subscription, so publishing first can miss the host's reply.
    this.sse = new EventSource(`https://ntfy.sh/${room}/sse`)
    this.sse.onmessage = async (e) => {
      try {
        if (!this.key) return
        const signal = readSignalingMessage(e.data)
        if (!signal) return
        // Addressed to this guest, or from a host old enough to answer everyone
        // at once. Someone else's answer is not this one's to read.
        if (signal.title !== `answer:${this.myPeerId}` && signal.title !== 'host-reply') return
        if (link.pc.signalingState === 'stable') return

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

        await link.pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp }))

        // A guest has exactly one handshake to complete, so it is done with the
        // room. Only the host keeps listening.
        if (this.sse) {
          this.sse.close()
          this.sse = null
        }
      } catch (err) {
        this.options.onError(err)
      }
    }

    const offer = await link.pc.createOffer()
    await link.pc.setLocalDescription(offer)
    await waitForIceGathering(link.pc)
    await this.publishClientOffer(room, link)
  }

  private async publishClientOffer(room: string, link: PeerLink): Promise<void> {
    if (!this.key) return
    try {
      // The install id rides inside the encrypted body, not the public title.
      const sdpData = JSON.stringify({
        sdp: link.pc.localDescription?.sdp,
        install: this.installId
      })
      const encryptedSdp = await encryptData(sdpData, this.key)

      const res = await fetch(`https://ntfy.sh/${room}`, {
        method: 'POST',
        // Named, so the host's answer can come back to this guest and not to
        // whoever else happens to be joining at the same moment.
        headers: { 'Title': `offer:${this.myPeerId}` },
        body: encryptedSdp
      })
      const failure = signalingPublishError(res.status)
      if (failure) {
        this.options.onError(new Error(failure))
        return
      }
      this.options.onProgress('Offer sent. Awaiting host pairing...')
    } catch (err) {
      this.options.onError(err)
    }
  }

  // Data channel handlers
  private setupDataChannelHandlers(link: PeerLink): void {
    const channel = link.channel
    if (!channel) return

    channel.onopen = () => {
      link.open = true
      this.options.onConnect()
      // Before the board, and by both sides. The host has to know who it has
      // let in before it can decide anything about them, and the guest is owed
      // the same courtesy.
      this.sendTo(link, { type: 'peer-hello', by: this.options.displayName ?? '' })
        .catch(err => console.warn('[Collab Coordinator] Could not introduce myself:', err))
      void this.sendBaselineTo(link)
      this.publishRoster()
    }

    // Serialized per link: messages apply in the order that peer sent them, and
    // each handler awaits IPC into the main process. Two peers talking at once
    // interleave, which is fine, because only one peer's order is a promise.
    channel.onmessage = (event) => {
      link.queue = link.queue.then(async () => {
        try {
          const msg = link.assembler.accept(event.data)
          if (msg !== null) await this.handleIncomingMessage(link, msg)
        } catch (err) {
          console.error('[Collab Coordinator] error handling message:', err)
          this.options.onError(err)
        }
      })
    }

    channel.onclose = () => {
      if (this.dropLink(link)) return
      this.options.onDisconnect()
      this.cleanup()
    }

    channel.onerror = (event) => {
      // A channel that errors is a peer that is gone, and for a host that is
      // the same event as a peer who left politely: keep the room, keep the
      // passcode, let them come back. Ending the whole session over it cost the
      // host its passcode for what is usually a blip.
      const what = describeChannelError(event)
      console.warn('[Collab Coordinator] Data channel error:', what, event)
      if (this.dropLink(link)) return
      this.options.onError(new Error(what))
    }
  }

  // Send baseline data if Host
  /** The board as it stands here, sent to one person who has just joined. */
  private async sendBaselineTo(link: PeerLink): Promise<void> {
    if (!this.options.isHost) return
    this.options.onProgress('Sending the board...')

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

      // The columns travel with the cards. A card's status is a column id, so
      // without them the peer holds cards addressed to columns it does not have.
      const board = await loadBoardConfig(this.options.context)

      await this.sendTo(link, {
        type: 'board-baseline',
        context: this.options.context,
        items,
        tags,
        itemTags,
        relations,
        mode: this.options.mode,
        board,
        // Who they are agreeing with, so a merge later on reads the ancestor
        // this pair actually has rather than one left by whoever last shared a
        // board of the same name.
        install: this.installId,
        // What this side has deleted, so a merge on the other end honours it
        // instead of handing every one of them back. Only the tables whose
        // tombstone id is a row id mean anything to the receiver.
        tombstones: fullDb.tombstones.filter(stone => MERGEABLE_TABLES.has(stone.table_name))
      })

      // Bound once somebody is in, and not before: a host with nobody connected
      // has nothing to broadcast to.
      window.addEventListener('db-mutation', this.handleLocalMutation)
      window.addEventListener(BOARD_CONFIG_EVENT, this.handleLocalBoardConfig)
    } catch (err) {
      console.error('[Collab Host] Failed to compile baseline:', err)
      this.options.onError(err)
    }
  }

  // Dispatch local changes to every peer
  private handleLocalMutation = (event: Event): void => {
    if (this.isApplyingRemote || this.links.size === 0) return

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
    if (mutationContext !== null && mutationContext !== this.sessionContext) return

    // Validated here rather than only on arrival, so a malformed mutation is
    // dropped where it can be seen instead of silently on the peer.
    const mutation = normalizeRemoteMutation(detail)
    if (!mutation) {
      console.warn('[Collab Coordinator] Skipped a local change of an unrecognised shape.')
      return
    }

    // Event handlers cannot await; a failed broadcast must not become an
    // unhandled rejection.
    void this.broadcast({
      type: 'db-mutation-event',
      mutation: retargetMutation(mutation, this.wireContext)
    }).catch(err => {
      console.error('[Collab Coordinator] Failed to broadcast local change:', err)
    })
  }

  /**
   * The board document, sent the same way a card is.
   *
   * Columns, the background, swimlanes and the card face only ever travelled
   * with the opening baseline, so a column added mid-session never reached
   * anyone. Cards moved into it then arrived addressed to a column the other
   * side did not have, and rendered nowhere at all while still being counted.
   */
  private handleLocalBoardConfig = (event: Event): void => {
    if (this.isApplyingRemote || this.links.size === 0) return
    const detail = (event as CustomEvent).detail
    if (!detail || typeof detail !== 'object') return
    const { context, board } = detail as { context?: unknown; board?: unknown }
    if (context !== this.sessionContext) return

    void this.broadcast({
      type: 'board-config',
      // Named as the other side knows it, exactly as a mutation is retargeted.
      context: this.wireContext,
      board: normalizeBoardConfig(board)
    }).catch(err => {
      console.error('[Collab Coordinator] Failed to broadcast the board change:', err)
    })
  }

  /**
   * Folds an arriving board into the one already here.
   *
   * What the host sent is only half of the merge, so this side's copy is read
   * back out of the database first. The result then goes through the same
   * baseline apply a replace would use: the merged board holds everything that
   * was already here, so clearing the workspace and writing it back loses
   * nothing, and it keeps one path into the database rather than two.
   *
   * The merge is this side's alone. The host keeps its own board, and finds out
   * about the difference through the ordinary live updates, or by joining back
   * the other way and merging in turn.
   */
  private async foldIntoLocalBoard(
    target: string,
    msg: BoardBaselineMessage,
    incoming: Item[]
  ): Promise<void> {
    const [local, board] = await Promise.all([
      window.electronAPI.sync.getDbPayload(),
      loadBoardConfig(target)
    ])

    // The same slice the baseline apply is about to clear, so the merge is
    // working with exactly what is at stake.
    const mine = local.items.filter(
      item => item.context === target && (item.type === 'card' || item.type === 'task')
    )
    const mineIds = new Set(mine.map(item => item.id))

    const merged = mergeBoards(
      {
        context: target,
        items: mine,
        tags: local.tags,
        itemTags: local.item_tags.filter(link => mineIds.has(link.item_id)),
        relations: local.relations.filter(
          relation => mineIds.has(relation.from_id) || mineIds.has(relation.to_id)
        ),
        board
      },
      {
        context: msg.context,
        items: incoming,
        tags: msg.tags,
        itemTags: msg.itemTags,
        relations: msg.relations,
        // A peer older than the board message sends no columns. Reading this
        // side's own back in their place adds nothing and takes nothing away.
        board: msg.board ?? board
      },
      // A card deleted here stays deleted. It is the one thing that stops the
      // merge being a plain union, and without it every card ever thrown away
      // would walk back in from the other copy.
      //
      // Read by table, because the tombstone id is only a row id for these
      // three. A deleted note records its filename there instead, and a note
      // named after a card id would quietly keep that card out of the merge.
      new Set(
        local.tombstones
          .filter(stone => MERGEABLE_TABLES.has(stone.table_name))
          .map(stone => stone.id)
      ),
      // What they deleted, with the times, so their deletions count for
      // something too without undoing anything edited here since.
      new Map((msg.tombstones ?? []).map(stone => [stone.id, stone.deleted_at])),
      // The board as it stood when these two were last together, if this pair
      // has met before. Turns "whose save was later" into "who changed it".
      await readMergeBase(target, this.hostInstall)
    )

    await saveBoardConfig(target, merged.board)
    await window.electronAPI.sync.applyBoardBaseline(
      target,
      merged.items,
      merged.tags,
      merged.itemTags,
      merged.relations
    )
    const what = describeMerge(merged.summary)
    this.options.onProgress(
      what ? `Merged into ${target}: ${what}.` : `Merged into ${target}: nothing new to take.`
    )

    // Offered to the host, so the merge is something the two of them did rather
    // than something one of them did quietly. The result travels whole: the
    // host merging for itself would break ties its own way and honour only its
    // own deletions, and two boards that are nearly the same is the worst
    // outcome available here.
    //
    // Nothing is recorded as agreed yet. Until the answer comes back this side
    // is the only one holding this board.
    try {
      this.offeredMerge = true
      await this.broadcast({
        type: 'merge-proposal',
        by: this.options.displayName ?? '',
        context: this.wireContext,
        items: merged.items,
        tags: merged.tags,
        itemTags: merged.itemTags,
        relations: merged.relations,
        board: merged.board
      })
    } catch (err) {
      // This side is merged either way. Only the offer failed.
      this.offeredMerge = false
      console.warn('[Collab Client] Could not offer the merge to the host:', err)
    }
  }

  /**
   * Records that both sides hold the same board as of now.
   *
   * The one moment an ancestor is worth writing down, and a later merge with
   * this peer reads it to tell a card somebody changed from a card that merely
   * has a newer save stamp on it.
   *
   * Read back out of the database rather than taken from the message, because
   * what is here is what this side actually agreed to.
   */
  private async recordAgreement(target: string, peer: string): Promise<void> {
    try {
      const db = await window.electronAPI.sync.getDbPayload()
      await writeMergeBase(
        target,
        peer,
        db.items.filter(
          item => item.context === target && (item.type === 'card' || item.type === 'task')
        )
      )
    } catch (err) {
      console.warn('[Collab] Could not record what both sides now hold:', err)
    }
  }

  /**
   * A guest has merged its copy with the board it joined and is offering the
   * result to the room.
   *
   * The host decides, and decides for everybody: the board being shared is the
   * host's, and a guest is live with it, so a guest allowed to say no would sit
   * in the room holding a board nobody else has and nobody else would know.
   *
   * The question is put with numbers on it, because "do you want to merge" is
   * not a question anyone can answer and this one overwrites a board.
   */
  private async considerMergeProposal(from: PeerLink, msg: MergeProposalMessage): Promise<void> {
    const target = this.sessionContext
    const who = msg.by.trim()

    // Only the host is asked, and only the host relays the result. A proposal
    // arriving anywhere else is a peer talking out of turn.
    if (!this.options.isHost) {
      await this.answerMerge(from, false, 'only the host decides that')
      return
    }

    // A proposal is the whole board as its author found it. Deciding a second
    // one after the first has gone in would put back everything the first took
    // away, and its author never saw the board they would be overwriting.
    if (this.decidingMerge) {
      this.options.onProgress(
        who ? `${who} also offered a merge. One at a time.` : 'Another merge was offered.'
      )
      await this.answerMerge(from, false, 'another merge was being decided')
      return
    }

    // Read-only is the host saying the guests cannot change this board, and
    // replacing all of it is the largest change there is. Refused without
    // asking, so the answer does not depend on who is at the keyboard.
    if (this.options.mode === 'readonly') {
      await this.answerMerge(from, false, 'the board is shared read-only')
      return
    }

    this.decidingMerge = true
    let accepted = false
    try {
      if (this.options.onMergeProposed) {
        const local = await window.electronAPI.sync.getDbPayload()
        const mine = local.items.filter(
          item => item.context === target && (item.type === 'card' || item.type === 'task')
        )
        const deletedHere = new Set(
          local.tombstones
            .filter(stone => MERGEABLE_TABLES.has(stone.table_name))
            .map(stone => stone.id)
        )
        accepted = await this.options.onMergeProposed({
          by: who,
          impact: mergeImpact(mine, msg.items, deletedHere)
        })
      }

      if (accepted) {
        this.isApplyingRemote = true
        try {
          // Their name for the board is not necessarily this side's.
          const items = msg.items.map(item =>
            item.context === target ? item : { ...item, context: target }
          )
          await saveBoardConfig(target, msg.board)
          await window.electronAPI.sync.applyBoardBaseline(
            target, items, msg.tags, msg.itemTags, msg.relations
          )
          window.dispatchEvent(new CustomEvent('kanban-refresh'))
          this.options.onProgress(
            who ? `Merged with ${who}. Both boards now match.` : 'Merged. Both boards now match.'
          )
          // The board the room is on now, sent to everyone else in it. They are
          // told rather than asked: they are live with this board, so one of
          // them keeping the old one would be holding cards nobody else has and
          // missing edits to cards it does not, quietly, for as long as the
          // session lasts.
          await this.broadcast(
            {
              type: 'board-reset',
              by: who,
              context: this.wireContext,
              items,
              tags: msg.tags,
              itemTags: msg.itemTags,
              relations: msg.relations,
              board: msg.board
            },
            from.id
          )
        } finally {
          this.isApplyingRemote = false
        }
        // Only now, and only for the peer whose board this is. What everyone
        // else holds is the host's doing, not an agreement with them.
        await this.recordAgreement(target, from.install)
      } else {
        this.options.onProgress(
          who ? `Turned down ${who}'s merge. Your board is unchanged.` : 'Merge turned down.'
        )
      }
    } catch (err) {
      console.error('[Collab] Failed to take the offered merge:', err)
      // A merge that threw is a merge that was not taken, whatever the user
      // said, and the other side has to be told that and not the intention.
      accepted = false
      this.options.onError(err)
    } finally {
      this.decidingMerge = false
    }

    // No reason either way: this one was answered by a person.
    await this.answerMerge(from, accepted)
  }

  /**
   * Back to whoever offered the merge.
   *
   * A reason only when the no was the app's rather than the user's: "they said
   * no" and "nobody was asked" read the same from the other end otherwise, and
   * only one of them is worth trying again.
   */
  private async answerMerge(to: PeerLink, accepted: boolean, reason?: string): Promise<void> {
    try {
      await this.sendTo(to, {
        type: 'merge-answer',
        accepted,
        by: this.options.displayName ?? '',
        reason: reason ?? ''
      })
    } catch (err) {
      console.warn('[Collab] Could not answer the merge proposal:', err)
    }
  }

  /**
   * Everything a peer sends arrives here, and nothing else does. The argument
   * is `unknown` on purpose: what came off the wire is only a message once it
   * has been through the normalizer.
   */
  private async handleIncomingMessage(from: PeerLink, raw: unknown): Promise<void> {
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
        // applyBoardBaseline deletes every card and task in the target
        // workspace before seeding the host's, and that is unrecoverable. The
        // caller decides what to do about it: replace, take the board as a
        // copy under a free name, fold the two together, or refuse.
        // Who is hosting, before anything is decided: the choice about to be
        // made is filed against them, and a merge is not on offer at all when
        // the board is being shared read-only.
        this.hostInstall = msg.install ?? ''
        const choice = await this.options.onResolveBaseline({
          context: msg.context,
          incomingItems: msg.items.length,
          mode: msg.mode
        })
        if (choice.action === 'cancel') {
          this.cleanup()
          this.options.onDisconnect()
          // After the disconnect, which posts a notice of its own. Said first
          // it was overwritten in the same tick, so backing out of the dialog
          // reported "Host disconnected" instead of what actually happened.
          this.options.onProgress('Join cancelled: your local board was left untouched.')
          break
        }

        // What the host is letting this side do. The board has always carried
        // it and nothing ever read it, so a board shared read-only arrived with
        // every editing control live and the restriction existed only in the
        // host's own description of the session.
        this.options.onMode?.(msg.mode)

        // The host's name for the board stays the name on the wire whatever it
        // is called here, or the two sides stop talking about the same board.
        this.wireContext = msg.context
        this.sessionContext = choice.action === 'copy' ? choice.slug : msg.context
        const target = this.sessionContext

        this.options.onProgress(
          choice.action === 'merge' ? 'Merging the two boards...' : 'Applying board baseline...'
        )
        this.isApplyingRemote = true

        try {
          // Into the picker before switching in, or leaving it is a one-way trip.
          const store = useAppStore.getState()
          const workspaces = await registerSharedWorkspace(target)
          store.setWorkspaceList(workspaces)
          store.setAvailableWorkspaces([...new Set([...store.availableWorkspaces, target])])
          store.setWorkspace(target)
          store.setView('kanban')

          // Every item still carries the host's workspace. applyBoardBaseline
          // deletes by the slug it is given but inserts each item under its
          // own, so without this a copy would arrive empty and the board it
          // was meant to spare would be overwritten instead.
          const items = target === msg.context
            ? msg.items
            : msg.items.map(item => ({ ...item, context: target }))

          if (choice.action === 'merge') {
            await this.foldIntoLocalBoard(target, msg, items)
          } else {
            // The host's columns first, so the cards are never briefly addressed
            // to columns this side does not have. Absent from an older peer, in
            // which case whatever board is already here is the best guess.
            if (msg.board) {
              try {
                await saveBoardConfig(target, msg.board)
              } catch (err) {
                console.error('[Collab Client] Failed to take the host board config:', err)
              }
            }

            await window.electronAPI.sync.applyBoardBaseline(target, items, msg.tags, msg.itemTags, msg.relations)
            // Both sides now hold the host's board exactly, which is the one
            // moment they are known to agree and so the ancestor a later merge
            // of this pair reasons from.
            await writeMergeBase(target, this.hostInstall, items)
            this.options.onProgress(`Joined board: ${target}. Ready!`)
          }

          window.dispatchEvent(new CustomEvent('kanban-refresh'))

          // If collaborative mode, bind local writes listener
          if (msg.mode === 'collaborative') {
            window.addEventListener('db-mutation', this.handleLocalMutation)
            // The board document too, and not only on the host. A guest adding
            // or renaming a column is the same change as the host doing it, and
            // wiring only one side would have left it travelling one way.
            window.addEventListener(BOARD_CONFIG_EVENT, this.handleLocalBoardConfig)
          }
        } catch (err) {
          // Said out loud, not just to the console. The last thing on screen
          // was "Merging the two boards...", and leaving that up is the app
          // claiming to be doing something it gave up on.
          console.error('[Collab Client] Failed to seed baseline:', err)
          this.options.onError(err)
        } finally {
          this.isApplyingRemote = false
        }
        break
      }

      case 'merge-proposal': {
        await this.considerMergeProposal(from, msg)
        break
      }

      case 'merge-answer': {
        // An answer to nothing is a peer talking out of turn, and reporting it
        // would tell this user their board had been taken somewhere it was
        // never sent.
        if (!this.offeredMerge) {
          console.warn('[Collab Coordinator] Ignored an answer to a merge this side never offered.')
          break
        }
        this.offeredMerge = false
        if (msg.accepted) await this.recordAgreement(this.sessionContext, this.hostInstall)
        this.options.onMergeAnswer?.(msg.accepted, msg.by.trim(), msg.reason?.trim() ?? '')
        break
      }

      case 'board-reset': {
        // Only the host says what the shared board is. A guest sending one is
        // asking to overwrite the host's board without anyone being asked,
        // which is what the proposal exists for.
        if (this.options.isHost) {
          console.warn('[Collab Host] Ignored a guest trying to replace the shared board.')
          break
        }
        // The host took somebody's merge, so this is the board now. Applied the
        // way the opening baseline is, because that is what it is: the whole
        // board, replacing the whole board.
        const target = this.sessionContext
        this.isApplyingRemote = true
        try {
          const items = msg.items.map(item =>
            item.context === target ? item : { ...item, context: target }
          )
          await saveBoardConfig(target, msg.board)
          await window.electronAPI.sync.applyBoardBaseline(
            target, items, msg.tags, msg.itemTags, msg.relations
          )
          window.dispatchEvent(new CustomEvent('kanban-refresh'))
        } catch (err) {
          console.error('[Collab Coordinator] Failed to take the new shared board:', err)
          this.options.onError(err)
          break
        } finally {
          this.isApplyingRemote = false
        }
        // Still an agreement with the host, whoever ran the merge: the host is
        // the only side this one has, and its board is what arrived.
        await this.recordAgreement(target, this.hostInstall)
        this.options.onBoardReset?.(msg.by.trim())
        break
      }

      case 'peer-hello': {
        from.name = msg.by.trim()
        // The list only changes for a host, and only a host publishes it. A
        // guest learns who else is here from the roster the host sends back.
        this.publishRoster()
        break
      }

      case 'peer-removed': {
        const who = msg.by.trim()
        this.options.onRemoved?.(who)
        // Nothing to say back, and the host is closing anyway. Ending here
        // stops the close that follows being reported as a second, unrelated
        // thing going wrong.
        this.cleanup()
        break
      }

      case 'mode-change': {
        // The host's word on what this side may do. A host that receives one
        // ignores it: the mode is the host's to set, and a guest sending this
        // would be a guest granting itself permission.
        if (!this.options.isHost) this.options.onMode?.(msg.mode)
        break
      }

      case 'peer-leaving': {
        // Said before they hang up, so the close that follows is explained
        // rather than just silent.
        const who = msg.by.trim()
        this.options.onProgress(
          who ? `${who} closed the connection.` : 'They closed the connection.'
        )
        break
      }

      case 'db-mutation-event': {
        this.isApplyingRemote = true
        try {
          // Arrives addressed to the host's workspace, which is not what this
          // side calls it when the board was joined as a copy.
          await window.electronAPI.sync.applyRemoteMutation(
            retargetMutation(msg.mutation, this.sessionContext)
          )
          window.dispatchEvent(new CustomEvent('kanban-refresh'))
        } catch (err) {
          console.error('[Collab Coordinator] Failed to apply remote mutation:', err)
        } finally {
          this.isApplyingRemote = false
        }
        // Guests are connected to the host and not to each other, so a change
        // one of them makes only reaches the rest if the host passes it on. Sent
        // on the wire's own name for the board, which is the host's, and back
        // to everyone except whoever made it.
        if (this.options.isHost) {
          await this.broadcast(
            { type: 'db-mutation-event', mutation: retargetMutation(msg.mutation, this.wireContext) },
            from.id
          )
        }
        break
      }

      case 'board-config': {
        this.isApplyingRemote = true
        try {
          await saveBoardConfig(this.sessionContext, msg.board)
          window.dispatchEvent(new CustomEvent('kanban-refresh'))
        } catch (err) {
          console.error('[Collab Coordinator] Failed to apply the remote board change:', err)
        } finally {
          this.isApplyingRemote = false
        }
        if (this.options.isHost) {
          await this.broadcast({ ...msg, context: this.wireContext }, from.id)
        }
        break
      }

      case 'roster': {
        // Only the host can know this, so a guest takes it as told. A host that
        // receives one ignores it: it is the one keeping the list. This side's
        // own entry comes out, because a room does not list you to yourself.
        if (!this.options.isHost) {
          this.options.onRoster?.(msg.members.filter(member => member.id !== this.myPeerId))
        }
        break
      }
    }
  }

  /**
   * A board baseline exceeds the 256 KB single-message ceiling on any board of
   * real size, so everything goes through the framing transport.
   */
  private async sendTo(link: PeerLink, msg: CollabMessage): Promise<void> {
    if (!link.channel || link.channel.readyState !== 'open') return
    await sendFramed(link.channel, msg)
  }

  /**
   * To everyone, or to everyone but one.
   *
   * The exception is how the host relays a change without echoing it back to
   * whoever made it. Failures are per link: one peer whose channel has gone
   * must not stop the message reaching the rest.
   */
  private async broadcast(msg: CollabMessage, exceptId?: string): Promise<void> {
    await Promise.all(
      [...this.links.values()]
        .filter(link => link.id !== exceptId)
        .map(link =>
          this.sendTo(link, msg).catch(err => {
            console.warn(`[Collab Coordinator] Could not reach peer ${link.id}:`, err)
          })
        )
    )
  }

  /**
   * The peer is gone, however it went.
   *
   * A host keeps the room and the passcode so whoever left can come straight
   * back, which is what a reconnect almost always is. Returns false when this
   * side has nothing to keep and the session really is over.
   *
   * One departure can raise both an error and a close, so this has to be safe
   * to call twice. The peer connection being gone is what says it already ran.
   */
  private keepHostingWithoutPeer(): boolean {
    // Closing on purpose closes the channel too, and the event lands a tick
    // later. Without this the host pressing Disconnect was told "Peer
    // disconnected" over the top of its own "Disconnected".
    if (this.ended) return true
    return this.options.isHost && this.signalingRoom !== ''
  }

  /**
   * One peer is gone. Returns true when the session carries on without them.
   *
   * A host loses a guest and keeps the room, the passcode and everyone else. A
   * guest losing the host has lost the session, because the host was all of it.
   * One departure can raise both an error and a close, so this has to be safe
   * to call twice: the link no longer being in the map is what says it ran.
   */
  private dropLink(link: PeerLink): boolean {
    const known = this.links.get(link.id) === link
    if (known) {
      this.links.delete(link.id)
      link.open = false
      try {
        link.pc.close()
      } catch (err) {
        console.warn('[Collab Coordinator] Could not close a peer connection:', err)
      }
      link.channel = null
    }

    if (!this.keepHostingWithoutPeer()) {
      // Nothing left to talk to, so nothing left to broadcast.
      window.removeEventListener('db-mutation', this.handleLocalMutation)
      window.removeEventListener(BOARD_CONFIG_EVENT, this.handleLocalBoardConfig)
      return false
    }

    if (known && !this.ended) {
      this.publishRoster()
      this.options.onPeerLeft?.(link.name)
    }
    return true
  }

  /** Ends every connection without giving up the room. */
  private closeAllPeers(): void {
    window.removeEventListener('db-mutation', this.handleLocalMutation)
    window.removeEventListener(BOARD_CONFIG_EVENT, this.handleLocalBoardConfig)
    for (const link of this.links.values()) {
      link.open = false
      try {
        link.pc.close()
      } catch (err) {
        console.warn('[Collab Coordinator] Could not close a peer connection:', err)
      }
      link.channel = null
    }
    this.links.clear()
  }

  /**
   * Says goodbye before hanging up, so the other side can name who left rather
   * than watching the connection go quiet. Best effort: a channel that is
   * already gone is exactly the case this cannot help with.
   */
  public async leave(): Promise<void> {
    await this.hangUp({ type: 'peer-leaving', by: this.options.displayName ?? '' })
  }

  /**
   * Shows one guest the door, told to their face, and keeps everyone else.
   *
   * Their id goes on a block list so their own client will not reconnect on
   * its own. That is a door, not a lock: the id is theirs to choose, so anyone
   * determined can mint another and come back. Changing the passcode is the
   * lock, and it is a separate action because it removes everybody.
   */
  public async remove(peerId: string): Promise<void> {
    const link = this.links.get(peerId)
    if (!link) return
    // An older peer sends no install id and so cannot be barred from returning.
    // Changing the passcode is the answer there, and it is the answer anyway
    // for anyone willing to go and clear the id themselves.
    if (link.install) this.blocked.add(link.install)

    try {
      if (link.channel?.readyState === 'open') {
        await this.sendTo(link, { type: 'peer-removed', by: this.options.displayName ?? '' })
        await closeGracefully(link.channel)
      }
    } catch (err) {
      console.warn('[Collab Host] Could not tell them they were removed:', err)
    }
    this.dropLink(link)
  }

  /** Tells the room this side is called something else now. */
  public async rename(name: string): Promise<void> {
    if (this.options.displayName === name) return
    this.options.displayName = name
    try {
      await this.broadcast({ type: 'peer-hello', by: name })
      // The host's own entry rides in the roster, so it has to go out again.
      this.publishRoster()
    } catch (err) {
      console.warn('[Collab Coordinator] Could not pass on the new name:', err)
    }
  }

  /** The host's word on what the guests may do, sent without ending anything. */
  public async setMode(mode: CollabMode): Promise<void> {
    if (!this.options.isHost) return
    // Kept, not only sent. It was told to whoever was already in the room and
    // nowhere else, so the next person to join was handed the mode the session
    // started on and the change never reached them.
    this.options.mode = mode
    await this.broadcast({ type: 'mode-change', mode })
  }

  private async hangUp(farewell: CollabMessage): Promise<void> {
    // Before anything closes, because closing a channel to flush the message
    // raises the same event a guest leaving raises, and a host would otherwise
    // answer its own departure by reopening the room.
    this.ended = true

    const open = [...this.links.values()].filter(link => link.channel?.readyState === 'open')
    await Promise.all(
      open.map(async link => {
        try {
          await this.sendTo(link, farewell)
          // Non-null: readyState was read off it a line above, and nothing in
          // between can have cleared it.
          await closeGracefully(link.channel as RTCDataChannel)
        } catch (err) {
          console.warn('[Collab Coordinator] Could not say goodbye to a peer:', err)
        }
      })
    )
    this.cleanup()
  }

  public cleanup(): void {
    this.ended = true
    this.closeAllPeers()
    this.signalingRoom = ''
    // A merge nobody can answer any more. Left standing, the next session would
    // refuse its first proposal on the strength of one from the last.
    this.decidingMerge = false
    this.offeredMerge = false

    if (this.sse) {
      this.sse.close()
      this.sse = null
    }
  }
}
