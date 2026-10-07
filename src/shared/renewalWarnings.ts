/** which renewal notices are due now; pure, so the sweep in main only delivers and remembers */

import { allDay, DAY_MS, dueDay, dueDeadline, REMIND_HOUR, todayIso } from './dueDate'
import { daysUntil, expiryPhrase, fieldEnd, isExpired, warnTime, type RenewalMeta } from './renewal'
import type { RenewalLookupState } from './renewalApi'
import { pendingRenewal } from './renewalTrust'

export interface RenewalEntry {
  id: string
  title: string
  status: string
  meta: RenewalMeta
}

export interface RenewalNotice {
  key: string
  entryId: string
  title: string
  body: string
}

/** how far back an expired one keeps reminding, the same week due dates use */
export const EXPIRED_REMIND_DAYS = 7

/** registrars can take a day or two to pass a renewal on, so silence is only news after this */
export const CONFIRM_GRACE_MS = 3 * DAY_MS

const capitalise = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1)

/** 3 May 2027, or Apr 2027 for a month */
export function shortDate(ms: number, precision: 'day' | 'month' = 'day'): string {
  const d = dueDay(ms)
  const options: Intl.DateTimeFormatOptions =
    precision === 'month' ? { month: 'short', year: 'numeric' } : { day: 'numeric', month: 'short', year: 'numeric' }
  return new Date(d.year, d.month, d.day).toLocaleDateString(undefined, options)
}

function untilPhrase(ms: number, now: number): string {
  const days = daysUntil(ms, now)
  if (days <= 0) return 'today'
  return days === 1 ? 'tomorrow' : `in ${days} days`
}

const renewWords = (meta: RenewalMeta): string => (meta.renews === 'auto' ? 'Renews automatically' : 'Renew manually')

/**
 * thresholds that have come round and not been sent; when several came round at once, while the app was
 * closed, only the nearest is worth saying, and the rest are marked so they never arrive late
 */
function crossed(date: number, days: number[], now: number, base: string, fired: ReadonlySet<string>) {
  const passed = days.filter(d => warnTime(date, d) <= now)
  const fresh = passed.filter(d => !fired.has(`${base}:${d}`))
  return { send: fresh.length > 0, nearest: Math.min(...passed), mark: passed.map(d => `${base}:${d}`) }
}

/** what to send now for one renewal, and every key to remember as sent */
export function renewalNotices(
  entry: RenewalEntry,
  now: number,
  fired: ReadonlySet<string>,
  snoozedUntil: number | null = null,
  lookupState: RenewalLookupState | null = null
): { notices: RenewalNotice[]; mark: string[] } {
  const notices: RenewalNotice[] = []
  const mark: string[] = []
  const { meta } = entry
  if (entry.status === 'cancelled') return { notices, mark }
  // nothing is marked while snoozed, so the nearest one arrives when it ends
  if (snoozedUntil !== null && snoozedUntil > now) return { notices, mark }
  const title = entry.title || 'Untitled'
  const add = (key: string, body: string): void => {
    notices.push({ key, entryId: entry.id, title, body })
  }

  const expiry = meta.expiresAt
  if (expiry !== null) {
    const base = `${entry.id}:expiry:${expiry}`
    if (!isExpired(expiry, now)) {
      const due = crossed(expiry, meta.warnAt, now, base, fired)
      if (due.send) add(`${base}:${due.nearest}`, `${capitalise(expiryPhrase(expiry, now))} · ${renewWords(meta)}`)
      mark.push(...due.mark)
    } else if (meta.renews === 'manual') {
      const late = -daysUntil(expiry, now)
      const morning = new Date(now)
      morning.setHours(REMIND_HOUR, 0, 0, 0)
      // once a day for a week, in the morning, or straight away the day a moment runs out
      const key = `${base}:expired:${todayIso(now)}`
      if (late <= EXPIRED_REMIND_DAYS && (late === 0 || now >= morning.getTime()) && !fired.has(key)) {
        add(key, `${capitalise(expiryPhrase(expiry, now))} · Renew manually`)
        mark.push(key)
      }
    }
  }

  lookupNotices(entry, now, fired, lookupState, add, mark)

  for (const field of meta.fields) {
    if (field.type !== 'date' || field.value === null) continue
    const end = fieldEnd(field)
    if (end === null) continue

    if (field.warn.mode === 'before' && now <= dueDeadline(end)) {
      const base = `${entry.id}:field:${field.id}:${field.value}`
      const due = crossed(end, field.warn.days, now, base, fired)
      if (due.send) add(`${base}:${due.nearest}`, `${field.label}: ${untilPhrase(end, now)}, ${shortDate(field.value, field.precision)}`)
      mark.push(...due.mark)
    }

    // the card that pays it, or anything else that has to outlast the renewal
    if (field.warn.mode === 'beforeRenewal' && expiry !== null && !isExpired(expiry, now)) {
      const endsFirst = allDay(dueDay(end)) < allDay(dueDay(expiry))
      const from = warnTime(expiry, meta.warnAt.length ? meta.warnAt[0] : 0)
      const key = `${entry.id}:before:${field.id}:${field.value}:${expiry}`
      if (endsFirst && now >= from && !fired.has(key)) {
        const verb = meta.renews === 'auto' ? 'renews' : 'expires'
        add(key, `${field.label} ${shortDate(field.value, field.precision)}, before it ${verb} on ${shortDate(expiry)}`)
        mark.push(key)
      }
    }
  }
  return { notices, mark }
}

