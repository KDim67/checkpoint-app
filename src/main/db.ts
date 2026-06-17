/**
 * SQLite Database Layer, Checkpoint
 *
 * Uses better-sqlite3 (synchronous API, native C++ module).
 * Must be rebuilt for Electron's Node ABI via electron-rebuild (postinstall script).
 *
 * All db.prepare() calls happen once at initDb() time, stored as module-level
 * prepared statements. Query functions call .run()/.get()/.all() on them, 
 * never call db.prepare() inside a per-call function.
 */

import Database from 'better-sqlite3'
import { join } from 'path'
import { v4 as uuidv4 } from 'uuid'
import { ipcMain } from 'electron'
import { z } from 'zod'
import {
  CreateItemSchema,
  UpdateItemSchema,
  CreateTagSchema,
  RelationTypeSchema,
  BulkUpdateSchema,
  SearchQuerySchema,
  TaskQueryParamsSchema
} from './validation'
import { IpcChannels } from '../shared/ipcChannels'
import type {
  Item,
  Tag,
  CreateItemPayload,
  CreateTagPayload,
  PaginatedResult,
  Relation,
  RelationType,
  SearchQuery,
  TaskQueryParams
} from '../shared/types'

// Current schema version
const CURRENT_VERSION = 1

// Prepared statement cache (populated by initDb)
let stmtGetItemsPaginated: Database.Statement
let stmtGetItemsTotal: Database.Statement
let stmtGetItemById: Database.Statement
let stmtInsertItem: Database.Statement
let stmtDeleteItem: Database.Statement
let stmtGetAllTags: Database.Statement
let stmtInsertTag: Database.Statement
let stmtUpdateTag: Database.Statement
let stmtDeleteTag: Database.Statement
let stmtGetTagsForItem: Database.Statement
let stmtInsertItemTag: Database.Statement
let stmtDeleteItemTags: Database.Statement
let stmtGetSetting: Database.Statement
let stmtSetSetting: Database.Statement
let stmtGetRelations: Database.Statement
let stmtInsertRelation: Database.Statement
let stmtDeleteRelation: Database.Statement
let stmtSearchItems: Database.Statement
let stmtSearchTotal: Database.Statement
let stmtGetContexts: Database.Statement
let stmtBulkUpdateStatus: Database.Statement
let stmtGetItemsForRebalance: Database.Statement
let stmtUpdateItemPosition: Database.Statement

