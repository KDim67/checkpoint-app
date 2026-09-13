/** P2P board sharing: ntfy.sh signalling lobby, baseline on connect, live edits after */

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
import { signalingPublishUrl, signalingStreamUrl } from '../../../shared/signalingHost'
import { registerSharedWorkspace } from './createWorkspace'
import { BOARD_CONFIG_EVENT, loadBoardConfig, saveBoardConfig } from './boardConfig'
import { normalizeBoardConfig } from '../../../shared/boardModel'
import * as syncApi from '../data/sync'
import { getSetting, setSetting } from '../data/settings'

interface CollabOptions {
  pairingCode: string
  isHost: boolean
  context: string
  mode: CollabMode
  onProgress: (progress: string) => void
  onConnect: () => void
  onDisconnect: () => void
  /** could be an RTCErrorEvent, not an Error; read with errorMessage */
  onError: (err: unknown) => void
  /** only when the board would land on an existing one: replace wipes it, so replace, copy or refuse */
  onResolveBaseline: (
    info: { context: string; incomingItems: number; mode: CollabMode }
  ) => Promise<BaselineChoice>
  /** sent with a goodbye so the peer can say who left */
  displayName?: string
  /** one guest left, the session stays open */
  onPeerLeft?: (name: string) => void
  /** the host knows, guests are told */
  onRoster?: (members: { id: string; name: string }[]) => void
  /** arrives with the board and whenever the host changes it */
  onMode?: (mode: CollabMode) => void
  /** removed by the host, not the same as leaving */
  onRemoved?: (by: string) => void
  /** a guest's merged board, asked of the host only; no leaves this board as is */
  onMergeProposed?: (info: { by: string; impact: MergeImpact }) => Promise<boolean>
  /** what the host did with our merge */
  onMergeAnswer?: (accepted: boolean, by: string, reason: string) => void
  /** the host took a merge, this is the board now */
  onBoardReset?: (by: string) => void
}

/** tombstones whose id is a row id, the ones a merge can use */
const MERGEABLE_TABLES = new Set(['items', 'tags', 'relations'])

/** last agreed state per workspace and peer, the ancestor for later merges; peerless keys the name alone */
const mergeBaseKey = (context: string, peer: string): string =>
  peer ? `merge_base_${context}_${peer}` : `merge_base_${context}`

/** enough to tell whether a card moved since */
interface BaseCard {
  id: string
  updated_at: number
  metadata: string
}

