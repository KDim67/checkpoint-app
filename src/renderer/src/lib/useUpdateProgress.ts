/** held once for the app: two surfaces, one download; late mounts get the current figure */

import { useEffect, useState } from 'react'
import type { UpdateProgress } from '../../../shared/types'
import * as appApi from '../data/app'

type Listener = (progress: UpdateProgress | null) => void

const listeners = new Set<Listener>()
let current: UpdateProgress | null = null
let subscribed = false

function publish(next: UpdateProgress | null): void {
  current = next
  for (const listener of listeners) listener(next)
}

/** never unsubscribed, dropping the listener would lose events in the gap */
function ensureSubscribed(): void {
  if (subscribed) return
  subscribed = true
  appApi.onUpdateProgress(publish)
  appApi.updateState()
    // a live event before this resolves is newer
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
