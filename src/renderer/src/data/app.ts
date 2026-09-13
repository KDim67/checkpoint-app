type Bridge = typeof window.electronAPI.app

export const checkForUpdates = (...args: Parameters<Bridge['checkForUpdates']>): ReturnType<Bridge['checkForUpdates']> =>
  window.electronAPI.app.checkForUpdates(...args)

export const close = (...args: Parameters<Bridge['close']>): ReturnType<Bridge['close']> =>
  window.electronAPI.app.close(...args)

export const getDataPath = (...args: Parameters<Bridge['getDataPath']>): ReturnType<Bridge['getDataPath']> =>
  window.electronAPI.app.getDataPath(...args)

export const getPathForFile = (...args: Parameters<Bridge['getPathForFile']>): ReturnType<Bridge['getPathForFile']> =>
  window.electronAPI.app.getPathForFile(...args)

export const getVersion = (...args: Parameters<Bridge['getVersion']>): ReturnType<Bridge['getVersion']> =>
  window.electronAPI.app.getVersion(...args)

export const maximize = (...args: Parameters<Bridge['maximize']>): ReturnType<Bridge['maximize']> =>
  window.electronAPI.app.maximize(...args)

export const minimize = (...args: Parameters<Bridge['minimize']>): ReturnType<Bridge['minimize']> =>
  window.electronAPI.app.minimize(...args)

export const onNavigateToView = (...args: Parameters<Bridge['onNavigateToView']>): ReturnType<Bridge['onNavigateToView']> =>
  window.electronAPI.app.onNavigateToView(...args)

export const onUpdateProgress = (...args: Parameters<Bridge['onUpdateProgress']>): ReturnType<Bridge['onUpdateProgress']> =>
  window.electronAPI.app.onUpdateProgress(...args)

export const openExternal = (...args: Parameters<Bridge['openExternal']>): ReturnType<Bridge['openExternal']> =>
  window.electronAPI.app.openExternal(...args)

export const osUserName = (): Bridge['osUserName'] => window.electronAPI.app.osUserName

export const platform = (): Bridge['platform'] => window.electronAPI.app.platform

export const saveBinaryFile = (...args: Parameters<Bridge['saveBinaryFile']>): ReturnType<Bridge['saveBinaryFile']> =>
  window.electronAPI.app.saveBinaryFile(...args)

export const saveFile = (...args: Parameters<Bridge['saveFile']>): ReturnType<Bridge['saveFile']> =>
  window.electronAPI.app.saveFile(...args)

export const showItemInFolder = (...args: Parameters<Bridge['showItemInFolder']>): ReturnType<Bridge['showItemInFolder']> =>
  window.electronAPI.app.showItemInFolder(...args)

export const updateState = (...args: Parameters<Bridge['updateState']>): ReturnType<Bridge['updateState']> =>
  window.electronAPI.app.updateState(...args)

export const versions = (): Bridge['versions'] => window.electronAPI.app.versions
