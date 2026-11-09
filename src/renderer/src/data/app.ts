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

export const installUpdate = (...args: Parameters<Bridge['installUpdate']>): ReturnType<Bridge['installUpdate']> =>
  window.electronAPI.app.installUpdate(...args)

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

export const releaseNotes = (...args: Parameters<Bridge['releaseNotes']>): ReturnType<Bridge['releaseNotes']> =>
  window.electronAPI.app.releaseNotes(...args)

export const saveBinaryFile = (...args: Parameters<Bridge['saveBinaryFile']>): ReturnType<Bridge['saveBinaryFile']> =>
  window.electronAPI.app.saveBinaryFile(...args)

export const saveFile = (...args: Parameters<Bridge['saveFile']>): ReturnType<Bridge['saveFile']> =>
  window.electronAPI.app.saveFile(...args)

export const setTitleBarColors = (...args: Parameters<Bridge['setTitleBarColors']>): ReturnType<Bridge['setTitleBarColors']> =>
  window.electronAPI.app.setTitleBarColors(...args)

export const showItemInFolder = (...args: Parameters<Bridge['showItemInFolder']>): ReturnType<Bridge['showItemInFolder']> =>
  window.electronAPI.app.showItemInFolder(...args)

export const openPath = (...args: Parameters<Bridge['openPath']>): ReturnType<Bridge['openPath']> =>
  window.electronAPI.app.openPath(...args)

export const showUpdateLog = (...args: Parameters<Bridge['showUpdateLog']>): ReturnType<Bridge['showUpdateLog']> =>
  window.electronAPI.app.showUpdateLog(...args)

export const showAppLog = (...args: Parameters<Bridge['showAppLog']>): ReturnType<Bridge['showAppLog']> =>
  window.electronAPI.app.showAppLog(...args)

export const problemReport = (...args: Parameters<Bridge['problemReport']>): ReturnType<Bridge['problemReport']> =>
  window.electronAPI.app.problemReport(...args)

export const crashNotice = (...args: Parameters<Bridge['crashNotice']>): ReturnType<Bridge['crashNotice']> =>
  window.electronAPI.app.crashNotice(...args)

export const logError = (...args: Parameters<Bridge['logError']>): ReturnType<Bridge['logError']> =>
  window.electronAPI.app.logError(...args)

export const updateState = (...args: Parameters<Bridge['updateState']>): ReturnType<Bridge['updateState']> =>
  window.electronAPI.app.updateState(...args)

export const versions = (): Bridge['versions'] => window.electronAPI.app.versions
