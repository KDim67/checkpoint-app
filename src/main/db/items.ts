import type Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import { emitPluginEvent } from '../pluginEvents'
import type { Item, Tag, CreateItemPayload, PaginatedResult } from '../../shared/types'
import { getDb, prepareOnce } from './connection'
import { getSetting } from './settings'
import { recordTombstone } from './tombstones'

let stmtGetItemsPaginated: Database.Statement
let stmtGetLogsPaginated: Database.Statement
let stmtGetItemsTotal: Database.Statement
let stmtGetItemById: Database.Statement
let stmtInsertItem: Database.Statement
let stmtDeleteItem: Database.Statement
let stmtGetTagsForItem: Database.Statement
let stmtInsertItemTag: Database.Statement
let stmtDeleteItemTags: Database.Statement
let stmtGetContexts: Database.Statement
let stmtGetItemsForRebalance: Database.Statement
let stmtUpdateItemPosition: Database.Statement

export function prepareItemStatements(db: Database.Database): void {
  stmtGetItemsPaginated = db.prepare(`
    SELECT i.*, GROUP_CONCAT(t.id || '|' || t.name || '|' || t.color, ';;') as tag_data
    FROM items i
    LEFT JOIN item_tags it ON i.id = it.item_id
    LEFT JOIN tags t ON it.tag_id = t.id
    WHERE i.context = ? AND i.type = ?
    GROUP BY i.id
    ORDER BY i.position ASC, i.created_at DESC
    LIMIT ? OFFSET ?
  `)

  stmtGetLogsPaginated = db.prepare(`
    SELECT i.*, GROUP_CONCAT(t.id || '|' || t.name || '|' || t.color, ';;') as tag_data
    FROM items i
    LEFT JOIN item_tags it ON i.id = it.item_id
    LEFT JOIN tags t ON it.tag_id = t.id
    WHERE i.context = ? AND i.type = ?
    GROUP BY i.id
    ORDER BY i.position DESC, i.created_at DESC
    LIMIT ? OFFSET ?
  `)

  stmtGetItemsTotal = db.prepare(
    `SELECT COUNT(*) as count FROM items WHERE context = ? AND type = ?`
  )

  stmtGetItemById = db.prepare(`
    SELECT i.*, GROUP_CONCAT(t.id || '|' || t.name || '|' || t.color, ';;') as tag_data
    FROM items i
    LEFT JOIN item_tags it ON i.id = it.item_id
    LEFT JOIN tags t ON it.tag_id = t.id
    WHERE i.id = ?
    GROUP BY i.id
  `)

  stmtInsertItem = db.prepare(`
    INSERT INTO items (id, type, context, title, body, status, priority, position, created_at, updated_at, due_at, metadata)
    VALUES (@id, @type, @context, @title, @body, @status, @priority, @position, @created_at, @updated_at, @due_at, @metadata)
  `)

  stmtDeleteItem = db.prepare(`DELETE FROM items WHERE id = ?`)

  stmtGetTagsForItem = db.prepare(`
    SELECT t.* FROM tags t
    INNER JOIN item_tags it ON t.id = it.tag_id
    WHERE it.item_id = ?
  `)
  stmtInsertItemTag = db.prepare(`INSERT OR IGNORE INTO item_tags (item_id, tag_id) VALUES (?, ?)`)
  stmtDeleteItemTags = db.prepare(`DELETE FROM item_tags WHERE item_id = ?`)

  stmtGetContexts = db.prepare(
    `SELECT DISTINCT context as slug FROM items`
  )

  stmtGetItemsForRebalance = db.prepare(`
    SELECT id FROM items
    WHERE context = ? AND status = ? AND type = 'card'
    ORDER BY position ASC
  `)

  stmtUpdateItemPosition = db.prepare(`
    UPDATE items SET position = ?, updated_at = ? WHERE id = ?
  `)
}

// Helper: parse concatenated tag data from JOIN

function parseTagData(tagData: string | null): Tag[] {
  if (!tagData) return []
  return tagData.split(';;').map(chunk => {
    const [id, name, color] = chunk.split('|')
    return { id, name, color }
  })
}

// Helper: parse a raw DB row into a typed Item

