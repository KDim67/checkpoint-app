import { describe, it, expect } from 'vitest'
import {
  addDays,
  coversDay,
  dueForDrop,
  dueForNew,
  firstDayOfWeek,
  formatDuration,
  monthGrid,
  nudgedDue,
  weekOf,
  type CalendarEntry
} from '../src/shared/calendar'
import { allDay, isAllDay, moment } from '../src/shared/dueDate'

const entry = (over: Partial<CalendarEntry>): CalendarEntry => ({
  id: 'x', layer: 'due', title: 't', start: 0, end: null, allDay: false, days: 1, workspace: 'work',
  color: null, movable: true, state: 'open', ref: { kind: 'item', id: 'x' }, detail: null, ...over
})

describe('the calendar grid', () => {
  it('starts the week where the locale does', () => {
    expect(firstDayOfWeek('en-US')).toBe(0)
    expect(firstDayOfWeek('en-GB')).toBe(1)
    expect(firstDayOfWeek('not a locale at all')).toBe(1)
  })

  it('finds the week a day sits in', () => {
    // 14 Oct 2026 is a Wednesday
    expect(weekOf({ year: 2026, month: 9, day: 14 }, 1).map(d => d.day)).toStrictEqual([12, 13, 14, 15, 16, 17, 18])
    expect(weekOf({ year: 2026, month: 9, day: 14 }, 0).map(d => d.day)).toStrictEqual([11, 12, 13, 14, 15, 16, 17])
  })

  it('gives every month six whole weeks, starting before the 1st when it has to', () => {
    const grid = monthGrid(2026, 9, 1)
    expect(grid).toHaveLength(42)
    expect(grid[0]).toStrictEqual({ year: 2026, month: 8, day: 28 })
    expect(grid[41]).toStrictEqual({ year: 2026, month: 10, day: 8 })
  })

  it('steps days through the calendar, so a clock change never skips one', () => {
    expect(addDays({ year: 2026, month: 2, day: 28 }, 1)).toStrictEqual({ year: 2026, month: 2, day: 29 })
    expect(addDays({ year: 2026, month: 9, day: 24 }, 2)).toStrictEqual({ year: 2026, month: 9, day: 26 })
    expect(addDays({ year: 2026, month: 0, day: 1 }, -1)).toStrictEqual({ year: 2025, month: 11, day: 31 })
  })
})

describe('which days an entry shows on', () => {
  it('covers each day of a whole-day entry that spans several', () => {
    const e = entry({ allDay: true, start: Date.UTC(2026, 9, 12), days: 3 })
    expect([11, 12, 13, 14, 15].map(day => coversDay(e, { year: 2026, month: 9, day }))).toStrictEqual([false, true, true, true, false])
  })

  it('shows a span on both days when it runs past midnight, and not on a day it only ends at', () => {
    const overnight = entry({ start: new Date(2026, 9, 12, 23).getTime(), end: new Date(2026, 9, 13, 1).getTime() })
    expect(coversDay(overnight, { year: 2026, month: 9, day: 12 })).toBe(true)
    expect(coversDay(overnight, { year: 2026, month: 9, day: 13 })).toBe(true)
    const toMidnight = entry({ start: new Date(2026, 9, 12, 22).getTime(), end: new Date(2026, 9, 13).getTime() })
    expect(coversDay(toMidnight, { year: 2026, month: 9, day: 13 })).toBe(false)
  })
})

describe('dropping something on a new day or time', () => {
  const day = { year: 2026, month: 9, day: 20 }

  it('keeps a whole-day item whole-day on a month cell', () => {
    expect(dueForDrop(allDay({ year: 2026, month: 9, day: 1 }), { day, minutes: null, allDayRow: false })).toBe(allDay(day))
  })

  it('keeps a timed item\'s time on a month cell', () => {
    const due = dueForDrop(new Date(2026, 9, 1, 14, 30).getTime(), { day, minutes: null, allDayRow: false })
    expect(due).toBe(new Date(2026, 9, 20, 14, 30).getTime())
  })

  it('makes it whole-day on the week\'s all-day row', () => {
    expect(dueForDrop(new Date(2026, 9, 1, 14, 30).getTime(), { day, minutes: null, allDayRow: true })).toBe(allDay(day))
  })

  it('gives it the slot\'s time, snapped to a quarter hour, and never midnight UTC by accident', () => {
    expect(dueForDrop(allDay(day), { day, minutes: 9 * 60 + 7, allDayRow: false })).toBe(new Date(2026, 9, 20, 9, 0).getTime())
    expect(dueForDrop(allDay(day), { day, minutes: 9 * 60 + 8, allDayRow: false })).toBe(new Date(2026, 9, 20, 9, 15).getTime())
    expect(dueForDrop(allDay(day), { day, minutes: 24 * 60 - 1, allDayRow: false })).toBe(new Date(2026, 9, 20, 23, 45).getTime())
    for (let m = 0; m < 24 * 60; m += 15) expect(isAllDay(dueForDrop(allDay(day), { day, minutes: m, allDayRow: false }))).toBe(false)
  })

  it('starts something new as the day it was made on, or the slot', () => {
    expect(dueForNew({ day, minutes: null, allDayRow: false })).toBe(allDay(day))
    expect(dueForNew({ day, minutes: 600, allDayRow: false })).toBe(new Date(2026, 9, 20, 10, 0).getTime())
  })
})

describe('focus totals', () => {
  it('read the way a person says them', () => {
    expect(formatDuration(25 * 60_000)).toBe('25m')
    expect(formatDuration(2 * 3_600_000)).toBe('2h')
    expect(formatDuration(130 * 60_000)).toBe('2h 10m')
  })
})

describe('moving from the keyboard', () => {
  const at = (d: number, h: number, m = 0) => moment(new Date(2026, 9, d, h, m))

  it('goes a day sideways and a week up or down, keeping a time or a whole day', () => {
    expect(nudgedDue(at(14, 9, 30), 'right', false)).toBe(at(15, 9, 30))
    expect(nudgedDue(at(14, 9, 30), 'up', false)).toBe(at(7, 9, 30))
    expect(nudgedDue(allDay({ year: 2026, month: 9, day: 31 }), 'right', false)).toBe(allDay({ year: 2026, month: 10, day: 1 }))
    expect(nudgedDue(allDay({ year: 2026, month: 9, day: 14 }), 'down', false)).toBe(allDay({ year: 2026, month: 9, day: 21 }))
  })

  it('in the time grid goes a quarter hour up or down, onto the grid first', () => {
    expect(nudgedDue(at(14, 9), 'up', true)).toBe(at(14, 8, 45))
    expect(nudgedDue(at(14, 9, 7), 'up', true)).toBe(at(14, 9))
    expect(nudgedDue(at(14, 9, 7), 'down', true)).toBe(at(14, 9, 15))
    expect(nudgedDue(at(14, 0), 'up', true)).toBe(at(13, 23, 45))
    expect(nudgedDue(at(14, 9), 'left', true)).toBe(at(13, 9))
  })
})
