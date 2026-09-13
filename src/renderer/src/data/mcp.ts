type Bridge = typeof window.electronAPI.mcp

export const getStatus = (...args: Parameters<Bridge['getStatus']>): ReturnType<Bridge['getStatus']> =>
  window.electronAPI.mcp.getStatus(...args)

export const listActivity = (...args: Parameters<Bridge['listActivity']>): ReturnType<Bridge['listActivity']> =>
  window.electronAPI.mcp.listActivity(...args)

export const onDataChanged = (...args: Parameters<Bridge['onDataChanged']>): ReturnType<Bridge['onDataChanged']> =>
  window.electronAPI.mcp.onDataChanged(...args)

export const regenerateToken = (...args: Parameters<Bridge['regenerateToken']>): ReturnType<Bridge['regenerateToken']> =>
  window.electronAPI.mcp.regenerateToken(...args)

export const toggle = (...args: Parameters<Bridge['toggle']>): ReturnType<Bridge['toggle']> =>
  window.electronAPI.mcp.toggle(...args)

export const undoActivity = (...args: Parameters<Bridge['undoActivity']>): ReturnType<Bridge['undoActivity']> =>
  window.electronAPI.mcp.undoActivity(...args)
