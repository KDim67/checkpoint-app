import { describe, expect, it } from 'vitest'
import {
  advanceOnce,
  advancePast,
  expiryPhrase,
  formatMoney,
  needsAttention,
  normalizeRenewal,
  parseAmount,
  renewalGroup,
  renewalTotals,
  renewTo,
  RENEWAL_LIMITS,
  type RenewalMeta
} from '../src/shared/renewal'
import { allDay, dueDay, isAllDay } from '../src/shared/dueDate'

/** the value, or a failure that says it was missing */
function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('expected a value')
  return value
}

const day = (year: number, month: number, d: number): number => allDay({ year, month, day: d })
const at = (year: number, month: number, d: number, hour = 10): number => new Date(year, month, d, hour).getTime()
const monthly = { every: 1, unit: 'month' as const }
const yearly = { every: 1, unit: 'year' as const }

describe('reading a renewal', () => {
  it('falls back to defaults for junk and never throws', () => {
    for (const junk of [null, undefined, 42, 'not json', '[]', { kind: '../../etc' }]) {
      const { meta, dropped } = normalizeRenewal(junk)
      expect(meta.kind).toBe('other')
      expect(meta.expiresAt).toBeNull()
      expect(meta.fields).toStrictEqual([])
      expect(dropped).toBe(0)
    }
  })

  it('drops broken, duplicate and surplus fields and counts them', () => {
    const fields = [
      { id: 'a', label: 'Cost', type: 'money', value: { amount: 1250, currency: 'eur' } },
      { id: 'a', label: 'Again', type: 'text', value: 'x' },
      { id: 'b', label: 'Mystery', type: 'hologram', value: 1 },
      'nonsense',
      ...Array.from({ length: 40 }, (_, i) => ({ id: `t${i}`, label: 'Note', type: 'text', value: '' }))
    ]
    const { meta, dropped } = normalizeRenewal({ fields })
    expect(meta.fields).toHaveLength(RENEWAL_LIMITS.fields)
    expect(meta.fields[0]).toMatchObject({ type: 'money', value: { amount: 1250, currency: 'EUR' } })
    expect(dropped).toBe(3 + (41 - RENEWAL_LIMITS.fields))
  })

  it('cuts text to size, keeps only safe links and only the last four of a key', () => {
    const { meta } = normalizeRenewal({
      url: 'javascript:alert(1)',
      fields: [
        { id: 'l', label: 'x'.repeat(100), type: 'text', value: 'y'.repeat(900) },
        { id: 'k', label: 'Key', type: 'keyHint', value: 'sk-proj-abcdefghijklmnop1234' },
        { id: 'u', label: 'Portal', type: 'link', value: 'file:///etc/passwd' }
      ]
    })
    expect(meta.url).toBe('')
    expect(meta.fields[0].label).toHaveLength(RENEWAL_LIMITS.label)
    expect((meta.fields[0] as { value: string }).value).toHaveLength(RENEWAL_LIMITS.text)
    expect(meta.fields[1]).toMatchObject({ value: '1234' })
    expect(meta.fields[2]).toMatchObject({ value: '' })
  })

  it('will not call something automatic that has no way to renew itself', () => {
    expect(normalizeRenewal({ renews: 'auto', cycle: 'once' }).meta.renews).toBe('manual')
    expect(normalizeRenewal({ renews: 'auto', cycle: monthly }).meta.renews).toBe('auto')
    expect(normalizeRenewal({ renews: 'auto', cycle: 'once', lookup: { source: 'tls', target: 'acme.dev' } }).meta.renews).toBe('auto')
  })

  it('keeps warning days in range, unique and largest first', () => {
    expect(normalizeRenewal({ warnAt: [1, 30, 7, 7, -2, 9999, 2.5] }).meta.warnAt).toStrictEqual([30, 7, 1])
  })

  it('takes the anchor day from the expiry when it has none', () => {
    expect(normalizeRenewal({ expiresAt: day(2027, 0, 31) }).meta.anchorDay).toBe(31)
  })
})

