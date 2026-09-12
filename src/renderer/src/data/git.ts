/** The bridge's `git` calls, as the renderer reaches them. Typed off the bridge. */

type Bridge = typeof window.electronAPI.git

export const checkRepo = (...args: Parameters<Bridge['checkRepo']>): ReturnType<Bridge['checkRepo']> =>
  window.electronAPI.git.checkRepo(...args)

export const getLog = (...args: Parameters<Bridge['getLog']>): ReturnType<Bridge['getLog']> =>
  window.electronAPI.git.getLog(...args)

export const getStatus = (...args: Parameters<Bridge['getStatus']>): ReturnType<Bridge['getStatus']> =>
  window.electronAPI.git.getStatus(...args)