export function rowToItem(row: Record<string, unknown>): Item {
  return {
    id: row.id as string,
    type: row.type as Item['type'],
    context: row.context as string,
    title: row.title as string,
    body: row.body as string,
    status: row.status as Item['status'],
    priority: row.priority as Item['priority'],
    position: row.position as number,
    created_at: row.created_at as number,
    updated_at: row.updated_at as number,
    due_at: (row.due_at as number | null) ?? null,
    metadata: row.metadata as string,
    tags: parseTagData(row.tag_data as string | null)
  }
}

export function getItemsPaginated(
  context: string,
  type: string,
  page: number,
  pageSize: number
): PaginatedResult<Item> {
  const pageIndex = page > 0 ? page - 1 : 0
  const offset = pageIndex * pageSize
  const stmt = type === 'log' ? stmtGetLogsPaginated : stmtGetItemsPaginated
  const rows = stmt.all(context, type, pageSize, offset) as Record<string, unknown>[]
  const total = (stmtGetItemsTotal.get(context, type) as { count: number }).count
  return { items: rows.map(rowToItem), total, page, pageSize }
}

/**
 * Every item of one type in a workspace, in the order a page of them comes in.
 *
 * For callers that need the whole board rather than a page of it. One page with
 * a large limit reads a board past that limit as though it ended there.
 */
export function getAllItems(context: string, type: string): Item[] {
  const order = type === 'log' ? 'i.position DESC' : 'i.position ASC'
  const rows = prepareOnce(getDb(), `
    SELECT i.*, GROUP_CONCAT(t.id || '|' || t.name || '|' || t.color, ';;') as tag_data
    FROM items i
    LEFT JOIN item_tags it ON i.id = it.item_id
    LEFT JOIN tags t ON it.tag_id = t.id
    WHERE i.context = ? AND i.type = ?
    GROUP BY i.id
    ORDER BY ${order}, i.created_at DESC
  `).all(context, type) as Record<string, unknown>[]
  return rows.map(rowToItem)
}

/**
 * Every item, for export. Unpaginated on purpose.
 *
 * An export that quietly stopped at a page boundary would be worse than none,
 * so this deliberately does not take a limit. It runs through the same tag join
 * and rowToItem mapping the rest of the app uses, so an exported row carries its
 * tags rather than a bare column dump.
 */
export function getAllItemsForExport(context: string | null): Item[] {
  const sql = `
    SELECT i.*, GROUP_CONCAT(t.id || '|' || t.name || '|' || t.color, ';;') as tag_data
    FROM items i
    LEFT JOIN item_tags it ON i.id = it.item_id
    LEFT JOIN tags t ON it.tag_id = t.id
    ${context ? 'WHERE i.context = @context' : ''}
    GROUP BY i.id
    ORDER BY i.context, i.created_at
  `
  const stmt = getDb().prepare(sql)
  const rows = (context ? stmt.all({ context }) : stmt.all()) as Record<string, unknown>[]
  return rows.map(rowToItem)
}

export function getItemById(id: string): Item | null {
  const row = stmtGetItemById.get(id) as Record<string, unknown> | undefined
  return row ? rowToItem(row) : null
}

export function createItem(
  db: Database.Database,
  payload: CreateItemPayload,
  tagIds: string[] = []
): Item {
  const now = Date.now()
  const id = uuidv4()
  const item = {
    id,
    type: payload.type,
    context: payload.context,
    title: payload.title,
    body: payload.body,
    status: payload.status ?? 'open',
    priority: payload.priority ?? 0,
    position: payload.position ?? now,
    created_at: now,
    updated_at: now,
    due_at: payload.due_at ?? null,
    metadata: payload.metadata ?? '{}'
  }

  db.transaction(() => {
    stmtInsertItem.run(item)
    for (const tagId of tagIds) {
      stmtInsertItemTag.run(id, tagId)
    }
  })()

  const created = { ...item, tags: tagIds.length ? (stmtGetTagsForItem.all(id) as Tag[]) : [] }
  // Emitted for every creation path (the UI, an agent over MCP, a webhook),
  // because a plugin cares that a card appeared, not who typed it.
  emitPluginEvent('item:created', { item: created })
  return created
}

