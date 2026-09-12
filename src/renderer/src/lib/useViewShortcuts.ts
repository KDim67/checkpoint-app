/**
 * A view's own key bindings, kept in step with Settings.
 *
 * Two things come back, because views need both. `match` turns a keydown into
 * a command id and is stable across renders, so a listener registered with it
 * in a dependency list is registered once; `bindings` is state, for the places
 * that have to *show* a key rather than react to one. A tooltip or a shortcut
 * sheet printing a hard-coded "V" would start lying the moment somebody
 * changed it, which is the failure this whole thing exists to fix.
 *
 * The bindings themselves are held once for the whole app rather than once per
 * component. A kanban board can hold a hundred cards and every one of them
 * wants the same three rows out of the settings table; a hook that read them
 * on its own would make a hundred trips through IPC on every board render.
 */

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
/**
 * Starts on the defaults rather than empty. The read is asynchronous, and a
 * view that waited for it would swallow every key pressed in the meantime.
 */
let current: ShortcutBindings = defaultViewBindings()
let loaded = false
let inFlight: Promise<void> | null = null

function refresh(): Promise<void> {
  // Callers that arrive while a read is in the air join it instead of starting
  // a second one.
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
  // One listener for the app, installed at import. Settings is a different
  // view, so a change is usually made while these are unmounted; this covers
  // the other order, Settings open over a view still mounted behind it.
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
    // A component mounting after the first read is already current, and one
    // mounting before it joins the read in flight.
    if (loaded) setBindings(current)
    else void refresh()
    return () => { listeners.delete(setBindings) }
  }, [])

  // Reads the module value rather than the state, so its identity never
  // changes and a handler holding it does not need re-registering.
  const match = useCallback(
    (e: KeyboardEvent | React.KeyboardEvent) => commandForEvent(e, scope, current),
    [scope]
  )

  return { bindings, match }
}