const later = (a: number, b: number): boolean => dueDeadline(a) > dueDeadline(b)

/** only a lookup that worked and still saw the old date says a renewal didn't happen; one that failed says nothing */
function lookupNotices(
  entry: RenewalEntry,
  now: number,
  fired: ReadonlySet<string>,
  state: RenewalLookupState | null,
  add: (key: string, body: string) => void,
  mark: string[]
): void {
  const { meta } = entry
  if (!meta.lookup || !state || state.state !== 'ok' || state.okAt === null || state.seenExpiry === null) return
  const morning = new Date(now)
  morning.setHours(REMIND_HOUR, 0, 0, 0)
  if (now < morning.getTime()) return
  const registry = meta.lookup.source === 'rdap'
  const day = todayIso(now)

  const pending = pendingRenewal(meta)
  if (pending && pending.from !== null) {
    const stale = now - pending.at >= CONFIRM_GRACE_MS && state.okAt > pending.at && !later(state.seenExpiry, pending.from)
    const key = `${entry.id}:unconfirmed:${pending.to}:${day}`
    if (stale && !fired.has(key)) {
      add(key, registry
        ? 'Still shows the old expiry at the registry. The renewal may not have gone through.'
        : 'The site still serves the old certificate. The renewal may not have gone through.')
      mark.push(key)
    }
    return
  }

  const expiry = meta.expiresAt
  if (meta.renews !== 'auto' || expiry === null || !isExpired(expiry, now)) return
  const late = -daysUntil(expiry, now)
  const unmoved = state.okAt > dueDeadline(expiry) && !later(state.seenExpiry, expiry)
  const key = `${entry.id}:notrenewed:${expiry}:${day}`
  if (late >= 1 && late <= EXPIRED_REMIND_DAYS && unmoved && !fired.has(key)) {
    add(key, registry
      ? `Set to renew itself, but the registry still shows it expiring on ${shortDate(expiry)}.`
      : `Set to renew itself, but the site's certificate still ends on ${shortDate(expiry)}.`)
    mark.push(key)
  }
}

/** a year and a bit covers the longest warning; keys of deleted renewals go straight away */
const FIRED_MAX_AGE_MS = 400 * 86_400_000

export function pruneFired(fired: Record<string, number>, liveIds: ReadonlySet<string>, now: number): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [key, at] of Object.entries(fired)) {
    const id = key.slice(0, key.indexOf(':'))
    if (liveIds.has(id) && now - at < FIRED_MAX_AGE_MS) out[key] = at
  }
  return out
}
