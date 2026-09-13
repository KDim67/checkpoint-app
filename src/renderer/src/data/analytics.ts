type Bridge = typeof window.electronAPI.analytics

export const getAnalytics = (...args: Parameters<Bridge['getAnalytics']>): ReturnType<Bridge['getAnalytics']> =>
  window.electronAPI.analytics.getAnalytics(...args)
