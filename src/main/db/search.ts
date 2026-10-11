import type Database from 'better-sqlite3'
import type { Item, PaginatedResult, SearchQuery, TaskQueryParams } from '../../shared/types'
import { getDb, prepareOnce } from './connection'
import { getItemById, rowToItem, TAG_DATA } from './items'
import { allDayRange, DAY_MS } from '../../shared/dueDate'

export function searchItems(query: SearchQuery): PaginatedResult<Item> {
  const page = query.page ?? 1
  const pageSize = query.pageSize ?? 20
  const pageIndex = page > 0 ? page - 1 : 0
  const offset = pageIndex * pageSize

  const rawQuery = (query.query || '').trim()
  if (!rawQuery) {
    return { items: [], total: 0, page, pageSize }
  }

  // exact UUID: direct lookup, still scoped so callers can't link across contexts
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawQuery)
  if (isUuid) {
    const item = getItemById(rawQuery)
    const matches =
      !!item &&
      (query.context === undefined || item.context === query.context) &&
      (query.type === undefined || item.type === query.type) &&
      (query.status === undefined || item.status === query.status)
    return {
      items: matches && item ? [item] : [],
      total: matches ? 1 : 0,
      page,
      pageSize
    }
  }

  // quote each term so user input isn't parsed as FTS syntax
  const terms = rawQuery.split(/\s+/).filter(Boolean)
  const ftsQuery = terms.map(t => `"${t.replace(/"/g, '""')}*"`).join(' AND ')

  // scoped on top of the FTS match, e.g. relation linking from the backlog drawer
  let sql = `
    SELECT i.*, GROUP_CONCAT(t.id || '|' || t.name || '|' || t.color, ';;') as tag_data
    FROM items i
    JOIN items_fts fts ON i.id = fts.id
    LEFT JOIN item_tags it ON i.id = it.item_id
    LEFT JOIN tags t ON it.tag_id = t.id
    WHERE items_fts MATCH ?
  `
  const args: (string | number)[] = [ftsQuery]

  if (query.context !== undefined) {
    sql += ` AND i.context = ?`
    args.push(query.context)
  }
  if (query.type !== undefined) {
    sql += ` AND i.type = ?`
    args.push(query.type)
  }
  if (query.status !== undefined) {
    sql += ` AND i.status = ?`
    args.push(query.status)
  }

  sql += ` GROUP BY i.id ORDER BY rank`

  const countSql = `SELECT COUNT(*) as count FROM (${sql})`
  const countArgs = [...args]

  sql += ` LIMIT ? OFFSET ?`
  args.push(pageSize, offset)

  const db = getDb()
  const rows = prepareOnce(db, sql).all(...args) as Record<string, unknown>[]
  const total = (prepareOnce(db, countSql).get(...countArgs) as { count: number }).count
  return { items: rows.map(rowToItem), total, page, pageSize }
}

export function queryTasks(db: Database.Database, context: string, params: TaskQueryParams): PaginatedResult<Item> {
  const page = params.page ?? 1
  const pageSize = params.pageSize ?? 50
  const offset = (page - 1) * pageSize

  // the filters touch the items alone, so neither the count nor the page needs the tags joined in
  let where = `i.context = ? AND i.type = 'task' AND i.status ${params.archivedOnly ? '=' : '!='} 'archived'`
  const args: (string | number | null)[] = [context]

  if (params.status && params.status.length > 0) {
    where += ` AND i.status IN (${params.status.map(() => '?').join(',')})`
    args.push(...params.status)
  }

  if (params.priority && params.priority.length > 0) {
    where += ` AND i.priority IN (${params.priority.map(() => '?').join(',')})`
    args.push(...params.priority)
  }

  // a whole day is in the range when its day is over by the end of it; a moment by the clock
  const days = allDayRange(params.dueStart, params.dueEnd)
  if (params.dueStart !== undefined && params.dueStart !== null) {
    where += ` AND ((i.due_at % ${DAY_MS} = 0 AND i.due_at >= ?) OR (i.due_at % ${DAY_MS} <> 0 AND i.due_at >= ?))`
    args.push(days.from, params.dueStart)
  }
  if (params.dueEnd !== undefined && params.dueEnd !== null) {
    where += ` AND ((i.due_at % ${DAY_MS} = 0 AND i.due_at <= ?) OR (i.due_at % ${DAY_MS} <> 0 AND i.due_at <= ?))`
    args.push(days.to, params.dueEnd)
  }

  // no due date matches no range, so it needs its own clause
  if (params.noDueDate) {
    where += ` AND i.due_at IS NULL`
  }

  if (params.untagged) {
    where += ` AND NOT EXISTS (SELECT 1 FROM item_tags x WHERE x.item_id = i.id)`
  }

  const relations = `(SELECT COUNT(*) FROM relations r WHERE r.from_id = i.id OR r.to_id = i.id)`
  if (params.hasRelations !== undefined && params.hasRelations !== null) {
    where += params.hasRelations ? ` AND ${relations} > 0` : ` AND ${relations} = 0`
  }

  if (params.query && params.query.trim() !== '') {
    where += ` AND (i.title LIKE ? OR i.body LIKE ?)`
    const likePattern = `%${params.query}%`
    args.push(likePattern, likePattern)
  }

  // tags AND, not OR
  if (params.tagIds && params.tagIds.length > 0) {
    where += ` AND i.id IN (
      SELECT item_id FROM item_tags
      WHERE tag_id IN (${params.tagIds.map(() => '?').join(',')})
      GROUP BY item_id
      HAVING COUNT(DISTINCT tag_id) = ?
    )`
    args.push(...params.tagIds, params.tagIds.length)
  }

  const allowedSortFields = ['status', 'priority', 'title', 'created_at', 'due_at', 'relations_count']
  const sortBy = allowedSortFields.includes(params.sortBy ?? '') ? params.sortBy : 'created_at'
  const sortDirection = params.sortDesc ? 'DESC' : 'ASC'

  let sortKey = `i.${sortBy}`
  const sortArgs: number[] = []
  if (sortBy === 'relations_count') {
    sortKey = relations
  } else if (sortBy === 'due_at') {
    // a whole day sorts at the end of its day here, after the moments on it; near enough across a clock change
    sortKey = `CASE WHEN i.due_at % ${DAY_MS} = 0 THEN i.due_at + ? ELSE i.due_at END`
    sortArgs.push(DAY_MS - 1 + new Date().getTimezoneOffset() * 60_000)
  }

  // the page's own rows first, in order, then their tags; the key comes first in the text, so its value binds first
  const sql = `
    SELECT i.*, ${TAG_DATA}
    FROM (SELECT i.*, ${sortKey} AS sort_key FROM items i WHERE ${where} ORDER BY sort_key ${sortDirection} LIMIT ? OFFSET ?) i
    ORDER BY i.sort_key ${sortDirection}
  `
  const rows = prepareOnce(db, sql).all(...sortArgs, ...args, pageSize, offset) as Record<string, unknown>[]
  const countRow = prepareOnce(db, `SELECT COUNT(*) as count FROM items i WHERE ${where}`).get(...args) as { count: number }
  const total = countRow ? countRow.count : 0

  return {
    items: rows.map(rowToItem),
    total,
    page,
    pageSize
  }
}
