/** The bridge's `exporter` calls, as the renderer reaches them. Typed off the bridge. */

type Bridge = typeof window.electronAPI.exporter

export const items = (...args: Parameters<Bridge['items']>): ReturnType<Bridge['items']> =>
  window.electronAPI.exporter.items(...args)
