type Bridge = typeof window.electronAPI.tray

export const action = (...args: Parameters<Bridge['action']>): ReturnType<Bridge['action']> =>
  window.electronAPI.tray.action(...args)

export const getStartup = (...args: Parameters<Bridge['getStartup']>): ReturnType<Bridge['getStartup']> =>
  window.electronAPI.tray.getStartup(...args)

export const onStartupChanged = (...args: Parameters<Bridge['onStartupChanged']>): ReturnType<Bridge['onStartupChanged']> =>
  window.electronAPI.tray.onStartupChanged(...args)

export const resize = (...args: Parameters<Bridge['resize']>): ReturnType<Bridge['resize']> =>
  window.electronAPI.tray.resize(...args)

export const setStartup = (...args: Parameters<Bridge['setStartup']>): ReturnType<Bridge['setStartup']> =>
  window.electronAPI.tray.setStartup(...args)

export const summary = (...args: Parameters<Bridge['summary']>): ReturnType<Bridge['summary']> =>
  window.electronAPI.tray.summary(...args)
