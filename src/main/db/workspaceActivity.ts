/** each workspace's open work, the dates around now, recent focus and the last thing changed, read once for the Workspaces page */

import type Database from 'better-sqlite3'
import { DAY_MS } from '../../shared/dueDate'
import { AHEAD_DAYS, PAST_DAYS, type ActivityBySlug, type LastChange, type WorkspaceActivity } from '../../shared/workspaceLanes'

// the tray's open work, so the two never disagree
const OPEN = `type IN ('card', 'task') AND status NOT IN ('done', 'archived')`
/** enough for a tooltip line; a pasted essay as a title stays in the database */
const TITLE_CHARS = 120

/** a log entry is often only a body; its first line stands in for the title */
function titleOf(title: string, body: string): string {
  const text = title.trim() || (body.split('\n').find(line => line.trim() !== '') ?? '').trim()
  return text.slice(0, TITLE_CHARS)
}

export function workspaceActivity(db: Database.Database, now: number): ActivityBySlug {
  const result: ActivityBySlug = {}
  const of = (slug: string): WorkspaceActivity => (result[slug] ??= { open: 0, dated: [], focus: [], lastChanged: null })

  const counts = db.prepare(`SELECT context, COUNT(*) AS n FROM items WHERE ${OPEN} GROUP BY context`).all() as { context: string; n: number }[]
  for (const row of counts) of(row.context).open = row.n

  // a day past the strip's end, so a whole day stored as midnight UTC is never lost to the timezone
  const until = now + (AHEAD_DAYS + 2) * DAY_MS
  const dated = db.prepare(
    `SELECT id, context, type, substr(title, 1, ${TITLE_CHARS}) AS title, due_at FROM items
     WHERE ${OPEN} AND due_at IS NOT NULL AND due_at < ? ORDER BY due_at`
  ).all(until) as { id: string; context: string; type: 'card' | 'task'; title: string; due_at: number }[]
  for (const row of dated) of(row.context).dated.push({ id: row.id, type: row.type, title: row.title.trim(), due: row.due_at })

  // likewise a day before the strip's start
  const since = now - (PAST_DAYS + 2) * DAY_MS
  const focus = db.prepare(
    'SELECT context, completed_at, duration_ms FROM focus_sessions WHERE completed_at >= ? ORDER BY completed_at'
  ).all(since) as { context: string; completed_at: number; duration_ms: number }[]
  for (const row of focus) of(row.context).focus.push({ at: row.completed_at, ms: row.duration_ms })

  // sqlite fills the bare columns from the row that holds the max
  const latest = db.prepare(
    'SELECT context, id, type, title, substr(body, 1, 400) AS body, MAX(updated_at) AS at FROM items GROUP BY context'
  ).all() as { context: string; id: string; type: LastChange['type']; title: string; body: string; at: number }[]
  for (const row of latest) of(row.context).lastChanged = { id: row.id, type: row.type, title: titleOf(row.title, row.body), at: row.at }

  return result
}
