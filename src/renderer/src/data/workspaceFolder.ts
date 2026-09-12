/** The bridge's `workspace` calls, as the renderer reaches them. Typed off the bridge. */

type Bridge = typeof window.electronAPI.workspace

export const getStructure = (...args: Parameters<Bridge['getStructure']>): ReturnType<Bridge['getStructure']> =>
  window.electronAPI.workspace.getStructure(...args)

export const readFile = (...args: Parameters<Bridge['readFile']>): ReturnType<Bridge['readFile']> =>
  window.electronAPI.workspace.readFile(...args)

export const selectFolder = (...args: Parameters<Bridge['selectFolder']>): ReturnType<Bridge['selectFolder']> =>
  window.electronAPI.workspace.selectFolder(...args)
