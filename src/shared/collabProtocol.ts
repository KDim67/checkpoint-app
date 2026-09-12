/**
 * The wire protocol between two collaborating Checkpoint instances.
 *
 * Whatever arrives here goes straight into prepared statements, and the pairing
 * code only proves the peer knows the code, not that it is a sane Checkpoint.
 * Usually it is just an older build.
 *
 * Reject structure, default decoration: a bad id or position means we cannot
 * apply the message, a missing title is just an empty title. And never be
 * stricter than the sender, or this breaks live sessions instead of guarding
 * them.
 */

import type {
  BulkUpdatePayload,
  Item,
  ItemPriority,
  ItemType,
  Relation,
  RelationType,
  SyncTombstone,
  Tag
} from './types'
import { normalizeBoardConfig, type BoardConfig } from './boardModel'

// The messages

export type RemoteMutation =
  | { type: 'createItem' | 'updateItem'; item: Item; tagIds?: string[] }
  | { type: 'deleteItem'; id: string }
  | { type: 'createTag' | 'updateTag'; tag: Tag }
  | { type: 'deleteTag'; id: string }
  | { type: 'createRelation'; relation: Relation }
  | { type: 'deleteRelation'; id: string }
  /**
   * Same payload the local bulk edit takes. It was once declared as
   * `{ updates: [...] }`, which nothing ever sent, so the receiver read
   * undefined and threw, and bulk edits silently failed on the peer.
   */
  | { type: 'bulkUpdateItems'; payload: BulkUpdatePayload }
  | { type: 'bulkDeleteItems'; ids: string[] }
  | { type: 'rebalancePositions'; context: string; status: string }

/**
 * Points a mutation at a different workspace.
 *
 * Someone who joined a shared board as a copy holds it under a different slug
 * from the host's, and both sides still have to agree on which board a change
 * is about. The slug is translated at the wire so nothing else in the app has
 * to know. Mutations addressed by id carry no workspace and pass through.
 */
export function retargetMutation(mutation: RemoteMutation, context: string): RemoteMutation {
  if (mutation.type === 'createItem' || mutation.type === 'updateItem') {
    if (mutation.item.context === context) return mutation
    return { ...mutation, item: { ...mutation.item, context } }
  }
  if (mutation.type === 'rebalancePositions') {
    return mutation.context === context ? mutation : { ...mutation, context }
  }
  // The third carrier of a workspace name, and the least obvious: a bulk edit
  // can move cards between workspaces, and its patch names the destination.
  // Sent untranslated it would move the peer's cards into a workspace named
  // after this side's copy.
  if (mutation.type === 'bulkUpdateItems') {
    const { context: target } = mutation.payload.patch
    if (target === undefined || target === context) return mutation
    return { ...mutation, payload: { ...mutation.payload, patch: { ...mutation.payload.patch, context } } }
  }
  return mutation
}

/**
 * What a guest is allowed to do. The host decides it, and can change its mind
 * without ending the session.
 */
export type CollabMode = 'collaborative' | 'readonly'

export interface BoardBaselineMessage {
  type: 'board-baseline'
  context: string
  items: Item[]
  tags: Tag[]
  itemTags: { item_id: string; tag_id: string }[]
  relations: Relation[]
  mode: CollabMode
  /**
   * The host's columns, so the cards have somewhere to land.
   *
   * Optional, because a build older than this one sends no board at all and a
   * peer joining from one must still get its cards. Without it a workspace
   * created by joining starts on the four default columns, and every card
   * whose status is a column the host renamed or added renders nowhere.
   */
  board?: BoardConfig
  /**
   * What this side has deleted, so a merge on the other end can honour it.
   *
   * Without them a merge knows only its own deletions, and every card the
   * sender threw away walks back in from the receiver's copy. Optional, because
   * a build older than this sends none and a merge without them is the merge
   * that shipped before.
   */
  tombstones?: SyncTombstone[]
}

/**
 * Who is in the room, as only the host can know.
 *
 * Guests are connected to the host and not to each other, so the list has to
 * come from the middle and be sent on every change.
 */
export interface RosterMessage {
  type: 'roster'
  members: { id: string; name: string }[]
}

