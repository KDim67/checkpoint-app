import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDb, getDb, getAllItems, getItemsPaginated, initDb, queryTasks } from '../src/main/db'
import { workspaceActivity } from '../src/main/db/workspaceActivity'
import { allDayRange, DAY_MS } from '../src/shared/dueDate'
import type { Item, TaskQueryParams } from '../src/shared/types'

// the list queries take their page before attaching tags; each must return what the old join-and-group queries did

let dir: string
const NOW = Date.UTC(2026, 9, 11, 12)
const TAG_DATA_JOIN = `GROUP_CONCAT(t.id || '|' || t.name || '|' || t.color, ';;') as tag_data`

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'checkpoint-list-queries-'))
  initDb(dir)
  const db = getDb()
  db.transaction(() => {
    for (let t = 0; t < 8; t++) db.prepare('INSERT INTO tags (id, name, color) VALUES (?, ?, ?)').run(`tag${t}`, `tag ${t}`, '#535e85')
    const ins = db.prepare(`INSERT INTO items (id, type, context, title, body, status, priority, position, created_at, updated_at, due_at, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}')`)
    const tag = db.prepare('INSERT INTO item_tags (item_id, tag_id) VALUES (?, ?)')
    let n = 0
    for (const ws of ['work', 'home']) {
      for (const [type, count] of [['task', 260], ['card', 140], ['log', 180]] as const) {
        for (let i = 0; i < count; i++) {
          n++
          const id = `${ws}-${type}-${i}`
          const status = type === 'task' ? ['open', 'in_progress', 'done', 'archived'][n % 4] : type === 'card' ? ['open', 'done'][n % 2] : 'open'
          // whole days, moments and none, either side of now
          const due = n % 3 === 0 ? null : n % 3 === 1 ? NOW + ((n % 40) - 20) * DAY_MS - (NOW % DAY_MS) : NOW + (n % 50 - 25) * 3_600_000
          ins.run(id, type, ws, `${['alpha', 'beta', 'gamma'][n % 3]} ${n}`, n % 7 === 0 ? 'mentions the shader' : 'plain', status, n % 4, i * 1.5, NOW - n * 60_000, NOW - ((n * 7919) % 100_000) * 1000, due)
          if (n % 2 === 0) tag.run(id, `tag${n % 8}`)
          if (n % 3 === 0) tag.run(id, `tag${(n + 3) % 8}`)
        }
      }
    }
    const rel = db.prepare('INSERT INTO relations (id, from_id, to_id, type) VALUES (?, ?, ?, ?)')
    for (let r = 0; r < 120; r++) rel.run(`rel${r}`, `work-task-${r}`, `work-task-${(r * 7 + 3) % 260}`, 'relates_to')
  })()
})

afterAll(() => {
  closeDb()
  rmSync(dir, { recursive: true, force: true })
})

const ids = (items: Item[]): string[] => items.map(i => i.id)
const sortedTags = (item: Item): string => (item.tags ?? []).map(t => t.id).sort().join(',')

/** the board and log pages as they were read before */
function oldPage(context: string, type: string, page: number, size: number): Item[] {
  const order = type === 'log' ? 'i.position DESC' : 'i.position ASC'
  const rows = getDb().prepare(`
    SELECT i.*, ${TAG_DATA_JOIN} FROM items i
    LEFT JOIN item_tags it ON i.id = it.item_id LEFT JOIN tags t ON it.tag_id = t.id
    WHERE i.context = ? AND i.type = ? GROUP BY i.id ORDER BY ${order}, i.created_at DESC LIMIT ? OFFSET ?
  `).all(context, type, size, (page - 1) * size) as Record<string, unknown>[]
  return rows.map(r => ({ id: r.id as string, tags: r.tag_data ? String(r.tag_data).split(';;').map(c => ({ id: c.split('|')[0] })) : [] }) as Item)
}

/** the backlog query as it was before, ids and tags only */
function oldTasks(context: string, p: TaskQueryParams): { ids: string[]; tags: Map<string, string>; total: number } {
  let sql = `SELECT i.*, ${TAG_DATA_JOIN}, (SELECT COUNT(*) FROM relations r WHERE r.from_id = i.id OR r.to_id = i.id) as relations_count
    FROM items i LEFT JOIN item_tags it ON i.id = it.item_id LEFT JOIN tags t ON it.tag_id = t.id
    WHERE i.context = ? AND i.type = 'task' AND i.status ${p.archivedOnly ? '=' : '!='} 'archived'`
  const args: (string | number | null)[] = [context]
  if (p.status?.length) { sql += ` AND i.status IN (${p.status.map(() => '?').join(',')})`; args.push(...p.status) }
  if (p.priority?.length) { sql += ` AND i.priority IN (${p.priority.map(() => '?').join(',')})`; args.push(...p.priority) }
  const days = allDayRange(p.dueStart, p.dueEnd)
  if (p.dueStart != null) { sql += ` AND ((i.due_at % ${DAY_MS} = 0 AND i.due_at >= ?) OR (i.due_at % ${DAY_MS} <> 0 AND i.due_at >= ?))`; args.push(days.from, p.dueStart) }
  if (p.dueEnd != null) { sql += ` AND ((i.due_at % ${DAY_MS} = 0 AND i.due_at <= ?) OR (i.due_at % ${DAY_MS} <> 0 AND i.due_at <= ?))`; args.push(days.to, p.dueEnd) }
  if (p.noDueDate) sql += ' AND i.due_at IS NULL'
  if (p.untagged) sql += ' AND NOT EXISTS (SELECT 1 FROM item_tags x WHERE x.item_id = i.id)'
  if (p.hasRelations != null) sql += ` AND (SELECT COUNT(*) FROM relations r WHERE r.from_id = i.id OR r.to_id = i.id) ${p.hasRelations ? '> 0' : '= 0'}`
  if (p.query?.trim()) { sql += ' AND (i.title LIKE ? OR i.body LIKE ?)'; args.push(`%${p.query}%`, `%${p.query}%`) }
  if (p.tagIds?.length) { sql += ` AND i.id IN (SELECT item_id FROM item_tags WHERE tag_id IN (${p.tagIds.map(() => '?').join(',')}) GROUP BY item_id HAVING COUNT(DISTINCT tag_id) = ?)`; args.push(...p.tagIds, p.tagIds.length) }
  sql += ' GROUP BY i.id'
  const rows = getDb().prepare(sql).all(...args) as Record<string, unknown>[]
  return {
    ids: rows.map(r => r.id as string),
    tags: new Map(rows.map(r => [r.id as string, r.tag_data ? String(r.tag_data).split(';;').map(c => c.split('|')[0]).sort().join(',') : ''])),
    total: rows.length
  }
}

