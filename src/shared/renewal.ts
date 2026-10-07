/** something that expires and comes back; an item of its own type with the details in metadata, never a secret */

import { allDay, DAY_MS, dueDay, dueDeadline, isAllDay, localDayOf, moment, REMIND_HOUR, type CalendarDay } from './dueDate'

export type RenewalCycle = { every: number; unit: 'month' | 'year' } | 'once'

export type DateWarn = { mode: 'none' } | { mode: 'before'; days: number[] } | { mode: 'beforeRenewal' }

interface FieldBase {
  id: string
  /** the template field it came from, so a rename can follow it */
  templateFieldId: string | null
  label: string
}

export type RenewalField = FieldBase & (
  | { type: 'text'; value: string }
  | { type: 'number'; value: number | null }
  /** minor units, so cents never drift */
  | { type: 'money'; value: { amount: number; currency: string } | null }
  | { type: 'date'; value: number | null; precision: 'day' | 'month'; warn: DateWarn }
  | { type: 'checkbox'; value: boolean; clearOnRenewal: boolean }
  | { type: 'link'; value: string }
  | { type: 'keyHint'; value: string }
)

export type RenewalFieldType = RenewalField['type']

export const FIELD_TYPES: { id: RenewalFieldType; label: string }[] = [
  { id: 'text', label: 'Text' },
  { id: 'number', label: 'Number' },
  { id: 'money', label: 'Money' },
  { id: 'date', label: 'Date' },
  { id: 'checkbox', label: 'Checkbox' },
  { id: 'link', label: 'Link' },
  { id: 'keyHint', label: 'Key hint' }
]

export interface RenewalLookupConfig {
  source: 'rdap' | 'tls'
  target: string
  port: number | null
  auto: boolean
}

export interface RenewalHistoryEntry {
  at: number
  from: number | null
  to: number
  by: 'you' | 'auto' | 'registry'
  /** a lookup has seen this date or a later one */
  confirmed: boolean
}

export interface RenewalMeta {
  v: 1
  kind: string
  /** the dueDate encoding: a whole day or a moment */
  expiresAt: number | null
  /** the day of month a cycle keeps, so 31 Jan goes to 28 Feb and back to 31 Mar */
  anchorDay: number
  renews: 'auto' | 'manual'
  cycle: RenewalCycle
  /** days before, largest first */
  warnAt: number[]
  url: string
  fields: RenewalField[]
  lookup: RenewalLookupConfig | null
  /** newest first */
  history: RenewalHistoryEntry[]
}

export const RENEWAL_LIMITS = {
  fields: 30,
  label: 40,
  text: 500,
  link: 2048,
  hint: 4,
  history: 20,
  warnAt: 6,
  warnDays: 365,
  months: 24,
  years: 10,
  target: 253,
  amount: 1e12
} as const

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const finite = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const int = (v: unknown, min: number, max: number): number | null => {
  const n = finite(v)
  return n !== null && Number.isInteger(n) && n >= min && n <= max ? n : null
}

/** http and https only, a javascript: link would run on click */
export function safeLink(v: unknown): string {
  const text = str(v, RENEWAL_LIMITS.link)
  if (!text) return ''
  try {
    const url = new URL(text)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : ''
  } catch {
    return ''
  }
}

export function normalizeWarnDays(v: unknown): number[] {
  if (!Array.isArray(v)) return []
  const days = v.map(d => int(d, 0, RENEWAL_LIMITS.warnDays)).filter((d): d is number => d !== null)
  return [...new Set(days)].sort((a, b) => b - a).slice(0, RENEWAL_LIMITS.warnAt)
}

export function normalizeCycle(v: unknown): RenewalCycle {
  if (!isObject(v)) return 'once'
  const unit = v.unit === 'year' ? 'year' : v.unit === 'month' ? 'month' : null
  if (!unit) return 'once'
  const every = int(v.every, 1, unit === 'year' ? RENEWAL_LIMITS.years : RENEWAL_LIMITS.months)
  return every === null ? 'once' : { every, unit }
}

