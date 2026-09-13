/** match is stable for listeners, bindings is state for display; held once, not a read per card */

import type React from 'react'
import { useCallback, useEffect, useState } from 'react'
import {
  commandForEvent,
  defaultViewBindings,
  loadViewBindings,
  type ShortcutBindings,
  type ShortcutScope
} from './shortcuts'

type Listener = (bindings: ShortcutBindings) => void

const listeners = new Set<Listener>()
/** defaults first, or keys pressed during the read are lost */
let current: ShortcutBindings = defaultViewBindings()
let loaded = false
let inFlight: Promise<void> | null = null

function refresh(): Promise<void> {
  // join a read already in flight
  inFlight ??= loadViewBindings()
    .then(next => {
      current = next
      loaded = true
      for (const listener of listeners) listener(next)
    })
    .catch(err => console.error('Failed to load view shortcuts:', err))
    .finally(() => { inFlight = null })
  return inFlight
}

if (typeof window !== 'undefined') {
  // one app listener, for Settings open over a mounted view
  window.addEventListener('settings-update-shortcuts', () => {
    loaded = false
    void refresh()
  })
}

interface ViewShortcuts {
  bindings: ShortcutBindings
  match: (e: KeyboardEvent | React.KeyboardEvent) => string | null
}

export function useViewShortcuts(scope: ShortcutScope): ViewShortcuts {
  const [bindings, setBindings] = useState<ShortcutBindings>(current)

  useEffect(() => {
    listeners.add(setBindings)
    // late mounts are current, early ones join the read
    if (loaded) setBindings(current)
    else void refresh()
    return () => { listeners.delete(setBindings) }
  }, [])

  // reads the module value, so its identity is stable
  const match = useCallback(
    (e: KeyboardEvent | React.KeyboardEvent) => commandForEvent(e, scope, current),
    [scope]
  )

  return { bindings, match }
}
