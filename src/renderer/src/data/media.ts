type Bridge = typeof window.electronAPI.media

export const getStorageInfo = (...args: Parameters<Bridge['getStorageInfo']>): ReturnType<Bridge['getStorageInfo']> =>
  window.electronAPI.media.getStorageInfo(...args)

export const saveFilePaths = (...args: Parameters<Bridge['saveFilePaths']>): ReturnType<Bridge['saveFilePaths']> =>
  window.electronAPI.media.saveFilePaths(...args)

export const saveFromBuffer = (...args: Parameters<Bridge['saveFromBuffer']>): ReturnType<Bridge['saveFromBuffer']> =>
  window.electronAPI.media.saveFromBuffer(...args)

export const scanAndPrune = (...args: Parameters<Bridge['scanAndPrune']>): ReturnType<Bridge['scanAndPrune']> =>
  window.electronAPI.media.scanAndPrune(...args)
