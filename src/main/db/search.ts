import type Database from 'better-sqlite3'
import type { Item, PaginatedResult, SearchQuery, TaskQueryParams } from '../../shared/types'
import { getDb, prepareOnce } from './connection'
import { getItemById, rowToItem } from './items'

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

  let sql = `
    SELECT i.*, GROUP_CONCAT(t.id || '|' || t.name || '|' || t.color, ';;') as tag_data,
           (SELECT COUNT(*) FROM relations r WHERE r.from_id = i.id OR r.to_id = i.id) as relations_count
    FROM items i
    LEFT JOIN item_tags it ON i.id = it.item_id
    LEFT JOIN tags t ON it.tag_id = t.id
    WHERE i.context = ? AND i.type = 'task' AND i.status ${params.archivedOnly ? '=' : '!='} 'archived'
  `
  const args: (string | number | null)[] = [context]

  if (params.status && params.status.length > 0) {
    sql += ` AND i.status IN (${params.status.map(() => '?').join(',')})`
    args.push(...params.status)
  }

  if (params.priority && params.priority.length > 0) {
    sql += ` AND i.priority IN (${params.priority.map(() => '?').join(',')})`
    args.push(...params.priority)
  }

  if (params.dueStart !== undefined && params.dueStart !== null) {
    sql += ` AND i.due_at >= ?`
    args.push(params.dueStart)
  }
  if (params.dueEnd !== undefined && params.dueEnd !== null) {
    sql += ` AND i.due_at <= ?`
    args.push(params.dueEnd)
  }

  // no due date matches no range, so it needs its own clause
  if (params.noDueDate) {
    sql += ` AND i.due_at IS NULL`
  }

  if (params.untagged) {
    sql += ` AND NOT EXISTS (SELECT 1 FROM item_tags x WHERE x.item_id = i.id)`
  }

  if (params.hasRelations !== undefined && params.hasRelations !== null) {
    if (params.hasRelations) {
      sql += ` AND (SELECT COUNT(*) FROM relations r WHERE r.from_id = i.id OR r.to_id = i.id) > 0`
    } else {
      sql += ` AND (SELECT COUNT(*) FROM relations r WHERE r.from_id = i.id OR r.to_id = i.id) = 0`
    }
  }

  if (params.query && params.query.trim() !== '') {
    sql += ` AND (i.title LIKE ? OR i.body LIKE ?)`
    const likePattern = `%${params.query}%`
    args.push(likePattern, likePattern)
  }

  // tags AND, not OR
  if (params.tagIds && params.tagIds.length > 0) {
    sql += ` AND i.id IN (
      SELECT item_id FROM item_tags 
      WHERE tag_id IN (${params.tagIds.map(() => '?').join(',')})
      GROUP BY item_id
      HAVING COUNT(DISTINCT tag_id) = ?
    )`
    args.push(...params.tagIds, params.tagIds.length)
  }

  sql += ` GROUP BY i.id`

  const allowedSortFields = ['status', 'priority', 'title', 'created_at', 'due_at', 'relations_count']
  const sortBy = allowedSortFields.includes(params.sortBy ?? '') ? params.sortBy : 'created_at'
  const sortDirection = params.sortDesc ? 'DESC' : 'ASC'
  
  if (sortBy === 'relations_count') {
    sql += ` ORDER BY relations_count ${sortDirection}`
  } else {
    sql += ` ORDER BY i.${sortBy} ${sortDirection}`
  }

  const countSql = `SELECT COUNT(*) as count FROM (${sql})`
  const countArgs = [...args]

  sql += ` LIMIT ? OFFSET ?`
  args.push(pageSize, offset)

  const rows = prepareOnce(db, sql).all(...args) as Record<string, unknown>[]
  const countRow = prepareOnce(db, countSql).get(...countArgs) as { count: number }
  const total = countRow ? countRow.count : 0

  return {
    items: rows.map(rowToItem),
    total,
    page,
    pageSize
  }
}