export function updateItem(
  db: Database.Database,
  id: string,
  patch: Partial<Omit<Item, 'id' | 'created_at'>>,
  tagIds?: string[]
): Item {
  const existing = stmtGetItemById.get(id) as Record<string, unknown> | undefined
  if (!existing) throw new Error(`Item not found: ${id}`)

  const updated_at = Date.now()
  const allowed: Array<keyof Item> = [
    'type', 'context', 'title', 'body', 'status',
    'priority', 'position', 'due_at', 'metadata'
  ]
  const setClauses = allowed
    .filter(k => k in patch)
    .map(k => `${k} = @${k}`)
    .concat('updated_at = @updated_at')
    .join(', ')

  if (setClauses.replace('updated_at = @updated_at', '').trim().length > 0 || tagIds !== undefined) {
    db.transaction(() => {
      if (setClauses) {
        prepareOnce(db, `UPDATE items SET ${setClauses} WHERE id = @id`).run({ ...patch, updated_at, id })
      }
      if (tagIds !== undefined) {
        stmtDeleteItemTags.run(id)
        for (const tagId of tagIds) {
          stmtInsertItemTag.run(id, tagId)
        }
      }
    })()
  }

  const row = stmtGetItemById.get(id) as Record<string, unknown>
  const item = rowToItem(row)

  // Only on the transition into a finished state, so repeated edits to an
  // already-done item do not each try to advance the rule, and a plugin
  // listening for completions does not hear the same one repeatedly.
  const wasOpen = existing.status !== 'done' && existing.status !== 'archived'
  const nowClosed = item.status === 'done' || item.status === 'archived'
  if (wasOpen && nowClosed) emitPluginEvent('item:completed', { item })
  if (wasOpen && nowClosed && onRecurrenceInstanceClosed) {
    try {
      const meta = JSON.parse(item.metadata || '{}') as { recurrenceId?: unknown }
      if (typeof meta.recurrenceId === 'string' && meta.recurrenceId) {
        onRecurrenceInstanceClosed(meta.recurrenceId)
      }
    } catch {
      // Metadata that is not JSON simply has no recurrence to advance.
    }
  }

  return item
}

let onRecurrenceInstanceClosed: ((recurrenceId: string) => void) | null = null

/**
 * Called when an item belonging to a recurrence reaches a finished state.
 *
 * Wired up from index.ts. Without it the next occurrence would still appear, but
 * only on the next hourly sweep. Completing today's task should offer
 * tomorrow's straight away.
 */
export function setRecurrenceInstanceClosedHandler(
  handler: ((recurrenceId: string) => void) | null
): void {
  onRecurrenceInstanceClosed = handler
}

/**
 * Deletes an item, returning the workspace it belonged to.
 *
 * The context is read before the row goes, because callers need it afterwards
 * and it is unrecoverable once deleted. Collaboration in particular filters
 * outgoing mutations by workspace, and a delete that cannot say which workspace
 * it came from gets broadcast from all of them.
 */
export function deleteItem(id: string): string | null {
  const existing = stmtGetItemById.get(id) as { context?: string } | undefined
  const context = existing?.context ?? null
  recordTombstone(id, 'items')
  stmtDeleteItem.run(id)
  return context
}

/**
 * Deletes many items in one transaction.
 *
 * Each leaves a tombstone, as deleting it alone does. Sync only skips an item it
 * has a tombstone for, so without one the next sync from a copy that still has
 * the item puts it straight back, and a merge cannot tell it was deleted.
 */
export function bulkDeleteItems(db: Database.Database, ids: string[]): number {
  db.transaction(() => {
    for (const id of ids) {
      recordTombstone(id, 'items')
      stmtDeleteItem.run(id)
    }
  })()
  return ids.length
}

export function getContextSlugs(): string[] {
  try {
    const raw = getSetting<string>('contexts_list', '')
    if (raw) {
      const parsed = JSON.parse(raw) as Array<{ slug: string }>
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.map(c => c.slug)
      }
    }
  } catch (err) {
    console.error('[db] Failed to parse contexts_list setting:', err)
  }

  // Fallback to distinct contexts from items table
  const rows = stmtGetContexts.all() as { slug: string }[]
  const slugs = rows.map(r => r.slug).filter(Boolean)
  if (!slugs.includes('default')) {
    slugs.unshift('default')
  }
  return slugs
}

export function rebalancePositions(db: Database.Database, context: string, status: string): void {
  const rows = stmtGetItemsForRebalance.all(context, status) as Array<{ id: string }>
  const now = Date.now()
  db.transaction(() => {
    rows.forEach((row, index) => {
      stmtUpdateItemPosition.run((index + 1) * 1000.0, now, row.id)
    })
  })()
}
