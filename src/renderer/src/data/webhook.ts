/** The bridge's `webhook` calls, as the renderer reaches them. Typed off the bridge. */

type Bridge = typeof window.electronAPI.webhook

export const toggle = (...args: Parameters<Bridge['toggle']>): ReturnType<Bridge['toggle']> =>
  window.electronAPI.webhook.toggle(...args)
