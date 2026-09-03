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
import { emitPluginEvent } from './pluginEvents'
import {
  CreateItemSchema,
  UpdateItemSchema,
  CreateTagSchema,
  RelationTypeSchema,
  BulkUpdateSchema,
  SearchQuerySchema,
  TaskQueryParamsSchema,
  CreateFocusSessionSchema
} from './validation'
import { IpcChannels } from '../shared/ipcChannels'
import { contextSettingKeys, remapContextSettings } from '../shared/contextSettings'
import { wallIndexKey } from '../shared/wallModel'
import { updateNativeTitleBarFromSettings } from './titleBarSync'
import {
  isSecretSetting,
  isEncrypted,
  encryptSecret,
  decryptSecret,
  secretSettingKeys
} from './secureSettings'
import type {
  Item,
  Tag,
  CreateItemPayload,
  CreateTagPayload,
  PaginatedResult,
  Relation,
  RelationType,
  SearchQuery,
  TaskQueryParams,
  FocusSession,
  CreateFocusSessionPayload,
  ClipboardItem,
  ContextExport,
  SyncPayload
} from '../shared/types'

export let dbInstance: Database.Database | null = null

// Statement cache, reuse compiled SQL across calls
// Keyed by the exact SQL string. Avoids re-parsing the same SQL on hot paths
// (updateItem, searchItems, queryTasks, analytics, applyRemoteMutationTx, etc.)
const _stmtCache = new Map<string, Database.Statement>()
function prepareOnce(db: Database.Database, sql: string): Database.Statement {
  let stmt = _stmtCache.get(sql)
  if (!stmt) {
    stmt = db.prepare(sql)
    _stmtCache.set(sql, stmt)
  }
  return stmt
}

/**
 * Cleanly close the database: checkpoint the WAL back into the main DB file,
 * then close. Must be called during app shutdown (will-quit handler).
 */
export function closeDb(): void {
  if (dbInstance) {
    try {
      dbInstance.pragma('wal_checkpoint(TRUNCATE)') // flush WAL → main db file
      dbInstance.close()
    } catch (err) {
      console.error('[db] Error closing database:', err)
    } finally {
      dbInstance = null
      _stmtCache.clear()
    }
  }
}

export function getDb(): Database.Database {
  if (!dbInstance) throw new Error('Database not initialized')
  return dbInstance
}

// Current schema version
const CURRENT_VERSION = 9

// Prepared statement cache (populated by initDb)
/**
 * Databases created by early builds carry a CHECK constraint limiting
 * items.status to ('open','in_progress','done','archived'). Custom Kanban
 * columns store the column id in status, so ANY move to a non-default column
 * (including the built-in "in_review") failed with SQLITE_CONSTRAINT_CHECK on
 * those databases. SQLite cannot drop a CHECK, so the table is rebuilt once,
 * detected via sqlite_master (safe on fresh databases, no-op).
 */
