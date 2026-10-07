import { describe, expect, it } from 'vitest'
import { looksLikeSecret, normalizeHost, parseRenewalText, withoutSecret } from '../src/shared/renewalText'
import { dueDay, isAllDay } from '../src/shared/dueDate'

/** the value, or a failure that says it was missing */
function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('expected a value')
  return value
}

describe('spotting a key', () => {
  it('knows the common prefixes', () => {
    for (const key of [
      'sk-proj-AbC123dEf456GhI789jKl012',
      'sk_live_51HxAbCdEfGhIjKlMnOp',
      'ghp_abcdefghijklmnopqrstuvwxyz0123',
      'AKIAIOSFODNN7EXAMPLE',
      'xoxb-1234567890-abcdefghij',
      'glpat-abcdefghij0123456789'
    ]) {
      expect(looksLikeSecret(`the key is ${key} ok`)).toBe(key)
    }
  })

  it('catches long random tokens', () => {
    expect(looksLikeSecret('token 9fK2mQ7xL4pR8sT1vW6yZ3bN')).toBe('9fK2mQ7xL4pR8sT1vW6yZ3bN')
  })

  it('leaves ordinary notes, links and host names alone', () => {
    for (const text of [
      'Renew through the registrar, card on file',
      'https://console.cloud.google.com/apis/credentials?project=acme-prod-2026',
      'billing.acme-internal-services2026.example.com',
      'pneumonoultramicroscopicsilicovolcanoconiosis',
      '550e8400-e29b-41d4-a716-446655440000'
    ]) {
      expect(looksLikeSecret(text)).toBeNull()
    }
  })

  it('takes the key out and keeps the rest tidy', () => {
    expect(withoutSecret('prod key sk-proj-AbC123dEf456GhI789jKl012 in vercel', 'sk-proj-AbC123dEf456GhI789jKl012'))
      .toBe('prod key in vercel')
  })
})

describe('host names', () => {
  it('reads links and bare names the same way', () => {
    expect(normalizeHost('https://www.Acme.dev/pricing?x=1')).toBe('acme.dev')
    expect(normalizeHost('acme.co.uk')).toBe('acme.co.uk')
    expect(normalizeHost('app.acme.dev:8443')).toBe('app.acme.dev')
  })

  it('writes names in other scripts as punycode', () => {
    expect(normalizeHost('bücher.de')).toBe('xn--bcher-kva.de')
  })

  it('refuses what names no host', () => {
    for (const text of ['', 'localhost', 'not a domain', '10.0.0.1', 'v1.2']) expect(normalizeHost(text)).toBeNull()
  })
})

describe('quick add', () => {
  const now = new Date(2026, 9, 10, 10).getTime()

  it('reads a bare domain as a domain to look up', () => {
    expect(parseRenewalText('acme.dev', now)).toStrictEqual({ title: 'acme.dev', kind: 'domain', expiresAt: undefined, target: 'acme.dev' })
  })

  it('reads a key with a date', () => {
    const guess = parseRenewalText('openai key 20 jan', now)
    expect(guess).toMatchObject({ title: 'openai key', kind: 'api_key', target: null })
    expect(isAllDay(must(guess.expiresAt))).toBe(true)
    expect(dueDay(must(guess.expiresAt))).toStrictEqual({ year: 2027, month: 0, day: 20 })
  })

  it('reads a subscription', () => {
    expect(parseRenewalText('workspace sub 3 may', now)).toMatchObject({ title: 'workspace sub', kind: 'subscription' })
  })

  it('reads a site with "cert" as its certificate', () => {
    expect(parseRenewalText('acme.dev cert', now)).toMatchObject({ kind: 'certificate', target: 'acme.dev', title: 'acme.dev cert' })
  })

  it('does not take a name with a dot in a sentence for a domain', () => {
    expect(parseRenewalText('next.js course licence', now)).toMatchObject({ kind: 'licence', target: null })
  })

  it('falls back to Other', () => {
    expect(parseRenewalText('passport', now)).toMatchObject({ title: 'passport', kind: 'other', expiresAt: undefined })
  })
})
