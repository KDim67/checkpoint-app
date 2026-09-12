/**
 * The FTS bridge triggers, kept separate because they are needed twice: once in
 * SCHEMA_SQL, and again after the legacy items rebuild, which drops them along
 * with the table. Two copies would drift.
 */
export const ITEMS_FTS_TRIGGERS_SQL = `CREATE TRIGGER IF NOT EXISTS items_fts_insert AFTER INSERT ON items BEGIN
  INSERT INTO items_fts(rowid, id, title, body) VALUES (new.rowid, new.id, new.title, new.body);
END;
CREATE TRIGGER IF NOT EXISTS items_fts_delete AFTER DELETE ON items BEGIN
  INSERT INTO items_fts(items_fts, rowid, id, title, body) VALUES('delete', old.rowid, old.id, old.title, old.body);
END;
CREATE TRIGGER IF NOT EXISTS items_fts_update AFTER UPDATE ON items BEGIN
  INSERT INTO items_fts(items_fts, rowid, id, title, body) VALUES('delete', old.rowid, old.id, old.title, old.body);
  INSERT INTO items_fts(rowid, id, title, body) VALUES (new.rowid, new.id, new.title, new.body);
END;`

export const SCHEMA_SQL = `
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
