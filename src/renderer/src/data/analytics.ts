/** The bridge's `analytics` calls, as the renderer reaches them. Typed off the bridge. */

type Bridge = typeof window.electronAPI.analytics

export const getAnalytics = (...args: Parameters<Bridge['getAnalytics']>): ReturnType<Bridge['getAnalytics']> =>
  window.electronAPI.analytics.getAnalytics(...args)
