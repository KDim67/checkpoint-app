import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initDb, closeDb, discardDb, getDb, searchItems, createItem } from '../src/main/db'

// Restoring a backup swaps the database file underneath a running app. The
// statement cache is keyed by SQL and compiled against one connection, so how
// the old connection is closed decides whether anything works afterwards.

let dir: string

afterEach(() => {
  try { discardDb() } catch { /* already gone */ }
  if (dir) rmSync(dir, { recursive: true, force: true })
})

/** A search with a real term, so the cached statement is actually compiled. */
const search = (): number => searchItems({ query: 'restore', page: 1, pageSize: 10 }).total

const seed = (): void => {
  dir = mkdtempSync(join(tmpdir(), 'checkpoint-restore-'))
  initDb(dir)
  createItem(getDb(), {
    type: 'log', context: 'work', title: 'before the restore', body: '',
    status: 'open', priority: 0, position: 1, metadata: '{}', due_at: null
  })
  // Warms the cache. An empty query short-circuits before touching it, which
  // is why this passes a term.
  expect(search()).toBe(1)
}

describe('swapping the database file the way a restore does', () => {
  it('keeps working when the connection goes through the db module', () => {
    seed()

    // What a restore should do: discardDb drops the cache along with the
    // connection its statements were compiled against.
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
