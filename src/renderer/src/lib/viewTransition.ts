/** a change of view as one crossfade; React has to draw the new view inside the callback, or the browser captures the old one twice */

import { flushSync } from 'react-dom'
import { prefersReducedMotion } from './presence'

export function withViewTransition(update: () => void): void {
  // a hidden window, such as one a shortcut is still bringing forward, has nothing to show and the browser refuses the transition
  if (typeof document === 'undefined' || !document.startViewTransition || document.visibilityState !== 'visible' || prefersReducedMotion()) {
    update()
    return
  }
  const transition = document.startViewTransition(() => flushSync(update))
  // one the browser drops, such as for a newer one started straight after, still makes the change; only the fade is lost, which is no error
  transition.ready.catch(() => {})
}
