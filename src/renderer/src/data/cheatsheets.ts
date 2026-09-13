type Bridge = typeof window.electronAPI.cheatsheets

export const add = (...args: Parameters<Bridge['add']>): ReturnType<Bridge['add']> =>
  window.electronAPI.cheatsheets.add(...args)

export const getRelevant = (...args: Parameters<Bridge['getRelevant']>): ReturnType<Bridge['getRelevant']> =>
  window.electronAPI.cheatsheets.getRelevant(...args)

export const getText = (...args: Parameters<Bridge['getText']>): ReturnType<Bridge['getText']> =>
  window.electronAPI.cheatsheets.getText(...args)

export const list = (...args: Parameters<Bridge['list']>): ReturnType<Bridge['list']> =>
  window.electronAPI.cheatsheets.list(...args)

export const remove = (...args: Parameters<Bridge['remove']>): ReturnType<Bridge['remove']> =>
  window.electronAPI.cheatsheets.remove(...args)

export const rename = (...args: Parameters<Bridge['rename']>): ReturnType<Bridge['rename']> =>
  window.electronAPI.cheatsheets.rename(...args)

export const search = (...args: Parameters<Bridge['search']>): ReturnType<Bridge['search']> =>
  window.electronAPI.cheatsheets.search(...args)

export const selectFile = (...args: Parameters<Bridge['selectFile']>): ReturnType<Bridge['selectFile']> =>
  window.electronAPI.cheatsheets.selectFile(...args)
