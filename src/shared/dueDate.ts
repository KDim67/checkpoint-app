/**
 * a due date is a day or a moment, held in the one number the database already has. A day is midnight
 * UTC of its date, which is what the date picker always saved, so it names the same calendar day in every
 * timezone and older dates need no change; any other number is a moment, read in local time
 */

export const DAY_MS = 86_400_000

/** a calendar date, month from 0 as Date counts them */
export interface CalendarDay {
  year: number
  month: number
  day: number
}

export const isAllDay = (ms: number): boolean => ms % DAY_MS === 0

/** that date as a whole day */
export const allDay = (d: CalendarDay): number => Date.UTC(d.year, d.month, d.day)

/** a moment; nudged a millisecond off midnight UTC, the one instant that would read back as a whole day */
export function moment(date: Date): number {
  const ms = date.getTime()
  return isAllDay(ms) ? ms + 1 : ms
}

/** the local date a moment falls on */
export function localDayOf(ms: number): CalendarDay {
  const d = new Date(ms)
  return { year: d.getFullYear(), month: d.getMonth(), day: d.getDate() }
}

/** the date it is due on: its own for a day, the local one for a moment */
export function dueDay(ms: number): CalendarDay {
  if (!isAllDay(ms)) return localDayOf(ms)
  const d = new Date(ms)
  return { year: d.getUTCFullYear(), month: d.getUTCMonth(), day: d.getUTCDate() }
}

const endOfLocalDay = (d: CalendarDay): number => new Date(d.year, d.month, d.day, 23, 59, 59, 999).getTime()

/** the moment it becomes late: the end of its day here, or the moment itself */
export function dueDeadline(ms: number): number {
  return isAllDay(ms) ? endOfLocalDay(dueDay(ms)) : ms
}

/** a day stays on time until it is over; a moment is late once it passes */
export const isOverdue = (ms: number, now: number = Date.now()): boolean => now > dueDeadline(ms)

const sameDay = (a: CalendarDay, b: CalendarDay): boolean => a.year === b.year && a.month === b.month && a.day === b.day

export const isDueToday = (ms: number, now: number = Date.now()): boolean => sameDay(dueDay(ms), localDayOf(now))

/** the morning a day's reminder goes out */
export const REMIND_HOUR = 9

/** when to remind: the morning of the day, or the moment itself */
export function remindAt(ms: number): number {
  if (!isAllDay(ms)) return ms
  const d = dueDay(ms)
  return new Date(d.year, d.month, d.day, REMIND_HOUR, 0, 0, 0).getTime()
}

/** whole days late, none on the day itself or before it */
export function daysLate(ms: number, now: number = Date.now()): number {
  if (isAllDay(ms)) return Math.max(0, Math.round((allDay(localDayOf(now)) - ms) / DAY_MS))
  return Math.max(0, Math.floor((now - ms) / DAY_MS))
}

const timeOf = (ms: number): string => new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })

/** a day's date in the reader's own words, as a local date so the locale formats it */
const dateWords = (d: CalendarDay, options: Intl.DateTimeFormatOptions): string =>
  new Date(d.year, d.month, d.day).toLocaleDateString(undefined, options)

/** near dates by name, "Today", "Tomorrow 3:00 PM", "Fri"; the rest as a date; a day carries no time */
export function formatDue(ms: number, now: number = Date.now()): string {
  const day = dueDay(ms)
  const offset = Math.round((allDay(day) - allDay(localDayOf(now))) / DAY_MS)
  const thisYear = day.year === localDayOf(now).year
  const name = offset === 0 ? 'Today'
    : offset === 1 ? 'Tomorrow'
    : offset === -1 ? 'Yesterday'
    : offset > 1 && offset < 7 ? dateWords(day, { weekday: 'short' })
    : dateWords(day, thisYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' })
  return isAllDay(ms) ? name : `${name} ${timeOf(ms)}`
}

/** the full date, for history and exports that are read later, when "Tomorrow" would be wrong */
export function formatDueDate(ms: number): string {
  const words = dateWords(dueDay(ms), { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
  return isAllDay(ms) ? words : `${words} ${timeOf(ms)}`
}

const pad = (n: number): string => String(n).padStart(2, '0')
const isoDay = (d: CalendarDay): string => `${d.year}-${pad(d.month + 1)}-${pad(d.day)}`

/** 2026-10-20, or 2026-10-20 15:00 with a time, for the assistant and plain-text exports */
export function dueIso(ms: number): string {
  if (isAllDay(ms)) return isoDay(dueDay(ms))
  const d = new Date(ms)
  return `${isoDay(localDayOf(ms))} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** today in local time, the date toISOString gets wrong for hours either side of midnight */
export const todayIso = (now: number = Date.now()): string => isoDay(localDayOf(now))

/** what a date input shows for it */
export const dateInputValue = (ms: number | null): string => (ms === null ? '' : isoDay(dueDay(ms)))

/** a day picked from a calendar: a whole day, or the same time on the new day when it had one */
export function fromDateInput(value: string, current: number | null = null): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!m) return null
  const day = { year: Number(m[1]), month: Number(m[2]) - 1, day: Number(m[3]) }
  if (current === null || isAllDay(current)) return allDay(day)
  const kept = new Date(current)
  return moment(new Date(day.year, day.month, day.day, kept.getHours(), kept.getMinutes(), 0, 0))
}

const pickedDay = (value: string): CalendarDay | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  return m ? { year: Number(m[1]), month: Number(m[2]) - 1, day: Number(m[3]) } : null
}

/** a filter's "from" day, as the first moment of it here */
export function dayStart(value: string): number | null {
  const d = pickedDay(value)
  return d ? new Date(d.year, d.month, d.day).getTime() : null
}

/** a filter's "to" day, as the last moment of it here, so the whole day is in */
export function dayEnd(value: string): number | null {
  const d = pickedDay(value)
  return d ? endOfLocalDay(d) : null
}

/**
 * a range of moments, as the dates a whole-day due must fall between for its deadline to land inside it;
 * the database compares days and moments apart with these
 */
export function allDayRange(start: number | null | undefined, end: number | null | undefined): { from: number | null; to: number | null } {
  const from = start === null || start === undefined ? null : allDay(localDayOf(start))
  let to: number | null = null
  if (end !== null && end !== undefined) {
    const day = localDayOf(end)
    // a day only counts once it is over by the end of the range
    to = end >= endOfLocalDay(day) ? allDay(day) : allDay(day) - DAY_MS
  }
  return { from, to }
}

/** an order that puts a whole day at the end of its day, after the moments on it */
export const dueSortKey = (ms: number): number => dueDeadline(ms)

/** text from an import or the assistant: a bare date is a day, a date with a time is a moment */
export function dueFromText(text: string): number | null {
  const t = (text ?? '').trim()
  if (!t) return null
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t)
  if (iso) return allDay({ year: Number(iso[1]), month: Number(iso[2]) - 1, day: Number(iso[3]) })
  const parsed = Date.parse(t)
  if (!Number.isFinite(parsed)) return null
  // no time written, "October 20, 2026" names a day, not midnight here
  if (!/\d:\d|T\d/i.test(t)) return allDay(localDayOf(parsed))
  return parsed
}
