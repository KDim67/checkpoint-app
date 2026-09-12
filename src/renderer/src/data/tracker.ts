/** The bridge's `tracker` calls, as the renderer reaches them. Typed off the bridge. */

type Bridge = typeof window.electronAPI.tracker

export const getActivityStats = (...args: Parameters<Bridge['getActivityStats']>): ReturnType<Bridge['getActivityStats']> =>
  window.electronAPI.tracker.getActivityStats(...args)

export const getState = (...args: Parameters<Bridge['getState']>): ReturnType<Bridge['getState']> =>
  window.electronAPI.tracker.getState(...args)

export const toggle = (...args: Parameters<Bridge['toggle']>): ReturnType<Bridge['toggle']> =>
  window.electronAPI.tracker.toggle(...args)
