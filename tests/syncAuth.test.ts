import { describe, it, expect } from 'vitest'
import { createHmac } from 'node:crypto'
import { sameSecret } from '../src/main/syncService'

// The pairing handshake is the only thing between a LAN socket and the user's
// database, so what counts as a matching digest is worth pinning down.

const digest = (code: string, salt: string): string =>
  createHmac('sha256', code).update(salt).digest('hex')

describe('comparing a pairing digest', () => {
  const salt = 'a1b2c3'

  it('accepts the digest the right code produces', () => {
    expect(sameSecret(digest('123456', salt), digest('123456', salt))).toBe(true)
  })

  it('rejects the digest a different code produces', () => {
    expect(sameSecret(digest('123456', salt), digest('123457', salt))).toBe(false)
  })

  it('rejects a digest that is the wrong length rather than throwing', () => {
    // timingSafeEqual throws when the buffers differ in length, and a throw
    // inside the connection handler would take the sync host down. A short
    // answer has to fail, not crash.
    expect(() => sameSecret('abcd', digest('123456', salt))).not.toThrow()
    expect(sameSecret('abcd', digest('123456', salt))).toBe(false)
  })

  it('rejects text that is not hex at all', () => {
    expect(sameSecret('not a digest', digest('123456', salt))).toBe(false)
  })

  it('rejects an empty answer', () => {
    expect(sameSecret('', digest('123456', salt))).toBe(false)
  })

  it('rejects a digest that is a prefix of the right one', () => {
    const right = digest('123456', salt)
    expect(sameSecret(right.slice(0, -2), right)).toBe(false)
  })
})