describe('moving a renewal on', () => {
  it('keeps the anchor day through short months and back', () => {
    const feb = must(advanceOnce(day(2027, 0, 31), monthly, 31))
    expect(dueDay(feb)).toStrictEqual({ year: 2027, month: 1, day: 28 })
    expect(dueDay(must(advanceOnce(feb, monthly, 31)))).toStrictEqual({ year: 2027, month: 2, day: 31 })
  })

  it('lands on 29 February in a leap year', () => {
    expect(dueDay(must(advanceOnce(day(2028, 0, 31), monthly, 31)))).toStrictEqual({ year: 2028, month: 1, day: 29 })
    expect(dueDay(must(advanceOnce(day(2028, 1, 29), yearly, 29)))).toStrictEqual({ year: 2029, month: 1, day: 28 })
  })

  it('keeps a whole day whole and a moment at its time', () => {
    expect(isAllDay(must(advanceOnce(day(2027, 4, 3), yearly, 3)))).toBe(true)
    const next = new Date(must(advanceOnce(at(2027, 4, 3, 14), monthly, 3)))
    expect([next.getMonth(), next.getDate(), next.getHours()]).toStrictEqual([5, 3, 14])
  })

  it('has nowhere to go for a one-off', () => {
    expect(advanceOnce(day(2027, 4, 3), 'once', 3)).toBeNull()
  })

  it('steps past a long gap until it has not ended yet', () => {
    const next = must(advancePast(day(2026, 0, 15), monthly, 15, at(2026, 9, 10)))
    expect(dueDay(next)).toStrictEqual({ year: 2026, month: 9, day: 15 })
  })

  it('records the renewal and clears the boxes that start each cycle empty', () => {
    const meta = normalizeRenewal({
      expiresAt: day(2026, 9, 1),
      cycle: monthly,
      fields: [
        { id: 'p', label: 'Paid', type: 'checkbox', value: true, clearOnRenewal: true },
        { id: 'q', label: 'Kept', type: 'checkbox', value: true, clearOnRenewal: false }
      ]
    }).meta
    const renewed = renewTo(meta, day(2026, 10, 1), 'you', at(2026, 9, 2), false)
    expect(renewed.expiresAt).toBe(day(2026, 10, 1))
    expect(renewed.fields.map(f => f.value)).toStrictEqual([false, true])
    expect(renewed.history[0]).toStrictEqual({ at: at(2026, 9, 2), from: day(2026, 9, 1), to: day(2026, 10, 1), by: 'you', confirmed: false })
  })
})

describe('how a renewal reads', () => {
  const now = at(2026, 9, 10)
  const meta = (expiresAt: number | null, extra: Partial<RenewalMeta> = {}): RenewalMeta =>
    ({ ...normalizeRenewal({ expiresAt }).meta, ...extra })

  it('says how far away it is in days', () => {
    expect(expiryPhrase(day(2026, 9, 10), now)).toBe('expires today')
    expect(expiryPhrase(day(2026, 9, 11), now)).toBe('expires tomorrow')
    expect(expiryPhrase(day(2026, 9, 22), now)).toBe('expires in 12 days')
    expect(expiryPhrase(day(2026, 9, 9), now)).toBe('expired yesterday')
    expect(expiryPhrase(day(2026, 9, 7), now)).toBe('expired 3 days ago')
    expect(expiryPhrase(at(2026, 9, 10, 8), now)).toBe('expired today')
  })

  it('groups by how soon', () => {
    expect(renewalGroup('active', meta(day(2026, 9, 9)), now)).toBe('expired')
    expect(renewalGroup('active', meta(day(2026, 10, 9)), now)).toBe('soon')
    expect(renewalGroup('active', meta(day(2026, 10, 10)), now)).toBe('later')
    expect(renewalGroup('active', meta(null), now)).toBe('later')
    expect(renewalGroup('cancelled', meta(day(2026, 9, 9)), now)).toBe('cancelled')
  })

  it('counts what needs attention: lapsed by hand, or ending within a week', () => {
    expect(needsAttention('active', meta(day(2026, 9, 9)), now)).toBe(true)
    expect(needsAttention('active', meta(day(2026, 9, 9), { renews: 'auto' }), now)).toBe(false)
    expect(needsAttention('active', meta(day(2026, 9, 17)), now)).toBe(true)
    expect(needsAttention('active', meta(day(2026, 9, 18)), now)).toBe(false)
    expect(needsAttention('cancelled', meta(day(2026, 9, 9)), now)).toBe(false)
  })
})

describe('totals', () => {
  const entry = (status: string, cycle: RenewalMeta['cycle'], fields: unknown[]) =>
    ({ status, meta: normalizeRenewal({ cycle, fields }).meta })
  const cost = (amount: number, currency = 'EUR', label = 'Cost') =>
    ({ id: `c${amount}${currency}${label}`, label, type: 'money', value: { amount, currency } })

  it('adds up by field name and currency, monthly and yearly', () => {
    const totals = renewalTotals([
      entry('active', monthly, [cost(1200)]),
      entry('active', yearly, [cost(12000)]),
      entry('active', monthly, [cost(500, 'USD')]),
      entry('active', monthly, [cost(999, 'EUR', 'cost')]),
      entry('cancelled', monthly, [cost(100000)]),
      entry('active', 'once', [cost(100000)])
    ])
    const eur = must(totals.find(t => t.currency === 'EUR'))
    expect(eur.monthly).toBeCloseTo(1200 + 1000 + 999)
    expect(eur.yearly).toBeCloseTo((1200 + 1000 + 999) * 12)
    expect(must(totals.find(t => t.currency === 'USD')).monthly).toBe(500)
    expect(totals).toHaveLength(2)
  })

  it('reads and writes amounts in the currency\'s own minor units', () => {
    expect(parseAmount('12.50', 'EUR')).toBe(1250)
    expect(parseAmount('12,5', 'EUR')).toBe(1250)
    expect(parseAmount('1200', 'JPY')).toBe(1200)
    expect(parseAmount('twelve', 'EUR')).toBeNull()
    expect(formatMoney(1250, 'EUR')).toMatch(/12[.,]50/)
  })
})