/**
 * The board document: columns, background, swimlanes, the card face.
 *
 * It used to travel only with the opening baseline, so a column added during a
 * session reached nobody, and a card moved into it arrived addressed to a
 * column the other side did not have and rendered nowhere.
 */
export interface BoardConfigMessage {
  type: 'board-config'
  context: string
  board: BoardConfig
}

export interface DbMutationMessage {
  type: 'db-mutation-event'
  mutation: RemoteMutation
}

/**
 * Sent before hanging up on purpose, so the other side can say who left rather
 * than just going quiet.
 *
 * A peer that crashes or loses its network sends nothing, which is the
 * difference the receiver is being told about: a message means they chose to.
 */
export interface PeerLeavingMessage {
  type: 'peer-leaving'
  /** May be empty. The receiver falls back to something readable. */
  by: string
}

/**
 * Said as soon as the channel opens, by both sides, so each can name the other.
 *
 * Without it the host knows only that somebody is in, which is no basis for
 * deciding whether to let them stay.
 */
export interface PeerHelloMessage {
  type: 'peer-hello'
  /** May be empty. The receiver falls back to something readable. */
  by: string
}

/**
 * The host dropping a guest on purpose.
 *
 * Separate from peer-leaving because the two read completely differently from
 * the other end: one is someone saying goodbye, the other is being shown the
 * door, and a connection that just goes quiet is neither.
 */
export interface PeerRemovedMessage {
  type: 'peer-removed'
  by: string
}

/** The host changing what the guest may do, without ending the session. */
export interface ModeChangeMessage {
  type: 'mode-change'
  mode: CollabMode
}

/**
 * One side offering the other the board the two of them make together.
 *
 * It carries the merged result rather than the raw copy for the other side to
 * merge for itself. Two independent merges do not have to agree: each side
 * breaks ties in its own favour and honours only its own deletions, so the
 * boards would end up nearly the same, which is the worst kind of same. One
 * merge, sent whole, and both ends hold the same board.
 */
export interface MergeProposalMessage {
  type: 'merge-proposal'
  by: string
  context: string
  items: Item[]
  tags: Tag[]
  itemTags: { item_id: string; tag_id: string }[]
  relations: Relation[]
  board: BoardConfig
}

/** Whether the other side took the merge. A no is an answer, not a failure. */
export interface MergeAnswerMessage {
  type: 'merge-answer'
  accepted: boolean
  by: string
}

export type CollabMessage =
  | BoardBaselineMessage
  | DbMutationMessage
  | PeerLeavingMessage
  | PeerHelloMessage
  | PeerRemovedMessage
  | ModeChangeMessage
  | MergeProposalMessage
  | MergeAnswerMessage
  | RosterMessage
  | BoardConfigMessage

// Primitives

