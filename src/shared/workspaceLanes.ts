/** a workspace's lane on the Workspaces page: what main read, laid out over the days around today where the boundaries can be tested */

import { DAY_MS, dueDay, isDueToday, isOverdue, localDayOf, type CalendarDay } from './dueDate'

export interface DatedItem {
  id: string
  type: 'card' | 'task'
  title: string
  due: number
}

export interface FocusSpan {
  /** when the session ended */
  at: number
  ms: number
}

export interface LastChange {
  id: string
  type: 'card' | 'task' | 'log'
  title: string
  at: number
}

/** one workspace as main reads it: open work, the dates that matter around now, recent focus and the last thing changed */
export interface WorkspaceActivity {
  /** open cards and tasks, the way the tray counts them */
  open: number
  /** open cards and tasks with a date: every late one, and the ones due in the days ahead */
  dated: DatedItem[]
  focus: FocusSpan[]
  lastChanged: LastChange | null
}

export type ActivityBySlug = Record<string, WorkspaceActivity>

export const PAST_DAYS = 14
export const AHEAD_DAYS = 13
export const STRIP_DAYS = PAST_DAYS + 1 + AHEAD_DAYS

/** a bar reaches full height here; one scale for every lane so they compare */
export const FOCUS_FULL_MS = 3 * 60 * 60 * 1000

export interface LaneDue {
  id: string
  type: DatedItem['type']
  title: string
  late: boolean
}

export interface LaneDay {
  day: CalendarDay
  /** days from today, negative before it */
  offset: number
  focusMs: number
  due: LaneDue[]
}

export interface Lane {
  days: LaneDay[]
  /** late longer ago than the strip reaches */
  olderLate: number
  open: number
  late: number
  /** still on time today; the late ones are counted above, as the tray does */
  dueToday: number
  focusWeekMs: number
  lastChanged: LastChange | null
}

const NOTHING: WorkspaceActivity = { open: 0, dated: [], focus: [], lastChanged: null }

/** whole calendar days from one date to another, whatever the clocks did in between */
function daysBetween(from: CalendarDay, to: CalendarDay): number {
  return Math.round((Date.UTC(to.year, to.month, to.day) - Date.UTC(from.year, from.month, from.day)) / DAY_MS)
}

function shifted(day: CalendarDay, by: number): CalendarDay {
  const d = new Date(day.year, day.month, day.day + by)
  return { year: d.getFullYear(), month: d.getMonth(), day: d.getDate() }
}

/** local midnight on the day this week began; weekStart counts as Date does, 0 for Sunday */
export function weekBegan(now: number, weekStart: number): number {
  const today = new Date(now)
  const back = (today.getDay() - weekStart + 7) % 7
  return new Date(today.getFullYear(), today.getMonth(), today.getDate() - back).getTime()
}

export function laneOf(activity: WorkspaceActivity | undefined, now: number, weekStart: number): Lane {
  const { open, dated, focus, lastChanged } = activity ?? NOTHING
  const today = localDayOf(now)
  const days: LaneDay[] = Array.from({ length: STRIP_DAYS }, (_, i) => ({
    day: shifted(today, i - PAST_DAYS),
    offset: i - PAST_DAYS,
    focusMs: 0,
    due: []
  }))

  let olderLate = 0
  let late = 0
  let dueToday = 0
  for (const item of dated) {
    const isLate = isOverdue(item.due, now)
    if (isLate) late++
    else if (isDueToday(item.due, now)) dueToday++
    const offset = daysBetween(today, dueDay(item.due))
    if (offset < -PAST_DAYS) {
      if (isLate) olderLate++
      continue
    }
    if (offset > AHEAD_DAYS) continue
    days[offset + PAST_DAYS].due.push({ id: item.id, type: item.type, title: item.title, late: isLate })
  }

  const weekFrom = weekBegan(now, weekStart)
  let focusWeekMs = 0
  for (const span of focus) {
    if (span.at > now) continue
    if (span.at >= weekFrom) focusWeekMs += span.ms
    const offset = daysBetween(today, localDayOf(span.at))
    if (offset >= -PAST_DAYS && offset <= 0) days[offset + PAST_DAYS].focusMs += span.ms
  }

  return { days, olderLate, open, late, dueToday, focusWeekMs, lastChanged }
}

/** a day's bar as a share of the full height */
export const focusShare = (ms: number): number => Math.min(1, Math.max(0, ms / FOCUS_FULL_MS))

const minutesOf = (ms: number): number => Math.round(ms / 60_000)

/** short, for the screen: 45m, 2h, 6h 40m */
export function formatFocus(ms: number): string {
  const minutes = minutesOf(ms)
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours === 0) return `${rest}m`
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`
}

/** in words, for a screen reader, which reads "6h" letter by letter */
export function spokenFocus(ms: number): string {
  const minutes = minutesOf(ms)
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  const unit = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`
  if (minutes === 0) return 'no focus time'
  if (hours === 0) return unit(rest, 'minute')
  return rest === 0 ? unit(hours, 'hour') : `${unit(hours, 'hour')} ${unit(rest, 'minute')}`
}

/** everything the strip shows, said out loud, since the strip itself is hidden from screen readers */
export function laneLabel(name: string, lane: Lane, { current, shared }: { current: boolean; shared: boolean }): string {
  const parts = [name]
  if (current) parts.push('current workspace')
  if (shared) parts.push('shared')
  if (lane.open === 0) parts.push('nothing open')
  else parts.push(`${lane.open} open`, `${lane.late} late`, `${lane.dueToday} due today`)
  parts.push(`${spokenFocus(lane.focusWeekMs)} this week`)
  return parts.join(', ')
}
