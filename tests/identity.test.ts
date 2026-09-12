import { describe, it, expect } from 'vitest'
import { newInstallId, readInstallId } from '../src/shared/identity'

// A removal is remembered against the install id, so a value that fails to read
// means the peer holding it cannot be barred from coming back.
describe('readInstallId', () => {
  it('accepts one it minted', () => {
    const id = newInstallId()
    expect(readInstallId(id)).toBe(id)
  })

  it('refuses anything that is not one', () => {
    for (const bad of [undefined, null, 42, {}, [], '', 'short', 'has spaces', 'UPPER-case']) {
      expect(readInstallId(bad)).toBe('')
    }
  })

  it('refuses one long enough to be somebody stuffing the setting', () => {
    expect(readInstallId('a'.repeat(65))).toBe('')
    expect(readInstallId('a'.repeat(64))).toBe('a'.repeat(64))
  })
})

describe('newInstallId', () => {
  it('mints something it will read back', () => {
    expect(readInstallId(newInstallId())).not.toBe('')
  })

  it('does not repeat itself', () => {
    const ids = new Set(Array.from({ length: 200 }, () => newInstallId()))
    expect(ids.size).toBe(200)
  })

  it('still reads back when the random half comes out empty', () => {
    // Math.random() of 0 stringifies to '0', which slices to nothing, so the
    // id is the timestamp and a trailing dash. It has to survive its own reader.
    expect(readInstallId(newInstallId(() => 0))).not.toBe('')
  })
})
