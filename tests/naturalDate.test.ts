import { describe, it, expect } from 'vitest'
import { parseNaturalDate, describeDue } from '../src/shared/naturalDate'
import { defined } from './helpers/defined'

// a Wednesday, room both ways
const WED_10AM = new Date(2026, 5, 17, 10, 0, 0, 0).getTime()
const at = (ms: number | null) => (ms === null ? null : new Date(ms))

const parse = (text: string, now = WED_10AM) => parseNaturalDate(text, now)

describe('no date present', () => {
  it('leaves ordinary text alone', () => {
    const out = parse('fix the auth bug')
    expect(out.dueAt).toBeNull()
    expect(out.cleanedText).toBe('fix the auth bug')
  })

  it('handles empty input', () => {
    expect(parse('')).toEqual({ dueAt: null, cleanedText: '', matched: null })
    expect(parse('   ').dueAt).toBeNull()
  })

  it('does not fire on a word that merely contains a keyword', () => {
    // word boundaries stop "montage" matching mon
    for (const text of ['build the montage', 'satisfy the linter', 'a wednesdayish plan']) {
      expect(parse(text).dueAt, text).toBeNull()
    }
  })

  it('does not read a bare number as a time', () => {
    // usually part of the task
    expect(parse('upgrade to 18').dueAt).toBeNull()
    expect(parse('refactor 3 modules').dueAt).toBeNull()
  })
})

describe('days', () => {
  it('understands today and defaults the hour', () => {
    const out = parse('write it up today')
    const due = defined(at(out.dueAt))
    expect(due.getDate()).toBe(17)
    expect(due.getHours()).toBe(9)
    expect(out.cleanedText).toBe('write it up')
  })

  it('understands tomorrow', () => {
    expect(defined(at(parse('ship it tomorrow').dueAt)).getDate()).toBe(18)
    expect(defined(at(parse('ship it tmr').dueAt)).getDate()).toBe(18)
  })

  it('gives tonight an evening hour rather than the default', () => {
    expect(defined(at(parse('deploy tonight').dueAt)).getHours()).toBe(20)
  })

  it('understands next week', () => {
    expect(defined(at(parse('review next week').dueAt)).getDate()).toBe(24)
  })
})

describe('weekdays', () => {
  it('finds the coming occurrence', () => {
    // Wed 17th, Friday is the 19th
    expect(defined(at(parse('standup friday').dueAt)).getDate()).toBe(19)
  })

  it('treats the current weekday as today', () => {
    // said on Wednesday means today
    expect(defined(at(parse('standup wednesday').dueAt)).getDate()).toBe(17)
  })

  it('wraps into the following week for a day already passed', () => {
    // Monday was the 15th, next is the 22nd
    expect(defined(at(parse('review monday').dueAt)).getDate()).toBe(22)
  })

  it('accepts short forms', () => {
    expect(defined(at(parse('call fri').dueAt)).getDate()).toBe(19)
    expect(defined(at(parse('call thurs').dueAt)).getDate()).toBe(18)
  })

  it('reads "next friday" as the one after the coming one', () => {
    const out = defined(at(parse('retro next friday').dueAt))
    expect(out.getDay()).toBe(5)
    expect(out.getDate()).toBeGreaterThan(19)
  })

  it('is checked before the bare weekday, so "next monday" is not "monday"', () => {
    const bare = defined(at(parse('x monday').dueAt))
    const next = defined(at(parse('x next monday').dueAt))
    expect(next.getTime()).toBeGreaterThan(bare.getTime())
  })
})

describe('relative offsets', () => {
  it('understands days and weeks', () => {
    expect(defined(at(parse('follow up in 3 days').dueAt)).getDate()).toBe(20)
    expect(defined(at(parse('follow up in 2 weeks').dueAt)).getDate()).toBe(1)
  })

  it('keeps the clock time for hours and minutes', () => {
    // names a moment, no 9am default
    const out = defined(at(parse('check in 4 hours').dueAt))
    expect(out.getHours()).toBe(14)
    expect(defined(at(parse('ping in 30 minutes').dueAt)).getMinutes()).toBe(30)
  })

  it('strips the phrase from the text', () => {
    expect(parse('follow up in 3 days').cleanedText).toBe('follow up')
  })
})

describe('times', () => {
  it('understands 12-hour and 24-hour forms', () => {
    expect(defined(at(parse('call tomorrow 3pm').dueAt)).getHours()).toBe(15)
    expect(defined(at(parse('call tomorrow at 9am').dueAt)).getHours()).toBe(9)
    expect(defined(at(parse('call tomorrow 15:30').dueAt)).getMinutes()).toBe(30)
  })

  it('maps midnight and noon correctly', () => {
    expect(defined(at(parse('x tomorrow 12am').dueAt)).getHours()).toBe(0)
    expect(defined(at(parse('x tomorrow 12pm').dueAt)).getHours()).toBe(12)
  })

  it('accepts the date and time in either order', () => {
    const a = parse('call 3pm tomorrow').dueAt
    const b = parse('call tomorrow 3pm').dueAt
    expect(a).toBe(b)
  })

  it('takes a bare time as today', () => {
    const out = defined(at(defined(parse('review at 4pm')).dueAt))
    expect(out.getDate()).toBe(17)
    expect(out.getHours()).toBe(16)
  })

  it('rolls a bare time that has already passed to tomorrow', () => {
    // nobody sets a reminder for the past
    const out = defined(at(parse('review at 8am').dueAt))
    expect(out.getDate()).toBe(18)
  })

  it('rejects an impossible clock time', () => {
    expect(parse('bump to 25pm').dueAt).toBeNull()
  })

  it('removes both parts from the text', () => {
    expect(parse('call the vendor tomorrow at 3pm').cleanedText).toBe('call the vendor')
  })
})

describe('cleaned text', () => {
  it('collapses the gap a removed phrase leaves behind', () => {
    expect(parse('email tomorrow the report').cleanedText).toBe('email the report')
  })

  it('leaves the other capture syntax untouched', () => {
    // the HUD parses these, the date parser mustn't eat them
    const out = parse('- fix login #auth @web !high tomorrow')
    expect(out.cleanedText).toBe('- fix login #auth @web !high')
    expect(out.dueAt).not.toBeNull()
  })

  it('reports what it matched', () => {
    expect(parse('ship tomorrow 3pm').matched).toBe('tomorrow 3pm')
    expect(parse('ship it').matched).toBeNull()
  })
})

describe('describeDue', () => {
  it('names today and tomorrow', () => {
    expect(describeDue(new Date(2026, 5, 17, 15, 0).getTime(), WED_10AM)).toContain('today')
    expect(describeDue(new Date(2026, 5, 18, 15, 0).getTime(), WED_10AM)).toContain('tomorrow')
  })

  it('uses the weekday within the week', () => {
    expect(describeDue(new Date(2026, 5, 19, 15, 0).getTime(), WED_10AM)).toContain('Friday')
  })

  it('falls back to a date further out', () => {
    expect(describeDue(new Date(2026, 6, 30, 15, 0).getTime(), WED_10AM)).toMatch(/\d/)
  })
})
