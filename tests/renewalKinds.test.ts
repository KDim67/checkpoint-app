import { describe, expect, it } from 'vitest'
import {
  BUILT_IN_KINDS,
  fieldsFromTemplate,
  kindById,
  kindIdFor,
  newRenewalMeta,
  normalizeKinds,
  renameLinkedFields,
  withoutKind
} from '../src/shared/renewalKinds'

const ids = (): (() => string) => {
  let n = 0
  return () => `id${++n}`
}

describe('kinds', () => {
  it('always has the built-ins, whatever was stored', () => {
    for (const junk of [null, 'nope', 7, { kinds: 'x' }, [{ id: 'domain', name: '' }]]) {
      expect(normalizeKinds(junk).map(k => k.id)).toStrictEqual(BUILT_IN_KINDS.map(k => k.id))
    }
  })

  it('layers edits over a built-in without letting it lose its lookup', () => {
    const kinds = normalizeKinds([{ id: 'domain', name: 'Web address', lookupSource: null, warnAt: [60], fields: [] }])
    const domain = kindById(kinds, 'domain')
    expect(domain).toMatchObject({ name: 'Web address', lookupSource: 'rdap', builtIn: true, warnAt: [60], fields: [] })
  })

  it('adds the user\'s own after the built-ins, never shadowing one', () => {
    const kinds = normalizeKinds([
      { id: 'insurance', name: 'Insurance', icon: 'home', renews: 'manual', cycle: { every: 1, unit: 'year' }, warnAt: [30] },
      { id: 'evil', name: 'Bad icon', icon: '<svg>', lookupSource: 'rdap' }
    ])
    expect(kinds.slice(-2).map(k => k.id)).toStrictEqual(['insurance', 'evil'])
    expect(kindById(kinds, 'insurance')).toMatchObject({ builtIn: false, icon: 'home', lookupSource: null })
    expect(kindById(kinds, 'evil')).toMatchObject({ icon: 'calendar', lookupSource: null })
  })

  it('falls back to Other for a kind that no longer exists', () => {
    expect(kindById(normalizeKinds(null), 'gone').id).toBe('other')
  })

  it('makes ids from names that never clash', () => {
    const kinds = normalizeKinds([{ id: 'car_insurance', name: 'Car insurance' }])
    expect(kindIdFor('Car insurance', kinds)).toBe('car_insurance_2')
    expect(kindIdFor('!!!', kinds)).toBe('kind')
  })

  it('keeps built-ins when asked to delete them', () => {
    const kinds = normalizeKinds([{ id: 'pet', name: 'Pet' }])
    expect(withoutKind(kinds, 'domain').some(k => k.id === 'domain')).toBe(true)
    expect(withoutKind(kinds, 'pet').some(k => k.id === 'pet')).toBe(false)
  })
})

describe('templates', () => {
  const subscription = kindById(normalizeKinds(null), 'subscription')

  it('starts an entry from its kind with fields pointing back at the template', () => {
    const meta = newRenewalMeta(subscription, ids())
    expect(meta).toMatchObject({ kind: 'subscription', renews: 'auto', cycle: { every: 1, unit: 'month' }, warnAt: [7, 1] })
    expect(meta.fields.map(f => [f.id, f.templateFieldId, f.label])).toStrictEqual([
      ['id1', 'subscription.cost', 'Cost'],
      ['id2', 'subscription.card', 'Card ends'],
      ['id3', 'subscription.paid', 'Paid this cycle']
    ])
  })

  it('renames copies of a template field and leaves one-off fields alone', () => {
    const meta = newRenewalMeta(subscription, ids())
    meta.fields.push({ id: 'own', templateFieldId: null, label: 'Cost', type: 'text', value: '' })
    const renamed = renameLinkedFields(meta, 'subscription.cost', 'Price')
    expect(renamed.fields.map(f => f.label)).toStrictEqual(['Price', 'Card ends', 'Paid this cycle', 'Cost'])
  })

  it('gives every copy its own id', () => {
    const make = ids()
    const a = fieldsFromTemplate(subscription, make)
    const b = fieldsFromTemplate(subscription, make)
    expect(new Set([...a, ...b].map(f => f.id)).size).toBe(6)
  })
})
