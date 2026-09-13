import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { quarantineDatabase, recoveryMessage, stampFor } from '../src/main/dbRecovery'

// the only copy of everything, so be precise

let dir: string
let dbPath: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'checkpoint-recovery-'))
  dbPath = join(dir, 'checkpoint.db')
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('moving an unreadable database aside', () => {
  it('keeps the file rather than deleting it', () => {
    // the only copy, a later SQLite may recover it
    writeFileSync(dbPath, 'not really a database')

    const { movedTo } = quarantineDatabase(dbPath, '2026-01-01T00-00-00-000Z')

    expect(existsSync(dbPath)).toBe(false)
    expect(existsSync(movedTo)).toBe(true)
    expect(readFileSync(movedTo, 'utf8')).toBe('not really a database')
  })

  it('takes the write-ahead log with it', () => {
    // a stale WAL would corrupt the fresh db
    writeFileSync(dbPath, 'db')
    writeFileSync(`${dbPath}-wal`, 'wal')
    writeFileSync(`${dbPath}-shm`, 'shm')

    const { movedTo, alsoMoved } = quarantineDatabase(dbPath, 'stamp')

    expect(existsSync(`${dbPath}-wal`)).toBe(false)
    expect(existsSync(`${dbPath}-shm`)).toBe(false)
    expect(alsoMoved).toEqual([`${movedTo}-wal`, `${movedTo}-shm`])
  })

  it('does not invent sidecars that were not there', () => {
    writeFileSync(dbPath, 'db')
    expect(quarantineDatabase(dbPath, 'stamp').alsoMoved).toEqual([])
  })

  it('names each rescue distinctly, so a second one cannot clobber the first', () => {
    writeFileSync(dbPath, 'first')
    const one = quarantineDatabase(dbPath, 'stamp-a')
    writeFileSync(dbPath, 'second')
    const two = quarantineDatabase(dbPath, 'stamp-b')

    expect(one.movedTo).not.toBe(two.movedTo)
    expect(readFileSync(one.movedTo, 'utf8')).toBe('first')
    expect(readFileSync(two.movedTo, 'utf8')).toBe('second')
  })

  it('copes with there being nothing to move', () => {
    // an unwritable dir throws first; the way out mustn't throw again
    expect(() => quarantineDatabase(dbPath, 'stamp')).not.toThrow()
  })
})

describe('the stamp in the rescued filename', () => {
  it('has nothing in it that a filesystem refuses', () => {
    const stamp = stampFor(Date.parse('2026-09-05T14:30:45.123Z'))
    for (const illegal of [':', '*', '?', '"', '<', '>', '|', '/', '\\']) {
      expect(stamp.includes(illegal)).toBe(false)
    }
    expect(stamp).toBe('2026-09-05T14-30-45-123Z')
  })

  it('sorts chronologically as text', () => {
    const earlier = stampFor(Date.parse('2026-01-01T00:00:00Z'))
    const later = stampFor(Date.parse('2026-12-31T23:59:59Z'))
    expect(earlier < later).toBe(true)
  })
})

describe('what the user is told', () => {
  it('says where their old database went and where backups are', () => {
    const message = recoveryMessage('C:/x/checkpoint.db.corrupt-1', 'C:/x/backups')
    expect(message).toContain('C:/x/checkpoint.db.corrupt-1')
    expect(message).toContain('C:/x/backups')
    // keeping the file is pointless if the message implies it's gone
    expect(message).toContain('kept, not deleted')
  })
})
