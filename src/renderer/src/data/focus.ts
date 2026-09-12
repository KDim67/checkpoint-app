/** Focus sessions, as the renderer reaches them. Typed off the bridge. */

type Db = typeof window.electronAPI.db

export const getFocusSessions = (...args: Parameters<Db['getFocusSessions']>): ReturnType<Db['getFocusSessions']> =>
  window.electronAPI.db.getFocusSessions(...args)

export const createFocusSession = (...args: Parameters<Db['createFocusSession']>): ReturnType<Db['createFocusSession']> =>
  window.electronAPI.db.createFocusSession(...args)
