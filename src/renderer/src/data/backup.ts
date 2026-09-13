type Bridge = typeof window.electronAPI.backup

export const getStatus = (...args: Parameters<Bridge['getStatus']>): ReturnType<Bridge['getStatus']> =>
  window.electronAPI.backup.getStatus(...args)

export const run = (...args: Parameters<Bridge['run']>): ReturnType<Bridge['run']> =>
  window.electronAPI.backup.run(...args)