/** every page of a backlog query, joined */
function allPages(p: TaskQueryParams): { items: Item[]; total: number } {
  const items: Item[] = []
  let total = 0
  for (let page = 1; page < 50; page++) {
    const res = queryTasks(getDb(), 'work', { ...p, page, pageSize: 23 })
    total = res.total
    items.push(...res.items)
    if (res.items.length < 23) break
  }
  return { items, total }
}

describe('a page of the board or the log', () => {
  it.each([['card', 30], ['log', 40]] as const)('of %s matches the old query page by page, tags included', (type, size) => {
    for (let page = 1; page <= 6; page++) {
      const now = getItemsPaginated('work', type, page, size).items
      const before = oldPage('work', type, page, size)
      expect(ids(now)).toEqual(ids(before))
      expect(now.map(sortedTags)).toEqual(before.map(sortedTags))
    }
  })

  it('reads only its own rows from the list index, with nothing grouped or sorted aside', () => {
    const plan = (getDb().prepare(`EXPLAIN QUERY PLAN SELECT * FROM items WHERE context = 'work' AND type = 'log' ORDER BY position DESC, created_at DESC LIMIT 50 OFFSET 0`).all() as { detail: string }[]).map(r => r.detail).join(' | ')
    expect(plan).toContain('idx_items_list')
    expect(plan).not.toContain('TEMP B-TREE')
  })

  it('a whole board matches its pages', () => {
    const whole = getAllItems('work', 'card')
    const paged = [1, 2, 3, 4, 5].flatMap(page => getItemsPaginated('work', 'card', page, 30).items)
    expect(ids(whole)).toEqual(ids(paged))
    expect(whole.map(sortedTags)).toEqual(paged.map(sortedTags))
  })
})

describe('the backlog query', () => {
  const cases: [string, TaskQueryParams][] = [
    ['everything', {}],
    ['archived only', { archivedOnly: true }],
    ['by status and priority', { status: ['open', 'in_progress'], priority: [1, 3] }],
    ['a due range', { dueStart: NOW - 5 * DAY_MS, dueEnd: NOW + 5 * DAY_MS }],
    ['no due date', { noDueDate: true }],
    ['untagged', { untagged: true }],
    ['with links', { hasRelations: true }],
    ['without links', { hasRelations: false }],
    ['a search', { query: 'shader' }],
    ['two tags at once', { tagIds: ['tag2', 'tag5'] }]
  ]

  it.each(cases)('finds the same tasks with the same tags: %s', (_name, params) => {
    const before = oldTasks('work', params)
    const { items, total } = allPages(params)
    expect(total).toBe(before.total)
    expect(new Set(ids(items)).size).toBe(items.length)
    expect([...ids(items)].sort()).toEqual([...before.ids].sort())
    for (const item of items) expect(sortedTags(item)).toBe(before.tags.get(item.id))
  })

  const sorts: TaskQueryParams['sortBy'][] = ['created_at', 'due_at', 'priority', 'status', 'title', 'relations_count']
  it.each(sorts)('keeps the order across pages when sorted by %s, both ways', sortBy => {
    for (const sortDesc of [false, true]) {
      const { items } = allPages({ sortBy, sortDesc })
      const key = (item: Item): number | string => {
        if (sortBy === 'relations_count') return (getDb().prepare('SELECT COUNT(*) AS n FROM relations WHERE from_id = ? OR to_id = ?').get(item.id, item.id) as { n: number }).n
        if (sortBy === 'due_at') return item.due_at === null ? -Infinity : item.due_at % DAY_MS === 0 ? item.due_at + DAY_MS - 1 + new Date().getTimezoneOffset() * 60_000 : item.due_at
        return item[sortBy as 'created_at' | 'priority' | 'status' | 'title'] as number | string
      }
      const keys = items.map(key)
      const ordered = [...keys].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
      expect(keys).toEqual(sortDesc ? ordered.reverse() : ordered)
      expect(items).toHaveLength(oldTasks('work', {}).total)
    }
  })
})

describe('the Workspaces page summary', () => {
  it('names the same last change in each workspace as grouping did', () => {
    const before = getDb().prepare('SELECT context, id, MAX(updated_at) AS at FROM items GROUP BY context').all() as { context: string; id: string; at: number }[]
    const now = workspaceActivity(getDb(), NOW)
    for (const row of before) expect(now[row.context].lastChanged).toMatchObject({ id: row.id, at: row.at })
  })
})
