import { describe, it, expect } from 'vitest'
import { byDay, cellSlots, inTimeGrid, laneRow, placeTimed, rangeOf, step, titleOf, visibleDays } from '../src/renderer/src/components/calendar/layout'
import { dayKey, type CalendarEntry } from '../src/shared/calendar'
import { allDay } from '../src/shared/dueDate'
import { defined } from './helpers/defined'

const entry = (over: Partial<CalendarEntry>): CalendarEntry => ({
  id: Math.random().toString(36), layer: 'due', title: 't', start: 0, end: null, allDay: false, days: 1, workspace: 'work',
  color: null, movable: true, state: 'open', ref: { kind: 'item', id: 'x' }, detail: null, ...over
})

const oct = (day: number) => ({ year: 2026, month: 9, day })

describe('what a view shows', () => {
  it('pages by a month, a week, or a month of agenda', () => {
    expect(step('month', oct(31), 1)).toStrictEqual({ year: 2026, month: 10, day: 1 })
    expect(step('week', oct(14), -1)).toStrictEqual(oct(7))
    expect(step('agenda', oct(1), 1)).toStrictEqual(oct(31))
  })

  it('covers its days from the first midnight to the one after the last', () => {
    const days = visibleDays('week', oct(14), 1)
    expect(rangeOf(days)).toStrictEqual({ from: new Date(2026, 9, 12).getTime(), to: new Date(2026, 9, 19).getTime() })
  })

  it('names the month, or the span of a week', () => {
    expect(titleOf('month', oct(14), [], 'en-GB')).toBe('October 2026')
    expect(titleOf('week', oct(14), visibleDays('week', oct(14), 1), 'en-GB')).toBe('12 Oct to 18 Oct 2026')
  })
})

describe('putting entries on their days', () => {
  const days = visibleDays('week', oct(14), 1)
  const today = oct(14)

  it('repeats a late entry on today as well as its own day', () => {
    const late = entry({ title: 'Late', allDay: true, start: allDay(oct(12)), state: 'late' })
    const cells = byDay([late], days, today)
    expect(defined(cells.get(dayKey(oct(12)))).entries).toStrictEqual([late])
    expect(defined(cells.get(dayKey(oct(14)))).entries).toStrictEqual([late])
  })

  it('folds log entries and commits into counts, and totals focus per day across midnight', () => {
    const log = entry({ layer: 'log', start: new Date(2026, 9, 13, 10).getTime() })
    const focus = entry({ layer: 'focus', start: new Date(2026, 9, 13, 23, 30).getTime(), end: new Date(2026, 9, 14, 0, 30).getTime() })
    const cells = byDay([log, focus], days, today)
    expect(defined(cells.get(dayKey(oct(13)))).counts.log).toStrictEqual([log])
    expect(defined(cells.get(dayKey(oct(13)))).focusMs).toBe(30 * 60_000)
    expect(defined(cells.get(dayKey(oct(14)))).focusMs).toBe(30 * 60_000)
  })

  it('puts whole days first, then the rest by time', () => {
    const morning = entry({ title: 'Morning', start: new Date(2026, 9, 14, 9).getTime() })
    const whole = entry({ title: 'Whole', allDay: true, start: allDay(oct(14)) })
    expect(defined(byDay([morning, whole], days, today).get(dayKey(oct(14)))).entries.map(e => e.title)).toStrictEqual(['Whole', 'Morning'])
  })
})

