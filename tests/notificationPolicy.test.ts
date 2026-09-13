import { describe, it, expect } from 'vitest'
import {
  DEFAULT_POLICY,
  NOTIFICATION_CATEGORIES,
  isQuietHour,
  normalizePolicy,
  pruneDedupe,
  shouldNotify,
  type DedupeEntry,
  type NotificationPolicy
} from '../src/shared/notificationPolicy'

const policy = (over: Partial<NotificationPolicy> = {}): NotificationPolicy => ({
  ...DEFAULT_POLICY,
  categories: { ...DEFAULT_POLICY.categories },
  ...over
})

/** a local hour, so quiet-hour tests read plainly */
const atHour = (h: number) => new Date(2026, 0, 15, h, 30).getTime()

describe('normalizePolicy', () => {
  it('fills everything in from junk', () => {
    expect(normalizePolicy(null)).toEqual(DEFAULT_POLICY)
    expect(normalizePolicy('{not json')).toEqual(DEFAULT_POLICY)
    expect(normalizePolicy(42)).toEqual(DEFAULT_POLICY)
  })

  it('reads a JSON string as well as an object', () => {
    const stored = JSON.stringify({ enabled: false })
    expect(normalizePolicy(stored).enabled).toBe(false)
  })

  it('keeps known categories and ignores unknown ones', () => {
    const out = normalizePolicy({ categories: { due: false, nonsense: true } })
    expect(out.categories.due).toBe(false)
    expect(out.categories).not.toHaveProperty('nonsense')
  })

  it('defaults a category that is missing rather than dropping it', () => {
    const out = normalizePolicy({ categories: { due: false } })
    expect(out.categories.focus).toBe(DEFAULT_POLICY.categories.focus)
  })

  it('clamps hours to the clock', () => {
    expect(normalizePolicy({ quietFrom: 99, quietTo: -3 })).toMatchObject({ quietFrom: 0, quietTo: 0 })
  })

  it('does not let a normalized policy share the default category object', () => {
    const out = normalizePolicy(null)
    out.categories.due = false
    expect(DEFAULT_POLICY.categories.due).toBe(true)
  })
})

describe('isQuietHour', () => {
  it('is inert while quiet hours are off', () => {
    expect(isQuietHour(policy({ quietEnabled: false, quietFrom: 22, quietTo: 8 }), 23)).toBe(false)
  })

  it('handles a window that wraps midnight', () => {
    // the case from <= h < to gets backwards
    const p = policy({ quietEnabled: true, quietFrom: 22, quietTo: 8 })
    expect(isQuietHour(p, 23)).toBe(true)
    expect(isQuietHour(p, 3)).toBe(true)
    expect(isQuietHour(p, 7)).toBe(true)
    expect(isQuietHour(p, 8)).toBe(false)
    expect(isQuietHour(p, 12)).toBe(false)
    expect(isQuietHour(p, 21)).toBe(false)
  })

  it('handles a window inside one day', () => {
    const p = policy({ quietEnabled: true, quietFrom: 9, quietTo: 17 })
    expect(isQuietHour(p, 8)).toBe(false)
    expect(isQuietHour(p, 9)).toBe(true)
    expect(isQuietHour(p, 16)).toBe(true)
    expect(isQuietHour(p, 17)).toBe(false)
  })

  it('treats an empty window as no quiet period', () => {
    expect(isQuietHour(policy({ quietEnabled: true, quietFrom: 10, quietTo: 10 }), 10)).toBe(false)
  })
})

describe('shouldNotify', () => {
  it('allows a normal notification', () => {
    expect(shouldNotify(policy(), 'due', atHour(12))).toEqual({ allow: true })
  })

  it('the master switch silences everything', () => {
    expect(shouldNotify(policy({ enabled: false }), 'due', atHour(12))).toEqual({
      allow: false,
      reason: 'disabled'
    })
  })

  it('a muted category is silenced on its own', () => {
    const p = policy({ categories: { ...DEFAULT_POLICY.categories, due: false } })
    expect(shouldNotify(p, 'due', atHour(12)).reason).toBe('category-off')
    expect(shouldNotify(p, 'focus', atHour(12)).allow).toBe(true)
  })

  it('quiet hours suppress', () => {
    const p = policy({ quietEnabled: true, quietFrom: 22, quietTo: 8 })
    expect(shouldNotify(p, 'due', atHour(23)).reason).toBe('quiet-hours')
    expect(shouldNotify(p, 'due', atHour(12)).allow).toBe(true)
  })

  describe('dedupe', () => {
    it('suppresses a repeat inside the window', () => {
      // an hourly sweep mustn't re-announce
      const seen = new Map<string, DedupeEntry>([['item:1', { at: atHour(9) }]])
      const decision = shouldNotify(policy(), 'due', atHour(10), {
        dedupeKey: 'item:1',
        seen,
        dedupeWindowMs: 24 * 3600_000
      })
      expect(decision).toEqual({ allow: false, reason: 'duplicate' })
    })

    it('allows it again once the window has passed', () => {
      const seen = new Map<string, DedupeEntry>([['item:1', { at: atHour(9) }]])
      const decision = shouldNotify(policy(), 'due', atHour(9) + 2 * 3600_000, {
        dedupeKey: 'item:1',
        seen,
        dedupeWindowMs: 3600_000
      })
      expect(decision.allow).toBe(true)
    })

    it('never repeats when the window is zero', () => {
      const seen = new Map<string, DedupeEntry>([['x', { at: 0 }]])
      expect(shouldNotify(policy(), 'due', atHour(12), { dedupeKey: 'x', seen, dedupeWindowMs: 0 }).allow).toBe(false)
    })

    it('does not confuse different keys', () => {
      const seen = new Map<string, DedupeEntry>([['item:1', { at: atHour(12) }]])
      expect(shouldNotify(policy(), 'due', atHour(12), { dedupeKey: 'item:2', seen }).allow).toBe(true)
    })

    it('is skipped entirely when no key is given', () => {
      // two intervals are two things
      const seen = new Map<string, DedupeEntry>([['item:1', { at: atHour(12) }]])
      expect(shouldNotify(policy(), 'focus', atHour(12), { seen }).allow).toBe(true)
    })
  })

  it('reports the strongest reason first', () => {
    // disabled outranks everything
    const p = policy({ enabled: false, quietEnabled: true, quietFrom: 0, quietTo: 23 })
    expect(shouldNotify(p, 'due', atHour(12)).reason).toBe('disabled')
  })
})

describe('pruneDedupe', () => {
  it('drops entries past the age limit and keeps the rest', () => {
    const now = atHour(12)
    const seen = new Map<string, DedupeEntry>([
      ['old', { at: now - 10 * 3600_000 }],
      ['fresh', { at: now - 60_000 }]
    ])
    pruneDedupe(seen, now, 3600_000)
    expect([...seen.keys()]).toEqual(['fresh'])
  })
})

describe('the shipped categories', () => {
  it('every category has a default in the default policy', () => {
    for (const c of NOTIFICATION_CATEGORIES) {
      expect(DEFAULT_POLICY.categories[c.id], c.id).toBeTypeOf('boolean')
    }
  })

  it('leaves the noisy ones off by default', () => {
    // bursty sources default to opted out
    expect(DEFAULT_POLICY.categories.agent).toBe(false)
    expect(DEFAULT_POLICY.categories.recurrence).toBe(false)
  })
})
