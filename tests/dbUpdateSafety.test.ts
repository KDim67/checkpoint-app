import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { gunzipSync, gzipSync } from 'node:zlib'
import { join } from 'node:path'
import { createItem, discardDb, getDb, initDb, NewerDatabaseError, SCHEMA_VERSION, searchItems } from '../src/main/db'
import { getBackupDir, listCompletedBackups, parseBackupName, runRestore, snapshotBeforeUpdate } from '../src/main/backupVault'
import { app } from 'electron'

// the electron stub gives each test worker its own userData; its app version is 0.0.0-test

const dataPath = app.getPath('userData')
const dbFile = join(dataPath, 'checkpoint.db')
const backupDir = join(dataPath, 'backups')

const addItem = (title: string): void => {
  createItem(getDb(), {
    type: 'log', context: 'work', title, body: '',
    status: 'open', priority: 0, position: 1, metadata: '{}', due_at: null
  })
}

/** a database as the version before this one left it, holding one item */
function lastVersionsDatabase(title = 'kept from the last version'): void {
  initDb(dataPath)
  addItem(title)
  getDb().pragma(`user_version = ${SCHEMA_VERSION - 1}`)
  discardDb()
}

const schemaOf = (file: string): number => {
  const db = new DatabaseSync(file)
  try {
    return (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
  } finally {
    db.close()
  }
}

const snapshots = (): string[] => (existsSync(backupDir) ? readdirSync(backupDir).filter(f => f.startsWith('pre_update_')) : [])

beforeEach(() => {
  mkdirSync(dataPath, { recursive: true })
})
afterEach(() => {
  try { discardDb() } catch { /* never opened */ }
  rmSync(dataPath, { recursive: true, force: true })
})

describe('a new version opening the last one\'s data', () => {
  it('copies the database before changing it, as the last version left it', () => {
    lastVersionsDatabase()
    initDb(dataPath, { beforeMigrating: snapshotBeforeUpdate })

    const [copy] = snapshots()
    expect(copy).toMatch(/^pre_update_\d+_0\.0\.0-test\.db\.gz$/)
    const restored = join(dataPath, 'restored.db')
    writeFileSync(restored, gunzipSync(readFileSync(join(backupDir, copy))))
    expect(schemaOf(restored)).toBe(SCHEMA_VERSION - 1)
    const db = new DatabaseSync(restored)
    expect(db.prepare('SELECT title FROM items').all().map(r => (r as { title: string }).title)).toStrictEqual(['kept from the last version'])
    db.close()
    // and the live one carried on to the new version
    expect(schemaOf(dbFile)).toBe(SCHEMA_VERSION)
  })

  it('keeps the last two copies', () => {
    for (let i = 0; i < 3; i++) {
      lastVersionsDatabase(`round ${i}`)
      initDb(dataPath, { beforeMigrating: snapshotBeforeUpdate })
      discardDb()
    }
    expect(snapshots()).toHaveLength(2)
  })

  it('makes no copy of a brand new database, or of one already up to date', () => {
    initDb(dataPath, { beforeMigrating: snapshotBeforeUpdate })
    discardDb()
    initDb(dataPath, { beforeMigrating: snapshotBeforeUpdate })
    expect(snapshots()).toStrictEqual([])
  })

  it('still updates when the copy can\'t be made, the update itself being all or nothing', () => {
    lastVersionsDatabase()
    initDb(dataPath, { beforeMigrating: () => { throw new Error('disk full') } })
    expect(schemaOf(dbFile)).toBe(SCHEMA_VERSION)
  })

  it('lists the copy in Settings with the version it was made for', () => {
    lastVersionsDatabase()
    initDb(dataPath, { beforeMigrating: snapshotBeforeUpdate })
    expect(parseBackupName('pre_update_1700000000000_1.2.0.db.gz')).toStrictEqual({ kind: 'preUpdate', timestamp: 1700000000000, version: '1.2.0' })
    expect(listCompletedBackups()[0]).toMatchObject({ kind: 'preUpdate', version: '0.0.0-test' })
    expect(getBackupDir()).toBe(backupDir)
  })
})

describe('an older version opening a newer one\'s data', () => {
  it('stops before touching it, so the newer version still finds it as it left it', () => {
    lastVersionsDatabase()
    initDb(dataPath)
    getDb().pragma(`user_version = ${SCHEMA_VERSION + 1}`)
    discardDb()
    const before = statSync(dbFile).size

    let copied = false
    expect(() => initDb(dataPath, { beforeMigrating: () => { copied = true } })).toThrow(NewerDatabaseError)
    discardDb()
    expect(copied).toBe(false)
    expect(schemaOf(dbFile)).toBe(SCHEMA_VERSION + 1)
    expect(statSync(dbFile).size).toBe(before)
  })

  it('won\'t restore a backup a newer version made, and keeps the data it has', async () => {
    initDb(dataPath)
    addItem('still here')
    mkdirSync(backupDir, { recursive: true })
    const newer = join(dataPath, 'newer.db')
    const other = new DatabaseSync(newer)
    other.exec(`CREATE TABLE t (x); PRAGMA user_version = ${SCHEMA_VERSION + 1};`)
    other.close()
    writeFileSync(join(backupDir, 'backup_1700000000000.db.gz'), gzipSync(readFileSync(newer)))

    await expect(runRestore('backup_1700000000000.db.gz')).rejects.toThrow(/newer version of Checkpoint/)
    expect(searchItems({ query: 'still', page: 1, pageSize: 10 }).total).toBe(1)
  })
})
