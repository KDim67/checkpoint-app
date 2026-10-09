/** every layer for one range, each fenced so a failing one empties itself and says why; and the two writes the calendar makes */

import { createItem, getDb, getItemById, updateItem } from '../db'
import { notifyRenderer, readBoardConfig } from '../mcp/toolKit'
import { CALENDAR_LAYERS, type CalendarAnswer, type CalendarEntry, type CalendarLayer, type CalendarProblem, type CalendarQuery } from '../../shared/calendar'
import type { CalendarResult, QuickAddInput } from '../../shared/calendarApi'
import type { Item } from '../../shared/types'
import { dueEntries, focusEntries, linkedRepositories, logEntries, renewalEntries, repeatEntries, type Range } from './sources'
import { commitEntries } from './commits'
import { subscribedEntries } from './icalStore'

const LAYERS = new Set<string>(CALENDAR_LAYERS.map(l => l.id))
// a year past either side of today is as far as anyone pages; past that a query is a mistake
const MAX_SPAN_MS = 400 * 86_400_000

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err))

export async function calendarEntries(query: CalendarQuery, now = Date.now()): Promise<CalendarResult<CalendarAnswer>> {
  const from = Number(query?.from)
  const to = Number(query?.to)
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from || to - from > MAX_SPAN_MS) {
    return { ok: false, reason: 'That date range is not one the calendar can show.' }
  }
  const workspaces = Array.isArray(query.workspaces) ? query.workspaces.filter((w): w is string => typeof w === 'string') : null
  const layers = (Array.isArray(query.layers) ? query.layers : []).filter((l): l is CalendarLayer => LAYERS.has(l))
  const range: Range = { from, to }
  const entries: CalendarEntry[] = []
  const problems: CalendarProblem[] = []

  const run = (layer: CalendarLayer, fn: () => CalendarEntry[]): void => {
    try {
      entries.push(...fn())
    } catch (err) {
      console.error(`[calendar] The ${layer} layer failed:`, err)
      problems.push({ layer, message: message(err) })
    }
  }

  for (const layer of layers) {
    if (layer === 'due') run(layer, () => dueEntries(range, workspaces, now))
    else if (layer === 'repeats') run(layer, () => repeatEntries(range, workspaces))
    else if (layer === 'renewals') run(layer, () => renewalEntries(range, workspaces))
    else if (layer === 'focus') run(layer, () => focusEntries(range, workspaces))
    else if (layer === 'log') run(layer, () => logEntries(range, workspaces))
    else if (layer === 'commits') {
      try {
        const got = await commitEntries(range, linkedRepositories(workspaces))
        entries.push(...got.entries)
        for (const p of got.problems) problems.push({ layer, message: p })
      } catch (err) {
        problems.push({ layer, message: message(err) })
      }
    } else if (layer === 'events') {
      try {
        const got = subscribedEntries(from, to, workspaces)
        entries.push(...got.entries)
        for (const p of got.problems) problems.push({ layer, message: p })
      } catch (err) {
        problems.push({ layer, message: message(err) })
      }
    }
  }
  entries.sort((a, b) => a.start - b.start)
  return { ok: true, value: { entries, problems } }
}

const movable = (item: Item | null): item is Item =>
  !!item && (item.type === 'card' || item.type === 'task') && item.status !== 'archived'

/** a whole day is midnight UTC exactly; any other finite number is a moment */
const validDue = (due: unknown): due is number => typeof due === 'number' && Number.isFinite(due) && due > 0

export function moveDue(itemId: unknown, due: unknown): CalendarResult<{ item: Item; previous: number | null }> {
  if (typeof itemId !== 'string' || !validDue(due)) return { ok: false, reason: 'That move was malformed.' }
  const before = getItemById(itemId)
  if (!movable(before)) return { ok: false, reason: 'That card or task can\'t be moved from the calendar.' }
  const item = updateItem(getDb(), itemId, { due_at: due })
  notifyRenderer()
  return { ok: true, value: { item, previous: before.due_at } }
}

export function quickAdd(input: QuickAddInput): CalendarResult<Item> {
  const title = typeof input?.title === 'string' ? input.title.trim() : ''
  if (!title) return { ok: false, reason: 'Give it a title.' }
  if (input.type !== 'card' && input.type !== 'task') return { ok: false, reason: 'It has to be a card or a task.' }
  if (typeof input.context !== 'string' || !input.context) return { ok: false, reason: 'Pick a workspace for it.' }
  if (!validDue(input.due)) return { ok: false, reason: 'That date was malformed.' }
  const columns = readBoardConfig(input.context).columns
  const item = createItem(getDb(), {
    type: input.type,
    context: input.context,
    title: title.slice(0, 500),
    body: '',
    // a card in a column nobody owns is hidden, so the board's first
    status: input.type === 'card' ? columns[0]?.id ?? 'todo' : 'open',
    priority: 0,
    position: Date.now(),
    due_at: input.due,
    metadata: '{}'
  })
  notifyRenderer()
  return { ok: true, value: item }
}
