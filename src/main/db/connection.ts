import Database from 'better-sqlite3'
import { join } from 'path'

export let dbInstance: Database.Database | null = null

// Statement cache. Reuse compiled SQL across calls
// Keyed by the exact SQL string. Avoids re-parsing the same SQL on hot paths
// (updateItem, searchItems, queryTasks, analytics, applyRemoteMutationTx, etc.)
const _stmtCache = new Map<string, Database.Statement>()
export function prepareOnce(db: Database.Database, sql: string): Database.Statement {
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
  if (!dbInstance) return

  // Separately, because a checkpoint that throws must not skip the close. It
  // used to share a try block with it, so a database that could not be flushed
  // was also never closed, and the file stayed locked for the rest of the
  // process's life.
  try {
    dbInstance.pragma('wal_checkpoint(TRUNCATE)') // flush WAL → main db file
  } catch (err) {
    console.error('[db] Could not checkpoint before closing:', err)
  }
  discardDb()
}

/**
 * Closes the handle and flushes nothing.
 *
 * For a database that could not be read: there is nothing worth checkpointing,
 * and on Windows the file cannot be moved out of the way while this process
 * still holds it open.
 */
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

  // Performance & safety PRAGMAs
  db.pragma('journal_mode = WAL')     // non-blocking concurrent reads
  db.pragma('foreign_keys = ON')
  db.pragma('synchronous = NORMAL')
  db.pragma('cache_size = -32000')    // 32MB page cache
  db.pragma('busy_timeout = 5000')    // wait up to 5s if locked
  db.pragma('temp_store = MEMORY')    // temp tables in RAM, not disk
  db.pragma('mmap_size = 67108864')   // 64MB memory-mapped I/O for reads

  return db
}
