import { describe, expect, it } from 'vitest'
import { cutSecret, findSecret, guessCurrency, newField, templateCopy, type RenewalDraft } from '../src/renderer/src/components/renewals/renewalDraft'
import { normalizeRenewal } from '../src/shared/renewal'

const KEY = 'sk-proj-AbC123dEf456GhI789jKl012'
const draft = (over: Partial<RenewalDraft> = {}, meta: object = {}): RenewalDraft =>
  ({ title: 'OpenAI', body: '', context: 'work', meta: normalizeRenewal(meta).meta, ...over })

describe('the editor draft', () => {
  it('finds a key wherever it would sync: title, notes, or a text field', () => {
    expect(findSecret(draft({ body: `use ${KEY}` }))?.place).toStrictEqual({ where: 'body' })
    expect(findSecret(draft({}, { fields: [{ id: 'w', label: 'Where', type: 'text', value: KEY }] }))?.place)
      .toStrictEqual({ where: 'field', fieldId: 'w' })
    expect(findSecret(draft({ body: 'renew through the registrar' }))).toBeNull()
  })

  it('cuts the key out and keeps its last four in the hint field it already has', () => {
    const before = draft({ body: `prod ${KEY} vercel` }, { fields: [{ id: 'h', label: 'Key', type: 'keyHint', value: '' }] })
    const after = cutSecret(before, KEY, { where: 'body' }, () => 'unused')
    expect(after.body).toBe('prod vercel')
    expect(after.meta.fields).toStrictEqual([{ id: 'h', templateFieldId: null, label: 'Key', type: 'keyHint', value: 'l012' }])
  })

  it('makes a hint field when there is none', () => {
    const after = cutSecret(draft({ body: KEY }), KEY, { where: 'body' }, () => 'made')
    expect(after.meta.fields).toStrictEqual([{ id: 'made', templateFieldId: null, label: 'Key', type: 'keyHint', value: 'l012' }])
  })

  it('copies a field into a template with its options but not what was filled in', () => {
    const field = { id: 'c', templateFieldId: null, label: 'Card ends', type: 'date' as const, value: 123, precision: 'month' as const, warn: { mode: 'beforeRenewal' as const } }
    expect(templateCopy(field, 't1')).toStrictEqual({ ...field, id: 't1', value: null })
    expect(newField('money', 'm')).toMatchObject({ label: 'Cost', value: null })
  })

  it('guesses a currency from what is in use, then from the region', () => {
    const paid = [{ meta: normalizeRenewal({ fields: [{ id: 'c', label: 'Cost', type: 'money', value: { amount: 1, currency: 'GBP' } }] }).meta }]
    expect(guessCurrency(paid, 'el-GR')).toBe('GBP')
    expect(guessCurrency([], 'el-GR')).toBe('EUR')
    expect(guessCurrency([], 'en-US')).toBe('USD')
    expect(guessCurrency([], 'ja-JP')).toBe('JPY')
  })
})
