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

import type { BulkUpdatePayload, Item, ItemPriority, ItemType, Relation, RelationType, Tag } from './types'

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

export interface BoardBaselineMessage {
  type: 'board-baseline'
  context: string
  items: Item[]
  tags: Tag[]
  itemTags: { item_id: string; tag_id: string }[]
  relations: Relation[]
  mode: 'collaborative' | 'readonly'
}

export interface DbMutationMessage {
  type: 'db-mutation-event'
  mutation: RemoteMutation
}

export type CollabMessage = BoardBaselineMessage | DbMutationMessage

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
      mode: o.mode === 'collaborative' ? 'collaborative' : 'readonly'
    }
  }

  if (o.type === 'db-mutation-event') {
    const mutation = normalizeRemoteMutation(o.mutation)
    return mutation ? { type: 'db-mutation-event', mutation } : null
  }

  return null
}
