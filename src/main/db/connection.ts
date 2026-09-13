import Database from 'better-sqlite3'
import { join } from 'path'

export let dbInstance: Database.Database | null = null

// keyed by exact SQL, skips re-parsing on hot paths
const _stmtCache = new Map<string, Database.Statement>()
export function prepareOnce(db: Database.Database, sql: string): Database.Statement {
  let stmt = _stmtCache.get(sql)
  if (!stmt) {
    stmt = db.prepare(sql)
    _stmtCache.set(sql, stmt)
  }
  return stmt
}

/** checkpoint WAL into the main file then close; call from will-quit */
export function closeDb(): void {
  if (!dbInstance) return

  // own try: a failed checkpoint mustn't skip the close and leave the file locked
  try {
    dbInstance.pragma('wal_checkpoint(TRUNCATE)') // flush WAL → main db file
  } catch (err) {
    console.error('[db] Could not checkpoint before closing:', err)
  }
  discardDb()
}

/** for unreadable dbs: nothing to checkpoint, and windows can't move a file still open */
export function discardDb(): void {
  if (!dbInstance) return
  try {
    dbInstance.close()
  } catch (err) {
    console.error('[db] Error closing database:', err)
  } finally {
    dbInstance = null
    _stmtCache.clear()
  }
}

export function getDb(): Database.Database {
  if (!dbInstance) throw new Error('Database not initialized')
  return dbInstance
}

export function openDb(dataPath: string): Database.Database {
  const dbPath = join(dataPath, 'checkpoint.db')
  const db = new Database(dbPath)
  dbInstance = db

  db.pragma('journal_mode = WAL')     // non-blocking concurrent reads
  db.pragma('foreign_keys = ON')
  db.pragma('synchronous = NORMAL')
  db.pragma('cache_size = -32000')    // 32MB page cache
  db.pragma('busy_timeout = 5000')    // wait up to 5s if locked
  db.pragma('temp_store = MEMORY')    // temp tables in RAM, not disk
  db.pragma('mmap_size = 67108864')   // 64MB memory-mapped I/O for reads

  return db
}
