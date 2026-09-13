import { useEffect, useState } from 'react'
import { readAiEnabled } from './features'

/** per call site like the view flags; cached so later mounts never flash an AI button */
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
