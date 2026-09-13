type Bridge = typeof window.electronAPI.clipboard

export const clearHistory = (...args: Parameters<Bridge['clearHistory']>): ReturnType<Bridge['clearHistory']> =>
  window.electronAPI.clipboard.clearHistory(...args)

export const createSnippet = (...args: Parameters<Bridge['createSnippet']>): ReturnType<Bridge['createSnippet']> =>
  window.electronAPI.clipboard.createSnippet(...args)

export const deleteItem = (...args: Parameters<Bridge['deleteItem']>): ReturnType<Bridge['deleteItem']> =>
  window.electronAPI.clipboard.deleteItem(...args)

export const getHistory = (...args: Parameters<Bridge['getHistory']>): ReturnType<Bridge['getHistory']> =>
  window.electronAPI.clipboard.getHistory(...args)

export const onHistoryChanged = (...args: Parameters<Bridge['onHistoryChanged']>): ReturnType<Bridge['onHistoryChanged']> =>
  window.electronAPI.clipboard.onHistoryChanged(...args)

export const paste = (...args: Parameters<Bridge['paste']>): ReturnType<Bridge['paste']> =>
  window.electronAPI.clipboard.paste(...args)

export const restoreItem = (...args: Parameters<Bridge['restoreItem']>): ReturnType<Bridge['restoreItem']> =>
  window.electronAPI.clipboard.restoreItem(...args)

export const togglePin = (...args: Parameters<Bridge['togglePin']>): ReturnType<Bridge['togglePin']> =>
  window.electronAPI.clipboard.togglePin(...args)

export const updateLabel = (...args: Parameters<Bridge['updateLabel']>): ReturnType<Bridge['updateLabel']> =>
  window.electronAPI.clipboard.updateLabel(...args)