function normalizeWarn(v: unknown): DateWarn {
  if (!isObject(v)) return { mode: 'none' }
  if (v.mode === 'beforeRenewal') return { mode: 'beforeRenewal' }
  if (v.mode === 'before') {
    const days = normalizeWarnDays(v.days)
    return days.length ? { mode: 'before', days } : { mode: 'none' }
  }
  return { mode: 'none' }
}

/** the last characters only; a hint tells keys apart and is no use to anyone who reads it */
export const keyHintOf = (v: unknown): string => (typeof v === 'string' ? v.trim().slice(-RENEWAL_LIMITS.hint) : '')

const CURRENCY = /^[A-Z]{3}$/

export function normalizeMoney(v: unknown): { amount: number; currency: string } | null {
  if (!isObject(v)) return null
  const amount = finite(v.amount)
  const currency = typeof v.currency === 'string' ? v.currency.trim().toUpperCase() : ''
  if (amount === null || Math.abs(amount) > RENEWAL_LIMITS.amount || !CURRENCY.test(currency)) return null
  return { amount: Math.round(amount), currency }
}

/** null when the field can't be read; the caller counts what it dropped */
export function normalizeField(raw: unknown, fallbackId: string): RenewalField | null {
  if (!isObject(raw)) return null
  const id = str(raw.id, 64) || fallbackId
  const templateFieldId = str(raw.templateFieldId, 64) || null
  const label = str(raw.label, RENEWAL_LIMITS.label) || 'Field'
  const base = { id, templateFieldId, label }
  switch (raw.type) {
    case 'text':
      return { ...base, type: 'text', value: str(raw.value, RENEWAL_LIMITS.text) }
    case 'number':
      return { ...base, type: 'number', value: finite(raw.value) }
    case 'money':
      return { ...base, type: 'money', value: normalizeMoney(raw.value) }
    case 'date': {
      const value = finite(raw.value)
      return {
        ...base,
        type: 'date',
        value: value !== null && value > 0 ? value : null,
        precision: raw.precision === 'month' ? 'month' : 'day',
        warn: normalizeWarn(raw.warn)
      }
    }
    case 'checkbox':
      return { ...base, type: 'checkbox', value: raw.value === true, clearOnRenewal: raw.clearOnRenewal === true }
    case 'link':
      return { ...base, type: 'link', value: safeLink(raw.value) }
    case 'keyHint':
      return { ...base, type: 'keyHint', value: keyHintOf(raw.value) }
    default:
      return null
  }
}

function normalizeLookup(v: unknown): RenewalLookupConfig | null {
  if (!isObject(v)) return null
  const source = v.source === 'rdap' ? 'rdap' : v.source === 'tls' ? 'tls' : null
  const target = str(v.target, RENEWAL_LIMITS.target).toLowerCase()
  if (!source || !target) return null
  return { source, target, port: int(v.port, 1, 65_535), auto: v.auto !== false }
}

function normalizeHistory(v: unknown): RenewalHistoryEntry[] {
  if (!Array.isArray(v)) return []
  const out: RenewalHistoryEntry[] = []
  for (const h of v) {
    if (!isObject(h)) continue
    const at = finite(h.at)
    const to = finite(h.to)
    if (at === null || to === null) continue
    const by = h.by === 'auto' || h.by === 'registry' ? h.by : 'you'
    out.push({ at, from: finite(h.from), to, by, confirmed: h.confirmed === true })
  }
  return out.sort((a, b) => b.at - a.at).slice(0, RENEWAL_LIMITS.history)
}

const KIND_ID = /^[a-z0-9_-]{1,40}$/

export function emptyRenewal(kind = 'other'): RenewalMeta {
  return {
    v: 1,
    kind,
    expiresAt: null,
    anchorDay: 1,
    renews: 'manual',
    cycle: 'once',
    warnAt: [7, 1],
    url: '',
    fields: [],
    lookup: null,
    history: []
  }
}

