import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDb, createItem, getDb, initDb } from '../src/main/db'
import { queryTasks } from '../src/main/db/search'
import { resolveDueRange } from '../src/shared/savedViews'
import { allDay, DAY_MS, localDayOf } from '../src/shared/dueDate'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'checkpoint-due-ranges-'))
  initDb(dir)
})

afterEach(() => {
  closeDb()
  rmSync(dir, { recursive: true, force: true })
})

const task = (title: string, dueAt: number | null) =>
  createItem(getDb(), {
    type: 'task', context: 'work', title, body: '', status: 'open',
    priority: 0, position: 0, due_at: dueAt, metadata: '{}'
  } as Parameters<typeof createItem>[1])

// ten in the morning, today, wherever the tests run
const today = localDayOf(Date.now())
const at = (dayOffset: number, hour: number): number => new Date(today.year, today.month, today.day + dayOffset, hour).getTime()
const now = at(0, 10)
const titles = (params: Parameters<typeof queryTasks>[2]): string[] =>
  queryTasks(getDb(), 'work', params).items.map(i => i.title).sort()

describe('due ranges with whole days and moments', () => {
  beforeEach(() => {
    task('day today', allDay(today))
    task('day yesterday', allDay(today) - DAY_MS)
    task('day tomorrow', allDay(today) + DAY_MS)
    task('at 8 today', at(0, 8))
    task('at 15 today', at(0, 15))
    task('at 15 yesterday', at(-1, 15))
  })

  it('keeps a day due today out of overdue until the day is over', () => {
    expect(titles(resolveDueRange('overdue', now))).toStrictEqual(['at 15 yesterday', 'at 8 today', 'day yesterday'])
  })

  it('puts everything of today in today, whole days and moments alike', () => {
    expect(titles(resolveDueRange('today', now))).toStrictEqual(['at 15 today', 'at 8 today', 'day today'])
  })

  it('sorts a whole day after the moments on the same day', () => {
    const order = queryTasks(getDb(), 'work', { sortBy: 'due_at' }).items.map(i => i.title)
    expect(order.indexOf('at 15 today')).toBeLessThan(order.indexOf('day today'))
    expect(order.indexOf('day today')).toBeLessThan(order.indexOf('day tomorrow'))
    expect(order.indexOf('day yesterday')).toBeLessThan(order.indexOf('at 8 today'))
  })
})
