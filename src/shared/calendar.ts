/** the calendar's one entry shape and its date maths; main fills entries, the renderer only places them */

import { DAY_MS, allDay, dueDay, isAllDay, localDayOf, moment, type CalendarDay } from './dueDate'

export const CALENDAR_LAYERS = [
  { id: 'due', label: 'Due cards and tasks', defaultOn: true },
  { id: 'repeats', label: 'Upcoming repeats', defaultOn: true },
  { id: 'renewals', label: 'Renewals', defaultOn: true },
  { id: 'focus', label: 'Focus sessions', defaultOn: true },
  { id: 'log', label: 'Log entries', defaultOn: true },
  // a busy repository fills every day, so it waits to be asked for
  { id: 'commits', label: 'Git commits', defaultOn: false },
  { id: 'events', label: 'Calendars you subscribe to', defaultOn: true }
] as const

export type CalendarLayer = typeof CALENDAR_LAYERS[number]['id']

/** what an entry opens, back where it lives */
export type CalendarRef =
  | { kind: 'item'; id: string }
  | { kind: 'recurrence'; id: string }
  | { kind: 'renewal'; id: string }
  | { kind: 'focus'; id: string }
  | { kind: 'commit'; workspace: string; hash: string }
  | { kind: 'event'; calendarId: string; uid: string }

export interface CalendarEntry {
  /** unique within one answer, for keys */
  id: string
  layer: CalendarLayer
  title: string
  /** the dueDate encoding for whole days, a moment otherwise */
  start: number
  /** a moment, for things that take time: focus, events */
  end: number | null
  allDay: boolean
  /** whole days an all-day entry covers, 1 for most */
  days: number
  workspace: string | null
  /** a subscribed calendar's colour; the rest are coloured by layer or workspace */
  color: string | null
  /** only due cards and tasks; everything else is changed where it lives */
  movable: boolean
  /** why a due card can't be moved here, when its date belongs to a connected service */
  locked?: string
  state: 'open' | 'done' | 'late' | 'ghost' | 'warning' | null
  ref: CalendarRef
  /** a line under the title: a column, a renewal kind, a commit author, a place */
  detail: string | null
  /** an event's description, shown when it is opened */
  notes?: string
}

export interface CalendarQuery {
  /** local moments bounding what is on screen */
  from: number
  to: number
  /** null means every workspace */
  workspaces: string[] | null
  layers: CalendarLayer[]
}

export interface CalendarProblem {
  layer: CalendarLayer
  message: string
}

export interface CalendarAnswer {
  entries: CalendarEntry[]
  /** a layer that failed says why, the others still draw */
  problems: CalendarProblem[]
}

/** a range to query wide enough for every whole day in it: those sit at midnight UTC, up to a day off local midnight */
export function paddedRange(from: number, to: number): { from: number; to: number } {
  return { from: from - DAY_MS, to: to + DAY_MS }
}

export const sameDay = (a: CalendarDay, b: CalendarDay): boolean =>
  a.year === b.year && a.month === b.month && a.day === b.day

export const dayKey = (d: CalendarDay): string => `${d.year}-${d.month + 1}-${d.day}`

/** local midnight of a day, and of the day after */
export function dayBounds(d: CalendarDay): { start: number; end: number } {
  return { start: new Date(d.year, d.month, d.day).getTime(), end: new Date(d.year, d.month, d.day + 1).getTime() }
}

export function addDays(d: CalendarDay, n: number): CalendarDay {
  // through the local calendar, so a clock change never skips or repeats a day
  return localDayOf(new Date(d.year, d.month, d.day + n, 12).getTime())
}

/** 0 Sunday to 6 Saturday, as Date counts; Intl numbers Monday 1 to Sunday 7 */
export function firstDayOfWeek(locale: string): number {
  try {
    const loc = new Intl.Locale(locale) as Intl.Locale & { getWeekInfo?: () => { firstDay: number }; weekInfo?: { firstDay: number } }
    const info = loc.getWeekInfo?.() ?? loc.weekInfo
    if (info && info.firstDay >= 1 && info.firstDay <= 7) return info.firstDay % 7
  } catch {
    // an unknown locale falls back below
  }
  return 1
}