// Schema

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS items (
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL CHECK(type IN ('log','card','task')),
  context     TEXT NOT NULL,
  title       TEXT NOT NULL DEFAULT '',
  body        TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'open',
  priority    INTEGER NOT NULL DEFAULT 0 CHECK(priority IN (0,1,2,3)),
  position    REAL NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  due_at      INTEGER,
  metadata    TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS tags (
  id      TEXT PRIMARY KEY,
  name    TEXT NOT NULL UNIQUE,
  color   TEXT NOT NULL DEFAULT '#535e85'
);

CREATE TABLE IF NOT EXISTS item_tags (
  item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  tag_id  TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (item_id, tag_id)
);

CREATE TABLE IF NOT EXISTS relations (
  id      TEXT PRIMARY KEY,
  from_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  to_id   TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  type    TEXT NOT NULL CHECK(type IN ('blocks','relates_to','duplicates'))
);

CREATE TABLE IF NOT EXISTS app_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS activity_tracking_logs (
  id           TEXT PRIMARY KEY,
  context      TEXT NOT NULL,
  window_title TEXT NOT NULL,
  process_name TEXT NOT NULL,
  duration_ms  INTEGER NOT NULL,
  captured_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_items_context   ON items(context);
CREATE INDEX IF NOT EXISTS idx_items_type      ON items(type);
CREATE INDEX IF NOT EXISTS idx_items_status    ON items(status);
CREATE INDEX IF NOT EXISTS idx_items_position  ON items(position);
CREATE INDEX IF NOT EXISTS idx_items_created   ON items(created_at DESC);
CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(
  id UNINDEXED,
  title,
  body,
  content='items',
  content_rowid='rowid'
);
CREATE TRIGGER IF NOT EXISTS items_fts_insert AFTER INSERT ON items BEGIN
  INSERT INTO items_fts(rowid, id, title, body) VALUES (new.rowid, new.id, new.title, new.body);
END;
CREATE TRIGGER IF NOT EXISTS items_fts_delete AFTER DELETE ON items BEGIN
  INSERT INTO items_fts(items_fts, rowid, id, title, body) VALUES('delete', old.rowid, old.id, old.title, old.body);
END;
CREATE TRIGGER IF NOT EXISTS items_fts_update AFTER UPDATE ON items BEGIN
  INSERT INTO items_fts(items_fts, rowid, id, title, body) VALUES('delete', old.rowid, old.id, old.title, old.body);
  INSERT INTO items_fts(rowid, id, title, body) VALUES (new.rowid, new.id, new.title, new.body);
END;
`

// Migrations

function runMigrations(db: Database.Database): void {
  const userVersion = (db.pragma('user_version', { simple: true }) as number) ?? 0
  if (userVersion >= CURRENT_VERSION) return

  db.transaction(() => {
    // v1: initial schema (applied via SCHEMA_SQL above)
    db.pragma(`user_version = ${CURRENT_VERSION}`)
  })()
}

// Init

export function initDb(dataPath: string): Database.Database {
  // Lazy import: better-sqlite3 is a native module, loaded only when needed
  const dbPath = join(dataPath, 'checkpoint.db')
  const db = new Database(dbPath)

  // Performance & safety PRAGMAs
  db.pragma('journal_mode = WAL')     // non-blocking concurrent reads
  db.pragma('foreign_keys = ON')
  db.pragma('synchronous = NORMAL')
  db.pragma('cache_size = -32000')    // 32MB page cache

  // Apply schema and migrations
  db.exec(SCHEMA_SQL)
  runMigrations(db)

  // Prepare all statements once at init time
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

  stmtGetAllTags = db.prepare(`SELECT * FROM tags ORDER BY name ASC`)
  stmtGetTagsForItem = db.prepare(`
    SELECT t.* FROM tags t
    INNER JOIN item_tags it ON t.id = it.tag_id
    WHERE it.item_id = ?
  `)
  stmtInsertTag = db.prepare(
    `INSERT INTO tags (id, name, color) VALUES (@id, @name, @color)`
  )
  stmtUpdateTag = db.prepare(`UPDATE tags SET name = @name, color = @color WHERE id = @id`)
  stmtDeleteTag = db.prepare(`DELETE FROM tags WHERE id = ?`)
  stmtInsertItemTag = db.prepare(`INSERT OR IGNORE INTO item_tags (item_id, tag_id) VALUES (?, ?)`)
  stmtDeleteItemTags = db.prepare(`DELETE FROM item_tags WHERE item_id = ?`)

  stmtGetSetting = db.prepare(`SELECT value FROM app_settings WHERE key = ?`)
  stmtSetSetting = db.prepare(
    `INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  )

  stmtGetRelations = db.prepare(
    `SELECT * FROM relations WHERE from_id = ? OR to_id = ?`
  )
  stmtInsertRelation = db.prepare(
    `INSERT INTO relations (id, from_id, to_id, type) VALUES (@id, @from_id, @to_id, @type)`
  )
  stmtDeleteRelation = db.prepare(`DELETE FROM relations WHERE id = ?`)

  stmtSearchItems = db.prepare(`
    SELECT i.*, GROUP_CONCAT(t.id || '|' || t.name || '|' || t.color, ';;') as tag_data
    FROM items i
    JOIN items_fts fts ON i.id = fts.id
    LEFT JOIN item_tags it ON i.id = it.item_id
    LEFT JOIN tags t ON it.tag_id = t.id
    WHERE items_fts MATCH ?
    GROUP BY i.id
    ORDER BY rank
    LIMIT ? OFFSET ?
  `)

  stmtSearchTotal = db.prepare(`
    SELECT COUNT(*) as count FROM items_fts WHERE items_fts MATCH ?
  `)

  stmtGetContexts = db.prepare(
    `SELECT DISTINCT context as slug FROM items`
  )

  stmtBulkUpdateStatus = db.prepare(
    `UPDATE items SET status = @status, updated_at = @updated_at WHERE id = @id`
  )

  stmtGetItemsForRebalance = db.prepare(`
    SELECT id FROM items
    WHERE context = ? AND status = ? AND type = 'card'
    ORDER BY position ASC
  `)

  stmtUpdateItemPosition = db.prepare(`
    UPDATE items SET position = ?, updated_at = ? WHERE id = ?
  `)

  return db
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

function rowToItem(row: Record<string, unknown>): Item {
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

// Query Functions

export function getItemsPaginated(
  context: string,
  type: string,
  page: number,
  pageSize: number
): PaginatedResult<Item> {
  const offset = page * pageSize
  const rows = stmtGetItemsPaginated.all(context, type, pageSize, offset) as Record<string, unknown>[]
  const total = (stmtGetItemsTotal.get(context, type) as { count: number }).count
  return { items: rows.map(rowToItem), total, page, pageSize }
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

  return { ...item, tags: tagIds.length ? (stmtGetTagsForItem.all(id) as Tag[]) : [] }
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
        const stmt = db.prepare(`UPDATE items SET ${setClauses} WHERE id = @id`)
        stmt.run({ ...patch, updated_at, id })
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
  return rowToItem(row)
}

export function deleteItem(id: string): void {
  stmtDeleteItem.run(id)
}

export function getAllTags(): Tag[] {
  return stmtGetAllTags.all() as Tag[]
}

export function createTag(payload: CreateTagPayload): Tag {
  const id = uuidv4()
  stmtInsertTag.run({ id, name: payload.name, color: payload.color })
  return { id, name: payload.name, color: payload.color }
}

export function updateTag(id: string, payload: Partial<CreateTagPayload>): Tag {
  const existing = stmtGetAllTags.all().find((t: unknown) => (t as Tag).id === id) as Tag | undefined
  if (!existing) throw new Error(`Tag not found: ${id}`)
  const updated = { ...existing, ...payload }
  stmtUpdateTag.run(updated)
  return updated
}

export function deleteTag(id: string): void {
  stmtDeleteTag.run(id)
}

export function getSetting<T>(key: string, defaultValue: T): T {
  const row = stmtGetSetting.get(key) as { value: string } | undefined
  if (!row) return defaultValue
  try {
    return JSON.parse(row.value) as T
  } catch {
    return defaultValue
  }
}

export function setSetting(key: string, value: unknown): void {
  stmtSetSetting.run(key, JSON.stringify(value))
}

export function getRelations(itemId: string): Relation[] {
  return stmtGetRelations.all(itemId, itemId) as Relation[]
}

export function createRelation(fromId: string, toId: string, type: RelationType): Relation {
  const id = uuidv4()
  stmtInsertRelation.run({ id, from_id: fromId, to_id: toId, type })
  return { id, from_id: fromId, to_id: toId, type }
}

export function deleteRelation(id: string): void {
  stmtDeleteRelation.run(id)
}

export function searchItems(query: SearchQuery): PaginatedResult<Item> {
  const page = query.page ?? 0
  const pageSize = query.pageSize ?? 20
  const offset = page * pageSize
  const ftsQuery = `${query.query}*`
  const rows = stmtSearchItems.all(ftsQuery, pageSize, offset) as Record<string, unknown>[]
  const total = (stmtSearchTotal.get(ftsQuery) as { count: number }).count
  return { items: rows.map(rowToItem), total, page, pageSize }
}

export function queryTasks(db: Database.Database, context: string, params: TaskQueryParams): PaginatedResult<Item> {
  const page = params.page ?? 1
  const pageSize = params.pageSize ?? 50
  const offset = (page - 1) * pageSize

  let sql = `
    SELECT i.*, GROUP_CONCAT(t.id || '|' || t.name || '|' || t.color, ';;') as tag_data,
           (SELECT COUNT(*) FROM relations r WHERE r.from_id = i.id OR r.to_id = i.id) as relations_count
    FROM items i
    LEFT JOIN item_tags it ON i.id = it.item_id
    LEFT JOIN tags t ON it.tag_id = t.id
    WHERE i.context = ? AND i.type = 'task' AND i.status != 'archived'
  `
  const args: (string | number | null)[] = [context]

  // Filters
  if (params.status && params.status.length > 0) {
    sql += ` AND i.status IN (${params.status.map(() => '?').join(',')})`
    args.push(...params.status)
  }

  if (params.priority && params.priority.length > 0) {
    sql += ` AND i.priority IN (${params.priority.map(() => '?').join(',')})`
    args.push(...params.priority)
  }

  if (params.dueStart !== undefined && params.dueStart !== null) {
    sql += ` AND i.due_at >= ?`
    args.push(params.dueStart)
  }
  if (params.dueEnd !== undefined && params.dueEnd !== null) {
    sql += ` AND i.due_at <= ?`
    args.push(params.dueEnd)
  }

  if (params.hasRelations !== undefined && params.hasRelations !== null) {
    if (params.hasRelations) {
      sql += ` AND (SELECT COUNT(*) FROM relations r WHERE r.from_id = i.id OR r.to_id = i.id) > 0`
    } else {
      sql += ` AND (SELECT COUNT(*) FROM relations r WHERE r.from_id = i.id OR r.to_id = i.id) = 0`
    }
  }

  if (params.query && params.query.trim() !== '') {
    sql += ` AND (i.title LIKE ? OR i.body LIKE ?)`
    const likePattern = `%${params.query}%`
    args.push(likePattern, likePattern)
  }

  // Tag filter (AND intersection)
  if (params.tagIds && params.tagIds.length > 0) {
    sql += ` AND i.id IN (
      SELECT item_id FROM item_tags 
      WHERE tag_id IN (${params.tagIds.map(() => '?').join(',')})
      GROUP BY item_id
      HAVING COUNT(DISTINCT tag_id) = ?
    )`
    args.push(...params.tagIds, params.tagIds.length)
  }

  sql += ` GROUP BY i.id`

  // Sorting
  const allowedSortFields = ['status', 'priority', 'title', 'created_at', 'due_at', 'relations_count']
  const sortBy = allowedSortFields.includes(params.sortBy ?? '') ? params.sortBy : 'created_at'
  const sortDirection = params.sortDesc ? 'DESC' : 'ASC'
  
  if (sortBy === 'relations_count') {
    sql += ` ORDER BY relations_count ${sortDirection}`
  } else {
    sql += ` ORDER BY i.${sortBy} ${sortDirection}`
  }

  // Count query
  const countSql = `SELECT COUNT(*) as count FROM (${sql})`
  const countArgs = [...args]

  // Pagination
  sql += ` LIMIT ? OFFSET ?`
  args.push(pageSize, offset)

  const rows = db.prepare(sql).all(...args) as Record<string, unknown>[]
  const countRow = db.prepare(countSql).get(...countArgs) as { count: number }
  const total = countRow ? countRow.count : 0

  return {
    items: rows.map(rowToItem),
    total,
    page,
    pageSize
  }
}

export function getContextSlugs(): string[] {
  const rows = stmtGetContexts.all() as { slug: string }[]
  return rows.map(r => r.slug)
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

// IPC Handler Registration

// Helper to wrap IPC actions in a safe result object that never throws over the bridge
async function handleSafe<T>(fn: () => T | Promise<T>) {
  try {
    const data = await fn()
    return { success: true, data }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    console.error('IPC Database error:', err)
    return { success: false, error: errorMessage }
  }
}

export function registerDbHandlers(db: Database.Database): void {
  ipcMain.handle(IpcChannels.DB_GET_ITEMS, (_event, context: unknown, type: unknown, page: unknown, pageSize: unknown) => {
    return handleSafe(() => {
      const parsedContext = z.string().parse(context)
      const parsedType = z.string().parse(type)
      const parsedPage = z.number().int().nonnegative().parse(page)
      const parsedPageSize = z.number().int().positive().parse(pageSize)
      return getItemsPaginated(parsedContext, parsedType, parsedPage, parsedPageSize)
    })
  })

  ipcMain.handle(IpcChannels.DB_CREATE_ITEM, (_event, payload: unknown, tagIds: unknown) => {
    return handleSafe(() => {
      const parsedPayload = CreateItemSchema.parse(payload)
      const parsedTagIds = z.array(z.string()).default([]).parse(tagIds)
      return createItem(db, parsedPayload, parsedTagIds)
    })
  })

  ipcMain.handle(IpcChannels.DB_UPDATE_ITEM, (_event, id: unknown, patch: unknown, tagIds?: unknown) => {
    return handleSafe(() => {
      const parsedId = z.string().parse(id)
      const parsedPatch = UpdateItemSchema.parse(patch)
      const parsedTagIds = tagIds !== undefined ? z.array(z.string()).parse(tagIds) : undefined
      return updateItem(db, parsedId, parsedPatch, parsedTagIds)
    })
  })

  ipcMain.handle(IpcChannels.DB_DELETE_ITEM, (_event, id: unknown) => {
    return handleSafe(() => {
      const parsedId = z.string().parse(id)
      deleteItem(parsedId)
    })
  })

  ipcMain.handle(IpcChannels.DB_GET_TAGS, () => {
    return handleSafe(() => getAllTags())
  })

  ipcMain.handle(IpcChannels.DB_CREATE_TAG, (_event, payload: unknown) => {
    return handleSafe(() => {
      const parsedPayload = CreateTagSchema.parse(payload)
      return createTag(parsedPayload)
    })
  })

  ipcMain.handle(IpcChannels.DB_UPDATE_TAG, (_event, id: unknown, payload: unknown) => {
    return handleSafe(() => {
      const parsedId = z.string().parse(id)
      const parsedPayload = CreateTagSchema.partial().parse(payload)
      return updateTag(parsedId, parsedPayload)
    })
  })

  ipcMain.handle(IpcChannels.DB_DELETE_TAG, (_event, id: unknown) => {
    return handleSafe(() => {
      const parsedId = z.string().parse(id)
      deleteTag(parsedId)
    })
  })

  ipcMain.handle(IpcChannels.DB_GET_SETTING, (_event, key: unknown) => {
    return handleSafe(() => {
      const parsedKey = z.string().parse(key)
      return getSetting(parsedKey, null)
    })
  })

  ipcMain.handle(IpcChannels.DB_SET_SETTING, (_event, key: unknown, value: unknown) => {
    return handleSafe(() => {
      const parsedKey = z.string().parse(key)
      setSetting(parsedKey, value)
    })
  })

  ipcMain.handle(IpcChannels.DB_GET_RELATIONS, (_event, itemId: unknown) => {
    return handleSafe(() => {
      const parsedItemId = z.string().parse(itemId)
      return getRelations(parsedItemId)
    })
  })

  ipcMain.handle(IpcChannels.DB_CREATE_RELATION, (_event, fromId: unknown, toId: unknown, type: unknown) => {
    return handleSafe(() => {
      const parsedFromId = z.string().parse(fromId)
      const parsedToId = z.string().parse(toId)
      const parsedType = RelationTypeSchema.parse(type)
      return createRelation(parsedFromId, parsedToId, parsedType)
    })
  })

  ipcMain.handle(IpcChannels.DB_DELETE_RELATION, (_event, id: unknown) => {
    return handleSafe(() => {
      const parsedId = z.string().parse(id)
      deleteRelation(parsedId)
    })
  })

  ipcMain.handle(IpcChannels.DB_SEARCH_ITEMS, (_event, query: unknown) => {
    return handleSafe(() => {
      const parsedQuery = SearchQuerySchema.parse(query)
      return searchItems(parsedQuery)
    })
  })

  ipcMain.handle(IpcChannels.DB_GET_CONTEXTS, () => {
    return handleSafe(() => getContextSlugs())
  })

  ipcMain.handle(IpcChannels.DB_BULK_UPDATE_ITEMS, (_event, payload: unknown) => {
    return handleSafe(() => {
      const parsedPayload = BulkUpdateSchema.parse(payload)
      const now = Date.now()
      db.transaction(() => {
        for (const id of parsedPayload.ids) {
          if (parsedPayload.patch.status) {
            stmtBulkUpdateStatus.run({ status: parsedPayload.patch.status, updated_at: now, id })
          }
        }
      })()
      return { updated: parsedPayload.ids.length }
    })
  })

  ipcMain.handle(IpcChannels.DB_BULK_DELETE_ITEMS, (_event, ids: unknown) => {
    return handleSafe(() => {
      const parsedIds = z.array(z.string()).parse(ids)
      db.transaction(() => {
        for (const id of parsedIds) stmtDeleteItem.run(id)
      })()
      return { deleted: parsedIds.length }
    })
  })

  ipcMain.handle(IpcChannels.DB_REBALANCE_POSITIONS, (_event, context: unknown, status: unknown) => {
    return handleSafe(() => {
      const parsedContext = z.string().parse(context)
      const parsedStatus = z.string().parse(status)
      rebalancePositions(db, parsedContext, parsedStatus)
    })
  })

  ipcMain.handle(IpcChannels.DB_QUERY_TASKS, (_event, context: unknown, params: unknown) => {
    return handleSafe(() => {
      const parsedContext = z.string().parse(context)
      const parsedParams = TaskQueryParamsSchema.parse(params)
      return queryTasks(db, parsedContext, parsedParams)
    })
  })
}