describe('blocks of time in the week', () => {
  it('sets overlapping blocks side by side and lets the rest use the whole width', () => {
    const at = (h: number, m = 0) => new Date(2026, 9, 14, h, m).getTime()
    const placed = placeTimed([
      entry({ id: 'a', layer: 'events', start: at(9), end: at(10) }),
      entry({ id: 'b', layer: 'events', start: at(9, 30), end: at(10, 30) }),
      entry({ id: 'c', layer: 'events', start: at(14), end: at(15) }),
      entry({ id: 'whole', allDay: true, start: allDay(oct(14)) })
    ], oct(14))
    const byId = Object.fromEntries(placed.map(p => [p.entry.id, p]))
    expect(Object.keys(byId).sort()).toStrictEqual(['a', 'b', 'c'])
    expect([byId.a.column, byId.a.columns, byId.b.column, byId.b.columns]).toStrictEqual([0, 2, 1, 2])
    expect([byId.c.column, byId.c.columns, byId.c.top]).toStrictEqual([0, 1, 14 * 60])
  })

  it('leaves a day or longer to the all-day row, where it reads as a bar', () => {
    const at = (d: number, h: number) => new Date(2026, 9, d, h).getTime()
    expect(inTimeGrid(entry({ layer: 'events', start: at(14, 9), end: at(14, 17) }))).toBe(true)
    expect(inTimeGrid(entry({ layer: 'events', start: at(14, 9), end: at(15, 9) }))).toBe(false)
    expect(inTimeGrid(entry({ allDay: true, start: allDay(oct(14)) }))).toBe(false)
  })

  it('gives a moment with no length room to read, kept inside its own day', () => {
    const [morning] = placeTimed([entry({ start: new Date(2026, 9, 14, 9).getTime() })], oct(14))
    expect(morning.height).toBe(30)
    const [late] = placeTimed([entry({ start: new Date(2026, 9, 14, 23, 50).getTime() })], oct(14))
    expect(late.top + late.height).toBe(24 * 60)
  })
})

describe('bars across a row of days', () => {
  // Monday 12 to Sunday 18 October
  const row = visibleDays('week', oct(14), 1)
  const whole = (title: string, day: number, days = 1) => entry({ id: title, title, allDay: true, start: allDay(oct(day)), days })
  const lanesOf = (entries: CalendarEntry[], today = oct(14)) => {
    const cells = byDay(entries, row, today)
    return laneRow(row, day => defined(cells.get(dayKey(day))).entries)
  }

  it('draws an entry over several days once, as wide as the days it covers', () => {
    const [bar] = lanesOf([whole('Trip', 13, 3)])
    expect(bar).toMatchObject({ start: 1, span: 3, lane: 0, continuesBefore: false, continuesAfter: false })
  })

  it('cuts a bar square where it carries on from the week before or into the next', () => {
    const [bar] = lanesOf([whole('Conference', 9, 12)])
    expect(bar).toMatchObject({ start: 0, span: 7, continuesBefore: true, continuesAfter: true })
  })

  it('keeps each bar on one line and fills the gaps with single days', () => {
    const lanes = lanesOf([whole('Trip', 12, 3), whole('Tuesday', 13), whole('Thursday', 15)])
    const by = Object.fromEntries(lanes.map(s => [s.entry.title, s.lane]))
    expect(by).toStrictEqual({ Trip: 0, Tuesday: 1, Thursday: 0 })
  })

  it('lets a late entry stand alone on today as well as on its own day', () => {
    const late = entry({ id: 'late', title: 'Late', allDay: true, start: allDay(oct(12)), state: 'late' })
    expect(lanesOf([late]).map(s => [s.start, s.span])).toStrictEqual([[0, 1], [2, 1]])
  })

  it('keeps room under a passing bar, and counts what falls past the last lane', () => {
    const lanes = lanesOf([whole('Trip', 12, 3), whole('A', 13), whole('B', 13), whole('C', 13)])
    const { slots, hidden } = cellSlots(lanes, 1, 3)
    expect(slots.map(s => (s.kind === 'start' ? s.segment.entry.title : s.kind))).toStrictEqual(['under', 'A', 'B'])
    expect(hidden).toBe(1)
    expect(cellSlots(lanes, 0, 3).slots.map(s => s.kind)).toStrictEqual(['start'])
    expect(cellSlots(lanes, 5, 3)).toStrictEqual({ slots: [], hidden: 0 })
  })
})
