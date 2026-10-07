import { describe, expect, it } from 'vitest'
import { normalizeRenewal } from '../src/shared/renewal'
import { pruneFired, renewalNotices, type RenewalEntry } from '../src/shared/renewalWarnings'
import { allDay } from '../src/shared/dueDate'

const day = (year: number, month: number, d: number): number => allDay({ year, month, day: d })
const at = (year: number, month: number, d: number, hour: number, minute = 0): number =>
  new Date(year, month, d, hour, minute).getTime()

const entry = (meta: unknown, status = 'active'): RenewalEntry =>
  ({ id: 'r1', title: 'acme.dev', status, meta: normalizeRenewal(meta).meta })

/** runs the sweep at each instant in turn, remembering what it sent, as main does */
function sweep(e: RenewalEntry, instants: number[]): string[] {
  const fired = new Set<string>()
  const bodies: string[] = []
  for (const now of instants) {
    const { notices, mark } = renewalNotices(e, now, fired)
    bodies.push(...notices.map(n => n.body))
    mark.forEach(k => fired.add(k))
  }
  return bodies
}

describe('warnings before it expires', () => {
  const domain = entry({ expiresAt: day(2026, 10, 20), warnAt: [30, 7, 1] })

  it('warns at nine in the morning on each threshold day, once', () => {
    expect(sweep(domain, [at(2026, 9, 21, 8, 59)])).toStrictEqual([])
    expect(sweep(domain, [at(2026, 9, 21, 9), at(2026, 9, 21, 9, 15), at(2026, 9, 22, 9)]))
      .toStrictEqual(['Expires in 30 days · Renew manually'])
  })

  it('sends only the nearest when the app was closed across several', () => {
    expect(sweep(domain, [at(2026, 10, 14, 10)])).toStrictEqual(['Expires in 6 days · Renew manually'])
    // and the ones it skipped never turn up late
    expect(sweep(domain, [at(2026, 10, 14, 10), at(2026, 10, 15, 10)])).toHaveLength(1)
  })

  it('says how it renews', () => {
    const sub = entry({ expiresAt: day(2026, 10, 20), warnAt: [7], renews: 'auto', cycle: { every: 1, unit: 'month' } })
    expect(sweep(sub, [at(2026, 10, 13, 9)])).toStrictEqual(['Expires in 7 days · Renews automatically'])
  })

  it('starts afresh for the next date once renewed', () => {
    const fired = new Set<string>()
    const first = renewalNotices(domain, at(2026, 10, 19, 9), fired)
    first.mark.forEach(k => fired.add(k))
    const renewed = entry({ expiresAt: day(2027, 10, 20), warnAt: [30, 7, 1] })
    expect(renewalNotices(renewed, at(2027, 9, 21, 9), fired).notices).toHaveLength(1)
  })

  it('warns on the day for a moment no later than the moment itself', () => {
    const cert = entry({ expiresAt: at(2026, 10, 20, 7), warnAt: [0], lookup: { source: 'tls', target: 'acme.dev' } })
    expect(sweep(cert, [at(2026, 10, 20, 6, 59)])).toStrictEqual([])
    expect(sweep(cert, [at(2026, 10, 20, 7)])).toStrictEqual(['Expires today · Renew manually'])
  })
})

describe('after it expires', () => {
  const key = entry({ expiresAt: day(2026, 9, 1), warnAt: [] })

  it('reminds once each morning for a week, then stops', () => {
    const mornings = Array.from({ length: 10 }, (_, i) => at(2026, 9, 2 + i, 9, 30))
    const bodies = sweep(key, mornings)
    expect(bodies).toHaveLength(7)
    expect(bodies[0]).toBe('Expired yesterday · Renew manually')
    expect(bodies[6]).toBe('Expired 7 days ago · Renew manually')
  })

  it('waits for the morning', () => {
    expect(sweep(key, [at(2026, 9, 2, 3)])).toStrictEqual([])
  })

  it('stays quiet for one that renews itself', () => {
    const sub = entry({ expiresAt: day(2026, 9, 1), renews: 'auto', cycle: { every: 1, unit: 'month' } })
    expect(sweep(sub, [at(2026, 9, 2, 10)])).toStrictEqual([])
  })

  it('stays quiet when cancelled or snoozed', () => {
    expect(sweep(entry({ expiresAt: day(2026, 9, 1) }, 'cancelled'), [at(2026, 9, 2, 10)])).toStrictEqual([])
    expect(renewalNotices(key, at(2026, 9, 2, 10), new Set(), at(2026, 9, 3, 10)).notices).toStrictEqual([])
  })
})

describe('date fields', () => {
  it('warns before a date of its own', () => {
    const e = entry({
      fields: [{ id: 'n', label: 'Notice period ends', type: 'date', value: day(2026, 10, 9), warn: { mode: 'before', days: [30] } }]
    })
    const [body] = sweep(e, [at(2026, 9, 10, 9)])
    expect(body).toMatch(/^Notice period ends: in 30 days, /)
  })

  it('warns once when the card ends before the renewal charges it', () => {
    const e = entry({
      expiresAt: day(2026, 11, 3),
      renews: 'auto',
      cycle: { every: 1, unit: 'month' },
      warnAt: [7, 1],
      fields: [{ id: 'c', label: 'Card ends', type: 'date', value: day(2026, 10, 1), precision: 'month', warn: { mode: 'beforeRenewal' } }]
    })
    const bodies = sweep(e, [at(2026, 10, 25, 9), at(2026, 10, 26, 9), at(2026, 11, 2, 9)])
    expect(bodies.filter(b => b.startsWith('Card ends'))).toHaveLength(1)
    expect(bodies.find(b => b.startsWith('Card ends'))).toMatch(/before it renews on/)
  })

  it('says nothing about a card that lasts past the renewal', () => {
    const e = entry({
      expiresAt: day(2026, 10, 15),
      warnAt: [7],
      fields: [{ id: 'c', label: 'Card ends', type: 'date', value: day(2026, 10, 1), precision: 'month', warn: { mode: 'beforeRenewal' } }]
    })
    // the card runs to the end of November, after the 15th
    expect(sweep(e, [at(2026, 10, 8, 9)]).filter(b => b.startsWith('Card ends'))).toStrictEqual([])
  })
})

describe('forgetting what was sent', () => {
  it('drops keys of deleted renewals and very old ones', () => {
    const now = at(2027, 0, 1, 9)
    const pruned = pruneFired(
      { 'r1:expiry:1:7': now - 1000, 'r1:expiry:0:30': now - 500 * 86_400_000, 'gone:expiry:1:7': now },
      new Set(['r1']),
      now
    )
    expect(Object.keys(pruned)).toStrictEqual(['r1:expiry:1:7'])
  })
})
