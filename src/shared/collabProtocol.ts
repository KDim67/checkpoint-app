/**
 * The wire protocol between two collaborating Checkpoint instances.
 *
 * This is the one place where data from another machine becomes data this
 * machine acts on, and until now both ends of it were typed `any`. What arrives
 * on the data channel was destructured and handed straight to prepared
 * statements, `INSERT OR REPLACE INTO items`, `DELETE FROM items WHERE id = ?`
 *, so a peer sending a field of the wrong shape either wrote nonsense into the
 * database or threw somewhere deep inside SQLite.
 *
 * Encryption does not help here. The pairing code establishes that the peer
 * knows the code, not that it is a well-behaved Checkpoint, and a peer running
 * an older or newer build is the ordinary case rather than the adversarial one.
 *
 * Two rules shape the normalizers:
 *
 * - **Reject structure, default decoration.** A missing id, a non-numeric
 *   position or an unknown kind means the message is not one this build
 *   understands, and guessing would write a corrupt row. A missing title is
 *   just an empty title.
 * - **Everything a genuine peer sends must survive.** These run on every
 *   mutation of a live session, so a normalizer that is stricter than the
 *   sender breaks collaboration rather than protecting it.
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
   * The same payload the local bulk edit takes: some ids and one patch applied
   * to all of them.
   *
   * It used to be declared here as `{ updates: [{ id, position, status }] }`,
   * a shape nothing in the app has ever sent. The receiving end read
   * `payload.updates`, found undefined, and threw, so every bulk edit made
   * during a shared session failed on the peer while succeeding locally. The
   * declaration was wrong, not the senders.
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
 * An item as it can safely be written.
 *
 * `id`, `type` and `context` are required because they decide *which* row is
 * replaced and which workspace it lands in, getting one wrong overwrites
 * something that has nothing to do with the message. The timestamps are
 * required because a row without them sorts and filters as though it were from
 * 1970.
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
    // Status is a free string by design, it holds a column id, and columns are
    // user-defined, so there is no set to check it against.
    status: str(o.status),
    priority: (priority !== null && priority >= 0 && priority <= 3 ? Math.round(priority) : 0) as ItemPriority,
    position,
    created_at: created,
    updated_at: updated,
    due_at: due,
    // Stored as a JSON string. A peer sending an object would write "[object
    // Object]" into the column and break every reader of it.
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
      // Absent and empty are different: absent leaves the row's tags alone,
      // while an empty array clears them. Preserving that distinction is the
      // difference between an edit and a silent untagging.
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

      // Only the three fields the local bulk edit can set. A patch naming
      // anything else is either a newer build or a peer trying its luck, and
      // in both cases the extra field is not something to write.
      const patch: BulkUpdatePayload['patch'] = {}
      if (typeof rawPatch.status === 'string') patch.status = rawPatch.status
      if (typeof rawPatch.context === 'string' && rawPatch.context.trim() !== '') patch.context = rawPatch.context
      const priority = num(rawPatch.priority)
      if (priority !== null && priority >= 0 && priority <= 3) patch.priority = Math.round(priority) as ItemPriority

      // Nothing to set means an UPDATE with an empty SET clause, which is a
      // syntax error rather than a no-op.
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

    // Anything else is from a build this one does not know. Dropped rather than
    // guessed at: a message whose shape is unknown cannot be applied safely.
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
      // Rows that cannot be written are dropped individually. One corrupt card
      // should cost the user that card, not the whole board they are joining.
      items: normalizeAll(o.items, normalizeSyncItem),
      tags: normalizeAll(o.tags, normalizeSyncTag),
      itemTags: normalizeAll(o.itemTags, normalizeItemTag),
      relations: normalizeAll(o.relations, normalizeSyncRelation),
      // Read-only is the safe default: a peer that fails to say means this end
      // does not start broadcasting its own writes back.
      mode: o.mode === 'collaborative' ? 'collaborative' : 'readonly'
    }
  }

  if (o.type === 'db-mutation-event') {
    const mutation = normalizeRemoteMutation(o.mutation)
    return mutation ? { type: 'db-mutation-event', mutation } : null
  }

  return null
}
