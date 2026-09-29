import type Database from 'better-sqlite3'

let stmtInsertTombstone: Database.Statement
let stmtDeleteTombstone: Database.Statement

export function prepareTombstoneStatements(db: Database.Database): void {
  stmtInsertTombstone = db.prepare(
    `INSERT OR REPLACE INTO sync_tombstones (id, table_name, deleted_at) VALUES (?, ?, ?)`
  )
  stmtDeleteTombstone = db.prepare(`DELETE FROM sync_tombstones WHERE id = ? AND table_name = ?`)
}

export function recordTombstone(id: string, tableName: string): void {
  try {
    stmtInsertTombstone.run(id, tableName, Date.now())
  } catch (err) {
    console.error('[db] Failed to record tombstone:', err)
  }
}

/** written again, so no longer deleted; an undone delete must not read as one to sync */
export function clearTombstone(id: string, tableName: string): void {
  try {
    stmtDeleteTombstone?.run(id, tableName)
  } catch (err) {
    console.error('[db] Failed to clear tombstone:', err)
  }
}
