/** The bridge's `cookbook` calls, as the renderer reaches them. Typed off the bridge. */

type Bridge = typeof window.electronAPI.cookbook

export const checkOllama = (...args: Parameters<Bridge['checkOllama']>): ReturnType<Bridge['checkOllama']> =>
  window.electronAPI.cookbook.checkOllama(...args)

export const deleteModel = (...args: Parameters<Bridge['deleteModel']>): ReturnType<Bridge['deleteModel']> =>
  window.electronAPI.cookbook.deleteModel(...args)

export const getHardwareSpecs = (...args: Parameters<Bridge['getHardwareSpecs']>): ReturnType<Bridge['getHardwareSpecs']> =>
  window.electronAPI.cookbook.getHardwareSpecs(...args)

export const onPullDone = (...args: Parameters<Bridge['onPullDone']>): ReturnType<Bridge['onPullDone']> =>
  window.electronAPI.cookbook.onPullDone(...args)

export const onPullError = (...args: Parameters<Bridge['onPullError']>): ReturnType<Bridge['onPullError']> =>
  window.electronAPI.cookbook.onPullError(...args)

export const onPullProgress = (...args: Parameters<Bridge['onPullProgress']>): ReturnType<Bridge['onPullProgress']> =>
  window.electronAPI.cookbook.onPullProgress(...args)

export const pullModel = (...args: Parameters<Bridge['pullModel']>): ReturnType<Bridge['pullModel']> =>
  window.electronAPI.cookbook.pullModel(...args)

export const stopPull = (...args: Parameters<Bridge['stopPull']>): ReturnType<Bridge['stopPull']> =>
  window.electronAPI.cookbook.stopPull(...args)