/** never throws; what it can't read falls back to defaults, and broken fields are dropped and counted */
export function normalizeRenewal(raw: unknown): { meta: RenewalMeta; dropped: number } {
  let parsed: unknown = raw
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw)
    } catch {
      parsed = null
    }
  }
  const o = isObject(parsed) ? parsed : {}
  const kind = typeof o.kind === 'string' && KIND_ID.test(o.kind) ? o.kind : 'other'
  const meta = emptyRenewal(kind)

  const expiresAt = finite(o.expiresAt)
  meta.expiresAt = expiresAt !== null && expiresAt > 0 ? expiresAt : null
  meta.anchorDay = int(o.anchorDay, 1, 31) ?? (meta.expiresAt === null ? 1 : dueDay(meta.expiresAt).day)
  meta.cycle = normalizeCycle(o.cycle)
  meta.warnAt = Array.isArray(o.warnAt) ? normalizeWarnDays(o.warnAt) : meta.warnAt
  meta.url = safeLink(o.url)
  meta.lookup = normalizeLookup(o.lookup)
  meta.history = normalizeHistory(o.history)
  // auto with nothing to roll forward by and nothing to look up has no way to renew itself
  meta.renews = o.renews === 'auto' && (meta.cycle !== 'once' || meta.lookup) ? 'auto' : 'manual'

  let dropped = 0
  const seen = new Set<string>()
  const rawFields = Array.isArray(o.fields) ? o.fields : []
  for (let i = 0; i < rawFields.length; i++) {
    const field = normalizeField(rawFields[i], `f${i}`)
    if (!field || seen.has(field.id) || meta.fields.length >= RENEWAL_LIMITS.fields) {
      dropped++
      continue
    }
    seen.add(field.id)
    meta.fields.push(field)
  }
  return { meta, dropped }
}

const daysInMonth = (year: number, month: number): number => new Date(year, month + 1, 0).getDate()

/** one cycle on, on the anchor day or the month's last day when it's shorter; a moment keeps its time */
export function advanceOnce(expiresAt: number, cycle: RenewalCycle, anchorDay: number): number | null {
  if (cycle === 'once') return null
  const from = dueDay(expiresAt)
  const months = cycle.every * (cycle.unit === 'year' ? 12 : 1)
  const target = new Date(from.year, from.month + months, 1)
  const day: CalendarDay = {
    year: target.getFullYear(),
    month: target.getMonth(),
    day: Math.min(anchorDay, daysInMonth(target.getFullYear(), target.getMonth()))
  }
  if (isAllDay(expiresAt)) return allDay(day)
  const time = new Date(expiresAt)
  return moment(new Date(day.year, day.month, day.day, time.getHours(), time.getMinutes(), time.getSeconds()))
}

/** far enough on that it hasn't ended yet; a lapse renewed today still counts from the old date, as registrars do */
export function advancePast(expiresAt: number, cycle: RenewalCycle, anchorDay: number, now: number): number | null {
  let next = advanceOnce(expiresAt, cycle, anchorDay)
  // a decade of monthlies, so a corrupt date can't spin
  for (let i = 0; next !== null && dueDeadline(next) <= now && i < 1200; i++) {
    next = advanceOnce(next, cycle, anchorDay)
  }
  return next
}

/** renewed by hand or by itself: the new date, a history line, and the checkboxes that start each cycle empty */
export function renewTo(
  meta: RenewalMeta,
  to: number,
  by: RenewalHistoryEntry['by'],
  now: number,
  confirmed: boolean
): RenewalMeta {
  return {
    ...meta,
    expiresAt: to,
    fields: meta.fields.map(f => (f.type === 'checkbox' && f.clearOnRenewal ? { ...f, value: false } : f)),
    history: [{ at: now, from: meta.expiresAt, to, by, confirmed }, ...meta.history].slice(0, RENEWAL_LIMITS.history)
  }
}

/** calendar days from today to its day; negative once past */
export function daysUntil(expiresAt: number, now: number): number {
  return Math.round((allDay(dueDay(expiresAt)) - allDay(localDayOf(now))) / DAY_MS)
}

export const isExpired = (expiresAt: number, now: number): boolean => now > dueDeadline(expiresAt)

/** "expires today", "in 12 days", "expired yesterday" */
export function expiryPhrase(expiresAt: number, now: number): string {
  const days = daysUntil(expiresAt, now)
  if (isExpired(expiresAt, now)) {
    if (days >= 0) return 'expired today'
    return days === -1 ? 'expired yesterday' : `expired ${-days} days ago`
  }
  if (days <= 0) return 'expires today'
  return days === 1 ? 'expires tomorrow' : `expires in ${days} days`
}

