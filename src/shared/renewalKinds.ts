/** kinds of renewal and their starting fields; the built-ins always exist, edits to them are layered on top */

import {
  emptyRenewal,
  normalizeCycle,
  normalizeField,
  normalizeWarnDays,
  RENEWAL_LIMITS,
  type RenewalCycle,
  type RenewalField,
  type RenewalMeta
} from './renewal'

/** drawn from a fixed set, the renderer maps each to an icon */
export const KIND_ICONS = [
  'globe', 'shield', 'key', 'card', 'badge', 'calendar',
  'home', 'car', 'heart', 'plane', 'file', 'server', 'phone', 'briefcase'
] as const
export type KindIcon = (typeof KIND_ICONS)[number]

export interface RenewalKind {
  id: string
  name: string
  icon: KindIcon
  builtIn: boolean
  /** built-ins only; a lookup needs code that knows where to ask */
  lookupSource: 'rdap' | 'tls' | null
  renews: 'auto' | 'manual'
  cycle: RenewalCycle
  warnAt: number[]
  /** templates; templateFieldId is always null here, the field's own id is what entries point at */
  fields: RenewalField[]
}

export const RENEWAL_KINDS_SETTING = 'renewal_kinds'
const MAX_KINDS = 40

const text = (id: string, label: string): RenewalField => ({ id, templateFieldId: null, label, type: 'text', value: '' })
const money = (id: string, label: string): RenewalField => ({ id, templateFieldId: null, label, type: 'money', value: null })
const cardEnds = (id: string): RenewalField => ({
  id, templateFieldId: null, label: 'Card ends', type: 'date', value: null, precision: 'month', warn: { mode: 'beforeRenewal' }
})

const YEARLY: RenewalCycle = { every: 1, unit: 'year' }
const MONTHLY: RenewalCycle = { every: 1, unit: 'month' }

export const BUILT_IN_KINDS: RenewalKind[] = [
  {
    id: 'domain', name: 'Domain', icon: 'globe', builtIn: true, lookupSource: 'rdap',
    renews: 'manual', cycle: YEARLY, warnAt: [30, 7, 1],
    fields: [text('domain.registrar', 'Registrar'), money('domain.cost', 'Cost'), cardEnds('domain.card')]
  },
  {
    id: 'certificate', name: 'Certificate', icon: 'shield', builtIn: true, lookupSource: 'tls',
    renews: 'auto', cycle: 'once', warnAt: [14, 3],
    fields: [text('certificate.renewedBy', 'Renewed by')]
  },
  {
    id: 'api_key', name: 'API key', icon: 'key', builtIn: true, lookupSource: null,
    renews: 'manual', cycle: 'once', warnAt: [14, 3, 0],
    fields: [
      text('api_key.where', 'Where it lives'),
      { id: 'api_key.hint', templateFieldId: null, label: 'Key', type: 'keyHint', value: '' }
    ]
  },
  {
    id: 'subscription', name: 'Subscription', icon: 'card', builtIn: true, lookupSource: null,
    renews: 'auto', cycle: MONTHLY, warnAt: [7, 1],
    fields: [
      money('subscription.cost', 'Cost'),
      cardEnds('subscription.card'),
      { id: 'subscription.paid', templateFieldId: null, label: 'Paid this cycle', type: 'checkbox', value: false, clearOnRenewal: true }
    ]
  },
  {
    id: 'licence', name: 'Licence', icon: 'badge', builtIn: true, lookupSource: null,
    renews: 'manual', cycle: YEARLY, warnAt: [30, 7],
    fields: [{ id: 'licence.seats', templateFieldId: null, label: 'Seats', type: 'number', value: null }, money('licence.cost', 'Cost')]
  },
  {
    id: 'other', name: 'Other', icon: 'calendar', builtIn: true, lookupSource: null,
    renews: 'manual', cycle: 'once', warnAt: [7, 1],
    fields: []
  }
]

const KIND_ID = /^[a-z0-9_-]{1,40}$/
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

