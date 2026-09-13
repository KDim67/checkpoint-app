import { describe, it, expect } from 'vitest'
import { shouldCheckForUpdates } from '../src/main/updater'

// two startup paths reach it; it must never run in dev or start twice

describe('when the updater runs at all', () => {
  it('stays out of the way in development', () => {
    // the stub is unpackaged, like a dev run
    expect(shouldCheckForUpdates()).toBe(false)
  })
})