/** the morning of the day so many days before; a moment's own day never warns later than the moment */
export function warnTime(date: number, days: number): number {
  const d = dueDay(date)
  const at = new Date(d.year, d.month, d.day - days, REMIND_HOUR, 0, 0, 0).getTime()
  return !isAllDay(date) && days === 0 ? Math.min(at, date) : at
}

/** a month-precision date counts until the end of its month */
export function fieldEnd(field: { value: number | null; precision: 'day' | 'month' }): number | null {
  if (field.value === null) return null
  if (field.precision === 'day') return field.value
  const d = dueDay(field.value)
  return allDay({ year: d.year, month: d.month, day: daysInMonth(d.year, d.month) })
}

export type RenewalGroup = 'expired' | 'soon' | 'later' | 'cancelled'

export const SOON_DAYS = 30

export function renewalGroup(status: string, meta: RenewalMeta, now: number): RenewalGroup {
  if (status === 'cancelled') return 'cancelled'
  if (meta.expiresAt === null) return 'later'
  if (isExpired(meta.expiresAt, now)) return 'expired'
  return daysUntil(meta.expiresAt, now) <= SOON_DAYS ? 'soon' : 'later'
}

/** inside the earliest warning, so the row can say it needs looking at */
export function isInWarningWindow(meta: RenewalMeta, now: number): boolean {
  if (meta.expiresAt === null || isExpired(meta.expiresAt, now)) return false
  const first = meta.warnAt.length ? meta.warnAt[0] : 0
  return now >= warnTime(meta.expiresAt, first)
}

/** what the tray and sidebar count: expired by hand, or ending within a week */
export function needsAttention(status: string, meta: RenewalMeta, now: number): boolean {
  if (status === 'cancelled' || meta.expiresAt === null) return false
  if (isExpired(meta.expiresAt, now)) return meta.renews === 'manual'
  return daysUntil(meta.expiresAt, now) <= 7
}

export interface RenewalTotal {
  key: string
  label: string
  currency: string
  monthly: number
  yearly: number
}

/** per money field name and currency; no conversion, a made-up rate would be wrong in a way nobody sees */
export function renewalTotals(entries: { status: string; meta: RenewalMeta }[]): RenewalTotal[] {
  const totals = new Map<string, RenewalTotal>()
  for (const { status, meta } of entries) {
    if (status === 'cancelled' || meta.cycle === 'once') continue
    const months = meta.cycle.every * (meta.cycle.unit === 'year' ? 12 : 1)
    for (const field of meta.fields) {
      if (field.type !== 'money' || !field.value) continue
      // by name, so a subscription's Cost and a domain's Cost add up
      const key = `${field.label.toLowerCase()}:${field.value.currency}`
      const total = totals.get(key) ?? { key, label: field.label, currency: field.value.currency, monthly: 0, yearly: 0 }
      total.monthly += field.value.amount / months
      total.yearly = total.monthly * 12
      totals.set(key, total)
    }
  }
  return [...totals.values()]
}

/** decimals the currency uses, 2 for most and 0 for yen */
export function currencyDigits(currency: string): number {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2
  } catch {
    return 2
  }
}

export function formatMoney(amount: number, currency: string): string {
  const value = amount / 10 ** currencyDigits(currency)
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(value)
  } catch {
    return `${value.toFixed(2)} ${currency}`
  }
}

/** "12.50" to 1250 cents; null for text that isn't an amount */
export function parseAmount(text: string, currency: string): number | null {
  const cleaned = text.trim().replace(/\s/g, '').replace(',', '.')
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null
  const value = Math.round(Number(cleaned) * 10 ** currencyDigits(currency))
  return Number.isFinite(value) && Math.abs(value) <= RENEWAL_LIMITS.amount ? value : null
}

/** what the reader sees for a cycle */
export function describeCycle(cycle: RenewalCycle): string {
  if (cycle === 'once') return 'Once'
  if (cycle.every === 1) return cycle.unit === 'year' ? 'Yearly' : 'Monthly'
  return `Every ${cycle.every} ${cycle.unit === 'year' ? 'years' : 'months'}`
}
