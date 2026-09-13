/** feeds prepared statements; reject bad structure, default decoration, never stricter than the sender */

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
import { readInstallId } from './identity'

export type RemoteMutation =
  | { type: 'createItem' | 'updateItem'; item: Item; tagIds?: string[] }
  | { type: 'deleteItem'; id: string }
  | { type: 'createTag' | 'updateTag'; tag: Tag }
  | { type: 'deleteTag'; id: string }
  | { type: 'createRelation'; relation: Relation }
  | { type: 'deleteRelation'; id: string }
  /** same payload as the local bulk edit; the old { updates } shape was never sent */
  | { type: 'bulkUpdateItems'; payload: BulkUpdatePayload }
  | { type: 'bulkDeleteItems'; ids: string[] }
  | { type: 'rebalancePositions'; context: string; status: string }

/** copies hold boards under another slug, translated at the wire; id-only mutations pass through */
export function retargetMutation(mutation: RemoteMutation, context: string): RemoteMutation {
  if (mutation.type === 'createItem' || mutation.type === 'updateItem') {
    if (mutation.item.context === context) return mutation
    return { ...mutation, item: { ...mutation.item, context } }
  }
  if (mutation.type === 'rebalancePositions') {
    return mutation.context === context ? mutation : { ...mutation, context }
  }
  // a bulk edit's patch can name a workspace too
  if (mutation.type === 'bulkUpdateItems') {
    const { context: target } = mutation.payload.patch
    if (target === undefined || target === context) return mutation
    return { ...mutation, payload: { ...mutation.payload, patch: { ...mutation.payload.patch, context } } }
  }
  return mutation
}

/** the host decides and can change it mid-session */
export type CollabMode = 'collaborative' | 'readonly'

export interface BoardBaselineMessage {
  type: 'board-baseline'
  context: string
  items: Item[]
  tags: Tag[]
  itemTags: { item_id: string; tag_id: string }[]
  relations: Relation[]
  mode: CollabMode
  /** optional for older builds; without it a joined workspace gets default columns and cards vanish */
  board?: BoardConfig
  /** optional; without them a merge revives everything the sender deleted */
  tombstones?: SyncTombstone[]
  /** file the board against the host, not the name; empty falls back to the name */
  install?: string
}

/** only the host knows, sent on every change */
interface RosterMessage {
  type: 'roster'
  members: { id: string; name: string }[]
}

/** it only went with the baseline once, so new columns never arrived */
interface BoardConfigMessage {
  type: 'board-config'
  context: string
  board: BoardConfig
}

interface DbMutationMessage {
  type: 'db-mutation-event'
  mutation: RemoteMutation
}

/** a crash sends nothing; this means they chose to */
interface PeerLeavingMessage {
  type: 'peer-leaving'
  /** may be empty */
  by: string
}

/** both sides on open, so each can name the other */
interface PeerHelloMessage {
  type: 'peer-hello'
  /** may be empty */
  by: string
}

/** being shown the door, not saying goodbye */
interface PeerRemovedMessage {
  type: 'peer-removed'
  by: string
}

/** without ending the session */
interface ModeChangeMessage {
  type: 'mode-change'
  mode: CollabMode
}

/** the merged result, whole: two independent merges end up nearly the same */
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

/** replaced wholesale, told not asked; everyone reached holds the board it replaces */
export interface BoardResetMessage {
  type: 'board-reset'
  /** so the notice says where the board came from */
  by: string
  context: string
  items: Item[]
  tags: Tag[]
  itemTags: { item_id: string; tag_id: string }[]
  relations: Relation[]
  board: BoardConfig
}

