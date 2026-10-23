/** keeps a closing dialog, drawer or toast on screen long enough to play its exit, then lets it go */

import { createContext, useContext, useEffect, useState } from 'react'
import { EXIT_MS } from './timings'

export type PresenceState = 'open' | 'closing'

/** with motion reduced there is no exit to wait for */
export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
}

/** mounted: draw it at all; state: closing while its exit plays, which stylesheets key their animation on */
export function usePresence(open: boolean, exitMs: number = EXIT_MS): { mounted: boolean; state: PresenceState } {
  const [lingering, setLingering] = useState(open)

  useEffect(() => {
    if (open) {
      setLingering(true)
      return
    }
    if (prefersReducedMotion()) {
      setLingering(false)
      return
    }
    const timer = setTimeout(() => setLingering(false), exitMs)
    return () => clearTimeout(timer)
  }, [open, exitMs])

  return { mounted: open || lingering, state: open ? 'open' : 'closing' }
}

/** what Presence tells the dialog or drawer inside it */
export const PresenceContext = createContext<PresenceState>('open')

export function usePresenceState(): PresenceState {
  return useContext(PresenceContext)
}
