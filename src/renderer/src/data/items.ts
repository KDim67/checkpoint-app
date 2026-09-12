/**
 * Cards, tasks and log entries, as the rest of the renderer asks for them.
 *
 * The bridge pages, and every screen that wanted a whole board asked for one
 * page with a number it picked itself: 1000 in some places, 500 in others. A
 * workspace past that number lost the rest without saying so, and nothing in
 * the call made that visible.
 */

import type { Item, ItemType, PaginatedResult } from '../../../shared/types'

/** Big enough that most boards need one round trip, small enough to stay a page. */
const PAGE_SIZE = 500

/** One page, for a caller that genuinely wants paging. */
export async function itemPage(
  context: string,
  type: ItemType,
  page: number,
  pageSize: number
): Promise<PaginatedResult<Item>> {
  return window.electronAPI.db.getItems(context, type, page, pageSize)
}

/**
 * Every item of a type in a workspace.
 *
 * Pages until the rows run out rather than guessing a ceiling. The guard on the
 * loop is the total the bridge reports, so a board that grows mid-read ends the
 * loop rather than spinning on it.
 */
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

/** How many of a type a workspace holds, without reading them. */
export async function countItems(context: string, type: ItemType): Promise<number> {
  const res = await itemPage(context, type, 1, 1)
  return res.total ?? 0
}

/** The most recent item of a type, or null when there is none. */
export async function latestItem(context: string, type: ItemType): Promise<Item | null> {
  const res = await itemPage(context, type, 1, 1)
  return res.items[0] ?? null
}

// Writes and queries. They pass straight through, typed off the bridge so the
// two cannot drift apart; what they give is one place in the renderer that
// reaches the database for items.

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
