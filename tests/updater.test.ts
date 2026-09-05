import { describe, it, expect } from 'vitest'
import { shouldCheckForUpdates } from '../src/main/updater'

// The updater is reached from two places: the ordinary startup path and the
// one taken after a database had to be rebuilt. Both are legitimate, so what
// matters is that it never runs in development and never starts twice.

describe('when the updater runs at all', () => {
  it('stays out of the way in development', () => {
    // The electron stub reports an unpackaged app, which is what a dev run is.
    // Without this the updater would hit GitHub on every `npm run dev`.
    expect(shouldCheckForUpdates()).toBe(false)
  })
})
