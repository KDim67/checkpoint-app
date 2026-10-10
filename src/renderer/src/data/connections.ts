type Bridge = typeof window.electronAPI.connections

export const connect = (...args: Parameters<Bridge['connect']>): ReturnType<Bridge['connect']> =>
  window.electronAPI.connections.connect(...args)

export const disconnect = (...args: Parameters<Bridge['disconnect']>): ReturnType<Bridge['disconnect']> =>
  window.electronAPI.connections.disconnect(...args)

export const list = (...args: Parameters<Bridge['list']>): ReturnType<Bridge['list']> =>
  window.electronAPI.connections.list(...args)

export const onChanged = (...args: Parameters<Bridge['onChanged']>): ReturnType<Bridge['onChanged']> =>
  window.electronAPI.connections.onChanged(...args)

export const clearFolder = (...args: Parameters<Bridge['clearFolder']>): ReturnType<Bridge['clearFolder']> =>
  window.electronAPI.connections.clearFolder(...args)

export const pickFolder = (...args: Parameters<Bridge['pickFolder']>): ReturnType<Bridge['pickFolder']> =>
  window.electronAPI.connections.pickFolder(...args)

export const setJiraProject = (...args: Parameters<Bridge['setJiraProject']>): ReturnType<Bridge['setJiraProject']> =>
  window.electronAPI.connections.setJiraProject(...args)

export const setNotionDatabase = (...args: Parameters<Bridge['setNotionDatabase']>): ReturnType<Bridge['setNotionDatabase']> =>
  window.electronAPI.connections.setNotionDatabase(...args)

export const setProject = (...args: Parameters<Bridge['setProject']>): ReturnType<Bridge['setProject']> =>
  window.electronAPI.connections.setProject(...args)

export const setRepo = (...args: Parameters<Bridge['setRepo']>): ReturnType<Bridge['setRepo']> =>
  window.electronAPI.connections.setRepo(...args)

export const setTeam = (...args: Parameters<Bridge['setTeam']>): ReturnType<Bridge['setTeam']> =>
  window.electronAPI.connections.setTeam(...args)

export const syncNow = (...args: Parameters<Bridge['syncNow']>): ReturnType<Bridge['syncNow']> =>
  window.electronAPI.connections.syncNow(...args)
