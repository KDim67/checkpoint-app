/** The bridge's `backup` calls, as the renderer reaches them. Typed off the bridge. */

type Bridge = typeof window.electronAPI.backup

export const getStatus = (...args: Parameters<Bridge['getStatus']>): ReturnType<Bridge['getStatus']> =>
  window.electronAPI.backup.getStatus(...args)

export const run = (...args: Parameters<Bridge['run']>): ReturnType<Bridge['run']> =>
  window.electronAPI.backup.run(...args)
