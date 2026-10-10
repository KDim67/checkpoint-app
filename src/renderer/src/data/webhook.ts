type Bridge = typeof window.electronAPI.webhook

export const getToken = (...args: Parameters<Bridge['getToken']>): ReturnType<Bridge['getToken']> =>
  window.electronAPI.webhook.getToken(...args)

export const toggle = (...args: Parameters<Bridge['toggle']>): ReturnType<Bridge['toggle']> =>
  window.electronAPI.webhook.toggle(...args)
