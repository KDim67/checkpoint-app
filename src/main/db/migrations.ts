import type Database from 'better-sqlite3'
import { isEncrypted, encryptSecret, secretSettingKeys } from '../secureSettings'
import { ITEMS_FTS_TRIGGERS_SQL } from './schema'

// Current schema version
const CURRENT_VERSION = 9

/**
 * Databases created by early builds carry a CHECK constraint limiting
 * items.status to ('open','in_progress','done','archived'). Custom Kanban
 * columns store the column id in status, so ANY move to a non-default column
 * (including the built-in "in_review") failed with SQLITE_CONSTRAINT_CHECK on
 * those databases. SQLite cannot drop a CHECK, so the table is rebuilt once,
 * detected via sqlite_master (safe on fresh databases: no-op).
 */
export function rebuildItemsTableIfLegacyCheck(db: Database.Database): void {
  const row = db.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'items'`).get() as { sql?: string } | undefined
  const tableSql = row?.sql || ''
  if (!/status[^,]*CHECK\s*\(/i.test(tableSql)) return

  console.log('[db] Legacy items.status CHECK constraint detected: rebuilding table')
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
    console.log('[db] items table rebuilt: custom column statuses now accepted')
  } finally {
    db.pragma('foreign_keys = ON')
  }
}

export function runMigrations(db: Database.Database): void {
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

/**
 * Re-writes credential settings that predate at-rest encryption, so an existing
 * install does not keep its provider keys in plaintext forever. Runs every boot,
 * no-op once the rows carry an envelope.
 *
 * Not via setSetting(): its side effects (titlebar sync, clipboard watcher) have
 * no business running during init.
 */
export function encryptLegacyPlaintextSecrets(db: Database.Database): void {
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
