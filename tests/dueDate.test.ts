import { describe, expect, it } from 'vitest'
import {
  allDay, allDayRange, dateInputValue, daysLate, DAY_MS, dueDay, dueDeadline, dueFromText, dueIso, dueSortKey,
  formatDue, formatDueDate, fromDateInput, isAllDay, isDueToday, isOverdue, moment, remindAt, todayIso
} from '../src/shared/dueDate'

// local moments, so every check holds in whatever timezone the tests run
const at = (month: number, day: number, hour = 0, minute = 0): number => new Date(2026, month, day, hour, minute).getTime()
const oct20 = allDay({ year: 2026, month: 9, day: 20 })

describe('a day and a moment', () => {
  it('reads midnight UTC as a whole day, which is what the old picker saved', () => {
    expect(isAllDay(oct20)).toBe(true)
    expect(isAllDay(new Date('2026-10-20').getTime())).toBe(true)
    expect(isAllDay(at(9, 20, 15))).toBe(false)
  })

  it('keeps a moment from ever passing for a day', () => {
    expect(isAllDay(moment(new Date(oct20)))).toBe(false)
    expect(moment(new Date(oct20)) - oct20).toBe(1)
  })

  it('names the same date for a day wherever it is read', () => {
    expect(dueDay(oct20)).toStrictEqual({ year: 2026, month: 9, day: 20 })
    expect(dateInputValue(oct20)).toBe('2026-10-20')
  })
})

describe('when it is late', () => {
  it('keeps a day on time until the day is over here', () => {
    expect(isOverdue(oct20, at(9, 20, 23, 59))).toBe(false)
    expect(isOverdue(oct20, at(9, 21, 0, 1))).toBe(true)
    expect(dueDeadline(oct20)).toBe(new Date(2026, 9, 20, 23, 59, 59, 999).getTime())
  })

  it('makes a moment late as soon as it passes', () => {
    const due = at(9, 20, 15)
    expect(isOverdue(due, at(9, 20, 14, 59))).toBe(false)
    expect(isOverdue(due, at(9, 20, 15, 1))).toBe(true)
  })

  it('counts days late by the calendar for a day, and none on the day itself', () => {
    expect(daysLate(oct20, at(9, 20, 18))).toBe(0)
    expect(daysLate(oct20, at(9, 22, 8))).toBe(2)
    expect(daysLate(at(9, 20, 15), at(9, 21, 16))).toBe(1)
  })

  it('reminds about a day in its morning, and about a moment at the moment', () => {
    expect(remindAt(oct20)).toBe(at(9, 20, 9))
    expect(remindAt(at(9, 20, 15))).toBe(at(9, 20, 15))
  })

  it('knows what is due today', () => {
    expect(isDueToday(oct20, at(9, 20, 1))).toBe(true)
    expect(isDueToday(oct20, at(9, 21, 1))).toBe(false)
  })
})

describe('how it reads', () => {
  const now = at(9, 19, 12)

  it('says a day without a time, and a moment with one', () => {
    expect(formatDue(oct20, now)).toBe('Tomorrow')
    expect(formatDue(at(9, 19, 17), now)).toMatch(/^Today \d/)
    expect(formatDue(allDay({ year: 2026, month: 9, day: 18 }), now)).toBe('Yesterday')
  })

  it('gives the full date where "tomorrow" would go stale, and plain text for the assistant', () => {
    expect(formatDueDate(oct20)).not.toMatch(/\d:\d/)
    expect(formatDueDate(at(9, 20, 15))).toMatch(/\d:\d/)
    expect(dueIso(oct20)).toBe('2026-10-20')
    expect(dueIso(at(9, 20, 15, 5))).toBe('2026-10-20 15:05')
    expect(todayIso(at(9, 20, 0, 30))).toBe('2026-10-20')
  })
})

describe('picking from a calendar', () => {
  it('makes a whole day, or keeps the time a moment already had', () => {
    expect(fromDateInput('2026-10-20')).toBe(oct20)
    expect(fromDateInput('2026-10-22', oct20)).toBe(oct20 + 2 * DAY_MS)
    expect(fromDateInput('2026-10-22', at(9, 20, 15, 30))).toBe(at(9, 22, 15, 30))
    expect(fromDateInput('')).toBeNull()
  })
})

describe('ranges for the database', () => {
  it('lets a day due today into "today" and keeps it out of "overdue" until the day ends', () => {
    const now = at(9, 20, 10)
    const today = allDayRange(at(9, 20), new Date(2026, 9, 20, 23, 59, 59, 999).getTime())
    expect(today).toStrictEqual({ from: oct20, to: oct20 })

    const overdue = allDayRange(null, now)
    // the latest day that has already ended is yesterday
    expect(overdue).toStrictEqual({ from: null, to: oct20 - DAY_MS })
  })

  it('orders a day after the moments on it', () => {
    expect(dueSortKey(oct20)).toBeGreaterThan(dueSortKey(at(9, 20, 18)))
    expect(dueSortKey(oct20)).toBeLessThan(dueSortKey(at(9, 21, 0, 30)))
  })
})

describe('dates written as text', () => {
  it('reads a bare date as a day and a date with a time as a moment', () => {
    expect(dueFromText('2026-10-20')).toBe(oct20)
    expect(dueFromText('October 20, 2026')).toBe(oct20)
    expect(dueFromText('2026-10-20T15:00')).toBe(at(9, 20, 15))
    expect(dueFromText('')).toBeNull()
    expect(dueFromText('someday')).toBeNull()
  })
})
