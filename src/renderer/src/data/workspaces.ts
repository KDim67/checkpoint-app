/** Workspaces as whole units: listing, exporting, importing and renaming them. Typed off the bridge. */

type Db = typeof window.electronAPI.db

export const getContexts = (...args: Parameters<Db['getContexts']>): ReturnType<Db['getContexts']> =>
  window.electronAPI.db.getContexts(...args)

export const exportContext = (...args: Parameters<Db['exportContext']>): ReturnType<Db['exportContext']> =>
  window.electronAPI.db.exportContext(...args)

export const importContext = (...args: Parameters<Db['importContext']>): ReturnType<Db['importContext']> =>
  window.electronAPI.db.importContext(...args)

export const importContextData = (...args: Parameters<Db['importContextData']>): ReturnType<Db['importContextData']> =>
  window.electronAPI.db.importContextData(...args)

export const renameContext = (...args: Parameters<Db['renameContext']>): ReturnType<Db['renameContext']> =>
  window.electronAPI.db.renameContext(...args)
