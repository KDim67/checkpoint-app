/** The bridge's `subtasks` calls, as the renderer reaches them. Typed off the bridge. */

type Bridge = typeof window.electronAPI.subtasks

export const add = (...args: Parameters<Bridge['add']>): ReturnType<Bridge['add']> =>
  window.electronAPI.subtasks.add(...args)

export const convert = (...args: Parameters<Bridge['convert']>): ReturnType<Bridge['convert']> =>
  window.electronAPI.subtasks.convert(...args)

export const list = (...args: Parameters<Bridge['list']>): ReturnType<Bridge['list']> =>
  window.electronAPI.subtasks.list(...args)

export const remove = (...args: Parameters<Bridge['remove']>): ReturnType<Bridge['remove']> =>
  window.electronAPI.subtasks.remove(...args)

export const update = (...args: Parameters<Bridge['update']>): ReturnType<Bridge['update']> =>
  window.electronAPI.subtasks.update(...args)
