/** links between items, off the db bridge */

type Db = typeof window.electronAPI.db

export const getRelations = (...args: Parameters<Db['getRelations']>): ReturnType<Db['getRelations']> =>
  window.electronAPI.db.getRelations(...args)

export const createRelation = (...args: Parameters<Db['createRelation']>): ReturnType<Db['createRelation']> =>
  window.electronAPI.db.createRelation(...args)

export const deleteRelation = (...args: Parameters<Db['deleteRelation']>): ReturnType<Db['deleteRelation']> =>
  window.electronAPI.db.deleteRelation(...args)
