import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initDb, closeDb, getDb, createItem, updateItem, createRelation, getAllItems, getItemsPaginated } from '../src/main/db'
import type { Item } from '../src/shared/types'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'checkpoint-all-items-'))
  initDb(dir)
})

afterEach(() => {
  closeDb()
  rmSync(dir, { recursive: true, force: true })
})

const seed = (over: Partial<Item> = {}): Item =>
  createItem(getDb(), {
    type: 'card', context: 'work', title: 'A card', body: '',
    status: 'todo', priority: 1, position: 1000, due_at: null, metadata: '{}',
    ...over
  })

describe('reading every item of a type', () => {
  it('reads a board past the size of any single page', () => {
    getDb().transaction(() => {
      for (let i = 0; i < 1001; i++) seed({ title: `Card ${i}`, position: i })
    })()

    expect(getItemsPaginated('work', 'card', 1, 1000).items).toHaveLength(1000)
    expect(getAllItems('work', 'card')).toHaveLength(1001)
  })

  it('comes back in the order a page does', () => {
    seed({ title: 'third', position: 3000 })
    seed({ title: 'first', position: 1000 })
    seed({ title: 'second', position: 2000 })

    const titles = (items: Item[]): string[] => items.map(i => i.title)
    expect(titles(getAllItems('work', 'card'))).toEqual(['first', 'second', 'third'])
    expect(titles(getAllItems('work', 'card'))).toEqual(titles(getItemsPaginated('work', 'card', 1, 50).items))
  })

  it('leaves out other types and other workspaces', () => {
    const card = seed()
    seed({ type: 'task' })
    seed({ context: 'elsewhere' })

    expect(getAllItems('work', 'card').map(i => i.id)).toEqual([card.id])
  })

  it('counts open blocking relations in blockedByCount and excludes done/archived blockers', () => {
    const blocked = seed({ title: 'Blocked card' })
    const blocker1 = seed({ title: 'Open blocker', status: 'todo' })
    const blocker2 = seed({ title: 'Second blocker', status: 'in_progress' })
    const related = seed({ title: 'Related only', status: 'todo' })

    createRelation(blocker1.id, blocked.id, 'blocks')
    createRelation(blocker2.id, blocked.id, 'blocks')
    createRelation(related.id, blocked.id, 'relates_to')

    expect(getAllItems('work', 'card').find(i => i.id === blocked.id)?.blockedByCount).toBe(2)

    updateItem(getDb(), blocker1.id, { status: 'done' })
    expect(getAllItems('work', 'card').find(i => i.id === blocked.id)?.blockedByCount).toBe(1)

    updateItem(getDb(), blocker2.id, { status: 'archived' })
    expect(getAllItems('work', 'card').find(i => i.id === blocked.id)?.blockedByCount).toBeUndefined()
  })
})
