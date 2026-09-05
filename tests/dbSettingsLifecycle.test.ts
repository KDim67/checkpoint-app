import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initDb, discardDb, getSetting, setSetting, deleteSetting } from '../src/main/db'

// Settings get read at both ends of the app's life: during startup before the
// database is open, and during shutdown after it has closed. Neither should
// be a crash.

let dir: string

afterEach(() => {
  try { discardDb() } catch { /* already gone */ }
  if (dir) rmSync(dir, { recursive: true, force: true })
})

describe('reading a setting with no database open', () => {
  it('returns the default before initDb rather than throwing', () => {
    expect(getSetting('anything', 'the default')).toBe('the default')
  })

  it('returns the default after the connection closes', () => {
    // The statement still exists once the database is gone, just finalized,
    // so guarding on the statement alone let this throw during shutdown.
    dir = mkdtempSync(join(tmpdir(), 'checkpoint-settings-'))
    initDb(dir)
    setSetting('active_context', 'work')
    expect(getSetting('active_context', '')).toBe('work')

    discardDb()

    expect(() => getSetting('active_context', 'fallback')).not.toThrow()
    expect(getSetting('active_context', 'fallback')).toBe('fallback')
  })
})

describe('writing a setting with no database open', () => {
  it('drops the write instead of throwing', () => {
    dir = mkdtempSync(join(tmpdir(), 'checkpoint-settings-'))
    initDb(dir)
    discardDb()
    expect(() => setSetting('active_context', 'work')).not.toThrow()
  })

  it('drops a delete too', () => {
    dir = mkdtempSync(join(tmpdir(), 'checkpoint-settings-'))
    initDb(dir)
    discardDb()
    expect(() => deleteSetting('active_context')).not.toThrow()
  })
})

describe('once a database is open again', () => {
  it('reads and writes normally', () => {
    dir = mkdtempSync(join(tmpdir(), 'checkpoint-settings-'))
    initDb(dir)
    setSetting('active_context', 'work')
    discardDb()
    initDb(dir)
    expect(getSetting('active_context', '')).toBe('work')
  })
})
