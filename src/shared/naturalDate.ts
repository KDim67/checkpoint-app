/**
 * Dates written the way people type them.
 *
 * Quick capture already understood `- task`, `#tag`, `@context` and `!priority`;
 * a due date was the one thing you still had to go and set by hand afterwards,
 * which defeats the point of a capture bar.
 *
 * Deliberately a small, predictable grammar rather than a general date library.
 * Everything it recognises is listed in RECOGNISED below and can be explained in
 * one line, a parser that quietly matches more than the user expects is worse
 * than one that matches less, because it silently dates things that were not
 * meant to be dated.
 *
 * All arithmetic is local time, for the same reason the recurrence rules are:
 * "tomorrow 3pm" means 3pm where the person typing it is sitting.
 */

export interface ParsedDate {
  /** Epoch milliseconds, or null when the text carried no date. */
  dueAt: number | null
  /** The input with the date phrase removed. */
  cleanedText: string
  /** What was matched, for showing back to the user. */
  matched: string | null
}

/** The hour used when a day is given without a time. */
const DEFAULT_HOUR = 9

const WEEKDAYS: Record<string, number> = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3,
  thursday: 4, thu: 4, thurs: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6
}

/** Everything the parser will match, for the UI hint and for the tests. */
export const RECOGNISED = [
  'today', 'tonight', 'tomorrow', 'next week',
  'monday … sunday (and mon, tue, …)', 'next monday …',
  'in 2 days', 'in 3 weeks', 'in 4 hours',
  '3pm', '15:30', 'at 9am'
]

const startOfDay = (d: Date): Date => {
  const out = new Date(d)
  out.setHours(0, 0, 0, 0)
  return out
}

const addDays = (d: Date, n: number): Date => {
  const out = new Date(d)
  out.setDate(out.getDate() + n)
  return out
}

interface TimeMatch {
  hours: number
  minutes: number
  source: string
}

/**
 * Finds a clock time.
 *
 * Requires either am/pm or a colon: a bare number is far more often part of the
 * task ("upgrade to 18") than a time, and guessing wrong silently dates things.
 */
function findTime(text: string): TimeMatch | null {
  const meridiem = /\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i.exec(text)
  if (meridiem) {
    let hours = parseInt(meridiem[1], 10)
    if (hours > 12) return null
    const minutes = meridiem[2] ? parseInt(meridiem[2], 10) : 0
    if (minutes > 59) return null
    const pm = meridiem[3].toLowerCase() === 'pm'
    if (hours === 12) hours = 0
    return { hours: pm ? hours + 12 : hours, minutes, source: meridiem[0] }
  }

  const twentyFour = /\b(?:at\s+)?([01]?\d|2[0-3]):([0-5]\d)\b/.exec(text)
  if (twentyFour) {
    return {
      hours: parseInt(twentyFour[1], 10),
      minutes: parseInt(twentyFour[2], 10),
      source: twentyFour[0]
    }
  }
  return null
}

interface DayMatch {
  date: Date
  source: string
  /** True when the phrase itself implied a time, so the default is not applied. */
  impliedTime: boolean
}