function rebuildItemsTableIfLegacyCheck(db: Database.Database): void {
  const row = db.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'items'`).get() as { sql?: string } | undefined
  const tableSql = row?.sql || ''
  if (!/status[^,]*CHECK\s*\(/i.test(tableSql)) return

  console.log('[db] Legacy items.status CHECK constraint detected, rebuilding table')
  // FK enforcement must be off during the rebuild or DROP TABLE would cascade
  // into item_tags/relations. The pragma is a no-op inside a transaction, so
  // it is toggled outside and the rebuild wrapped in its own transaction.
  db.pragma('foreign_keys = OFF')
  try {
    db.transaction(() => {
      db.exec(`
        CREATE TABLE items_rebuild (
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
        INSERT INTO items_rebuild
          SELECT id, type, context, title, body, status, priority, position, created_at, updated_at, due_at, metadata
          FROM items;
        DROP TABLE items;
        ALTER TABLE items_rebuild RENAME TO items;
        CREATE INDEX IF NOT EXISTS idx_items_context   ON items(context);
        CREATE INDEX IF NOT EXISTS idx_items_type      ON items(type);
        CREATE INDEX IF NOT EXISTS idx_items_status    ON items(status);
        CREATE INDEX IF NOT EXISTS idx_items_position  ON items(position);
        CREATE INDEX IF NOT EXISTS idx_items_created   ON items(created_at DESC);
        ${ITEMS_FTS_TRIGGERS_SQL}
      `)
    })()
    console.log('[db] items table rebuilt, custom column statuses now accepted')
  } finally {
    db.pragma('foreign_keys = ON')
  }
}

function runMigrations(db: Database.Database): void {
  const userVersion = (db.pragma('user_version', { simple: true }) as number) ?? 0
  if (userVersion >= CURRENT_VERSION) return

  db.transaction(() => {
    if (userVersion < 2) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS focus_sessions (
          id           TEXT PRIMARY KEY,
          context      TEXT NOT NULL,
          duration_ms  INTEGER NOT NULL,
          completed_at INTEGER NOT NULL,
          notes        TEXT NOT NULL DEFAULT '',
          tasks_json   TEXT NOT NULL DEFAULT '[]'
        );
      `)
    }
    if (userVersion < 3) {
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_focus_sessions_context ON focus_sessions(context, completed_at DESC);
        CREATE INDEX IF NOT EXISTS idx_relations_from ON relations(from_id);
        CREATE INDEX IF NOT EXISTS idx_relations_to ON relations(to_id);
      `)
    }
    if (userVersion < 4) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS clipboard_items (
          id          TEXT PRIMARY KEY,
          content     TEXT NOT NULL,
          is_pinned   INTEGER NOT NULL DEFAULT 0,
          label       TEXT,
          created_at  INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_clipboard_created ON clipboard_items(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_clipboard_pinned ON clipboard_items(is_pinned);
      `)
    }
    if (userVersion < 5) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS ai_memories (
          id           TEXT PRIMARY KEY,
          context      TEXT NOT NULL,
          category     TEXT NOT NULL DEFAULT 'semantic',
          memory_key   TEXT NOT NULL,
          content      TEXT NOT NULL,
          is_pinned    INTEGER NOT NULL DEFAULT 0,
          access_count INTEGER NOT NULL DEFAULT 0,
          created_at   INTEGER NOT NULL,
          updated_at   INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_ai_memories_context ON ai_memories(context, updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_ai_memories_key ON ai_memories(memory_key);
      `)
    }
    if (userVersion < 6) {
      // Repairs two things at once: rowids invalidated by the legacy items
      // rebuild, and rows written either before items_fts existed or during a
      // session when the rebuild had dropped its triggers. Cheap and idempotent.
      db.exec(`INSERT INTO items_fts(items_fts) VALUES('rebuild');`)
    }
    if (userVersion < 7) {
      // Same DDL as SCHEMA_SQL. Existing databases predate the MCP server
      // keeping any record of what it changed.
      db.exec(`
        CREATE TABLE IF NOT EXISTS subtasks (
  id          TEXT PRIMARY KEY,
  item_id     TEXT NOT NULL,
  title       TEXT NOT NULL,
  done        INTEGER NOT NULL DEFAULT 0,
  position    REAL NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_subtasks_item ON subtasks(item_id, position);
CREATE TABLE IF NOT EXISTS recurrences (
  id           TEXT PRIMARY KEY,
  context      TEXT NOT NULL,
  type         TEXT NOT NULL DEFAULT 'task',
  title        TEXT NOT NULL,
  body         TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'open',
  priority     INTEGER NOT NULL DEFAULT 2,
  freq         TEXT NOT NULL,
  interval     INTEGER NOT NULL DEFAULT 1,
  by_weekday   TEXT NOT NULL DEFAULT '[]',
  start_at     INTEGER NOT NULL,
  until_at     INTEGER,
  next_due     INTEGER,
  active       INTEGER NOT NULL DEFAULT 1,
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_recurrences_context ON recurrences(context);
CREATE INDEX IF NOT EXISTS idx_recurrences_due ON recurrences(active, next_due);
CREATE TABLE IF NOT EXISTS mcp_activity (
          id          TEXT PRIMARY KEY,
          tool        TEXT NOT NULL,
          context     TEXT,
          summary     TEXT NOT NULL,
          undo        TEXT,
          undone_at   INTEGER,
          created_at  INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mcp_activity_created ON mcp_activity(created_at DESC);
      `)
    }
    if (userVersion < 8) {
      // Same DDL as SCHEMA_SQL.
      db.exec(`CREATE TABLE IF NOT EXISTS recurrences (
  id           TEXT PRIMARY KEY,
  context      TEXT NOT NULL,
  type         TEXT NOT NULL DEFAULT 'task',
  title        TEXT NOT NULL,
  body         TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'open',
  priority     INTEGER NOT NULL DEFAULT 2,
  freq         TEXT NOT NULL,
  interval     INTEGER NOT NULL DEFAULT 1,
  by_weekday   TEXT NOT NULL DEFAULT '[]',
  start_at     INTEGER NOT NULL,
  until_at     INTEGER,
  next_due     INTEGER,
  active       INTEGER NOT NULL DEFAULT 1,
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_recurrences_context ON recurrences(context);
CREATE INDEX IF NOT EXISTS idx_recurrences_due ON recurrences(active, next_due);`)
    }
    if (userVersion < 9) {
      // Same DDL as SCHEMA_SQL. Subtasks previously lived as markdown checkboxes
      // inside a task body; those are converted on request, not automatically.
      db.exec(`CREATE TABLE IF NOT EXISTS subtasks (
  id          TEXT PRIMARY KEY,
  item_id     TEXT NOT NULL,
  title       TEXT NOT NULL,
  done        INTEGER NOT NULL DEFAULT 0,
  position    REAL NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_subtasks_item ON subtasks(item_id, position);`)
    }
    db.pragma(`user_version = ${CURRENT_VERSION}`)
  })()
}
let stmtGetItemsPaginated: Database.Statement
let stmtGetLogsPaginated: Database.Statement
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
let stmtDeleteSetting: Database.Statement
let stmtGetRelations: Database.Statement
let stmtInsertRelation: Database.Statement
let stmtDeleteRelation: Database.Statement
let stmtGetContexts: Database.Statement
let stmtGetItemsForRebalance: Database.Statement
let stmtUpdateItemPosition: Database.Statement
let stmtInsertFocusSession: Database.Statement
let stmtGetFocusSessions: Database.Statement
let stmtInsertActivityLog: Database.Statement
let stmtInsertTombstone: Database.Statement

let stmtGetClipboardHistory: Database.Statement
let stmtInsertClipboardItem: Database.Statement
let stmtFindClipboardItemByContent: Database.Statement
let stmtUpdateClipboardItemTimestamp: Database.Statement
let stmtUpdateClipboardItemPin: Database.Statement
let stmtUpdateClipboardItemLabel: Database.Statement
let stmtDeleteClipboardItem: Database.Statement
let stmtClearClipboardHistory: Database.Statement
let stmtDeleteClipboardHistoryOverflow: Database.Statement

// Schema

/**
 * The FTS bridge triggers, kept separate because they are needed twice: once in
 * SCHEMA_SQL, and again after the legacy items rebuild, which drops them along
 * with the table. Two copies would drift.
 */
const ITEMS_FTS_TRIGGERS_SQL = `CREATE TRIGGER IF NOT EXISTS items_fts_insert AFTER INSERT ON items BEGIN
  INSERT INTO items_fts(rowid, id, title, body) VALUES (new.rowid, new.id, new.title, new.body);
END;
CREATE TRIGGER IF NOT EXISTS items_fts_delete AFTER DELETE ON items BEGIN
  INSERT INTO items_fts(items_fts, rowid, id, title, body) VALUES('delete', old.rowid, old.id, old.title, old.body);
END;
CREATE TRIGGER IF NOT EXISTS items_fts_update AFTER UPDATE ON items BEGIN
  INSERT INTO items_fts(items_fts, rowid, id, title, body) VALUES('delete', old.rowid, old.id, old.title, old.body);
  INSERT INTO items_fts(rowid, id, title, body) VALUES (new.rowid, new.id, new.title, new.body);
END;`

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

CREATE TABLE IF NOT EXISTS sync_tombstones (
  id          TEXT PRIMARY KEY,
  table_name  TEXT NOT NULL,
  deleted_at  INTEGER NOT NULL
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
CREATE TABLE IF NOT EXISTS mcp_activity (
  id          TEXT PRIMARY KEY,
  tool        TEXT NOT NULL,
  context     TEXT,
  summary     TEXT NOT NULL,
  undo        TEXT,
  undone_at   INTEGER,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mcp_activity_created ON mcp_activity(created_at DESC);
CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(
  id UNINDEXED,
  title,
  body,
  content='items',
  content_rowid='rowid'
);
${ITEMS_FTS_TRIGGERS_SQL}
`



// Init

export function initDb(dataPath: string): Database.Database {
  // Lazy import: better-sqlite3 is a native module, loaded only when needed
  const dbPath = join(dataPath, 'checkpoint.db')
  const db = new Database(dbPath)
  dbInstance = db

  // Performance & safety PRAGMAs
  db.pragma('journal_mode = WAL')     // non-blocking concurrent reads
  db.pragma('foreign_keys = ON')
  db.pragma('synchronous = NORMAL')
  db.pragma('cache_size = -32000')    // 32MB page cache
  db.pragma('busy_timeout = 5000')    // wait up to 5s if locked
  db.pragma('temp_store = MEMORY')    // temp tables in RAM, not disk
  db.pragma('mmap_size = 67108864')   // 64MB memory-mapped I/O for reads

  // Apply schema and migrations
  db.exec(SCHEMA_SQL)
  rebuildItemsTableIfLegacyCheck(db)
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
  stmtDeleteSetting = db.prepare(`DELETE FROM app_settings WHERE key = ?`)

  stmtGetRelations = db.prepare(
    `SELECT * FROM relations WHERE from_id = ? OR to_id = ?`
  )
  stmtInsertRelation = db.prepare(
    `INSERT INTO relations (id, from_id, to_id, type) VALUES (@id, @from_id, @to_id, @type)`
  )
  stmtDeleteRelation = db.prepare(`DELETE FROM relations WHERE id = ?`)

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

  stmtInsertFocusSession = db.prepare(`
    INSERT INTO focus_sessions (id, context, duration_ms, completed_at, notes, tasks_json)
    VALUES (?, ?, ?, ?, ?, ?)
  `)

  stmtGetFocusSessions = db.prepare(`
    SELECT * FROM focus_sessions WHERE context = ? ORDER BY completed_at DESC
  `)

  stmtGetClipboardHistory = db.prepare(`
    SELECT * FROM clipboard_items ORDER BY is_pinned DESC, created_at DESC
  `)
  stmtInsertClipboardItem = db.prepare(`
    INSERT INTO clipboard_items (id, content, is_pinned, label, created_at)
    VALUES (?, ?, ?, ?, ?)
  `)
  stmtFindClipboardItemByContent = db.prepare(`
    SELECT id, is_pinned FROM clipboard_items WHERE content = ? LIMIT 1
  `)
  stmtUpdateClipboardItemTimestamp = db.prepare(`
    UPDATE clipboard_items SET created_at = ? WHERE id = ?
  `)
  stmtUpdateClipboardItemPin = db.prepare(`
    UPDATE clipboard_items SET is_pinned = ? WHERE id = ?
  `)
  stmtUpdateClipboardItemLabel = db.prepare(`
    UPDATE clipboard_items SET label = ? WHERE id = ?
  `)
  stmtDeleteClipboardItem = db.prepare(`
    DELETE FROM clipboard_items WHERE id = ?
  `)
  stmtClearClipboardHistory = db.prepare(`
    DELETE FROM clipboard_items WHERE is_pinned = 0
  `)
  stmtDeleteClipboardHistoryOverflow = db.prepare(`
    DELETE FROM clipboard_items WHERE is_pinned = 0 AND id NOT IN (
      SELECT id FROM clipboard_items WHERE is_pinned = 0 ORDER BY created_at DESC LIMIT 200
    )
  `)

  stmtInsertActivityLog = db.prepare(`
    INSERT INTO activity_tracking_logs (id, context, window_title, process_name, duration_ms, captured_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `)

  stmtInsertTombstone = db.prepare(
    `INSERT OR REPLACE INTO sync_tombstones (id, table_name, deleted_at) VALUES (?, ?, ?)`
  )

  encryptLegacyPlaintextSecrets(db)

  return db
}

/**
 * Re-writes credential settings that predate at-rest encryption.
 *
 * Without this, an existing install keeps its provider keys in plaintext
 * forever unless the user happens to re-save them in AI Settings. Runs on every
 * boot but is a no-op once the rows carry an envelope. Deliberately does not
 * use setSetting(): the prepared statements are in place by now, but the
 * side-effects that function fires (titlebar sync, clipboard watcher) have no
 * business running during init.
 */
function encryptLegacyPlaintextSecrets(db: Database.Database): void {
  try {
    const read = db.prepare(`SELECT value FROM app_settings WHERE key = ?`)
    const write = db.prepare(`UPDATE app_settings SET value = ? WHERE key = ?`)
    for (const key of secretSettingKeys()) {
      const row = read.get(key) as { value: string } | undefined
      if (!row || isEncrypted(row.value)) continue
      const enveloped = encryptSecret(row.value)
      // encryptSecret falls back to plaintext when no keyring is available;
      // writing that back would be a pointless no-op UPDATE every boot.
      if (isEncrypted(enveloped)) write.run(enveloped, key)
    }
  } catch (err) {
    console.error('[db] Could not migrate plaintext credentials:', err)
  }
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
  const pageIndex = page > 0 ? page - 1 : 0
  const offset = pageIndex * pageSize
  const stmt = type === 'log' ? stmtGetLogsPaginated : stmtGetItemsPaginated
  const rows = stmt.all(context, type, pageSize, offset) as Record<string, unknown>[]
  const total = (stmtGetItemsTotal.get(context, type) as { count: number }).count
  return { items: rows.map(rowToItem), total, page, pageSize }
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
  // Emitted for every creation path, the UI, an agent over MCP, a webhook, 
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
 * only on the next hourly sweep, completing today's task should offer
 * tomorrow's straight away.
 */
export function setRecurrenceInstanceClosedHandler(
  handler: ((recurrenceId: string) => void) | null
): void {
  onRecurrenceInstanceClosed = handler
}

export function recordTombstone(id: string, tableName: string): void {
  try {
    stmtInsertTombstone.run(id, tableName, Date.now())
  } catch (err) {
    console.error('[db] Failed to record tombstone:', err)
  }
}

export function applyBoardBaselineTx(
  context: string,
  items: Item[],
  tags: Tag[],
  itemTags: SyncPayload['item_tags'],
  relations: Relation[]
): void {
  const db = getDb()
  db.transaction(() => {
    // 1. Delete all items in context of type 'card' or 'task'
    db.prepare("DELETE FROM items WHERE context = ? AND type IN ('card', 'task')").run(context)

    // 2. Insert tags
    const stmtTag = db.prepare('INSERT OR IGNORE INTO tags (id, name, color) VALUES (?, ?, ?)')
    for (const t of tags) {
      stmtTag.run(t.id, t.name, t.color)
    }

    // 3. Insert items
    const stmtItem = db.prepare(`
      INSERT OR REPLACE INTO items (id, type, context, title, body, status, priority, position, created_at, updated_at, due_at, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    for (const item of items) {
      stmtItem.run(
        item.id,
        item.type,
        item.context,
        item.title,
        item.body,
        item.status,
        item.priority,
        item.position,
        item.created_at,
        item.updated_at,
        item.due_at || null,
        item.metadata || '{}'
      )
    }

    // 4. Insert item_tags
    const stmtItemTag = db.prepare('INSERT OR REPLACE INTO item_tags (item_id, tag_id) VALUES (?, ?)')
    for (const it of itemTags) {
      stmtItemTag.run(it.item_id, it.tag_id)
    }

    // 5. Insert relations
    const stmtRelation = db.prepare('INSERT OR REPLACE INTO relations (id, from_id, to_id, type) VALUES (?, ?, ?, ?)')
    for (const r of relations) {
      stmtRelation.run(r.id, r.from_id, r.to_id, r.type)
    }
  })()
}

export type RemoteMutation =
  | { type: 'createItem' | 'updateItem'; item: Item; tagIds?: string[] }
  | { type: 'deleteItem'; id: string }
  | { type: 'createTag' | 'updateTag'; tag: Tag }
  | { type: 'deleteTag'; id: string }
  | { type: 'createRelation'; relation: Relation }
  | { type: 'deleteRelation'; id: string }
  | { type: 'bulkUpdateItems'; payload: { updates: { id: string; position: number; status: string }[] } }
  | { type: 'bulkDeleteItems'; ids: string[] }
  | { type: 'rebalancePositions'; context: string; status: string }

export function applyRemoteMutationTx(mutation: RemoteMutation): void {
  const db = getDb()
  const { type } = mutation

  if (type === 'createItem' || type === 'updateItem') {
    const { item, tagIds } = mutation
    db.transaction(() => {
      db.prepare(`
        INSERT OR REPLACE INTO items (id, type, context, title, body, status, priority, position, created_at, updated_at, due_at, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        item.id,
        item.type,
        item.context,
        item.title,
        item.body,
        item.status,
        item.priority,
        item.position,
        item.created_at,
        item.updated_at,
        item.due_at || null,
        item.metadata || '{}'
      )

      if (tagIds) {
        db.prepare('DELETE FROM item_tags WHERE item_id = ?').run(item.id)
        const stmtTag = db.prepare('INSERT OR REPLACE INTO item_tags (item_id, tag_id) VALUES (?, ?)')
        for (const tagId of tagIds) {
          stmtTag.run(item.id, tagId)
        }
      }
    })()
  } else if (type === 'deleteItem') {
    const { id } = mutation
    db.prepare('DELETE FROM items WHERE id = ?').run(id)
  } else if (type === 'createTag') {
    const { tag } = mutation
    db.prepare('INSERT OR IGNORE INTO tags (id, name, color) VALUES (?, ?, ?)')
      .run(tag.id, tag.name, tag.color)
  } else if (type === 'updateTag') {
    const { tag } = mutation
    db.prepare('UPDATE tags SET name = ?, color = ? WHERE id = ?')
      .run(tag.name, tag.color, tag.id)
  } else if (type === 'deleteTag') {
    const { id } = mutation
    db.prepare('DELETE FROM tags WHERE id = ?').run(id)
  } else if (type === 'createRelation') {
    const { relation } = mutation
    db.prepare('INSERT OR REPLACE INTO relations (id, from_id, to_id, type) VALUES (?, ?, ?, ?)')
      .run(relation.id, relation.from_id, relation.to_id, relation.type)
  } else if (type === 'deleteRelation') {
    const { id } = mutation
    db.prepare('DELETE FROM relations WHERE id = ?').run(id)
  } else if (type === 'bulkUpdateItems') {
    const { payload } = mutation
    db.transaction(() => {
      const stmt = db.prepare('UPDATE items SET position = ?, status = ?, updated_at = ? WHERE id = ?')
      for (const u of payload.updates) {
        stmt.run(u.position, u.status, Date.now(), u.id)
      }
    })()
  } else if (type === 'bulkDeleteItems') {
    const { ids } = mutation
    db.transaction(() => {
      const stmt = db.prepare('DELETE FROM items WHERE id = ?')
      for (const id of ids) {
        stmt.run(id)
      }
    })()
  } else if (type === 'rebalancePositions') {
    const { context, status } = mutation
    // Call directly, we are already inside db.ts so no import needed
    rebalancePositions(db, context, status)
  }
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
  recordTombstone(id, 'tags')
  stmtDeleteTag.run(id)
}

/**
 * Removes a setting outright. Writing an empty value would leave a row that
 * still syncs and still shows up in a settings dump; a deleted wall should
 * leave nothing behind.
 */
export function deleteSetting(key: string): void {
  if (!stmtDeleteSetting) return
  stmtDeleteSetting.run(key)
}

export function getSetting<T>(key: string, defaultValue: T): T {
  // The prepared statements only exist after initDb. Anything reading a setting
  // during startup gets the default rather than a crash on an undefined stmt.
  if (!stmtGetSetting) return defaultValue
  const row = stmtGetSetting.get(key) as { value: string } | undefined
  if (!row) return defaultValue
  const serialized = isSecretSetting(key) ? decryptSecret(row.value) : row.value
  try {
    return JSON.parse(serialized) as T
  } catch {
    return defaultValue
  }
}

export function setSetting(key: string, value: unknown): void {
  if (!stmtSetSetting) {
    console.error('[db] Dropped setting write before initDb:', key)
    return
  }
  const serialized = JSON.stringify(value)
  stmtSetSetting.run(key, isSecretSetting(key) ? encryptSecret(serialized) : serialized)
  if (key === 'app_theme') {
    try {
      updateNativeTitleBarFromSettings(value as string)
    } catch (err) {
      console.error('[db] Failed to sync titlebar overlay:', err)
    }
  }
  if (key === 'feature_view_clipboard') {
    // Imported lazily: clipboardWatcher's sink is recordClipboardCopy from this
    // module, so a static import would close the cycle.
    import('./clipboardWatcher')
      .then(({ setClipboardCaptureEnabled }) => setClipboardCaptureEnabled(value !== 'false'))
      .catch(err => console.error('[db] Failed to apply clipboard capture setting:', err))
  }
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
  recordTombstone(id, 'relations')
  stmtDeleteRelation.run(id)
}

// Subtasks

export interface SubtaskRow {
  id: string
  item_id: string
  title: string
  done: number
  position: number
  created_at: number
}

export function getSubtasks(itemId: string): SubtaskRow[] {
  return getDb()
    .prepare(`SELECT * FROM subtasks WHERE item_id = ? ORDER BY position, created_at`)
    .all(itemId) as SubtaskRow[]
}

/**
 * Counts for many parents at once.
 *
 * A row-by-row query would be one round trip per task in the table, which is
 * what makes a progress column too slow to be worth showing.
 */
export function getSubtaskCounts(itemIds: string[]): Map<string, { total: number; done: number }> {
  const out = new Map<string, { total: number; done: number }>()
  if (itemIds.length === 0) return out
  const rows = getDb()
    .prepare(
      `SELECT item_id, COUNT(*) as total, SUM(done) as done
       FROM subtasks WHERE item_id IN (${itemIds.map(() => '?').join(',')})
       GROUP BY item_id`
    )
    .all(...itemIds) as { item_id: string; total: number; done: number | null }[]
  for (const row of rows) out.set(row.item_id, { total: row.total, done: row.done ?? 0 })
  return out
}

export function insertSubtask(row: SubtaskRow): void {
  getDb()
    .prepare(
      `INSERT INTO subtasks (id, item_id, title, done, position, created_at)
       VALUES (@id, @item_id, @title, @done, @position, @created_at)`
    )
    .run(row)
}

export function updateSubtask(id: string, patch: { title?: string; done?: boolean; position?: number }): void {
  const sets: string[] = []
  const args: Record<string, unknown> = { id }
  if (patch.title !== undefined) { sets.push('title = @title'); args.title = patch.title }
  if (patch.done !== undefined) { sets.push('done = @done'); args.done = patch.done ? 1 : 0 }
  if (patch.position !== undefined) { sets.push('position = @position'); args.position = patch.position }
  if (sets.length === 0) return
  getDb().prepare(`UPDATE subtasks SET ${sets.join(', ')} WHERE id = @id`).run(args)
}

export function deleteSubtask(id: string): void {
  getDb().prepare(`DELETE FROM subtasks WHERE id = ?`).run(id)
}

// MCP activity
// A record of what an external agent changed. Prepared lazily rather than in the
// init block because these run rarely, only when the MCP server is switched on
//, and there is no reason to pay for them on every launch.

export interface McpActivityRow {
  id: string
  tool: string
  context: string | null
  summary: string
  undo: string | null
  undone_at: number | null
  created_at: number
}

export function insertMcpActivity(row: McpActivityRow): void {
  getDb()
    .prepare(
      `INSERT INTO mcp_activity (id, tool, context, summary, undo, undone_at, created_at)
       VALUES (@id, @tool, @context, @summary, @undo, @undone_at, @created_at)`
    )
    .run(row)
}

export function getMcpActivity(limit = 50): McpActivityRow[] {
  // rowid breaks the tie. An agent can easily make several writes inside one
  // millisecond, and on created_at alone SQLite is free to return those in any
  // order, so the log would show a card being updated before it was created.
  return getDb()
    .prepare(`SELECT * FROM mcp_activity ORDER BY created_at DESC, rowid DESC LIMIT ?`)
    .all(limit) as McpActivityRow[]
}

export function getMcpActivityById(id: string): McpActivityRow | null {
  return (getDb()
    .prepare(`SELECT * FROM mcp_activity WHERE id = ?`)
    .get(id) as McpActivityRow | undefined) ?? null
}

/**
 * Stamps an entry as reversed.
 *
 * The guard on `undone_at IS NULL` is what makes undo idempotent: two clicks on
 * the same row, or a click racing a sync, would otherwise replay the reversing
 * actions twice, and replaying a `delete_item` that already ran would go on to
 * delete whatever later took that id.
 */
export function markMcpActivityUndone(id: string, at: number): boolean {
  const result = getDb()
    .prepare(`UPDATE mcp_activity SET undone_at = ? WHERE id = ? AND undone_at IS NULL`)
    .run(at, id)
  return result.changes > 0
}

export interface RecurrenceRow {
  id: string
  context: string
  type: string
  title: string
  body: string
  status: string
  priority: number
  freq: string
  interval: number
  by_weekday: string
  start_at: number
  until_at: number | null
  next_due: number | null
  active: number
  created_at: number
}

export function insertRecurrence(row: RecurrenceRow): void {
  getDb()
    .prepare(
      `INSERT INTO recurrences (id, context, type, title, body, status, priority, freq, interval,
                                by_weekday, start_at, until_at, next_due, active, created_at)
       VALUES (@id, @context, @type, @title, @body, @status, @priority, @freq, @interval,
               @by_weekday, @start_at, @until_at, @next_due, @active, @created_at)`
    )
    .run(row)
}

export function getRecurrences(context?: string): RecurrenceRow[] {
  const db = getDb()
  return (context
    ? db.prepare(`SELECT * FROM recurrences WHERE context = ? ORDER BY created_at DESC`).all(context)
    : db.prepare(`SELECT * FROM recurrences ORDER BY created_at DESC`).all()) as RecurrenceRow[]
}

export function getRecurrenceById(id: string): RecurrenceRow | null {
  return (getDb().prepare(`SELECT * FROM recurrences WHERE id = ?`).get(id) as RecurrenceRow | undefined) ?? null
}

/** Active rules whose next occurrence has come due. */
export function getDueRecurrences(now: number): RecurrenceRow[] {
  return getDb()
    .prepare(`SELECT * FROM recurrences WHERE active = 1 AND next_due IS NOT NULL AND next_due <= ? ORDER BY next_due`)
    .all(now) as RecurrenceRow[]
}

export function setRecurrenceNextDue(id: string, nextDue: number | null): void {
  // A rule with no further occurrences is deactivated rather than deleted, so
  // the instances it already produced keep something to point back at.
  getDb()
    .prepare(`UPDATE recurrences SET next_due = ?, active = ? WHERE id = ?`)
    .run(nextDue, nextDue === null ? 0 : 1, id)
}

export function setRecurrenceActive(id: string, active: boolean): void {
  getDb().prepare(`UPDATE recurrences SET active = ? WHERE id = ?`).run(active ? 1 : 0, id)
}

export function deleteRecurrence(id: string): void {
  getDb().prepare(`DELETE FROM recurrences WHERE id = ?`).run(id)
}

/**
 * True when an unfinished instance of this rule already exists.
 *
 * This is what bounds the items table: a rule spawns its next occurrence only
 * once the previous one is done or archived, so a daily task left untouched for
 * a month produces one card, not thirty.
 */
export function hasOpenRecurrenceInstance(recurrenceId: string): boolean {
  const row = getDb()
    .prepare(
      `SELECT 1 FROM items
       WHERE status NOT IN ('done', 'archived')
         AND json_extract(metadata, '$.recurrenceId') = ?
       LIMIT 1`
    )
    .get(recurrenceId)
  return row !== undefined
}

/** Drops entries older than the cutoff. The log is a convenience, not an audit. */
export function pruneMcpActivity(olderThan: number): number {
  return getDb().prepare(`DELETE FROM mcp_activity WHERE created_at < ?`).run(olderThan).changes
}

export function searchItems(query: SearchQuery): PaginatedResult<Item> {
  const page = query.page ?? 1
  const pageSize = query.pageSize ?? 20
  const pageIndex = page > 0 ? page - 1 : 0
  const offset = pageIndex * pageSize

  const rawQuery = (query.query || '').trim()
  if (!rawQuery) {
    return { items: [], total: 0, page, pageSize }
  }

  // If the query is exactly a UUID, return the direct item lookup (still honoring
  // any context/type/status scoping so callers can't accidentally link across contexts)
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawQuery)
  if (isUuid) {
    const item = getItemById(rawQuery)
    const matches =
      !!item &&
      (query.context === undefined || item.context === query.context) &&
      (query.type === undefined || item.type === query.type) &&
      (query.status === undefined || item.status === query.status)
    return {
      items: matches && item ? [item] : [],
      total: matches ? 1 : 0,
      page,
      pageSize
    }
  }

  // Split by whitespace, escape double quotes, and wrap each term in double quotes with prefix match wildcard
  const terms = rawQuery.split(/\s+/).filter(Boolean)
  const ftsQuery = terms.map(t => `"${t.replace(/"/g, '""')}*"`).join(' AND ')

  // Apply optional context/type/status scoping on top of the FTS match so search
  // (e.g. relation linking from the Backlog task drawer) stays within the intended scope.
  let sql = `
    SELECT i.*, GROUP_CONCAT(t.id || '|' || t.name || '|' || t.color, ';;') as tag_data
    FROM items i
    JOIN items_fts fts ON i.id = fts.id
    LEFT JOIN item_tags it ON i.id = it.item_id
    LEFT JOIN tags t ON it.tag_id = t.id
    WHERE items_fts MATCH ?
  `
  const args: (string | number)[] = [ftsQuery]

  if (query.context !== undefined) {
    sql += ` AND i.context = ?`
    args.push(query.context)
  }
  if (query.type !== undefined) {
    sql += ` AND i.type = ?`
    args.push(query.type)
  }
  if (query.status !== undefined) {
    sql += ` AND i.status = ?`
    args.push(query.status)
  }

  sql += ` GROUP BY i.id ORDER BY rank`

  const countSql = `SELECT COUNT(*) as count FROM (${sql})`
  const countArgs = [...args]

  sql += ` LIMIT ? OFFSET ?`
  args.push(pageSize, offset)

  const db = getDb()
  const rows = prepareOnce(db, sql).all(...args) as Record<string, unknown>[]
  const total = (prepareOnce(db, countSql).get(...countArgs) as { count: number }).count
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
    WHERE i.context = ? AND i.type = 'task' AND i.status ${params.archivedOnly ? '=' : '!='} 'archived'
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

  // Distinct from a date range: a task with no due date satisfies no range, so
  // "has no due date" needs its own clause rather than an open-ended one.
  if (params.noDueDate) {
    sql += ` AND i.due_at IS NULL`
  }

  if (params.untagged) {
    sql += ` AND NOT EXISTS (SELECT 1 FROM item_tags x WHERE x.item_id = i.id)`
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

  const rows = prepareOnce(db, sql).all(...args) as Record<string, unknown>[]
  const countRow = prepareOnce(db, countSql).get(...countArgs) as { count: number }
  const total = countRow ? countRow.count : 0

  return {
    items: rows.map(rowToItem),
    total,
    page,
    pageSize
  }
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

export function createFocusSession(payload: CreateFocusSessionPayload): FocusSession {
  const id = uuidv4()
  const completed_at = Date.now()
  stmtInsertFocusSession.run(
    id,
    payload.context,
    payload.duration_ms,
    completed_at,
    payload.notes,
    payload.tasks_json
  )
  return {
    id,
    context: payload.context,
    duration_ms: payload.duration_ms,
    completed_at,
    notes: payload.notes,
    tasks_json: payload.tasks_json
  }
}

export function getFocusSessions(context: string): FocusSession[] {
  const rows = stmtGetFocusSessions.all(context) as Record<string, unknown>[]
  return rows.map(row => ({
    id: row.id as string,
    context: row.context as string,
    duration_ms: row.duration_ms as number,
    completed_at: row.completed_at as number,
    notes: row.notes as string,
    tasks_json: row.tasks_json as string
  }))
}

export function getClipboardHistory(): ClipboardItem[] {
  const rows = stmtGetClipboardHistory.all() as Record<string, unknown>[]
  return rows.map(row => ({
    id: row.id as string,
    content: row.content as string,
    is_pinned: row.is_pinned as number,
    label: row.label as string | null,
    created_at: row.created_at as number
  }))
}

export function recordClipboardCopy(content: string): void {
  const existing = stmtFindClipboardItemByContent.get(content) as { id: string; is_pinned: number } | undefined
  const now = Date.now()
  if (existing) {
    stmtUpdateClipboardItemTimestamp.run(now, existing.id)
  } else {
    const id = uuidv4()
    stmtInsertClipboardItem.run(id, content, 0, null, now)
    stmtDeleteClipboardHistoryOverflow.run()
  }
}

export function createClipboardSnippet(content: string, label: string | null): void {
  const existing = stmtFindClipboardItemByContent.get(content) as { id: string; is_pinned: number } | undefined
  const now = Date.now()
  if (existing) {
    stmtUpdateClipboardItemTimestamp.run(now, existing.id)
    stmtUpdateClipboardItemPin.run(1, existing.id)
    if (label) {
      stmtUpdateClipboardItemLabel.run(label, existing.id)
    }
  } else {
    const id = uuidv4()
    stmtInsertClipboardItem.run(id, content, 1, label || null, now)
    stmtDeleteClipboardHistoryOverflow.run()
  }
}

export function toggleClipboardPin(id: string, isPinned: boolean): void {
  stmtUpdateClipboardItemPin.run(isPinned ? 1 : 0, id)
}

export function updateClipboardLabel(id: string, label: string | null): void {
  stmtUpdateClipboardItemLabel.run(label || null, id)
}

export function deleteClipboardItem(id: string): void {
  stmtDeleteClipboardItem.run(id)
}

export function restoreClipboardItem(content: string, isPinned: boolean, label: string | null): void {
  const existing = stmtFindClipboardItemByContent.get(content) as { id: string; is_pinned: number } | undefined
  const now = Date.now()
  if (existing) {
    stmtUpdateClipboardItemTimestamp.run(now, existing.id)
    stmtUpdateClipboardItemPin.run(isPinned ? 1 : 0, existing.id)
    stmtUpdateClipboardItemLabel.run(label || null, existing.id)
  } else {
    const id = uuidv4()
    stmtInsertClipboardItem.run(id, content, isPinned ? 1 : 0, label || null, now)
    stmtDeleteClipboardHistoryOverflow.run()
  }
}

export function clearClipboardHistory(): void {
  stmtClearClipboardHistory.run()
}

export function insertActivityLog(context: string, windowTitle: string, processName: string, durationMs: number): void {
  const id = uuidv4()
  const capturedAt = Date.now()
  stmtInsertActivityLog.run(id, context, windowTitle, processName, durationMs, capturedAt)
}

export function getActivityStats(
  context: string | null,
  timeStart: number,
  timeEnd: number
): {
  totalDurationMs: number
  byProcess: Array<{ processName: string; durationMs: number }>
  byContext: Array<{ context: string; durationMs: number }>
  byTitle: Array<{ windowTitle: string; processName: string; durationMs: number }>
} {
  const isContextFilter = context && context !== 'all' && context !== ''
  const contextFilter = isContextFilter ? 'AND context = ?' : ''
  const params: (string | number)[] = [timeStart, timeEnd]
  if (isContextFilter) params.push(context)

  const db = getDb()
  // 1. Total duration
  const totalRow = prepareOnce(db, `
    SELECT SUM(duration_ms) as total 
    FROM activity_tracking_logs 
    WHERE captured_at >= ? AND captured_at <= ? ${contextFilter}
  `).get(...params) as { total: number | null }
  const totalDurationMs = totalRow?.total || 0

  // 2. By Process
  const byProcessRows = prepareOnce(db, `
    SELECT process_name as processName, SUM(duration_ms) as durationMs 
    FROM activity_tracking_logs 
    WHERE captured_at >= ? AND captured_at <= ? ${contextFilter}
    GROUP BY process_name
    ORDER BY durationMs DESC
    LIMIT 15
  `).all(...params) as Array<{ processName: string; durationMs: number }>

  // 3. By Context
  const byContextRows = prepareOnce(db, `
    SELECT context, SUM(duration_ms) as durationMs 
    FROM activity_tracking_logs 
    WHERE captured_at >= ? AND captured_at <= ? ${contextFilter}
    GROUP BY context
    ORDER BY durationMs DESC
  `).all(...params) as Array<{ context: string; durationMs: number }>

  // 4. By Title
  const byTitleRows = prepareOnce(db, `
    SELECT window_title as windowTitle, process_name as processName, SUM(duration_ms) as durationMs 
    FROM activity_tracking_logs 
    WHERE captured_at >= ? AND captured_at <= ? ${contextFilter}
    GROUP BY window_title, process_name
    ORDER BY durationMs DESC
    LIMIT 20
  `).all(...params) as Array<{ windowTitle: string; processName: string; durationMs: number }>

  return {
    totalDurationMs,
    byProcess: byProcessRows,
    byContext: byContextRows,
    byTitle: byTitleRows
  }
}

export function exportContextData(db: Database.Database, context: string): ContextExport {
  const items = db.prepare(`SELECT * FROM items WHERE context = ?`).all(context) as Item[]
  const itemIds = items.map(i => i.id)

  let tags: Tag[] = []
  let item_tags: ContextExport['item_tags'] = []
  let relations: Relation[] = []

  if (itemIds.length > 0) {
    const placeholders = itemIds.map(() => '?').join(',')
    
    tags = db.prepare(`
      SELECT DISTINCT t.* FROM tags t
      INNER JOIN item_tags it ON t.id = it.tag_id
      WHERE it.item_id IN (${placeholders})
    `).all(...itemIds) as Tag[]

    item_tags = db.prepare(`
      SELECT * FROM item_tags
      WHERE item_id IN (${placeholders})
    `).all(...itemIds) as ContextExport['item_tags']

    relations = db.prepare(`
      SELECT * FROM relations
      WHERE from_id IN (${placeholders}) OR to_id IN (${placeholders})
    `).all(...itemIds, ...itemIds) as Relation[]
  }

  // A workspace is not only its rows. Its columns, background, swimlanes,
  // backlog layout and walls all live in app_settings, and an export without
  // them hands back the cards arranged on a board the user never configured.
  const settings: Record<string, string> = {}
  const readSetting = db.prepare(`SELECT value FROM app_settings WHERE key = ?`)
  const collect = (key: string): void => {
    // Secrets are stored encrypted and belong to this machine, not to the
    // workspace. None of the keys below are secret; the guard is so that stays
    // true if one is ever added.
    if (isSecretSetting(key)) return
    const row = readSetting.get(key) as { value: string } | undefined
    if (row) settings[key] = row.value
  }

  // The index has to be read before the walls can be found: every wall after
  // the first is keyed by its own id rather than by the workspace.
  const storedIndex = (readSetting.get(wallIndexKey(context)) as { value: string } | undefined)?.value
  contextSettingKeys(context, storedIndex ?? null).forEach(collect)

  return {
    version: 2,
    context,
    items,
    tags,
    item_tags,
    relations,
    settings
  }
}

export function importContextData(db: Database.Database, newContextSlug: string, data: ContextExport): void {
  db.transaction(() => {
    // 1. Insert tags
    const stmtTag = db.prepare(`INSERT OR IGNORE INTO tags (id, name, color) VALUES (@id, @name, @color)`)
    if (Array.isArray(data.tags)) {
      for (const t of data.tags) {
        stmtTag.run(t)
      }
    }

    // 2. Insert items
    const stmtItem = db.prepare(`
      INSERT OR REPLACE INTO items (id, type, context, title, body, status, priority, position, created_at, updated_at, due_at, metadata)
      VALUES (@id, @type, @context, @title, @body, @status, @priority, @position, @created_at, @updated_at, @due_at, @metadata)
    `)
    if (Array.isArray(data.items)) {
      for (const item of data.items) {
        const copy = { ...item, context: newContextSlug }
        stmtItem.run(copy)
      }
    }

    // 3. Insert item_tags
    const stmtItemTag = db.prepare(`INSERT OR IGNORE INTO item_tags (item_id, tag_id) VALUES (?, ?)`)
    if (Array.isArray(data.item_tags)) {
      for (const it of data.item_tags) {
        stmtItemTag.run(it.item_id, it.tag_id)
      }
    }

    // 4. Insert relations
    const stmtRelation = db.prepare(`
      INSERT OR REPLACE INTO relations (id, from_id, to_id, type)
      VALUES (@id, @from_id, @to_id, @type)
    `)
    if (Array.isArray(data.relations)) {
      for (const rel of data.relations) {
        stmtRelation.run(rel)
      }
    }

    // 5. The workspace's own settings, rewritten for the workspace being
    // imported into. Absent from a version 1 export, which still imports.
    if (data.settings && typeof data.settings === 'object') {
      const stmtSetting = db.prepare(
        `INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      )
      const entries = remapContextSettings(
        data.settings,
        data.context,
        newContextSlug,
        () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
      )
      for (const entry of entries) {
        if (!isSecretSetting(entry.key)) stmtSetting.run(entry.key, entry.value)
      }
    }
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
      return { context: deleteItem(parsedId) }
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

  ipcMain.handle(IpcChannels.DB_DELETE_SETTING, (_event, key: unknown) => {
    return handleSafe(() => {
      const parsedKey = z.string().parse(key)
      deleteSetting(parsedKey)
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

      // Build the SET clause once from whichever fields were actually provided,
      // so bulk status/priority/context updates all persist (not just status).
      const setFields: string[] = []
      const baseParams: Record<string, unknown> = { updated_at: now }
      if (parsedPayload.patch.status !== undefined) {
        setFields.push('status = @status')
        baseParams.status = parsedPayload.patch.status
      }
      if (parsedPayload.patch.priority !== undefined) {
        setFields.push('priority = @priority')
        baseParams.priority = parsedPayload.patch.priority
      }
      if (parsedPayload.patch.context !== undefined) {
        setFields.push('context = @context')
        baseParams.context = parsedPayload.patch.context
      }

      if (setFields.length > 0) {
        setFields.push('updated_at = @updated_at')
        const stmtBulkUpdate = db.prepare(
          `UPDATE items SET ${setFields.join(', ')} WHERE id = @id`
        )
        db.transaction(() => {
          for (const id of parsedPayload.ids) {
            stmtBulkUpdate.run({ ...baseParams, id })
          }
        })()
      }

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

  ipcMain.handle(IpcChannels.DB_CREATE_FOCUS_SESSION, (_event, payload: unknown) => {
    return handleSafe(() => {
      const parsedPayload = CreateFocusSessionSchema.parse(payload)
      return createFocusSession(parsedPayload)
    })
  })

  ipcMain.handle(IpcChannels.DB_GET_FOCUS_SESSIONS, (_event, context: unknown) => {
    return handleSafe(() => {
      const parsedContext = z.string().parse(context)
      return getFocusSessions(parsedContext)
    })
  })

  ipcMain.handle(IpcChannels.TRACKER_GET_STATS, (_event, context: unknown, timeStart: unknown, timeEnd: unknown) => {
    return handleSafe(() => {
      const parsedContext = z.string().nullable().parse(context)
      const parsedStart = z.number().parse(timeStart)
      const parsedEnd = z.number().parse(timeEnd)
      return getActivityStats(parsedContext, parsedStart, parsedEnd)
    })
  })

  // Clipboard History Handlers
  ipcMain.handle(IpcChannels.CLIPBOARD_GET_HISTORY, () => {
    return handleSafe(() => getClipboardHistory())
  })

  ipcMain.handle(IpcChannels.CLIPBOARD_TOGGLE_PIN, (_event, id: unknown, isPinned: unknown) => {
    return handleSafe(() => {
      const parsedId = z.string().parse(id)
      const parsedPin = z.boolean().parse(isPinned)
      toggleClipboardPin(parsedId, parsedPin)
    })
  })

  ipcMain.handle(IpcChannels.CLIPBOARD_UPDATE_LABEL, (_event, id: unknown, label: unknown) => {
    return handleSafe(() => {
      const parsedId = z.string().parse(id)
      const parsedLabel = z.string().nullable().parse(label)
      updateClipboardLabel(parsedId, parsedLabel)
    })
  })

  ipcMain.handle(IpcChannels.CLIPBOARD_DELETE_ITEM, (_event, id: unknown) => {
    return handleSafe(() => {
      const parsedId = z.string().parse(id)
      deleteClipboardItem(parsedId)
    })
  })

  ipcMain.handle(IpcChannels.CLIPBOARD_RESTORE_ITEM, (_event, content: unknown, isPinned: unknown, label: unknown) => {
    return handleSafe(() => {
      const parsedContent = z.string().parse(content)
      const parsedPin = z.boolean().parse(isPinned)
      const parsedLabel = z.string().nullable().parse(label)
      restoreClipboardItem(parsedContent, parsedPin, parsedLabel)
    })
  })


  ipcMain.handle(IpcChannels.CLIPBOARD_CLEAR_HISTORY, () => {
    return handleSafe(() => clearClipboardHistory())
  })

  ipcMain.handle(IpcChannels.CLIPBOARD_CREATE_SNIPPET, (_event, content: unknown, label: unknown) => {
    return handleSafe(() => {
      const parsedContent = z.string().parse(content)
      const parsedLabel = z.string().nullable().parse(label)
      createClipboardSnippet(parsedContent, parsedLabel)
    })
  })
}
