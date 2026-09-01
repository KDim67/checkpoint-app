import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initDb, closeDb, getDb, searchItems } from '../src/main/db'

// These run the real initDb, real SCHEMA_SQL, real legacy-CHECK rebuild, real
// user_version ladder, against a throwaway file in the OS temp directory. The
// user's own database is never opened.
//
// `better-sqlite3` is aliased to a node:sqlite facade (see vitest.config.ts),
// so the SQL is executed by SQLite 3.53 rather than by the Electron-ABI native
// binding. The migrations are plain SQL and pragmas, so what is under test here
// is unaffected; what a plain-Node runner cannot check is the binding itself.

// Deliberately a literal rather than an import from db.ts: asserting the
// pragma against the same constant that set it would pass no matter what. Bump
// this by hand whenever a migration is added.
const CURRENT_VERSION = 9

/** The items table as shipped by early builds: status carried a CHECK constraint. */
const LEGACY_SCHEMA = `
CREATE TABLE items (
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL CHECK(type IN ('log','card','task')),
  context     TEXT NOT NULL,
  title       TEXT NOT NULL DEFAULT '',
  body        TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','in_progress','done','archived')),
  priority    INTEGER NOT NULL DEFAULT 0 CHECK(priority IN (0,1,2,3)),
  position    REAL NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  due_at      INTEGER,
  metadata    TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE tags (
  id      TEXT PRIMARY KEY,
  name    TEXT NOT NULL UNIQUE,
  color   TEXT NOT NULL DEFAULT '#535e85'
);
CREATE TABLE item_tags (
  item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  tag_id  TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (item_id, tag_id)
);
CREATE TABLE relations (
  id      TEXT PRIMARY KEY,
  from_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  to_id   TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  type    TEXT NOT NULL CHECK(type IN ('blocks','relates_to','duplicates'))
);
CREATE TABLE app_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`

const LEGACY_ROW = {
  id: 'itm_legacy',
  type: 'card',
  context: 'game-jam',
  title: 'Ship the prototype',
  body: 'Vertical slice with one playable level.',
  status: 'in_progress',
  priority: 3,
  position: 4.5,
  created_at: 1700000000000,
  updated_at: 1700000900000,
  due_at: 1700500000000,
  metadata: '{"colour":"#3b82f6"}'
}

let dir: string

function dbFile(): string {
  return join(dir, 'checkpoint.db')
}

/** Writes a pre-versioning database with real user content in it. */
function seedLegacyDatabase(userVersion = 0): void {
  const raw = new DatabaseSync(dbFile())
  raw.exec(LEGACY_SCHEMA)
  raw.prepare(
    `INSERT INTO items (id, type, context, title, body, status, priority, position, created_at, updated_at, due_at, metadata)
     VALUES (@id, @type, @context, @title, @body, @status, @priority, @position, @created_at, @updated_at, @due_at, @metadata)`
  ).run(LEGACY_ROW)
  raw.prepare(
    `INSERT INTO items (id, type, context, title, body, status, priority, position, created_at, updated_at, due_at, metadata)
     VALUES ('itm_done', 'task', 'game-jam', 'Pick an engine', '', 'done', 1, 0, 1, 1, NULL, '{}')`
  ).run()
  raw.exec(`INSERT INTO tags (id, name, color) VALUES ('tag_1', 'engine', '#a855f7')`)
  raw.exec(`INSERT INTO item_tags (item_id, tag_id) VALUES ('itm_legacy', 'tag_1'), ('itm_done', 'tag_1')`)
  raw.exec(
    `INSERT INTO relations (id, from_id, to_id, type) VALUES ('rel_1', 'itm_done', 'itm_legacy', 'blocks')`
  )
  raw.exec(`INSERT INTO app_settings (key, value) VALUES ('ai_base_url', '"http://localhost:11434/v1"')`)
  if (userVersion > 0) raw.exec(`PRAGMA user_version = ${userVersion}`)
  raw.close()
}

/** Everything a migration could plausibly damage, in one comparable value. */
function snapshot(): unknown {
  const raw = new DatabaseSync(dbFile())
  const objects = raw
    .prepare(`SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name`)
    .all()
    .map((r) => ({ ...r }))
  const tables = objects.filter((o) => o.type === 'table' && typeof o.sql === 'string')
  const data: Record<string, unknown[]> = {}
  for (const table of tables) {
    const name = table.name as string
    // FTS shadow tables hold opaque blobs; their parent table is what matters.
    if (name.startsWith('items_fts')) continue
    data[name] = raw.prepare(`SELECT * FROM "${name}"`).all().map((r) => ({ ...r }))
  }
  const version = raw.prepare('PRAGMA user_version').get() as { user_version: number }
  raw.close()
  return { objects, data, userVersion: version.user_version }
}

