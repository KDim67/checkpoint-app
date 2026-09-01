import { describe, it, expect } from 'vitest'
import {
  normalizeRule,
  nextOccurrence,
  describeRule,
  type RecurrenceRule
} from '../src/shared/recurrence'

/** Local-time constructor, so the tests mean the same thing the rules do. */
const at = (y: number, m: number, d: number, h = 9, min = 0) =>
  new Date(y, m - 1, d, h, min, 0, 0).getTime()

const show = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString().slice(0, 16))

const rule = (over: Partial<RecurrenceRule> = {}): RecurrenceRule => ({
  freq: 'daily',
  interval: 1,
  byWeekday: [],
  startAt: at(2026, 1, 1),
  untilAt: null,
  ...over
})

describe('normalizeRule', () => {
  it('accepts a well-formed rule', () => {
    expect(normalizeRule({ freq: 'daily', interval: 2, startAt: at(2026, 1, 1) })).toMatchObject({
      freq: 'daily',
      interval: 2
    })
  })

  it('rejects an unusable frequency or start', () => {
    expect(normalizeRule({ freq: 'hourly', startAt: at(2026, 1, 1) })).toBeNull()
    expect(normalizeRule({ freq: 'daily' })).toBeNull()
    expect(normalizeRule({ freq: 'daily', startAt: 0 })).toBeNull()
    expect(normalizeRule(null)).toBeNull()
  })

  it('rejects a window that closes before it opens', () => {
    // Such a rule could never fire; creating it would look like it worked.
    expect(normalizeRule({ freq: 'daily', startAt: at(2026, 5, 1), untilAt: at(2026, 1, 1) })).toBeNull()
  })

  it('forces the interval to a sane positive number', () => {
    expect(normalizeRule({ freq: 'daily', interval: 0, startAt: at(2026, 1, 1) })?.interval).toBe(1)
    expect(normalizeRule({ freq: 'daily', interval: -5, startAt: at(2026, 1, 1) })?.interval).toBe(1)
    expect(normalizeRule({ freq: 'daily', interval: 'x', startAt: at(2026, 1, 1) })?.interval).toBe(1)
    expect(normalizeRule({ freq: 'daily', interval: 10_000, startAt: at(2026, 1, 1) })?.interval).toBe(365)
  })

  it('cleans, dedupes and sorts weekdays', () => {
    const out = normalizeRule({ freq: 'weekly', startAt: at(2026, 1, 1), byWeekday: [5, 1, 1, 9, -2, 3] })
    expect(out?.byWeekday).toEqual([1, 3, 5])
  })

  it('drops weekdays on rules where they would mean nothing', () => {
    expect(normalizeRule({ freq: 'daily', startAt: at(2026, 1, 1), byWeekday: [1, 2] })?.byWeekday).toEqual([])
    expect(normalizeRule({ freq: 'monthly', startAt: at(2026, 1, 1), byWeekday: [1] })?.byWeekday).toEqual([])
  })
})

describe('nextOccurrence, daily', () => {
  it('returns the start when it is still ahead', () => {
    const r = rule({ startAt: at(2026, 6, 1) })
    expect(show(nextOccurrence(r, at(2026, 5, 1)))).toBe(show(at(2026, 6, 1)))
  })

  it('is exclusive, so asking again from an occurrence moves forward', () => {
    const r = rule()
    const first = nextOccurrence(r, at(2026, 1, 1))
    expect(show(first)).toBe(show(at(2026, 1, 2)))
  })

  it('honours an interval', () => {
    const r = rule({ interval: 3 })
    expect(show(nextOccurrence(r, at(2026, 1, 1)))).toBe(show(at(2026, 1, 4)))
    expect(show(nextOccurrence(r, at(2026, 1, 4)))).toBe(show(at(2026, 1, 7)))
  })

  it('lands on the interval grid after a long gap, not on the gap itself', () => {
    // Started 1 Jan every 3 days; 1 Mar is day 59, so the grid gives 2 Mar.
    const r = rule({ interval: 3 })
    const next = nextOccurrence(r, at(2026, 3, 1, 12))
    const daysSinceStart = Math.round((next! - r.startAt) / 86_400_000)
    expect(daysSinceStart % 3).toBe(0)
    expect(next!).toBeGreaterThan(at(2026, 3, 1, 12))
  })

  it('keeps the anchor time of day', () => {
    const r = rule({ startAt: at(2026, 1, 1, 14, 30) })
    const next = new Date(nextOccurrence(r, at(2026, 3, 5))!)
    expect([next.getHours(), next.getMinutes()]).toEqual([14, 30])
  })

  it('stops after the end date', () => {
    const r = rule({ untilAt: at(2026, 1, 3) })
    expect(nextOccurrence(r, at(2026, 1, 3))).toBeNull()
  })
})

