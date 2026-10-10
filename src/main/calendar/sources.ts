/** each layer answers for a range and the workspaces asked about; nothing here changes anything */

import { getDb, getRecurrences, readContextList } from '../db'
import { rowToItem } from '../db/items'
import { ruleFromRow } from '../recurrenceService'
import { getKinds, listRenewals } from '../renewals'
import { readBoardConfig } from '../mcp/toolKit'
import { kindById } from '../../shared/renewalKinds'
import { nextOccurrence } from '../../shared/recurrence'
import { warnTime } from '../../shared/renewal'
import { isAllDay, isOverdue } from '../../shared/dueDate'
import { paddedRange, type CalendarEntry } from '../../shared/calendar'
import { dueLockOf } from '../../shared/connections'

export interface Range {
  from: number
  to: number
}

/** a cap per layer, so one enormous workspace can't stall the screen */
const LIMIT = 2000

const inList = (column: string, workspaces: string[] | null): { sql: string; args: string[] } =>
  workspaces === null ? { sql: '', args: [] } : { sql: ` AND ${column} IN (${workspaces.map(() => '?').join(', ') || 'NULL'})`, args: workspaces }

const isDone = (status: string): boolean => status === 'done'

/** a card's column, by its name, for the line under its title */
function columnNamer(): (context: string, status: string) => string | null {
  const boards = new Map<string, Map<string, string>>()
  return (context, status) => {
    let columns = boards.get(context)
    if (!columns) {
      columns = new Map(readBoardConfig(context).columns.map(c => [c.id, c.name]))
      boards.set(context, columns)
    }
    return columns.get(status) ?? null
  }
}

/** cards and tasks due in range; with today on screen, the late ones from before it too */
export function dueEntries(range: Range, workspaces: string[] | null, now: number): CalendarEntry[] {
  const { from, to } = paddedRange(range.from, range.to)
  const scope = inList('context', workspaces)
  const rows = getDb().prepare(
    `SELECT * FROM items WHERE due_at IS NOT NULL AND type IN ('card', 'task') AND status != 'archived'
     AND ((due_at >= ? AND due_at < ?) OR (? BETWEEN ? AND ? AND due_at < ? AND status != 'done'))${scope.sql}
     ORDER BY due_at LIMIT ${LIMIT}`
  ).all(from, to, now, range.from, range.to, from, ...scope.args) as Record<string, unknown>[]
  const column = columnNamer()
  return rows.map(rowToItem).map(item => {
    const due = item.due_at as number
    const done = isDone(item.status)
    const locked = dueLockOf(item.metadata)
    return {
      id: `item:${item.id}`,
      layer: 'due',
      title: item.title || 'Untitled',
      start: due,
      end: null,
      allDay: isAllDay(due),
      days: 1,
      workspace: item.context,
      color: null,
      movable: locked === null,
      ...(locked ? { locked } : {}),
      state: done ? 'done' : isOverdue(due, now) ? 'late' : 'open',
      ref: { kind: 'item', id: item.id },
      detail: item.type === 'card' ? column(item.context, item.status) : 'Task'
    }
  })
}

/** occurrences not made yet: the next one waiting and those after it, as ghosts */
export function repeatEntries(range: Range, workspaces: string[] | null): CalendarEntry[] {
  const { from, to } = paddedRange(range.from, range.to)
  const out: CalendarEntry[] = []
  const rows = workspaces === null ? getRecurrences() : workspaces.flatMap(w => getRecurrences(w))
  for (const row of rows) {
    if (row.active !== 1 || row.next_due === null) continue
    const rule = ruleFromRow(row)
    if (!rule) continue
    let at: number | null = row.next_due
    for (let i = 0; at !== null && at < to && i < 400 && out.length < LIMIT; i++) {
      if (at >= from) {
        out.push({
          id: `repeat:${row.id}:${at}`,
          layer: 'repeats',
          title: row.title || 'Untitled',
          start: at,
          end: null,
          allDay: isAllDay(at),
          days: 1,
          workspace: row.context,
          color: null,
          movable: false,
          state: 'ghost',
          ref: { kind: 'recurrence', id: row.id },
          detail: 'Repeats'
        })
      }
      at = nextOccurrence(rule, at)
    }
  }
  return out
}

