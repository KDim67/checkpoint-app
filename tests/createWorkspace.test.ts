import { describe, it, expect } from 'vitest'
import { slugifyWorkspace } from '../src/renderer/src/lib/createWorkspace'

describe('slugifyWorkspace', () => {
  it('lowercases and hyphenates', () => {
    expect(slugifyWorkspace('My Unity Project')).toBe('my-unity-project')
  })

  it('collapses runs of punctuation into a single hyphen', () => {
    expect(slugifyWorkspace('Game -- Jam!!  2026')).toBe('game-jam-2026')
  })

  it('trims hyphens from both ends', () => {
    expect(slugifyWorkspace('  ...Client Work...  ')).toBe('client-work')
  })

  it('returns empty for a name with nothing usable in it', () => {
    // The caller treats this as a validation failure rather than creating a
    // workspace whose slug is the empty string.
    expect(slugifyWorkspace('!!!')).toBe('')
    expect(slugifyWorkspace('   ')).toBe('')
  })

  it('keeps digits', () => {
    expect(slugifyWorkspace('Sprint 42')).toBe('sprint-42')
  })

  it('is idempotent, so re-slugging an existing slug is safe', () => {
    const once = slugifyWorkspace('My Project')
    expect(slugifyWorkspace(once)).toBe(once)
  })
})
