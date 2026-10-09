import { describe, it, expect } from 'vitest'
import { checkValue, MAX_SETTINGS, normalizeSettingFields } from '../src/shared/pluginSettings'

describe('the settings a plugin declares', () => {
  it('keeps usable fields, labels them by key when unlabelled, and falls back to text', () => {
    expect(normalizeSettingFields([
      { key: 'webhook', label: 'Webhook', type: 'secret', description: 'From Slack' },
      { key: 'n', type: 'colour' }
    ])).toStrictEqual([
      { key: 'webhook', label: 'Webhook', type: 'secret', description: 'From Slack', default: null },
      { key: 'n', label: 'n', type: 'text', description: null, default: null }
    ])
  })

  it('drops bad or repeated keys, and keeps at most a fixed number', () => {
    const many = Array.from({ length: MAX_SETTINGS + 5 }, (_, i) => ({ key: `k${i}` }))
    expect(normalizeSettingFields(many)).toHaveLength(MAX_SETTINGS)
    expect(normalizeSettingFields([{ key: '1bad' }, { key: 'has space' }, { key: 'ok' }, { key: 'ok', label: 'again' }]).map(f => f.key)).toStrictEqual(['ok'])
  })

  it('never takes a default for a secret, and only a default of the right type otherwise', () => {
    const [secret, number, wrong] = normalizeSettingFields([
      { key: 'token', type: 'secret', default: 'abc' },
      { key: 'limit', type: 'number', default: 4 },
      { key: 'flag', type: 'boolean', default: 'yes' }
    ])
    expect(secret.default).toBeNull()
    expect(number.default).toBe(4)
    expect(wrong.default).toBeNull()
  })
})

describe('a value you fill in', () => {
  it('is checked against its field', () => {
    expect(checkValue('number', '12.5')).toStrictEqual({ ok: true, value: 12.5 })
    expect(checkValue('number', 'abc')).toMatchObject({ ok: false })
    expect(checkValue('boolean', 'true')).toMatchObject({ ok: false })
    expect(checkValue('text', 'x'.repeat(2001))).toMatchObject({ ok: false })
    expect(checkValue('secret', '')).toStrictEqual({ ok: true, value: null })
  })
})
