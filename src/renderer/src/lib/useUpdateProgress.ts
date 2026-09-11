/**
 * What the background update download is doing, shared by everything that shows it.
 *
 * Held once for the whole app rather than once per component. Two surfaces want
 * it, the titlebar indicator and the About panel, and each mounting its own
 * subscription would mean two IPC reads and two listeners describing the same
 * single download.
 *
 * It also has to survive the panel being shut, which is where most of a download
 * happens. A component mounting halfway through gets the current figure straight
 * away instead of waiting for the next event, and a download that finished an
 * hour ago still has something to say.
 */

import { useEffect, useState } from 'react'
import type { UpdateProgress } from '../../../shared/types'

type Listener = (progress: UpdateProgress | null) => void

const listeners = new Set<Listener>()
let current: UpdateProgress | null = null
let subscribed = false

function publish(next: UpdateProgress | null): void {
  current = next
  for (const listener of listeners) listener(next)
}

/**
 * Subscribed on first use and never unsubscribed. The indicator is mounted for
 * the whole session anyway, and dropping the listener between components would
 * lose the events that arrive in the gap.
 */
function ensureSubscribed(): void {
  if (subscribed) return
  subscribed = true
  window.electronAPI.app.onUpdateProgress(publish)
  window.electronAPI.app.updateState()
    // A live event that lands before this read resolves is the newer answer.
    .then(state => { if (state && !current) publish(state) })
    .catch(err => console.error('Failed to read the update state:', err))
}

export function useUpdateProgress(): UpdateProgress | null {
  const [progress, setProgress] = useState<UpdateProgress | null>(current)

  useEffect(() => {
    listeners.add(setProgress)
    ensureSubscribed()
    setProgress(current)
    return () => { listeners.delete(setProgress) }
  }, [])

  return progress
}