function templateFields(raw: unknown, fallback: RenewalField[]): RenewalField[] {
  if (!Array.isArray(raw)) return fallback
  const seen = new Set<string>()
  const out: RenewalField[] = []
  raw.forEach((f, i) => {
    const field = normalizeField(f, `t${i}`)
    if (!field || seen.has(field.id) || out.length >= RENEWAL_LIMITS.fields) return
    seen.add(field.id)
    out.push({ ...field, templateFieldId: null })
  })
  return out
}

function layered(base: RenewalKind | null, raw: Record<string, unknown>, id: string): RenewalKind {
  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 40) : base?.name ?? 'Untitled kind'
  const icon = KIND_ICONS.includes(raw.icon as KindIcon) ? (raw.icon as KindIcon) : base?.icon ?? 'calendar'
  return {
    id,
    name,
    icon,
    builtIn: !!base,
    lookupSource: base?.lookupSource ?? null,
    renews: raw.renews === 'auto' || raw.renews === 'manual' ? raw.renews : base?.renews ?? 'manual',
    cycle: 'cycle' in raw ? normalizeCycle(raw.cycle) : base?.cycle ?? 'once',
    warnAt: Array.isArray(raw.warnAt) ? normalizeWarnDays(raw.warnAt) : base?.warnAt ?? [7, 1],
    fields: templateFields(raw.fields, base?.fields ?? [])
  }
}

/** never throws; built-ins first in their order, then the user's own in theirs */
export function normalizeKinds(raw: unknown): RenewalKind[] {
  let parsed: unknown = raw
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw)
    } catch {
      parsed = null
    }
  }
  const list = Array.isArray(parsed) ? parsed : isObject(parsed) && Array.isArray(parsed.kinds) ? parsed.kinds : []
  const stored = new Map<string, Record<string, unknown>>()
  for (const k of list) {
    if (isObject(k) && typeof k.id === 'string' && KIND_ID.test(k.id) && !stored.has(k.id)) stored.set(k.id, k)
  }

  const kinds = BUILT_IN_KINDS.map(base => layered(base, stored.get(base.id) ?? {}, base.id))
  for (const [id, k] of stored) {
    if (kinds.length >= MAX_KINDS) break
    if (BUILT_IN_KINDS.some(b => b.id === id)) continue
    kinds.push(layered(null, k, id))
  }
  return kinds
}

export const kindById = (kinds: RenewalKind[], id: string): RenewalKind =>
  kinds.find(k => k.id === id) ?? kinds.find(k => k.id === 'other') ?? BUILT_IN_KINDS[BUILT_IN_KINDS.length - 1]

/** an entry's own copies, each pointing back at the template field it came from */
export function fieldsFromTemplate(kind: RenewalKind, makeId: () => string): RenewalField[] {
  return kind.fields.map(f => ({ ...f, id: makeId(), templateFieldId: f.id }))
}

export function newRenewalMeta(kind: RenewalKind, makeId: () => string): RenewalMeta {
  return {
    ...emptyRenewal(kind.id),
    renews: kind.renews,
    cycle: kind.cycle,
    warnAt: [...kind.warnAt],
    fields: fieldsFromTemplate(kind, makeId)
  }
}

/** an id for a new kind, from its name, never clashing with one that exists */
export function kindIdFor(name: string, kinds: RenewalKind[]): string {
  const stem = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 32) || 'kind'
  let id = stem
  for (let n = 2; kinds.some(k => k.id === id); n++) id = `${stem}_${n}`
  return id
}

/** entries of a deleted kind keep their fields and become Other */
export function withoutKind(kinds: RenewalKind[], id: string): RenewalKind[] {
  return kinds.filter(k => k.builtIn || k.id !== id)
}

/** a renamed template field, and the same label on an entry's copies of it */
export function renameLinkedFields(meta: RenewalMeta, templateFieldId: string, label: string): RenewalMeta {
  return {
    ...meta,
    fields: meta.fields.map(f => (f.templateFieldId === templateFieldId ? { ...f, label } : f))
  }
}