function obj(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

/** A non-empty string, or null. Used wherever the value is an identity. */
function id(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

const ITEM_TYPES: ItemType[] = ['log', 'card', 'task']
const RELATION_TYPES: RelationType[] = ['blocks', 'relates_to', 'duplicates']

// Rows

/**
 * id, type and context decide which row is replaced and where. A wrong one
 * overwrites something unrelated. Timestamps required too, or the row sorts as
 * though it were from 1970.
 */
export function normalizeSyncItem(raw: unknown): Item | null {
  const o = obj(raw)
  if (!o) return null

  const itemId = id(o.id)
  const context = id(o.context)
  const type = ITEM_TYPES.includes(o.type as ItemType) ? (o.type as ItemType) : null
  const position = num(o.position)
  const created = num(o.created_at)
  const updated = num(o.updated_at)
  if (!itemId || !context || !type || position === null || created === null || updated === null) return null

  const priority = num(o.priority)
  const due = num(o.due_at)

  return {
    id: itemId,
    type,
    context,
    title: str(o.title),
    body: str(o.body),
    // Free string by design: it holds a user-defined column id.
    status: str(o.status),
    priority: (priority !== null && priority >= 0 && priority <= 3 ? Math.round(priority) : 0) as ItemPriority,
    position,
    created_at: created,
    updated_at: updated,
    due_at: due,
    // JSON text. An object here writes "[object Object]" and breaks every reader.
    metadata: typeof o.metadata === 'string' ? o.metadata : '{}'
  }
}

export function normalizeSyncTag(raw: unknown): Tag | null {
  const o = obj(raw)
  if (!o) return null
  const tagId = id(o.id)
  if (!tagId) return null
  return { id: tagId, name: str(o.name), color: str(o.color) }
}

export function normalizeSyncRelation(raw: unknown): Relation | null {
  const o = obj(raw)
  if (!o) return null
  const relId = id(o.id)
  const from = id(o.from_id)
  const to = id(o.to_id)
  const type = RELATION_TYPES.includes(o.type as RelationType) ? (o.type as RelationType) : null
  if (!relId || !from || !to || !type) return null
  return { id: relId, from_id: from, to_id: to, type }
}

function normalizeItemTag(raw: unknown): { item_id: string; tag_id: string } | null {
  const o = obj(raw)
  if (!o) return null
  const itemId = id(o.item_id)
  const tagId = id(o.tag_id)
  return itemId && tagId ? { item_id: itemId, tag_id: tagId } : null
}

/** Drops the entries that cannot be written, keeping the rest. */
function normalizeAll<T>(raw: unknown, one: (value: unknown) => T | null): T[] {
  return Array.isArray(raw) ? raw.map(one).filter((v): v is T => v !== null) : []
}

/**
 * A deletion the sender remembers. The table matters: only these three record a
 * row id, and a merge reading a note's filename as a card id would keep that
 * card out for no reason.
 */
function normalizeTombstone(raw: unknown): SyncTombstone | null {
  const o = obj(raw)
  if (!o) return null
  const rowId = id(o.id)
  const table = id(o.table_name)
  if (!rowId || !table) return null
  if (table !== 'items' && table !== 'tags' && table !== 'relations') return null
  return { id: rowId, table_name: table, deleted_at: num(o.deleted_at) ?? 0 }
}

/** Someone in the room. A member with no id is nobody. */
function normalizeRosterMember(raw: unknown): { id: string; name: string } | null {
  const o = obj(raw)
  if (!o) return null
  const memberId = id(o.id)
  return memberId ? { id: memberId, name: str(o.name) } : null
}

/** Ids only, for the mutations that carry a list of them. */
function idList(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.map(id).filter((v): v is string => v !== null) : []
}

// Mutations

export function normalizeRemoteMutation(raw: unknown): RemoteMutation | null {
  const o = obj(raw)
  if (!o) return null

  switch (o.type) {
    case 'createItem':
    case 'updateItem': {
      const item = normalizeSyncItem(o.item)
      if (!item) return null
      // Absent leaves tags alone; empty clears them. Collapsing the two untags silently.
      const tagIds = o.tagIds === undefined || o.tagIds === null ? undefined : idList(o.tagIds)
      return { type: o.type, item, ...(tagIds ? { tagIds } : {}) }
    }

    case 'deleteItem':
    case 'deleteTag':
    case 'deleteRelation': {
      const target = id(o.id)
      return target ? { type: o.type, id: target } : null
    }

    case 'createTag':
    case 'updateTag': {
      const tag = normalizeSyncTag(o.tag)
      return tag ? { type: o.type, tag } : null
    }

    case 'createRelation': {
      const relation = normalizeSyncRelation(o.relation)
      return relation ? { type: 'createRelation', relation } : null
    }

    case 'bulkUpdateItems': {
      const payload = obj(o.payload)
      if (!payload) return null

      const ids = idList(payload.ids)
      const rawPatch = obj(payload.patch)
      if (ids.length === 0 || !rawPatch) return null

      // Only the three the local bulk edit can set; anything else is not ours to write.
      const patch: BulkUpdatePayload['patch'] = {}
      if (typeof rawPatch.status === 'string') patch.status = rawPatch.status
      if (typeof rawPatch.context === 'string' && rawPatch.context.trim() !== '') patch.context = rawPatch.context
      const priority = num(rawPatch.priority)
      if (priority !== null && priority >= 0 && priority <= 3) patch.priority = Math.round(priority) as ItemPriority

      // An empty patch is an empty SET clause. A syntax error, not a no-op.
      return Object.keys(patch).length > 0 ? { type: 'bulkUpdateItems', payload: { ids, patch } } : null
    }

    case 'bulkDeleteItems': {
      const ids = idList(o.ids)
      return ids.length > 0 ? { type: 'bulkDeleteItems', ids } : null
    }

    case 'rebalancePositions': {
      const context = id(o.context)
      return context ? { type: 'rebalancePositions', context, status: str(o.status) } : null
    }

    // From a build we do not know. Dropped rather than guessed at.
    default:
      return null
  }
}

// Messages

export function normalizeCollabMessage(raw: unknown): CollabMessage | null {
  const o = obj(raw)
  if (!o) return null

  if (o.type === 'board-baseline') {
    const context = id(o.context)
    if (!context) return null
    return {
      type: 'board-baseline',
      context,
      // Dropped one by one: a corrupt card should not cost the whole board.
      items: normalizeAll(o.items, normalizeSyncItem),
      tags: normalizeAll(o.tags, normalizeSyncTag),
      itemTags: normalizeAll(o.itemTags, normalizeItemTag),
      relations: normalizeAll(o.relations, normalizeSyncRelation),
      // Read-only by default, so an unclear peer does not make us broadcast back.
      mode: o.mode === 'collaborative' ? 'collaborative' : 'readonly',
      // Absent from an older peer. Left undefined rather than normalised into
      // a default board, so the joiner can tell "no board was sent" from "the
      // host really has the default four" and keep its own in the first case.
      board: o.board === undefined ? undefined : normalizeBoardConfig(o.board),
      tombstones: o.tombstones === undefined
        ? undefined
        : normalizeAll(o.tombstones, normalizeTombstone)
    }
  }

  if (o.type === 'roster') {
    return { type: 'roster', members: normalizeAll(o.members, normalizeRosterMember) }
  }

  if (o.type === 'board-config') {
    const context = id(o.context)
    if (!context) return null
    return { type: 'board-config', context, board: normalizeBoardConfig(o.board) }
  }

  if (o.type === 'db-mutation-event') {
    const mutation = normalizeRemoteMutation(o.mutation)
    return mutation ? { type: 'db-mutation-event', mutation } : null
  }

  if (o.type === 'peer-leaving') {
    // No name is still a valid goodbye: knowing they left on purpose is the
    // point, and who they were is the decoration.
    return { type: 'peer-leaving', by: str(o.by) }
  }

  if (o.type === 'peer-hello') {
    return { type: 'peer-hello', by: str(o.by) }
  }

  if (o.type === 'peer-removed') {
    return { type: 'peer-removed', by: str(o.by) }
  }

  if (o.type === 'merge-proposal') {
    const context = id(o.context)
    // Same rule as the baseline: a merge with no workspace on it has nowhere to
    // go, and the workspace is what the receiver is about to overwrite.
    if (!context) return null
    return {
      type: 'merge-proposal',
      by: str(o.by),
      context,
      items: normalizeAll(o.items, normalizeSyncItem),
      tags: normalizeAll(o.tags, normalizeSyncTag),
      itemTags: normalizeAll(o.itemTags, normalizeItemTag),
      relations: normalizeAll(o.relations, normalizeSyncRelation),
      board: normalizeBoardConfig(o.board)
    }
  }

  if (o.type === 'merge-answer') {
    // Only an explicit yes is a yes. Anything else, including a field that will
    // not read, leaves the other side's board exactly as it was, which is the
    // failure nobody has to undo.
    return { type: 'merge-answer', accepted: o.accepted === true, by: str(o.by) }
  }

  if (o.type === 'mode-change') {
    // Rejected rather than defaulted, unlike every other field here. A mode
    // nobody can read must not become the permissive one: this is the message
    // that decides what a peer is allowed to do, and the safe way to fail is to
    // leave what was already agreed in place.
    if (o.mode !== 'collaborative' && o.mode !== 'readonly') return null
    return { type: 'mode-change', mode: o.mode }
  }

  return null
}
