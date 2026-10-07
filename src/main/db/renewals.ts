/** rows of the renewals table, created in schema.ts; status is checked in code, the table has no CHECKs to outgrow */

import type Database from 'better-sqlite3'
import type { RenewalRow } from '../../shared/renewalApi'
import { getDb, prepareOnce } from './connection'
import { clearTombstone, recordTombstone } from './tombstones'

export const RENEWALS_TABLE = 'renewals'

export function listRenewalRows(context?: string, db: Database.Database = getDb()): RenewalRow[] {
  return (context
    ? prepareOnce(db, `SELECT * FROM renewals WHERE context = ? ORDER BY created_at`).all(context)
    : prepareOnce(db, `SELECT * FROM renewals ORDER BY created_at`).all()) as RenewalRow[]
}

export function getRenewalRow(id: string): RenewalRow | null {
  return (prepareOnce(getDb(), `SELECT * FROM renewals WHERE id = ?`).get(id) as RenewalRow | undefined) ?? null
}

/** also Undo after a delete, so the id is the caller's and any tombstone for it goes */
export function insertRenewalRow(row: RenewalRow): void {
  prepareOnce(getDb(), `
    INSERT INTO renewals (id, context, title, body, status, created_at, updated_at, metadata)
    VALUES (@id, @context, @title, @body, @status, @created_at, @updated_at, @metadata)
  `).run(row)
  clearTombstone(row.id, RENEWALS_TABLE)
}

export function updateRenewalRow(
  id: string,
  patch: Partial<Pick<RenewalRow, 'context' | 'title' | 'body' | 'status' | 'metadata'>>,
  now = Date.now()
): void {
  const keys = (['context', 'title', 'body', 'status', 'metadata'] as const).filter(k => patch[k] !== undefined)
  const sets = [...keys.map(k => `${k} = @${k}`), 'updated_at = @updated_at'].join(', ')
  prepareOnce(getDb(), `UPDATE renewals SET ${sets} WHERE id = @id`).run({ ...patch, id, updated_at: now })
}

/** tombstoned, or the next sync brings it back */
export function deleteRenewalRow(id: string): void {
  recordTombstone(id, RENEWALS_TABLE)
  prepareOnce(getDb(), `DELETE FROM renewals WHERE id = ?`).run(id)
}
