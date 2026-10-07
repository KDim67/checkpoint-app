/**
 * what a lookup may change: a later date at the registry means it renewed, an earlier one is only shown,
 * and a certificate that didn't check out can never push a date later, or a forged one could silence warnings
 */

import { dueDeadline, dueDay } from './dueDate'
import { renewTo, RENEWAL_LIMITS, type RenewalHistoryEntry, type RenewalMeta } from './renewal'

/** days apart, not milliseconds: two answers for one day are the same answer */
const sameOrLater = (a: number, b: number): boolean => dueDeadline(a) >= dueDeadline(b)
const later = (a: number, b: number): boolean => dueDeadline(a) > dueDeadline(b)

/** the renewal you clicked that nothing has confirmed yet */
export function pendingRenewal(meta: RenewalMeta): RenewalHistoryEntry | null {
  const last = meta.history[0]
  return last && last.by === 'you' && !last.confirmed ? last : null
}

export interface LookupDecision {
  /** what to save, or null when nothing changes */
  meta: RenewalMeta | null
  /** an earlier date than the one stored; shown with Use it, never applied */
  disagree: number | null
}

export function applyLookup(meta: RenewalMeta, seen: number, verified: boolean | null, now: number): LookupDecision {
  const stored = meta.expiresAt
  if (stored === null) {
    // the first date is what the lookup was for; an untrusted certificate says so in the row
    return { meta: { ...meta, expiresAt: seen, anchorDay: dueDay(seen).day }, disagree: null }
  }

  const pending = pendingRenewal(meta)
  if (pending && sameOrLater(seen, pending.to)) {
    // it went through; the registry's own date wins over the one the cycle guessed
    if (verified === false && later(seen, pending.to)) return { meta: confirm(meta, pending.to), disagree: null }
    return { meta: confirm(meta, seen), disagree: null }
  }

  if (later(seen, stored)) {
    if (verified === false) return { meta: null, disagree: null }
    return { meta: renewTo(meta, seen, 'registry', now, true), disagree: null }
  }

  // still the old date after you renewed: not a disagreement, the not-renewed warning covers it
  if (pending && pending.from !== null && !later(seen, pending.from)) return { meta: null, disagree: null }
  if (later(stored, seen)) return { meta: null, disagree: seen }
  return { meta: null, disagree: null }
}

function confirm(meta: RenewalMeta, to: number): RenewalMeta {
  const [first, ...rest] = meta.history
  return {
    ...meta,
    expiresAt: to,
    history: [{ ...first, to, confirmed: true }, ...rest].slice(0, RENEWAL_LIMITS.history)
  }
}