/** the seven days of the week holding a day */
export function weekOf(d: CalendarDay, weekStart: number): CalendarDay[] {
  const weekday = new Date(d.year, d.month, d.day).getDay()
  const back = (weekday - weekStart + 7) % 7
  const first = addDays(d, -back)
  return Array.from({ length: 7 }, (_, i) => addDays(first, i))
}

/** six whole weeks, so every month keeps the same height */
export function monthGrid(year: number, month: number, weekStart: number): CalendarDay[] {
  const first = weekOf({ year, month, day: 1 }, weekStart)[0]
  return Array.from({ length: 42 }, (_, i) => addDays(first, i))
}

/** the day an entry starts on, by the same rule as a due date */
export const entryDay = (entry: Pick<CalendarEntry, 'start' | 'allDay'>): CalendarDay =>
  entry.allDay ? dueDay(entry.start) : localDayOf(entry.start)

/** whether an entry shows on a day, counting the days an all-day one covers and a timed span past midnight */
export function coversDay(entry: CalendarEntry, d: CalendarDay): boolean {
  if (entry.allDay) {
    const first = entryDay(entry)
    const target = Date.UTC(d.year, d.month, d.day)
    const begin = Date.UTC(first.year, first.month, first.day)
    return target >= begin && target < begin + entry.days * DAY_MS
  }
  const { start, end } = dayBounds(d)
  const finish = Math.max(entry.end ?? entry.start, entry.start)
  // a span that ends exactly at midnight belongs to the day before
  return entry.start < end && (finish > start || entry.start >= start)
}

/** minutes after local midnight */
export function minutesOf(ms: number): number {
  const t = new Date(ms)
  return t.getHours() * 60 + t.getMinutes()
}

export const SNAP_MINUTES = 15

/** where something was dropped: a day, and in the week grid a time; null minutes is the all-day row or a month cell */
export interface DropTarget {
  day: CalendarDay
  minutes: number | null
  /** the all-day row of the week grid, which makes a timed item whole-day; a month cell keeps its time */
  allDayRow: boolean
}

/** the new due date for a drop: a month cell keeps the time, the all-day row clears it, a slot sets it */
export function dueForDrop(current: number, target: DropTarget): number {
  if (target.minutes !== null) {
    const snapped = Math.round(target.minutes / SNAP_MINUTES) * SNAP_MINUTES
    const hours = Math.min(23, Math.floor(snapped / 60))
    const minutes = snapped >= 24 * 60 ? 45 : snapped % 60
    return moment(new Date(target.day.year, target.day.month, target.day.day, hours, minutes))
  }
  if (target.allDayRow || isAllDay(current)) return allDay(target.day)
  const time = new Date(current)
  return moment(new Date(target.day.year, target.day.month, target.day.day, time.getHours(), time.getMinutes(), time.getSeconds()))
}

export type Nudge = 'left' | 'right' | 'up' | 'down'

/** one key press of a keyboard move: a day sideways, a week up or down, or in the time grid a quarter hour */
export function nudgedDue(current: number, nudge: Nudge, inTimeGrid: boolean): number {
  if (inTimeGrid && !isAllDay(current) && (nudge === 'up' || nudge === 'down')) {
    const t = new Date(current)
    const minutes = t.getHours() * 60 + t.getMinutes()
    // to the next quarter hour, so a time off the grid lands on it
    const next = nudge === 'up'
      ? Math.ceil(minutes / SNAP_MINUTES) * SNAP_MINUTES - SNAP_MINUTES
      : Math.floor(minutes / SNAP_MINUTES) * SNAP_MINUTES + SNAP_MINUTES
    return moment(new Date(t.getFullYear(), t.getMonth(), t.getDate(), 0, next))
  }
  const day = entryDay({ start: current, allDay: isAllDay(current) })
  const by = nudge === 'left' ? -1 : nudge === 'right' ? 1 : nudge === 'up' ? -7 : 7
  return dueForDrop(current, { day: addDays(day, by), minutes: null, allDayRow: false })
}

/** the due date a new item made on a day or a slot starts with */
export function dueForNew(target: DropTarget): number {
  return target.minutes === null ? allDay(target.day) : dueForDrop(allDay(target.day), target)
}

/** 2h 10m; the month shows a day's focus as a total */
export function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000)
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m}m`
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}
