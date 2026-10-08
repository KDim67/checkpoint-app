/** the editor's draft and the edits it needs, kept pure so they're testable without a screen */

import { FIELD_TYPES, keyHintOf, type RenewalField, type RenewalFieldType, type RenewalMeta } from '../../../../shared/renewal'
import { looksLikeSecret, withoutSecret } from '../../../../shared/renewalText'

export interface RenewalDraft {
  title: string
  body: string
  context: string
  meta: RenewalMeta
}

export function newField(type: RenewalFieldType, id: string): RenewalField {
  const label = FIELD_TYPES.find(t => t.id === type)?.label ?? 'Field'
  const base = { id, templateFieldId: null, label }
  switch (type) {
    case 'text': return { ...base, type, value: '' }
    case 'number': return { ...base, type, value: null }
    case 'money': return { ...base, label: 'Cost', type, value: null }
    case 'date': return { ...base, type, value: null, precision: 'day', warn: { mode: 'none' } }
    case 'checkbox': return { ...base, type, value: false, clearOnRenewal: false }
    case 'link': return { ...base, type, value: '' }
    case 'keyHint': return { ...base, label: 'Key', type, value: '' }
  }
}

/** a template keeps a field's shape and options, never what one entry filled in */
export function templateCopy(field: RenewalField, id: string): RenewalField {
  const blank = newField(field.type, id)
  return { ...field, id, templateFieldId: null, value: blank.value } as RenewalField
}

export type SecretPlace = { where: 'title' } | { where: 'body' } | { where: 'field'; fieldId: string }

/** the first key-shaped thing in what syncs, and where it is */
export function findSecret(draft: RenewalDraft): { secret: string; place: SecretPlace } | null {
  const inTitle = looksLikeSecret(draft.title)
  if (inTitle) return { secret: inTitle, place: { where: 'title' } }
  const inBody = looksLikeSecret(draft.body)
  if (inBody) return { secret: inBody, place: { where: 'body' } }
  for (const field of draft.meta.fields) {
    if (field.type !== 'text' && field.type !== 'link') continue
    const found = looksLikeSecret(field.value)
    if (found) return { secret: found, place: { where: 'field', fieldId: field.id } }
  }
  return null
}

/** the key taken out of where it was, its last four kept in a key hint, made if there's none */
export function cutSecret(draft: RenewalDraft, secret: string, place: SecretPlace, makeId: () => string): RenewalDraft {
  const hint = keyHintOf(secret)
  let fields = draft.meta.fields.map(f =>
    place.where === 'field' && f.id === place.fieldId && (f.type === 'text' || f.type === 'link')
      ? { ...f, value: withoutSecret(f.value, secret) }
      : f
  )
  const hintField = fields.find(f => f.type === 'keyHint')
  fields = hintField
    ? fields.map(f => (f.id === hintField.id ? { ...f, value: hint } as RenewalField : f))
    : [...fields, { ...newField('keyHint', makeId()), value: hint } as RenewalField]
  return {
    ...draft,
    title: place.where === 'title' ? withoutSecret(draft.title, secret) || draft.title.replace(secret, keyHintOf(secret)) : draft.title,
    body: place.where === 'body' ? withoutSecret(draft.body, secret) : draft.body,
    meta: { ...draft.meta, fields }
  }
}

/** currency most people here pay in, from the locale's region; a guess the field lets you change */
const REGION_CURRENCY: Record<string, string> = {
  US: 'USD', GB: 'GBP', CA: 'CAD', AU: 'AUD', NZ: 'NZD', JP: 'JPY', CH: 'CHF', IN: 'INR', CN: 'CNY',
  SE: 'SEK', NO: 'NOK', DK: 'DKK', PL: 'PLN', CZ: 'CZK', HU: 'HUF', RO: 'RON', BR: 'BRL', MX: 'MXN',
  TR: 'TRY', IL: 'ILS', ZA: 'ZAR', SG: 'SGD', HK: 'HKD', KR: 'KRW',
  ...Object.fromEntries(['AT', 'BE', 'CY', 'DE', 'EE', 'ES', 'FI', 'FR', 'GR', 'HR', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PT', 'SI', 'SK'].map(r => [r, 'EUR']))
}

export function guessCurrency(records: { meta: RenewalMeta }[], locale = navigator.language): string {
  // the one already in use beats any guess
  for (const r of records) {
    for (const f of r.meta.fields) if (f.type === 'money' && f.value) return f.value.currency
  }
  const region = (() => {
    try {
      return new Intl.Locale(locale).maximize().region ?? ''
    } catch {
      return ''
    }
  })()
  return REGION_CURRENCY[region] ?? 'USD'
}
