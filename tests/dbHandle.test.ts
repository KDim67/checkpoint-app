import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync, renameSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initDb, closeDb, discardDb, getDb } from '../src/main/db'

// windows won't rename a held file, and recovery moves it

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

    // EBUSY on windows with the handle open, how recovery first failed
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
