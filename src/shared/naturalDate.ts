/** a small grammar, not a library: overmatching silently dates things; a date alone is a whole day, with a time a moment */

import { allDay, moment } from './dueDate'

interface ParsedDate {
  /** null when no date */
  dueAt: number | null
  /** with the date phrase removed */
  cleanedText: string
  /** shown back to the user */
  matched: string | null
}

const WEEKDAYS: Record<string, number> = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3,
  thursday: 4, thu: 4, thurs: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6
}

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

/** needs am/pm or a colon, bare numbers are usually part of the task */
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
  /** so the default hour isn't applied */
  impliedTime: boolean
}

/** relative to now */
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
    // "in 2 hours" names a moment, "in 2 days" doesn't
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

  // before the bare weekday, so "next monday" isn't "monday"
  const nextWeekday = new RegExp(`\\bnext\\s+(${Object.keys(WEEKDAYS).join('|')})\\b`, 'i').exec(text)
  if (nextWeekday) {
    const target = WEEKDAYS[nextWeekday[1].toLowerCase()]
    let ahead = (target - now.getDay() + 7) % 7
    // "next Friday" on a Friday is the one after
    ahead = ahead === 0 ? 7 : ahead
    return { date: startOfDay(addDays(now, ahead + 7 > 13 ? ahead : ahead + 7)), source: nextWeekday[0], impliedTime: false }
  }

  const nextWeek = /\bnext\s+week\b/i.exec(text)
  if (nextWeek) return { date: startOfDay(addDays(now, 7)), source: nextWeek[0], impliedTime: false }

  const weekday = new RegExp(`\\b(${Object.keys(WEEKDAYS).join('|')})\\b`, 'i').exec(text)
  if (weekday) {
    const target = WEEKDAYS[weekday[1].toLowerCase()]
    // includes today
    const ahead = (target - now.getDay() + 7) % 7
    return { date: startOfDay(addDays(now, ahead)), source: weekday[0], impliedTime: false }
  }

  return null
}

/** collapses leftover whitespace */
const tidy = (text: string): string => text.replace(/\s{2,}/g, ' ').trim()

/** a bare time means today, or tomorrow if it's passed */
export function parseNaturalDate(input: string, now: number = Date.now()): ParsedDate {
  const text = input ?? ''
  if (!text.trim()) return { dueAt: null, cleanedText: '', matched: null }

  const reference = new Date(now)
  const day = findDay(text, reference)
  const time = findTime(day ? text.replace(day.source, ' ') : text)

  let due: Date
  let wholeDay = false
  if (day) {
    due = new Date(day.date)
    if (time) due.setHours(time.hours, time.minutes, 0, 0)
    else wholeDay = !day.impliedTime
  } else if (time) {
    due = startOfDay(reference)
    due.setHours(time.hours, time.minutes, 0, 0)
    // a passed bare time means the next one
    if (due.getTime() <= now) due = addDays(due, 1)
  } else {
    return { dueAt: null, cleanedText: text.trim(), matched: null }
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

  const dueAt = wholeDay
    ? allDay({ year: due.getFullYear(), month: due.getMonth(), day: due.getDate() })
    : moment(due)
  return { dueAt, cleanedText: tidy(cleaned), matched: parts.join(' ') }
}

const MONTHS: Record<string, number> = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3, may: 4,
  jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8, september: 8,
  oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11
}

/**
 * what a due-date field holds: the words above, an ISO date, or a day and a month name, with a time if given;
 * null clears it and undefined is text that isn't a date. Month names are safe here and nowhere else,
 * since "may" in a task title is a word
 */
export function parseDueText(input: string, now: number = Date.now()): number | null | undefined {
  const text = (input ?? '').trim()
  if (!text) return null

  const time = findTime(text)
  const rest = (time ? text.replace(time.source, ' ') : text).replace(/\s{2,}/g, ' ').trim()
  const at = (year: number, month: number, day: number): number | undefined => {
    const date = new Date(year, month, day, time?.hours ?? 0, time?.minutes ?? 0, 0, 0)
    // 31 feb would roll into march; that's a typo, not a date
    if (date.getMonth() !== month || date.getDate() !== day) return undefined
    return time ? moment(date) : allDay({ year, month, day })
  }

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(rest)
  if (iso) return at(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]))

  const names = Object.keys(MONTHS).join('|')
  const dayFirst = new RegExp(`^(\\d{1,2})\\s+(${names})\\.?(?:\\s+(\\d{4}))?$`, 'i').exec(rest)
  const monthFirst = new RegExp(`^(${names})\\.?\\s+(\\d{1,2})(?:,?\\s+(\\d{4}))?$`, 'i').exec(rest)
  const named = dayFirst
    ? { day: Number(dayFirst[1]), month: MONTHS[dayFirst[2].toLowerCase()], year: dayFirst[3] }
    : monthFirst
      ? { day: Number(monthFirst[2]), month: MONTHS[monthFirst[1].toLowerCase()], year: monthFirst[3] }
      : null
  if (named) {
    const reference = new Date(now)
    if (named.year) return at(Number(named.year), named.month, named.day)
    // no year and the day has passed: the next one
    const passed = new Date(reference.getFullYear(), named.month, named.day) < startOfDay(reference)
    return at(reference.getFullYear() + (passed ? 1 : 0), named.month, named.day)
  }

  return parseNaturalDate(text, now).dueAt ?? undefined
}
