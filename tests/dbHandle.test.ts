import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync, renameSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initDb, closeDb, discardDb, getDb } from '../src/main/db'

// Releasing the file handle is the whole point of discardDb: Windows will not
// rename a file the process still holds open, and moving an unreadable
// database out of the way is how the app recovers from one.

let dir: string

afterEach(() => {
  try { discardDb() } catch { /* already closed */ }
  if (dir) rmSync(dir, { recursive: true, force: true })
})

describe('letting go of the database file', () => {
  it('releases the handle, so the file can be moved', () => {
    dir = mkdtempSync(join(tmpdir(), 'checkpoint-handle-'))
    initDb(dir)

    const dbPath = join(dir, 'checkpoint.db')
    discardDb()

    // The real check. With the handle still open this throws EBUSY on Windows,
    // which is exactly how the recovery path failed the first time it ran.
    const moved = `${dbPath}.moved`
    expect(() => renameSync(dbPath, moved)).not.toThrow()
    expect(existsSync(moved)).toBe(true)
  })

  it('leaves nothing behind that still thinks it has a database', () => {
    dir = mkdtempSync(join(tmpdir(), 'checkpoint-handle-'))
    initDb(dir)
    discardDb()
    expect(() => getDb()).toThrow(/not initialized/i)
  })

  it('does nothing when called twice', () => {
    dir = mkdtempSync(join(tmpdir(), 'checkpoint-handle-'))
    initDb(dir)
    discardDb()
    expect(() => discardDb()).not.toThrow()
  })

  it('closes on the ordinary shutdown path too', () => {
    dir = mkdtempSync(join(tmpdir(), 'checkpoint-handle-'))
    initDb(dir)
    closeDb()
    expect(() => getDb()).toThrow(/not initialized/i)
    expect(() => renameSync(join(dir, 'checkpoint.db'), join(dir, 'x.db'))).not.toThrow()
  })
})
