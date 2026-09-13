/** pages until done; callers used to pick their own page size and silently lose the rest */

import type { Item, ItemType, PaginatedResult } from '../../../shared/types'

/** one round trip for most boards, still a page */
const PAGE_SIZE = 500

/** for callers that really want paging */
export async function itemPage(
  context: string,
  type: ItemType,
  page: number,
  pageSize: number
): Promise<PaginatedResult<Item>> {
  return window.electronAPI.db.getItems(context, type, page, pageSize)
}

/** pages until rows run out, guarded by the reported total so a growing board can't spin */
export async function readItems(context: string, type: ItemType): Promise<Item[]> {
  const first = await itemPage(context, type, 1, PAGE_SIZE)
  const items = [...first.items]
  const total = first.total ?? items.length
  for (let page = 2; items.length < total; page++) {
    const next = await itemPage(context, type, page, PAGE_SIZE)
    if (next.items.length === 0) break
    items.push(...next.items)
  }
  return items
}

/** without reading them */
export async function countItems(context: string, type: ItemType): Promise<number> {
  const res = await itemPage(context, type, 1, 1)
  return res.total ?? 0
}

/** null when there's none */
export async function latestItem(context: string, type: ItemType): Promise<Item | null> {
  const res = await itemPage(context, type, 1, 1)
  return res.items[0] ?? null
}

// pass-throughs, the one place in the renderer that reaches items

type Db = typeof window.electronAPI.db

export const createItem = (...args: Parameters<Db['createItem']>): ReturnType<Db['createItem']> =>
  window.electronAPI.db.createItem(...args)

export const updateItem = (...args: Parameters<Db['updateItem']>): ReturnType<Db['updateItem']> =>
  window.electronAPI.db.updateItem(...args)

export const deleteItem = (...args: Parameters<Db['deleteItem']>): ReturnType<Db['deleteItem']> =>
  window.electronAPI.db.deleteItem(...args)

export const bulkUpdateItems = (...args: Parameters<Db['bulkUpdateItems']>): ReturnType<Db['bulkUpdateItems']> =>
  window.electronAPI.db.bulkUpdateItems(...args)

export const bulkDeleteItems = (...args: Parameters<Db['bulkDeleteItems']>): ReturnType<Db['bulkDeleteItems']> =>
  window.electronAPI.db.bulkDeleteItems(...args)

export const rebalancePositions = (...args: Parameters<Db['rebalancePositions']>): ReturnType<Db['rebalancePositions']> =>
  window.electronAPI.db.rebalancePositions(...args)

export const searchItems = (...args: Parameters<Db['searchItems']>): ReturnType<Db['searchItems']> =>
  window.electronAPI.db.searchItems(...args)

export const queryTasks = (...args: Parameters<Db['queryTasks']>): ReturnType<Db['queryTasks']> =>
  window.electronAPI.db.queryTasks(...args)
