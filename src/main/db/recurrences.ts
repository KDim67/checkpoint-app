import { getDb } from './connection'

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
