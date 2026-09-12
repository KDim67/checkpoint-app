import type Database from 'better-sqlite3'

let stmtInsertTombstone: Database.Statement

export function prepareTombstoneStatements(db: Database.Database): void {
  stmtInsertTombstone = db.prepare(
    `INSERT OR REPLACE INTO sync_tombstones (id, table_name, deleted_at) VALUES (?, ?, ?)`
  )
}

export function recordTombstone(id: string, tableName: string): void {
  try {
    stmtInsertTombstone.run(id, tableName, Date.now())
  } catch (err) {
    console.error('[db] Failed to record tombstone:', err)
  }
}
