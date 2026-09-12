import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initDb, closeDb, getDb, createItem, getItemById, bulkDeleteItems, deleteItem } from '../src/main/db'
import type { Item } from '../src/shared/types'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'checkpoint-bulk-delete-'))
  initDb(dir)
})

afterEach(() => {
  closeDb()
  rmSync(dir, { recursive: true, force: true })
})

const seedCard = (title: string): Item =>
  createItem(getDb(), {
    type: 'card', context: 'work', title, body: '',
    status: 'todo', priority: 1, position: 1000, due_at: null, metadata: '{}'
  })

const tombstones = (): Array<{ id: string; table_name: string }> =>
  (getDb().prepare('SELECT id, table_name FROM sync_tombstones ORDER BY id').all() as Array<{ id: string; table_name: string }>)
    .map(row => ({ id: row.id, table_name: row.table_name }))

describe('deleting items in bulk', () => {
  it('removes every item it is given', () => {
    const a = seedCard('a')
    const b = seedCard('b')
    const kept = seedCard('kept')

    expect(bulkDeleteItems(getDb(), [a.id, b.id])).toBe(2)

    expect(getItemById(a.id)).toBeNull()
    expect(getItemById(b.id)).toBeNull()
    expect(getItemById(kept.id)).not.toBeNull()
  })

  it('leaves a tombstone for each, so sync and merges know they were deleted', () => {
    const a = seedCard('a')
    const b = seedCard('b')

    bulkDeleteItems(getDb(), [a.id, b.id])

    expect(tombstones()).toEqual([a.id, b.id].sort().map(id => ({ id, table_name: 'items' })))
  })

  it('leaves the same record a single delete does', () => {
    const single = seedCard('single')
    const bulk = seedCard('bulk')

    deleteItem(single.id)
    bulkDeleteItems(getDb(), [bulk.id])

    const byId = new Map(tombstones().map(t => [t.id, t.table_name]))
    expect(byId.get(single.id)).toBe('items')
    expect(byId.get(bulk.id)).toBe('items')
  })
})
