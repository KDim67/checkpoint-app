import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initDb, closeDb, discardDb, getDb, searchItems, createItem } from '../src/main/db'

// restores swap the file under a running app; how the old connection closes decides what works after

let dir: string

afterEach(() => {
  try { discardDb() } catch { /* already gone */ }
  if (dir) rmSync(dir, { recursive: true, force: true })
})

/** a real term so the statement actually compiles */
const search = (): number => searchItems({ query: 'restore', page: 1, pageSize: 10 }).total

const seed = (): void => {
  dir = mkdtempSync(join(tmpdir(), 'checkpoint-restore-'))
  initDb(dir)
  createItem(getDb(), {
    type: 'log', context: 'work', title: 'before the restore', body: '',
    status: 'open', priority: 0, position: 1, metadata: '{}', due_at: null
  })
  // warms the cache, empty queries skip it
  expect(search()).toBe(1)
}

describe('swapping the database file the way a restore does', () => {
  it('keeps working when the connection goes through the db module', () => {
    seed()

    // discardDb drops the cache with the connection
    discardDb()
    initDb(dir)

    expect(search()).toBe(1)
  })

  it('keeps working across an ordinary shutdown and restart', () => {
    seed()
    closeDb()
    initDb(dir)
    expect(search()).toBe(1)
  })
})
