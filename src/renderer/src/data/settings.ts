/** Rows in the settings table, as the renderer reaches them. The typed readers built on these are in lib/settings. */

type Db = typeof window.electronAPI.db

export const deleteSetting = (...args: Parameters<Db['deleteSetting']>): ReturnType<Db['deleteSetting']> =>
  window.electronAPI.db.deleteSetting(...args)

export const getSetting = (...args: Parameters<Db['getSetting']>): ReturnType<Db['getSetting']> =>
  window.electronAPI.db.getSetting(...args)

export const setSetting = (...args: Parameters<Db['setSetting']>): ReturnType<Db['setSetting']> =>
  window.electronAPI.db.setSetting(...args)
