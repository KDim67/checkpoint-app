import { useEffect, useState } from 'react'
import { readAiEnabled } from './features'

/**
 * Whether the assistant is switched on.
 *
 * Read per call site, the way the view flags are, so there is no store entry to
 * keep in sync. The last answer is cached at module level: only the very first
 * read is optimistic, so a component mounting later never flashes an AI button
 * at someone who turned AI off.
 */
let cached = true

export function useAiEnabled(): boolean {
  const [enabled, setEnabled] = useState(cached)

  useEffect(() => {
    let stale = false
    const read = (): void => {
      void readAiEnabled().then(value => {
        cached = value
        if (!stale) setEnabled(value)
      })
    }

    read()
    window.addEventListener('settings-update-features', read)
    return () => {
      stale = true
      window.removeEventListener('settings-update-features', read)
    }
  }, [])

  return enabled
}
