/** where entries go on screen; plain functions, so the placing is tested without a browser */

import {
  addDays,
  coversDay,
  dayBounds,
  dayKey,
  entryDay,
  minutesOf,
  monthGrid,
  sameDay,
  weekOf,
  type CalendarEntry,
  type CalendarLayer
} from '../../../../shared/calendar'
import { DAY_MS, type CalendarDay } from '../../../../shared/dueDate'

export type CalendarViewKind = 'month' | 'week' | 'agenda'

export const AGENDA_DAYS = 30

/** layers shown per day as one count instead of one chip each */
export const COUNTED_LAYERS: CalendarLayer[] = ['log', 'commits']

export function visibleDays(view: CalendarViewKind, anchor: CalendarDay, weekStart: number): CalendarDay[] {
  if (view === 'month') return monthGrid(anchor.year, anchor.month, weekStart)
  if (view === 'week') return weekOf(anchor, weekStart)
  return Array.from({ length: AGENDA_DAYS }, (_, i) => addDays(anchor, i))
}

/** local moments from the first day's midnight to the midnight after the last */
export function rangeOf(days: CalendarDay[]): { from: number; to: number } {
  return { from: dayBounds(days[0]).start, to: dayBounds(days[days.length - 1]).end }
}

/** the next or previous page: a month, a week, or a month of agenda */
export function step(view: CalendarViewKind, anchor: CalendarDay, direction: 1 | -1): CalendarDay {
  if (view === 'month') {
    const d = new Date(anchor.year, anchor.month + direction, 1)
    return { year: d.getFullYear(), month: d.getMonth(), day: 1 }
  }
  return addDays(anchor, direction * (view === 'week' ? 7 : AGENDA_DAYS))
}

export function titleOf(view: CalendarViewKind, anchor: CalendarDay, days: CalendarDay[], locale?: string): string {
  const fmt = (d: CalendarDay, options: Intl.DateTimeFormatOptions): string =>
    new Date(d.year, d.month, d.day).toLocaleDateString(locale, options)
  if (view === 'month') return fmt(anchor, { month: 'long', year: 'numeric' })
  const first = days[0]
  const last = days[days.length - 1]
  const sameYear = first.year === last.year
  return `${fmt(first, { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) })} to ${fmt(last, { day: 'numeric', month: 'short', year: 'numeric' })}`
}

export interface DayContents {
  /** chips, whole-day first, then by time */
  entries: CalendarEntry[]
  /** counted layers, folded into one figure each */
  counts: Partial<Record<CalendarLayer, CalendarEntry[]>>
  /** minutes of focus, for the month's total */
  focusMs: number
}

const byPlacement = (a: CalendarEntry, b: CalendarEntry): number =>
  Number(b.allDay) - Number(a.allDay) || a.start - b.start || a.title.localeCompare(b.title)

/** each day's share; a late entry shows on its own day and again on today, so nothing late hides in the past */
export function byDay(entries: CalendarEntry[], days: CalendarDay[], today: CalendarDay): Map<string, DayContents> {
  const out = new Map<string, DayContents>(days.map(d => [dayKey(d), { entries: [], counts: {}, focusMs: 0 }]))
  const todayKey = dayKey(today)
  for (const entry of entries) {
    for (const day of days) {
      if (!coversDay(entry, day)) continue
      const cell = out.get(dayKey(day))
      if (!cell) continue
      if (COUNTED_LAYERS.includes(entry.layer)) (cell.counts[entry.layer] ??= []).push(entry)
      else cell.entries.push(entry)
      if (entry.layer === 'focus' && entry.end !== null) {
        const { start, end } = dayBounds(day)
        cell.focusMs += Math.max(0, Math.min(entry.end, end) - Math.max(entry.start, start))
      }
    }
    const todayCell = out.get(todayKey)
    if (entry.state === 'late' && todayCell && !sameDay(entryDay(entry), today) && !todayCell.entries.includes(entry)) {
      todayCell.entries.push(entry)
    }
  }
  for (const cell of out.values()) cell.entries.sort(byPlacement)
  return out
}

/** whether an entry sits in the week's time grid rather than its all-day row; a day or longer reads better as a bar */
export const inTimeGrid = (entry: CalendarEntry): boolean =>
  !entry.allDay && !COUNTED_LAYERS.includes(entry.layer) && (entry.end === null || entry.end - entry.start < DAY_MS)

/** one entry's stretch across a row of days; a bar when it covers more than one */
export interface Segment {
  entry: CalendarEntry
  /** the column it starts on */
  start: number
  span: number
  lane: number
  /** it carries on from before the row, or past its end, so that edge is cut square */
  continuesBefore: boolean
  continuesAfter: boolean
}

