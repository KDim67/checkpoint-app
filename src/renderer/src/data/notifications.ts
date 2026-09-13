type Bridge = typeof window.electronAPI.notifications

export const getPolicy = (...args: Parameters<Bridge['getPolicy']>): ReturnType<Bridge['getPolicy']> =>
  window.electronAPI.notifications.getPolicy(...args)

export const send = (...args: Parameters<Bridge['send']>): ReturnType<Bridge['send']> =>
  window.electronAPI.notifications.send(...args)

export const setPolicy = (...args: Parameters<Bridge['setPolicy']>): ReturnType<Bridge['setPolicy']> =>
  window.electronAPI.notifications.setPolicy(...args)