function tableNames(): string[] {
  const raw = new DatabaseSync(dbFile())
  const names = raw
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)
    .all()
    .map((r) => (r as { name: string }).name)
  raw.close()
  return names
}

function userVersion(): number {
  const raw = new DatabaseSync(dbFile())
  const row = raw.prepare('PRAGMA user_version').get() as { user_version: number }
  raw.close()
  return row.user_version
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'checkpoint-db-'))
})

afterEach(() => {
  closeDb()
  rmSync(dir, { recursive: true, force: true })
})

describe('upgrading a legacy database', () => {
  it('keeps every column of every existing item through the table rebuild', () => {
    seedLegacyDatabase()
    initDb(dir)
    const row = getDb().prepare(`SELECT * FROM items WHERE id = 'itm_legacy'`).get()
    expect({ ...(row as Record<string, unknown>) }).toEqual(LEGACY_ROW)
  })

  it('does not cascade-delete tag links or relations when items is dropped', () => {
    // item_tags and relations both declare ON DELETE CASCADE against items, so
    // the rebuild's DROP TABLE would wipe them if foreign_keys were left on.
    seedLegacyDatabase()
    initDb(dir)
    const db = getDb()
    expect(db.prepare(`SELECT COUNT(*) AS n FROM item_tags`).get()).toMatchObject({ n: 2 })
    expect(db.prepare(`SELECT COUNT(*) AS n FROM relations`).get()).toMatchObject({ n: 1 })
    expect(db.prepare(`SELECT COUNT(*) AS n FROM items`).get()).toMatchObject({ n: 2 })
  })

  it('re-enables foreign key enforcement after the rebuild', () => {
    seedLegacyDatabase()
    initDb(dir)
    expect(getDb().pragma('foreign_keys', { simple: true })).toBe(1)
  })

  it('makes custom Kanban column ids storable, which the legacy CHECK forbade', () => {
    seedLegacyDatabase()

    const before = new DatabaseSync(dbFile())
    expect(() =>
      before.exec(
        `INSERT INTO items (id, type, context, status, created_at, updated_at) VALUES ('x','card','c','col_7f3a',1,1)`
      )
    ).toThrow()
    before.close()

    initDb(dir)
    expect(() =>
      getDb()
        .prepare(
          `INSERT INTO items (id, type, context, title, body, status, priority, position, created_at, updated_at, due_at, metadata)
           VALUES ('itm_new','card','game-jam','','','col_7f3a',0,0,1,1,NULL,'{}')`
        )
        .run()
    ).not.toThrow()
  })

  it('creates every table a later schema version introduced', () => {
    seedLegacyDatabase()
    initDb(dir)
    expect(tableNames()).toEqual(
      expect.arrayContaining([
        'activity_tracking_logs',
        'ai_memories',
        'app_settings',
        'clipboard_items',
        'focus_sessions',
        'item_tags',
        'items',
        'relations',
        'sync_tombstones',
        'tags'
      ])
    )
  })

  it('stamps the database at the current schema version', () => {
    seedLegacyDatabase()
    initDb(dir)
    closeDb()
    expect(userVersion()).toBe(CURRENT_VERSION)
  })

  it('preserves settings written by the old build', () => {
    seedLegacyDatabase()
    initDb(dir)
    expect(getDb().prepare(`SELECT value FROM app_settings WHERE key = 'ai_base_url'`).get()).toMatchObject({
      value: '"http://localhost:11434/v1"'
    })
  })

  // Known defect
  // SCHEMA_SQL creates the items_fts triggers, and the legacy rebuild then does
  // DROP TABLE items, which drops the triggers attached to it. The renamed
  // items_rebuild table comes back without them, so for the whole session that
  // performed the migration nothing written to items reaches the FTS index and
  // search silently returns fewer results than it should.
  it('leaves the full-text search triggers attached after the rebuild', () => {
    seedLegacyDatabase()
    initDb(dir)
    const db = getDb()

    const triggers = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name`)
      .all() as { name: string }[]
    expect(triggers.map((t) => t.name)).toEqual([
      'items_fts_delete',
      'items_fts_insert',
      'items_fts_update'
    ])

    db.prepare(
      `INSERT INTO items (id, type, context, title, body, status, priority, position, created_at, updated_at, due_at, metadata)
       VALUES ('itm_after','card','game-jam','Netcode spike','','open',0,0,1,1,NULL,'{}')`
    ).run()
    expect(db.prepare(`SELECT id FROM items_fts WHERE items_fts MATCH 'Netcode'`).get()).toMatchObject({
      id: 'itm_after'
    })
  })

  // Known defect
  // items_fts is an external-content FTS5 table. Creating it over a populated
  // items table leaves the index empty, nothing backfills it, so every item a
  // user wrote before upgrading to the search build is invisible to search, with
  // no error anywhere to suggest the results are incomplete.
  it('can still find items that predate the full-text index', () => {
    seedLegacyDatabase()
    initDb(dir)
    const found = searchItems({ query: 'prototype', page: 1, pageSize: 20 })
    expect(found.items.map((i) => i.id)).toContain('itm_legacy')
  })
})

describe('re-running migrations', () => {
  it('changes nothing the second time a migrated database is opened', () => {
    seedLegacyDatabase()
    initDb(dir)
    closeDb()
    const afterFirst = snapshot()

    initDb(dir)
    closeDb()
    expect(snapshot()).toEqual(afterFirst)
  })

  it('changes nothing the second time a fresh database is opened', () => {
    initDb(dir)
    closeDb()
    const afterFirst = snapshot()

    initDb(dir)
    closeDb()
    expect(snapshot()).toEqual(afterFirst)
  })
})

describe('partial upgrades', () => {
  it('adds only the missing tables when resuming from an intermediate version', () => {
    seedLegacyDatabase(3)
    // A version-3 database already has focus_sessions with data in it.
    const raw = new DatabaseSync(dbFile())
    raw.exec(`
      CREATE TABLE focus_sessions (
        id TEXT PRIMARY KEY, context TEXT NOT NULL, duration_ms INTEGER NOT NULL,
        completed_at INTEGER NOT NULL, notes TEXT NOT NULL DEFAULT '',
        tasks_json TEXT NOT NULL DEFAULT '[]'
      );
      INSERT INTO focus_sessions (id, context, duration_ms, completed_at, notes, tasks_json)
      VALUES ('fs_1', 'game-jam', 1500000, 1700000000000, 'deep work', '[]');
    `)
    raw.close()

    initDb(dir)
    const db = getDb()
    expect(db.prepare(`SELECT notes FROM focus_sessions WHERE id = 'fs_1'`).get()).toMatchObject({
      notes: 'deep work'
    })
    expect(tableNames()).toEqual(expect.arrayContaining(['clipboard_items', 'ai_memories', 'mcp_activity', 'recurrences', 'subtasks']))
  })

  it('leaves a database already at the current version alone', () => {
    initDb(dir)
    closeDb()
    const migrated = snapshot()

    // Nothing in runMigrations should fire on a second open at CURRENT_VERSION.
    expect((migrated as { userVersion: number }).userVersion).toBe(CURRENT_VERSION)
    initDb(dir)
    closeDb()
    expect(snapshot()).toEqual(migrated)
  })
})

describe('a fresh database', () => {
  it('is created at the current version with the whole schema', () => {
    initDb(dir)
    closeDb()
    expect(userVersion()).toBe(CURRENT_VERSION)
    expect(tableNames()).toEqual(
      expect.arrayContaining(['items', 'tags', 'item_tags', 'relations', 'app_settings', 'focus_sessions'])
    )
  })

  it('is not put through the legacy rebuild', () => {
    // The rebuild is detected from the items DDL; a false positive here would
    // mean every launch drops and recreates the user's items table.
    initDb(dir)
    closeDb()
    const raw = new DatabaseSync(dbFile())
    const sql = (raw.prepare(`SELECT sql FROM sqlite_master WHERE name = 'items'`).get() as { sql: string }).sql
    raw.close()
    expect(sql).not.toMatch(/items_rebuild/)
    // The detector keys off a CHECK on status; a fresh table must not carry one.
    expect(sql).toMatch(/status\s+TEXT NOT NULL DEFAULT 'open',/)
  })

  it('indexes new items for full-text search', () => {
    initDb(dir)
    const db = getDb()
    db.prepare(
      `INSERT INTO items (id, type, context, title, body, status, priority, position, created_at, updated_at, due_at, metadata)
       VALUES ('itm_1','card','c','Netcode spike','rollback','open',0,0,1,1,NULL,'{}')`
    ).run()
    expect(db.prepare(`SELECT id FROM items_fts WHERE items_fts MATCH 'rollback'`).get()).toMatchObject({
      id: 'itm_1'
    })
  })
})