async function readMergeBase(context: string, peer: string): Promise<Map<string, Item>> {
  try {
    const raw = await getSetting(mergeBaseKey(context, peer))
    if (!Array.isArray(raw)) return new Map()
    const base = new Map<string, Item>()
    for (const entry of raw as BaseCard[]) {
      if (!entry || typeof entry.id !== 'string') continue
      // only the three compared fields are real, the rest fill the shape
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

/** stamp and metadata only, a whole board in a settings row would be stored twice */
async function writeMergeBase(context: string, peer: string, items: Item[]): Promise<void> {
  try {
    const base: BaseCard[] = items.map(item => ({
      id: item.id,
      updated_at: item.updated_at,
      metadata: item.metadata
    }))
    await setSetting(mergeBaseKey(context, peer), base)
  } catch (err) {
    console.warn('[Collab] Could not record the merge base:', err)
  }
}

/** copy carries its slug since the caller holds the workspace list */
type BaselineChoice =
  | { action: 'replace' }
  | { action: 'copy'; slug: string }
  /** keep ours and fold theirs in, loses nothing */
  | { action: 'merge' }
  | { action: 'cancel' }

/** a host holds several, a guest holds one to its host */
interface PeerLink {
  id: string
  pc: RTCPeerConnection
  channel: RTCDataChannel | null
  /** frames interleave per connection, reassembly is per link */
  assembler: FrameAssembler
  /** empty until hello */
  name: string
  /** removals are remembered against it; empty for older peers */
  install: string
  /** apply in arrival order, each awaits IPC */
  queue: Promise<void>
  open: boolean
}

/** a guest's only link */
const HOST_LINK = 'host'

/** fits an ntfy title without colliding */
function newPeerId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/** minted on first use, kept after */
async function loadInstallId(): Promise<string> {
  try {
    const stored = readInstallId(await getSetting(INSTALL_ID_KEY))
    if (stored) return stored
    const minted = newInstallId()
    await setSetting(INSTALL_ID_KEY, minted)
    return minted
  } catch (err) {
    // without one this side just can't be blocked, like before
    console.warn('[Collab Coordinator] Could not read this install id:', err)
    return ''
  }
}

export class WebRTCCollaborationCoordinator {
  /** the host answers every offer with its own connection; ignoring later ones capped it at two people */
  private links = new Map<string, PeerLink>()

  /** keyed on install id, which survives restarts; the per-attempt signalling id didn't */
  private blocked = new Set<string>()

  /** read once so offers can carry it */
  private installId = ''

  /** published with the offer so answers can be addressed */
  private myPeerId = newPeerId()

  private sse: EventSource | null = null
  private key: CryptoKey | null = null
  private options: CollabOptions

  private isApplyingRemote = false

  /** local vs wire name differ only for a copy; reading options.context filtered every joiner edit out */
  private sessionContext: string
  private wireContext: string

  /** so a host can reopen the same room instead of minting a new code */
  private signalingRoom = ''

  /** so the session's own closing events stay quiet */
  private ended = false

  /** the peer key a joiner files its board under */
  private hostInstall = ''

  /** one at a time, others refused: a second full-board proposal would undo the first */
  private decidingMerge = false

  /** so an answer is addressed to us */
  private offeredMerge = false

  constructor(options: CollabOptions) {
    this.options = options
    this.sessionContext = options.context
    this.wireContext = options.context
  }

  public async start(): Promise<void> {
    try {
      this.cleanup()
      // after cleanup sets it, or the new session's close events are silenced
      this.ended = false
      this.installId = await loadInstallId()
      this.key = await deriveKey(this.options.pairingCode, COLLAB_SALT)
      this.options.onProgress('Deriving security key...')

      // hashed, the pairing code never appears in the public topic
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

  /** failure paths every peer connection needs */
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

  /** in arrival order */
  private roster(): { id: string; name: string }[] {
    // host first: a list from the host's own links hid the one name guests came for
    return [
      { id: HOST_LINK, name: this.options.displayName ?? '' },
      ...[...this.links.values()]
        .filter(link => link.open)
        .map(link => ({ id: link.id, name: link.name }))
    ]
  }

  /** only the host knows who's in; sent on every change so no guest thinks someone's still here */
  private publishRoster(): void {
    if (!this.options.isHost) return
    const members = this.roster()
    // nobody is shown to themselves
    this.options.onRoster?.(members.filter(member => member.id !== HOST_LINK))
    void this.broadcast({ type: 'roster', members }).catch(err => {
      console.warn('[Collab Host] Could not send the roster:', err)
    })
  }

  /** offer:<id> / answer:<id> so guests share a room without reading each other; bare titles still answered */
  private static offerIdFrom(title: string): string | null {
    if (title.startsWith('offer:')) return title.slice('offer:'.length) || null
    return title === 'client-offer' ? 'legacy' : null
  }

  private setupHostSignaling(room: string): void {
    // close the previous stream on reopen, or each guest leaks one and handlers race
    this.sse?.close()
    this.sse = new EventSource(signalingStreamUrl(room))
    this.options.onProgress('Waiting for someone to join...')

    this.sse.onmessage = async (e) => {
      try {
        if (!this.key) return
        const signal = readSignalingMessage(e.data)
        if (!signal) return

        const peerId = WebRTCCollaborationCoordinator.offerIdFrom(signal.title)
        // this room also carries the host's own answers
        if (!peerId) return
        // removed earlier this session
        if (this.blocked.has(peerId)) return
        // already connected, or a duplicate delivery
        if (this.links.has(peerId)) return

        this.options.onProgress('Connecting with someone...')

        // claimed before the first await, or a duplicate offer builds a second connection
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

        // checked here so a removed guest is turned away before getting the board
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

      const res = await fetch(signalingPublishUrl(room), {
        method: 'POST',
        headers: { 'Title': legacy ? 'host-reply' : `answer:${link.id}` },
        body: encryptedSdp
      })
      const failure = signalingPublishError(res.status)
      if (failure) {
        this.options.onError(new Error(failure))
        return
      }

      // the stream stays open, closing after one answer limited it to two people
    } catch (err) {
      this.options.onError(err)
    }
  }

  private async setupClientConnection(room: string): Promise<void> {
    const link = this.openLink(HOST_LINK)
    link.channel = link.pc.createDataChannel('collab-channel', { ordered: true })
    this.setupDataChannelHandlers(link)

    // subscribe before publishing, ntfy's SSE only carries later messages
    this.sse = new EventSource(signalingStreamUrl(room))
    this.sse.onmessage = async (e) => {
      try {
        if (!this.key) return
        const signal = readSignalingMessage(e.data)
        if (!signal) return
        // ours, or from an old host answering everyone
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

        // a guest has one handshake, only the host keeps listening
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
      // install id inside the encrypted body, not the public title
      const sdpData = JSON.stringify({
        sdp: link.pc.localDescription?.sdp,
        install: this.installId
      })
      const encryptedSdp = await encryptData(sdpData, this.key)

      const res = await fetch(signalingPublishUrl(room), {
        method: 'POST',
        // named so the answer comes back to this guest
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

  private setupDataChannelHandlers(link: PeerLink): void {
    const channel = link.channel
    if (!channel) return

    channel.onopen = () => {
      link.open = true
      this.options.onConnect()
      // hello before the board, both sides
      this.sendTo(link, { type: 'peer-hello', by: this.options.displayName ?? '' })
        .catch(err => console.warn('[Collab Coordinator] Could not introduce myself:', err))
      void this.sendBaselineTo(link)
      this.publishRoster()
    }

    // per-link order; peers interleave, only each peer's own order is promised
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
      // an erroring channel is a gone peer; the host keeps the room and passcode for a blip
      const what = describeChannelError(event)
      console.warn('[Collab Coordinator] Data channel error:', what, event)
      if (this.dropLink(link)) return
      this.options.onError(new Error(what))
    }
  }

  /** the board as it stands, for someone who just joined */
  private async sendBaselineTo(link: PeerLink): Promise<void> {
    if (!this.options.isHost) return
    this.options.onProgress('Sending the board...')

    try {
      const fullDb = await syncApi.getDbPayload()
      const items = fullDb.items.filter(
        i => i.context === this.options.context && (i.type === 'card' || i.type === 'task')
      )
      const tags = fullDb.tags
      const itemTags = fullDb.item_tags.filter(it => items.some(item => item.id === it.item_id))
      const relations = fullDb.relations.filter(
        r => items.some(item => item.id === r.from_id || item.id === r.to_id)
      )

      // columns travel with cards, statuses are column ids
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
        // so a later merge reads this pair's ancestor, not a same-named board's
        install: this.installId,
        // our deletions, so their merge honours them; row-id tables only
        tombstones: fullDb.tombstones.filter(stone => MERGEABLE_TABLES.has(stone.table_name))
      })

      // bound once someone's in
      window.addEventListener('db-mutation', this.handleLocalMutation)
      window.addEventListener(BOARD_CONFIG_EVENT, this.handleLocalBoardConfig)
    } catch (err) {
      console.error('[Collab Host] Failed to compile baseline:', err)
      this.options.onError(err)
    }
  }

  private handleLocalMutation = (event: Event): void => {
    if (this.isApplyingRemote || this.links.size === 0) return

    const e = event as CustomEvent
    const { detail } = e

    // only this workspace; deletes carry the context the preload read, or every delete was broadcast
    const mutationContext: string | null =
      detail.item?.context ?? (typeof detail.context === 'string' ? detail.context : null)
    if (mutationContext !== null && mutationContext !== this.sessionContext) return

    // validated here so a bad mutation drops visibly
    const mutation = normalizeRemoteMutation(detail)
    if (!mutation) {
      console.warn('[Collab Coordinator] Skipped a local change of an unrecognised shape.')
      return
    }

    // handlers can't await, a failed broadcast mustn't go unhandled
    void this.broadcast({
      type: 'db-mutation-event',
      mutation: retargetMutation(mutation, this.wireContext)
    }).catch(err => {
      console.error('[Collab Coordinator] Failed to broadcast local change:', err)
    })
  }

  /** board doc sent like a card; it only went with the baseline, so new columns never arrived */
  private handleLocalBoardConfig = (event: Event): void => {
    if (this.isApplyingRemote || this.links.size === 0) return
    const detail = (event as CustomEvent).detail
    if (!detail || typeof detail !== 'object') return
    const { context, board } = detail as { context?: unknown; board?: unknown }
    if (context !== this.sessionContext) return

    void this.broadcast({
      type: 'board-config',
      // named as the other side knows it
      context: this.wireContext,
      board: normalizeBoardConfig(board)
    }).catch(err => {
      console.error('[Collab Coordinator] Failed to broadcast the board change:', err)
    })
  }

  /** folds theirs into ours, then through the baseline apply: one path into the db, and the merge is ours alone */
  private async foldIntoLocalBoard(
    target: string,
    msg: BoardBaselineMessage,
    incoming: Item[]
  ): Promise<void> {
    const [local, board] = await Promise.all([
      syncApi.getDbPayload(),
      loadBoardConfig(target)
    ])

    // the same slice the baseline apply clears
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
        // older peers send no columns, use ours
        board: msg.board ?? board
      },
      // deleted here stays deleted; by table, since only these ids are row ids
      new Set(
        local.tombstones
          .filter(stone => MERGEABLE_TABLES.has(stone.table_name))
          .map(stone => stone.id)
      ),
      // their deletions with times, without undoing edits made here since
      new Map((msg.tombstones ?? []).map(stone => [stone.id, stone.deleted_at])),
      // last agreed board with this pair, turns "whose save was later" into "who changed it"
      await readMergeBase(target, this.hostInstall)
    )

    await saveBoardConfig(target, merged.board)
    await syncApi.applyBoardBaseline(
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

    // offered whole to the host so both agree on one board; nothing's recorded until the answer
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
      // merged either way, only the offer failed
      this.offeredMerge = false
      console.warn('[Collab Client] Could not offer the merge to the host:', err)
    }
  }

  /** read from the db, what's here is what we agreed to */
  private async recordAgreement(target: string, peer: string): Promise<void> {
    try {
      const db = await syncApi.getDbPayload()
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

  /** the host decides for the room; asked with numbers since yes overwrites a board */
  private async considerMergeProposal(from: PeerLink, msg: MergeProposalMessage): Promise<void> {
    const target = this.sessionContext
    const who = msg.by.trim()

    // only the host is asked and relays
    if (!this.options.isHost) {
      await this.answerMerge(from, false, 'only the host decides that')
      return
    }

    // a second full-board proposal would undo the first
    if (this.decidingMerge) {
      this.options.onProgress(
        who
          ? `${who} offered a merge at the same time. They will have to join again.`
          : 'A second merge was offered at the same time and could not be taken.'
      )
      await this.answerMerge(from, false, 'somebody else was merging at the same time')
      return
    }

    // read-only refuses outright, whoever's at the keyboard
    if (this.options.mode === 'readonly') {
      await this.answerMerge(from, false, 'the board is shared read-only')
      return
    }

    this.decidingMerge = true
    let accepted = false
    try {
      if (this.options.onMergeProposed) {
        const local = await syncApi.getDbPayload()
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
          // their name for the board isn't necessarily ours
          const items = msg.items.map(item =>
            item.context === target ? item : { ...item, context: target }
          )
          await saveBoardConfig(target, msg.board)
          await syncApi.applyBoardBaseline(
            target, items, msg.tags, msg.itemTags, msg.relations
          )
          window.dispatchEvent(new CustomEvent('kanban-refresh'))
          this.options.onProgress(
            who ? `Merged with ${who}. Both boards now match.` : 'Merged. Both boards now match.'
          )
          // told, not asked: everyone's live on this board
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
        // only now, and only for the peer whose board it is
        await this.recordAgreement(target, from.install)
      } else {
        this.options.onProgress(
          who ? `Turned down ${who}'s merge. Your board is unchanged.` : 'Merge turned down.'
        )
      }
    } catch (err) {
      console.error('[Collab] Failed to take the offered merge:', err)
      // a merge that threw wasn't taken, whatever was clicked
      accepted = false
      this.options.onError(err)
    } finally {
      this.decidingMerge = false
    }

    // answered by a person, no reason
    await this.answerMerge(from, accepted)
  }

  /** a reason only when the app said no, so the other side knows whether to retry */
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

  /** unknown until the normalizer says otherwise */
  private async handleIncomingMessage(from: PeerLink, raw: unknown): Promise<void> {
    const msg = normalizeCollabMessage(raw)
    if (!msg) {
      // ignored, not fatal: other builds send things we don't know
      console.warn('[Collab Coordinator] Ignored a message this build does not understand.')
      return
    }

    switch (msg.type) {
      case 'board-baseline': {
        // the baseline apply wipes the workspace; the caller picks replace, copy, merge or refuse
        this.hostInstall = msg.install ?? ''
        const choice = await this.options.onResolveBaseline({
          context: msg.context,
          incomingItems: msg.items.length,
          mode: msg.mode
        })
        if (choice.action === 'cancel') {
          this.cleanup()
          this.options.onDisconnect()
          // after the disconnect, or its notice overwrites this
          this.options.onProgress('Join cancelled: your local board was left untouched.')
          break
        }

        // the mode was always sent and never read, so read-only boards stayed editable
        this.options.onMode?.(msg.mode)

        // keep the host's name on the wire, or the sides stop talking about one board
        this.wireContext = msg.context
        this.sessionContext = choice.action === 'copy' ? choice.slug : msg.context
        const target = this.sessionContext

        this.options.onProgress(
          choice.action === 'merge' ? 'Merging the two boards...' : 'Applying board baseline...'
        )
        this.isApplyingRemote = true

        try {
          // into the picker first, or leaving it is one-way
          const store = useAppStore.getState()
          const workspaces = await registerSharedWorkspace(target)
          store.setWorkspaceList(workspaces)
          store.setAvailableWorkspaces([...new Set([...store.availableWorkspaces, target])])
          store.setWorkspace(target)
          store.setView('kanban')

          // items carry the host's slug; retarget or a copy arrives empty and overwrites the spared board
          const items = target === msg.context
            ? msg.items
            : msg.items.map(item => ({ ...item, context: target }))

          if (choice.action === 'merge') {
            await this.foldIntoLocalBoard(target, msg, items)
          } else {
            // host's columns first so cards never point at missing ones; older peers send none
            if (msg.board) {
              try {
                await saveBoardConfig(target, msg.board)
              } catch (err) {
                console.error('[Collab Client] Failed to take the host board config:', err)
              }
            }

            await syncApi.applyBoardBaseline(target, items, msg.tags, msg.itemTags, msg.relations)
            // both hold the host's board now, the ancestor for later merges
            await writeMergeBase(target, this.hostInstall, items)
            this.options.onProgress(`Joined board: ${target}. Ready!`)
          }

          window.dispatchEvent(new CustomEvent('kanban-refresh'))

          if (msg.mode === 'collaborative') {
            window.addEventListener('db-mutation', this.handleLocalMutation)
            // the board doc too, on both sides, or column changes go one way
            window.addEventListener(BOARD_CONFIG_EVENT, this.handleLocalBoardConfig)
          }
        } catch (err) {
          // say it on screen, not just the console, or "Merging..." stays up
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
        // an answer to nothing is out of turn, don't report it
        if (!this.offeredMerge) {
          console.warn('[Collab Coordinator] Ignored an answer to a merge this side never offered.')
          break
        }
        this.offeredMerge = false
        if (msg.accepted) {
          await this.recordAgreement(this.sessionContext, this.hostInstall)
          this.options.onMergeAnswer?.(true, msg.by.trim(), '')
          break
        }

        // refused: we hold the merged board, the room holds the host's; leave before ours gets wiped
        this.options.onMergeAnswer?.(false, msg.by.trim(), msg.reason?.trim() ?? '')
        await this.leave()
        break
      }

      case 'board-reset': {
        // only the host says what the shared board is
        if (this.options.isHost) {
          console.warn('[Collab Host] Ignored a guest trying to replace the shared board.')
          break
        }
        // the host took a merge, applied like the opening baseline
        const target = this.sessionContext
        this.isApplyingRemote = true
        try {
          const items = msg.items.map(item =>
            item.context === target ? item : { ...item, context: target }
          )
          await saveBoardConfig(target, msg.board)
          await syncApi.applyBoardBaseline(
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
        // still an agreement with the host
        await this.recordAgreement(target, this.hostInstall)
        this.options.onBoardReset?.(msg.by.trim())
        break
      }

      case 'peer-hello': {
        from.name = msg.by.trim()
        // only the host publishes the list
        this.publishRoster()
        break
      }

      case 'peer-removed': {
        const who = msg.by.trim()
        this.options.onRemoved?.(who)
        // nothing to answer and the host is closing; end so its close isn't reported twice
        this.cleanup()
        break
      }

      case 'mode-change': {
        // a guest can't grant itself permission, the host ignores these
        if (!this.options.isHost) this.options.onMode?.(msg.mode)
        break
      }

      case 'peer-leaving': {
        // said before they hang up so the close is explained
        const who = msg.by.trim()
        this.options.onProgress(
          who ? `${who} closed the connection.` : 'They closed the connection.'
        )
        break
      }

      case 'db-mutation-event': {
        this.isApplyingRemote = true
        try {
          // addressed to the host's workspace name, not ours for a copy
          await syncApi.applyRemoteMutation(
            retargetMutation(msg.mutation, this.sessionContext)
          )
          window.dispatchEvent(new CustomEvent('kanban-refresh'))
        } catch (err) {
          console.error('[Collab Coordinator] Failed to apply remote mutation:', err)
        } finally {
          this.isApplyingRemote = false
        }
        // guests only reach each other through the host; relay on the wire name, not back to the sender
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
        // the host keeps the list; our own entry comes out
        if (!this.options.isHost) {
          this.options.onRoster?.(msg.members.filter(member => member.id !== this.myPeerId))
        }
        break
      }
    }
  }

  /** baselines exceed 256 KB, so always framed */
  private async sendTo(link: PeerLink, msg: CollabMessage): Promise<void> {
    if (!link.channel || link.channel.readyState !== 'open') return
    await sendFramed(link.channel, msg)
  }

  /** per-link failures, one gone channel mustn't stop the rest; exceptId avoids echoes */
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

  /** the host keeps room and passcode for reconnects; false when the session is really over; safe twice */
  private keepHostingWithoutPeer(): boolean {
    // our own close fires the channel event a tick later
    if (this.ended) return true
    return this.options.isHost && this.signalingRoom !== ''
  }

  /** true when the session carries on; a guest losing the host loses it; safe twice */
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
      // nothing left to broadcast to
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

  /** keeps the room */
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

  /** goodbye first so the other side can name who left; best effort */
  public async leave(): Promise<void> {
    await this.hangUp({ type: 'peer-leaving', by: this.options.displayName ?? '' })
  }

  /** a door, not a lock: a determined guest can mint a new id; changing the passcode is the lock */
  public async remove(peerId: string): Promise<void> {
    const link = this.links.get(peerId)
    if (!link) return
    // older peers send no install id and can't be barred
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

  public async rename(name: string): Promise<void> {
    if (this.options.displayName === name) return
    this.options.displayName = name
    try {
      await this.broadcast({ type: 'peer-hello', by: name })
      // the host's own entry rides in the roster
      this.publishRoster()
    } catch (err) {
      console.warn('[Collab Coordinator] Could not pass on the new name:', err)
    }
  }

  /** without ending anything */
  public async setMode(mode: CollabMode): Promise<void> {
    if (!this.options.isHost) return
    // kept, not only sent, or the next joiner got the starting mode
    this.options.mode = mode
    await this.broadcast({ type: 'mode-change', mode })
  }

  private async hangUp(farewell: CollabMessage): Promise<void> {
    // before anything closes, or the host answers its own departure by reopening
    this.ended = true

    const open = [...this.links.values()].filter(link => link.channel?.readyState === 'open')
    await Promise.all(
      open.map(async link => {
        try {
          await this.sendTo(link, farewell)
          // readyState was read off it a line above
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
    // reset, or the next session refuses its first proposal
    this.decidingMerge = false
    this.offeredMerge = false

    if (this.sse) {
      this.sse.close()
      this.sse = null
    }
  }
}