/** Finds the day being referred to, relative to `now`. */
function findDay(text: string, now: Date): DayMatch | null {
  const relative = /\bin\s+(\d{1,3})\s+(minute|hour|day|week)s?\b/i.exec(text)
  if (relative) {
    const amount = parseInt(relative[1], 10)
    const unit = relative[2].toLowerCase()
    const date = new Date(now)
    if (unit === 'minute') date.setMinutes(date.getMinutes() + amount)
    else if (unit === 'hour') date.setHours(date.getHours() + amount)
    else if (unit === 'day') date.setDate(date.getDate() + amount)
    else date.setDate(date.getDate() + amount * 7)
    // "in 2 hours" already names a moment; "in 2 days" does not.
    return { date, source: relative[0], impliedTime: unit === 'minute' || unit === 'hour' }
  }

  const tonight = /\btonight\b/i.exec(text)
  if (tonight) {
    const date = startOfDay(now)
    date.setHours(20, 0, 0, 0)
    return { date, source: tonight[0], impliedTime: true }
  }

  const today = /\btoday\b/i.exec(text)
  if (today) return { date: startOfDay(now), source: today[0], impliedTime: false }

  const tomorrow = /\b(tomorrow|tmr)\b/i.exec(text)
  if (tomorrow) return { date: startOfDay(addDays(now, 1)), source: tomorrow[0], impliedTime: false }

  // Checked before the bare weekday so "next monday" is not read as "monday".
  const nextWeekday = new RegExp(`\\bnext\\s+(${Object.keys(WEEKDAYS).join('|')})\\b`, 'i').exec(text)
  if (nextWeekday) {
    const target = WEEKDAYS[nextWeekday[1].toLowerCase()]
    let ahead = (target - now.getDay() + 7) % 7
    // "next Friday" said on a Friday means the one after, never today.
    ahead = ahead === 0 ? 7 : ahead
    return { date: startOfDay(addDays(now, ahead + 7 > 13 ? ahead : ahead + 7)), source: nextWeekday[0], impliedTime: false }
  }

  const nextWeek = /\bnext\s+week\b/i.exec(text)
  if (nextWeek) return { date: startOfDay(addDays(now, 7)), source: nextWeek[0], impliedTime: false }

  const weekday = new RegExp(`\\b(${Object.keys(WEEKDAYS).join('|')})\\b`, 'i').exec(text)
  if (weekday) {
    const target = WEEKDAYS[weekday[1].toLowerCase()]
    // Includes today: "standup friday" said on Friday means this morning's.
    const ahead = (target - now.getDay() + 7) % 7
    return { date: startOfDay(addDays(now, ahead)), source: weekday[0], impliedTime: false }
  }

  return null
}

/** Collapses the whitespace left where a phrase was removed. */
const tidy = (text: string): string => text.replace(/\s{2,}/g, ' ').trim()

/**
 * Pulls a due date out of free text.
 *
 * A time on its own is accepted and taken to mean today, "review notes at 4pm"
 * is a complete thought. If that moment has already passed, it rolls to
 * tomorrow, because nobody sets a reminder for the past.
 */
export function parseNaturalDate(input: string, now: number = Date.now()): ParsedDate {
  const text = input ?? ''
  if (!text.trim()) return { dueAt: null, cleanedText: '', matched: null }

  const reference = new Date(now)
  const day = findDay(text, reference)
  const time = findTime(day ? text.replace(day.source, ' ') : text)

  if (!day && !time) return { dueAt: null, cleanedText: text.trim(), matched: null }

  let due: Date
  if (day) {
    due = new Date(day.date)
    if (time) due.setHours(time.hours, time.minutes, 0, 0)
    else if (!day.impliedTime) due.setHours(DEFAULT_HOUR, 0, 0, 0)
  } else {
    due = startOfDay(reference)
    due.setHours(time!.hours, time!.minutes, 0, 0)
    // A bare time that has already gone means the next one.
    if (due.getTime() <= now) due = addDays(due, 1)
  }

  let cleaned = text
  const parts: string[] = []
  if (day) {
    cleaned = cleaned.replace(day.source, ' ')
    parts.push(day.source.trim())
  }
  if (time) {
    cleaned = cleaned.replace(time.source, ' ')
    parts.push(time.source.trim())
  }

  return { dueAt: due.getTime(), cleanedText: tidy(cleaned), matched: parts.join(' ') }
}

/** Short label for the pill shown while typing. */
export function describeDue(dueAt: number, now: number = Date.now()): string {
  const due = new Date(dueAt)
  const days = Math.round((startOfDay(due).getTime() - startOfDay(new Date(now)).getTime()) / 86_400_000)
  const time = due.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })

  if (days === 0) return `today ${time}`
  if (days === 1) return `tomorrow ${time}`
  if (days > 1 && days < 7) {
    return `${due.toLocaleDateString(undefined, { weekday: 'long' })} ${time}`
  }
  return `${due.toLocaleDateString()} ${time}`
}