/** lanes for one row: earlier and longer first, so a bar keeps one line across the row and single days fill the gaps */
export function laneRow(row: CalendarDay[], entriesOn: (day: CalendarDay) => CalendarEntry[]): Segment[] {
  const found: Omit<Segment, 'lane'>[] = []
  const seen = new Set<string>()
  row.forEach((day, column) => {
    for (const entry of entriesOn(day)) {
      // a late entry repeated on today stands alone there
      if (!coversDay(entry, day)) {
        found.push({ entry, start: column, span: 1, continuesBefore: false, continuesAfter: false })
        continue
      }
      if (seen.has(entry.id)) continue
      seen.add(entry.id)
      let last = column
      while (last + 1 < row.length && coversDay(entry, row[last + 1])) last++
      found.push({
        entry,
        start: column,
        span: last - column + 1,
        continuesBefore: column === 0 && coversDay(entry, addDays(day, -1)),
        continuesAfter: last === row.length - 1 && coversDay(entry, addDays(row[last], 1))
      })
    }
  })
  found.sort((a, b) => a.start - b.start || b.span - a.span || byPlacement(a.entry, b.entry))
  const taken: boolean[][] = []
  const free = (lane: number, from: number, span: number): boolean =>
    Array.from({ length: span }, (_, i) => taken[lane]?.[from + i] !== true).every(Boolean)
  return found.map(segment => {
    let lane = 0
    while (!free(lane, segment.start, segment.span)) lane++
    taken[lane] ??= []
    for (let i = 0; i < segment.span; i++) taken[lane][segment.start + i] = true
    return { ...segment, lane }
  })
}

/** what a cell draws in one lane: an entry starting there, a bar passing over from the left, or nothing */
export type Slot = { kind: 'start'; segment: Segment } | { kind: 'under' } | { kind: 'empty' }

/** a cell's lanes, up to maxLanes; whatever sits deeper is counted toward its More */
export function cellSlots(segments: Segment[], column: number, maxLanes: number): { slots: Slot[]; hidden: number } {
  const here = segments.filter(s => column >= s.start && column < s.start + s.span)
  const lanes = Math.min(maxLanes, Math.max(-1, ...here.map(s => s.lane)) + 1)
  const slots = Array.from({ length: lanes }, (_, lane): Slot => {
    const segment = here.find(s => s.lane === lane)
    if (!segment) return { kind: 'empty' }
    return segment.start === column ? { kind: 'start', segment } : { kind: 'under' }
  })
  return { slots, hidden: here.filter(s => s.lane >= maxLanes).length }
}

/** a timed entry with no length still needs room to be read and clicked */
export const MIN_BLOCK_MINUTES = 30

export interface Placed {
  entry: CalendarEntry
  /** minutes from midnight, clipped to the day */
  top: number
  height: number
  column: number
  columns: number
}

/** overlapping blocks share the width side by side, each cluster as wide as its busiest moment */
export function placeTimed(entries: CalendarEntry[], day: CalendarDay): Placed[] {
  const { start: dayStart, end: dayEnd } = dayBounds(day)
  const blocks = entries
    .filter(e => inTimeGrid(e) && coversDay(e, day))
    .map(entry => {
      const begin = Math.max(entry.start, dayStart)
      const finish = Math.min(Math.max(entry.end ?? entry.start, entry.start), dayEnd)
      const top = begin <= dayStart ? 0 : minutesOf(begin)
      const length = Math.max(MIN_BLOCK_MINUTES, (finish - begin) / 60_000)
      return { entry, top, height: Math.min(length, 24 * 60 - top), column: 0, columns: 1 }
    })
    .sort((a, b) => a.top - b.top || b.height - a.height)

  const placed: Placed[] = []
  let cluster: Placed[] = []
  let clusterEnd = -1
  const close = (): void => {
    const width = Math.max(1, ...cluster.map(p => p.column + 1))
    for (const p of cluster) p.columns = width
    cluster = []
  }
  for (const block of blocks) {
    if (block.top >= clusterEnd) close()
    const taken = new Set(cluster.filter(p => p.top + p.height > block.top).map(p => p.column))
    let column = 0
    while (taken.has(column)) column++
    const p = { ...block, column }
    cluster.push(p)
    placed.push(p)
    clusterEnd = Math.max(clusterEnd, p.top + p.height)
  }
  close()
  return placed
}

/** the weekday names in the grid's order */
export function weekdayNames(weekStart: number, locale?: string): string[] {
  // 4 Jan 2026 was a Sunday
  return Array.from({ length: 7 }, (_, i) =>
    new Date(2026, 0, 4 + ((weekStart + i) % 7)).toLocaleDateString(locale, { weekday: 'short' }))
}