/** a no is an answer, not a failure */
interface MergeAnswerMessage {
  type: 'merge-answer'
  accepted: boolean
  by: string
  /** only when the app said no, so the other side knows whether to retry */
  reason?: string
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
  | BoardResetMessage
  | RosterMessage
  | BoardConfigMessage

function obj(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

/** non-empty or null, for identities */
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

/** id, type and context decide what's replaced; timestamps required or it sorts as 1970 */
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
    // free string, a user-defined column id
    status: str(o.status),
    priority: (priority !== null && priority >= 0 && priority <= 3 ? Math.round(priority) : 0) as ItemPriority,
    position,
    created_at: created,
    updated_at: updated,
    due_at: due,
    // JSON text; an object writes "[object Object]"
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

/** drops unwritable entries, keeps the rest */
function normalizeAll<T>(raw: unknown, one: (value: unknown) => T | null): T[] {
  return Array.isArray(raw) ? raw.map(one).filter((v): v is T => v !== null) : []
}

/** only these three tables hold row ids */
function normalizeTombstone(raw: unknown): SyncTombstone | null {
  const o = obj(raw)
  if (!o) return null
  const rowId = id(o.id)
  const table = id(o.table_name)
  if (!rowId || !table) return null
  if (table !== 'items' && table !== 'tags' && table !== 'relations') return null
  return { id: rowId, table_name: table, deleted_at: num(o.deleted_at) ?? 0 }
}

/** no id, nobody */
function normalizeRosterMember(raw: unknown): { id: string; name: string } | null {
  const o = obj(raw)
  if (!o) return null
  const memberId = id(o.id)
  return memberId ? { id: memberId, name: str(o.name) } : null
}

function idList(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.map(id).filter((v): v is string => v !== null) : []
}

export function normalizeRemoteMutation(raw: unknown): RemoteMutation | null {
  const o = obj(raw)
  if (!o) return null

  switch (o.type) {
    case 'createItem':
    case 'updateItem': {
      const item = normalizeSyncItem(o.item)
      if (!item) return null
      // absent leaves tags, empty clears them
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

      // only what the local bulk edit can set
      const patch: BulkUpdatePayload['patch'] = {}
      if (typeof rawPatch.status === 'string') patch.status = rawPatch.status
      if (typeof rawPatch.context === 'string' && rawPatch.context.trim() !== '') patch.context = rawPatch.context
      const priority = num(rawPatch.priority)
      if (priority !== null && priority >= 0 && priority <= 3) patch.priority = Math.round(priority) as ItemPriority

      // an empty patch is a SQL syntax error
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

    // unknown build, dropped not guessed
    default:
      return null
  }
}

export function normalizeCollabMessage(raw: unknown): CollabMessage | null {
  const o = obj(raw)
  if (!o) return null

  if (o.type === 'board-baseline') {
    const context = id(o.context)
    if (!context) return null
    return {
      type: 'board-baseline',
      context,
      // one by one, a bad card shouldn't cost the board
      items: normalizeAll(o.items, normalizeSyncItem),
      tags: normalizeAll(o.tags, normalizeSyncTag),
      itemTags: normalizeAll(o.itemTags, normalizeItemTag),
      relations: normalizeAll(o.relations, normalizeSyncRelation),
      // read-only by default so an unclear peer doesn't get broadcasts
      mode: o.mode === 'collaborative' ? 'collaborative' : 'readonly',
      // left undefined so the joiner can tell no board from the default four
      board: o.board === undefined ? undefined : normalizeBoardConfig(o.board),
      tombstones: o.tombstones === undefined
        ? undefined
        : normalizeAll(o.tombstones, normalizeTombstone),
      // empty covers old hosts and unreadable ids
      install: readInstallId(o.install)
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
    // no name is still a valid goodbye
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
    // no workspace, nowhere to go
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

  if (o.type === 'board-reset') {
    const context = id(o.context)
    // no workspace, nowhere to put it
    if (!context) return null
    return {
      type: 'board-reset',
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
    // only an explicit yes
    return {
      type: 'merge-answer',
      accepted: o.accepted === true,
      by: str(o.by),
      reason: str(o.reason)
    }
  }

  if (o.type === 'mode-change') {
    // rejected, not defaulted: an unreadable mode mustn't become permissive
    if (o.mode !== 'collaborative' && o.mode !== 'readonly') return null
    return { type: 'mode-change', mode: o.mode }
  }

  return null
}
