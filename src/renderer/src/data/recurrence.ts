/** The bridge's `recurrence` calls, as the renderer reaches them. Typed off the bridge. */

type Bridge = typeof window.electronAPI.recurrence

export const create = (...args: Parameters<Bridge['create']>): ReturnType<Bridge['create']> =>
  window.electronAPI.recurrence.create(...args)

export const list = (...args: Parameters<Bridge['list']>): ReturnType<Bridge['list']> =>
  window.electronAPI.recurrence.list(...args)

export const remove = (...args: Parameters<Bridge['remove']>): ReturnType<Bridge['remove']> =>
  window.electronAPI.recurrence.remove(...args)

export const setActive = (...args: Parameters<Bridge['setActive']>): ReturnType<Bridge['setActive']> =>
  window.electronAPI.recurrence.setActive(...args)
