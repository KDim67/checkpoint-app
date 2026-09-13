import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initDb, closeDb, getSetting, setSetting } from '../src/main/db'
import { ensureWebhookToken, offeredToken, tokenMatches, WEBHOOK_TOKEN_KEY } from '../src/main/webhookAuth'
import { isSecretSetting, secretSettingKeys } from '../src/main/secureSettings'

// loopback is reachable from any page, the token is the only guard

let dir: string

const setup = (): void => {
  dir = mkdtempSync(join(tmpdir(), 'checkpoint-webhook-'))
  initDb(dir)
}
const teardown = (): void => {
  closeDb()
  rmSync(dir, { recursive: true, force: true })
}

describe('the webhook token', () => {
  it('is made on first use and kept afterwards', () => {
    setup()
    try {
      const first = ensureWebhookToken()
      expect(first).toMatch(/^[0-9a-f]{48}$/)
      // a changing token breaks stored scripts on restart
      expect(ensureWebhookToken()).toBe(first)
      expect(getSetting(WEBHOOK_TOKEN_KEY, '')).toBe(first)
    } finally {
      teardown()
    }
  })

  it('is long enough not to be guessed', () => {
    setup()
    try {
      // 24 random bytes, not brute-forceable over HTTP
      expect(Buffer.from(ensureWebhookToken(), 'hex')).toHaveLength(24)
    } finally {
      teardown()
    }
  })

  it('differs between installs', () => {
    setup()
    const a = ensureWebhookToken()
    teardown()

    setup()
    const b = ensureWebhookToken()
    teardown()

    expect(a).not.toBe(b)
  })

  it('replaces a stored value too short to be one of ours', () => {
    setup()
    try {
      // a truncated setting mustn't become a weak token forever
      setSetting(WEBHOOK_TOKEN_KEY, 'short')
      const fixed = ensureWebhookToken()
      expect(fixed).not.toBe('short')
      expect(fixed.length).toBeGreaterThanOrEqual(32)
    } finally {
      teardown()
    }
  })
})

describe('reading the token off a request', () => {
  it('accepts the documented Bearer form', () => {
    expect(offeredToken('Bearer abc123')).toBe('abc123')
  })

  it('accepts it however the caller cased the scheme', () => {
    expect(offeredToken('bearer abc123')).toBe('abc123')
    expect(offeredToken('BEARER abc123')).toBe('abc123')
  })

  it('accepts a bare token, since plenty of tools send one', () => {
    expect(offeredToken('abc123')).toBe('abc123')
  })

  it('is not confused by surrounding whitespace', () => {
    expect(offeredToken('  Bearer   abc123  ')).toBe('abc123')
  })

  it('reads a missing header as no token rather than crashing', () => {
    expect(offeredToken(undefined)).toBe('')
    expect(offeredToken('')).toBe('')
  })
})

describe('checking an offered token', () => {
  const real = 'a'.repeat(48)

  it('accepts the real one', () => {
    expect(tokenMatches(real, real)).toBe(true)
  })

  it('rejects a different one of the same length', () => {
    expect(tokenMatches('b'.repeat(48), real)).toBe(false)
  })

  it('rejects an empty offer, which is what no header produces', () => {
    expect(tokenMatches('', real)).toBe(false)
  })

  it('rejects a prefix of the real one without throwing', () => {
    // a length mismatch throw would let anyone stop the gateway
    expect(() => tokenMatches(real.slice(0, 10), real)).not.toThrow()
    expect(tokenMatches(real.slice(0, 10), real)).toBe(false)
  })

  it('rejects a longer string that starts with the real one', () => {
    expect(tokenMatches(real + 'extra', real)).toBe(false)
  })
})

describe('how the token is stored', () => {
  it('is treated as a secret, so it is encrypted at rest', () => {
    // same file and backups as the provider keys, and it grants writes
    expect(isSecretSetting(WEBHOOK_TOKEN_KEY)).toBe(true)
  })

  it('is in the list the boot migration walks, so existing installs catch up', () => {
    expect(secretSettingKeys()).toContain(WEBHOOK_TOKEN_KEY)
  })

  it('sits alongside the other credential of its kind', () => {
    // encrypted for the same reason as mcp_auth_token
    expect(isSecretSetting('mcp_auth_token')).toBe(true)
    expect(isSecretSetting('ai_api_key')).toBe(true)
  })
})