/** the day each expires, and the day its first warning starts */
export function renewalEntries(range: Range, workspaces: string[] | null): CalendarEntry[] {
  const { from, to } = paddedRange(range.from, range.to)
  const kinds = getKinds()
  const scope = workspaces === null ? null : new Set(workspaces)
  const out: CalendarEntry[] = []
  for (const r of listRenewals()) {
    if (r.status !== 'active' || r.meta.expiresAt === null) continue
    if (scope && !scope.has(r.context)) continue
    const expires = r.meta.expiresAt
    const kind = kindById(kinds, r.meta.kind).name
    if (expires >= from && expires < to) {
      out.push({
        id: `renewal:${r.id}`, layer: 'renewals', title: r.title, start: expires, end: null,
        allDay: isAllDay(expires), days: 1, workspace: r.context, color: null, movable: false,
        state: null, ref: { kind: 'renewal', id: r.id }, detail: kind
      })
    }
    const firstWarning = r.meta.warnAt.length ? warnTime(expires, r.meta.warnAt[0]) : null
    if (firstWarning !== null && firstWarning >= from && firstWarning < to && firstWarning < expires) {
      out.push({
        id: `renewal-warning:${r.id}`, layer: 'renewals', title: `${r.title} warnings start`, start: firstWarning, end: null,
        allDay: false, days: 1, workspace: r.context, color: null, movable: false,
        state: 'warning', ref: { kind: 'renewal', id: r.id }, detail: kind
      })
    }
  }
  return out
}

/** sessions as the time they took */
export function focusEntries(range: Range, workspaces: string[] | null): CalendarEntry[] {
  const scope = inList('context', workspaces)
  const rows = getDb().prepare(
    `SELECT id, context, duration_ms, completed_at, notes FROM focus_sessions
     WHERE completed_at > ? AND completed_at - duration_ms < ?${scope.sql} ORDER BY completed_at LIMIT ${LIMIT}`
  ).all(range.from, range.to, ...scope.args) as { id: string; context: string; duration_ms: number; completed_at: number; notes: string }[]
  return rows.map(s => ({
    id: `focus:${s.id}`,
    layer: 'focus',
    title: s.notes.split('\n')[0].trim() || 'Focus',
    start: s.completed_at - s.duration_ms,
    end: s.completed_at,
    allDay: false,
    days: 1,
    workspace: s.context,
    color: null,
    movable: false,
    state: null,
    ref: { kind: 'focus', id: s.id },
    detail: null
  }))
}

/** what was written in the log, by when */
export function logEntries(range: Range, workspaces: string[] | null): CalendarEntry[] {
  const scope = inList('context', workspaces)
  const rows = getDb().prepare(
    `SELECT * FROM items WHERE type = 'log' AND status != 'archived' AND created_at >= ? AND created_at < ?${scope.sql}
     ORDER BY created_at LIMIT ${LIMIT}`
  ).all(range.from, range.to, ...scope.args) as Record<string, unknown>[]
  return rows.map(rowToItem).map(item => ({
    id: `log:${item.id}`,
    layer: 'log',
    title: item.title || item.body.split('\n')[0].slice(0, 80) || 'Log entry',
    start: item.created_at,
    end: null,
    allDay: false,
    days: 1,
    workspace: item.context,
    color: null,
    movable: false,
    state: null,
    ref: { kind: 'item', id: item.id },
    detail: null
  }))
}

/** workspaces linked to a repository, for the commits layer */
export function linkedRepositories(workspaces: string[] | null): { workspace: string; path: string }[] {
  const scope = workspaces === null ? null : new Set(workspaces)
  return (readContextList(getDb()) ?? [])
    .filter(entry => typeof entry.gitPath === 'string' && entry.gitPath && (!scope || scope.has(entry.slug)))
    .map(entry => ({ workspace: entry.slug, path: entry.gitPath as string }))
}