describe('nextOccurrence, weekly', () => {
  it('repeats on the start weekday when none are named', () => {
    const r = rule({ freq: 'weekly', startAt: at(2026, 1, 1) })
    const next = nextOccurrence(r, at(2026, 1, 1))
    expect(new Date(next!).getDay()).toBe(new Date(r.startAt).getDay())
    expect(show(next)).toBe(show(at(2026, 1, 8)))
  })

  it('fires on each named weekday', () => {
    // 1 Jan 2026 is a Thursday. Mondays and Fridays only.
    const r = rule({ freq: 'weekly', startAt: at(2026, 1, 1), byWeekday: [1, 5] })
    const first = nextOccurrence(r, at(2026, 1, 1))!
    expect(new Date(first).getDay()).toBe(5)
    const second = nextOccurrence(r, first)!
    expect(new Date(second).getDay()).toBe(1)
  })

  it('only ever returns a named weekday', () => {
    const r = rule({ freq: 'weekly', startAt: at(2026, 1, 1), byWeekday: [2, 4] })
    let cursor = at(2026, 1, 1)
    for (let i = 0; i < 12; i++) {
      cursor = nextOccurrence(r, cursor)!
      expect([2, 4]).toContain(new Date(cursor).getDay())
    }
  })

  it('honours a multi-week interval', () => {
    const r = rule({ freq: 'weekly', interval: 2, startAt: at(2026, 1, 1) })
    expect(show(nextOccurrence(r, at(2026, 1, 1)))).toBe(show(at(2026, 1, 15)))
  })
})

describe('nextOccurrence, monthly', () => {
  it('keeps the same day each month', () => {
    const r = rule({ freq: 'monthly', startAt: at(2026, 1, 15) })
    expect(show(nextOccurrence(r, at(2026, 1, 15)))).toBe(show(at(2026, 2, 15)))
  })

  it('clamps to the last day of a shorter month instead of rolling over', () => {
    // The classic bug: 31 Jan + 1 month rolls to 2 or 3 March and then every
    // later occurrence is permanently shifted.
    const r = rule({ freq: 'monthly', startAt: at(2026, 1, 31) })
    const feb = nextOccurrence(r, at(2026, 1, 31))!
    expect(new Date(feb).getMonth()).toBe(1)
    expect(new Date(feb).getDate()).toBe(28)
  })

  it('returns to the anchor day after a short month', () => {
    const r = rule({ freq: 'monthly', startAt: at(2026, 1, 31) })
    const feb = nextOccurrence(r, at(2026, 1, 31))!
    const mar = nextOccurrence(r, feb)!
    expect(new Date(mar).getDate()).toBe(31)
  })

  it('handles a leap February', () => {
    const r = rule({ freq: 'monthly', startAt: at(2024, 1, 31) })
    const feb = nextOccurrence(r, at(2024, 1, 31))!
    expect(new Date(feb).getDate()).toBe(29)
  })

  it('honours a multi-month interval', () => {
    const r = rule({ freq: 'monthly', interval: 3, startAt: at(2026, 1, 10) })
    expect(show(nextOccurrence(r, at(2026, 1, 10)))).toBe(show(at(2026, 4, 10)))
  })

  it('crosses a year boundary', () => {
    const r = rule({ freq: 'monthly', startAt: at(2026, 12, 5) })
    expect(show(nextOccurrence(r, at(2026, 12, 5)))).toBe(show(at(2027, 1, 5)))
  })
})

describe('nextOccurrence, termination', () => {
  it('never returns a time at or before the cutoff', () => {
    for (const freq of ['daily', 'weekly', 'monthly'] as const) {
      const r = rule({ freq, startAt: at(2020, 1, 1) })
      const after = at(2026, 6, 15, 13, 7)
      const next = nextOccurrence(r, after)
      expect(next, freq).not.toBeNull()
      expect(next!, freq).toBeGreaterThan(after)
    }
  })

  it('returns null once past the end for every frequency', () => {
    for (const freq of ['daily', 'weekly', 'monthly'] as const) {
      const r = rule({ freq, startAt: at(2026, 1, 1), untilAt: at(2026, 2, 1) })
      expect(nextOccurrence(r, at(2026, 3, 1)), freq).toBeNull()
    }
  })

  it('answers a far-future cutoff by jumping, not by stepping to it', () => {
    // The fast-forward is what makes this possible: a daily rule 174 years old
    // would otherwise need 63,000 steps and hit the loop guard.
    const r = rule({ startAt: at(2026, 1, 1) })
    const started = process.hrtime.bigint()
    const next = nextOccurrence(r, at(2200, 1, 1))
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6

    expect(next).not.toBeNull()
    expect(next!).toBeGreaterThan(at(2200, 1, 1))
    expect(elapsedMs).toBeLessThan(50)
  })
})

describe('describeRule', () => {
  it('reads naturally for each frequency', () => {
    expect(describeRule(rule())).toBe('Every day')
    expect(describeRule(rule({ interval: 3 }))).toBe('Every 3 days')
    expect(describeRule(rule({ freq: 'weekly' }))).toBe('Every week')
    expect(describeRule(rule({ freq: 'weekly', byWeekday: [1, 3] }))).toBe('Every Monday, Wednesday')
    expect(describeRule(rule({ freq: 'monthly', startAt: at(2026, 1, 15) }))).toBe('Monthly on day 15')
  })

  it('mentions the end date when there is one', () => {
    expect(describeRule(rule({ untilAt: at(2026, 6, 1) }))).toContain('until')
  })
})
