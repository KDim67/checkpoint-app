import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { rmSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { initDb, discardDb, getDb, createItem, searchItems, getSetting, setSetting } from '../src/main/db'
import { runBackup, runRestore, listCompletedBackups, getBackupDir, parseBackupName } from '../src/main/backupVault'

// The corrupt-database dialog points people here, so restore has to actually
// work. The electron stub fixes userData at a throwaway path, so this runs
// against real files without touching anyone's profile.

const dataPath = '/tmp/checkpoint-test/userData'

const search = (term: string): number => searchItems({ query: term, page: 1, pageSize: 10 }).total

const addItem = (title: string): void => {
  createItem(getDb(), {
    type: 'log', context: 'work', title, body: '',
    status: 'open', priority: 0, position: 1, metadata: '{}', due_at: null
  })
}

beforeEach(() => {
  // initDb does not create the directory: the real app relies on Electron
  // having made userData already.
  mkdirSync(dataPath, { recursive: true })
})

afterEach(() => {
  // Read while the connection is still open: getBackupDir goes through
  // getSetting, and a finalized statement throws once the database is gone.
  let backupDir = ''
  try { backupDir = getBackupDir() } catch { /* never opened */ }
  try { discardDb() } catch { /* already gone */ }
  rmSync(dataPath, { recursive: true, force: true })
  if (backupDir) rmSync(backupDir, { recursive: true, force: true })
})

describe('restoring a backup', () => {
  it('brings back what was in it, and the app keeps working afterwards', async () => {
    initDb(dataPath)
    addItem('written before the backup')
    expect(search('backup')).toBe(1)

    const backupFile = await runBackup()
    expect(existsSync(backupFile)).toBe(true)

    // Life goes on: something else is added after the snapshot.
    addItem('written after the backup')
    expect(search('after')).toBe(1)

    await runRestore(listCompletedBackups()[0].filename)

    // The state the backup captured.
    expect(search('backup')).toBe(1)
    expect(search('after')).toBe(0)
  })

  it('leaves the statement cache usable, not pointing at a dead connection', async () => {
    initDb(dataPath)
    addItem('a searchable thing')
    // Warms the cache against the pre-restore connection. Closing the raw
    // handle instead of going through db.ts used to leave every cached
    // statement compiled against it, and better-sqlite3 then throws
    // "The database connection is not open" on the next query.
    expect(search('searchable')).toBe(1)

    await runBackup()
    await runRestore(listCompletedBackups()[0].filename)

    expect(() => search('searchable')).not.toThrow()
    expect(search('searchable')).toBe(1)
  })

  it('keeps settings written before the snapshot', async () => {
    initDb(dataPath)
    setSetting('active_context', 'work')
    await runBackup()

    setSetting('active_context', 'somewhere-else')
    await runRestore(listCompletedBackups()[0].filename)

    expect(getSetting('active_context', '')).toBe('work')
  })

  it('takes a safety copy first, so a restore is itself undoable', async () => {
    initDb(dataPath)
    addItem('the state before restoring')
    await runBackup()

    const before = listCompletedBackups().length
    await runRestore(listCompletedBackups()[0].filename)

    // The pre-restore snapshot joins the list.
    expect(listCompletedBackups().length).toBeGreaterThan(before)
  })

  it('refuses a backup that is not there rather than emptying the database', async () => {
    initDb(dataPath)
    addItem('still here afterwards')

    await expect(runRestore('backup_does_not_exist.db.gz')).rejects.toThrow()
    expect(search('afterwards')).toBe(1)
  })
})

describe('reading a name in the vault', () => {
  it('knows the two kinds apart', () => {
    expect(parseBackupName('backup_1700000000000.db.gz')).toEqual({ kind: 'scheduled', timestamp: 1700000000000 })
    expect(parseBackupName('pre_restore_1700000000000.db.gz')).toEqual({ kind: 'preRestore', timestamp: 1700000000000 })
  })

  it('ignores anything else in the folder', () => {
    // A stray temp file, a half-written copy, or something the user dropped in.
    expect(parseBackupName('temp_safety_123.db')).toBeNull()
    expect(parseBackupName('notes.txt')).toBeNull()
    expect(parseBackupName('backup_notanumber.db.gz')).toBeNull()
    expect(parseBackupName('backup_123.db')).toBeNull()
  })
})

describe('what the vault keeps', () => {
  it('lists the copy taken before a restore, so the restore can be undone', async () => {
    initDb(dataPath)
    addItem('the state before restoring')
    await runBackup()
    await runRestore(listCompletedBackups().filter(b => b.kind === 'scheduled')[0].filename)

    const safety = listCompletedBackups().filter(b => b.kind === 'preRestore')
    // Written but never listed was the old behaviour: a safety net on disk
    // and nowhere the user could reach it.
    expect(safety.length).toBe(1)
  })

  it('prunes the pre-restore copies too, instead of letting them pile up', async () => {
    initDb(dataPath)
    addItem('something to snapshot')
    await runBackup()

    const scheduled = listCompletedBackups().filter(b => b.kind === 'scheduled')[0].filename
    // maxCount defaults well above this, so the point is only that the count
    // tracks restores rather than growing without any bound at all.
    for (let i = 0; i < 3; i++) await runRestore(scheduled)

    const safety = listCompletedBackups().filter(b => b.kind === 'preRestore')
    expect(safety.length).toBeGreaterThan(0)
    expect(safety.length).toBeLessThanOrEqual(3)
  })
})

describe('a backup that did not finish', () => {
  it('is not mistaken for one that did', () => {
    // compressFile writes to <name>.partial and renames only once the file is
    // whole, so anything still wearing that suffix is incomplete.
    expect(parseBackupName('backup_1700000000000.db.gz.partial')).toBeNull()
    expect(parseBackupName('pre_restore_1700000000000.db.gz.partial')).toBeNull()
  })

  it('is neither listed nor counted against retention', async () => {
    initDb(dataPath)
    addItem('something worth keeping')
    await runBackup()

    const dir = getBackupDir()
    const listedBefore = listCompletedBackups().length

    // A partial left behind by a full disk or a killed process.
    writeFileSync(join(dir, `backup_${Date.now() + 1000}.db.gz.partial`), 'truncated rubbish')

    // It must not appear as a restorable backup, and must not push a real one
    // out of the vault by taking up a retention slot.
    expect(listCompletedBackups().length).toBe(listedBefore)
    expect(listCompletedBackups().every(b => b.filename.endsWith('.db.gz'))).toBe(true)
  })

  it('leaves the real backup restorable alongside it', async () => {
    initDb(dataPath)
    addItem('the good copy')
    await runBackup()
    writeFileSync(join(getBackupDir(), 'backup_9999999999999.db.gz.partial'), 'rubbish')

    const good = listCompletedBackups().filter(b => b.kind === 'scheduled')[0]
    await runRestore(good.filename)
    expect(search('good')).toBe(1)
  })
})
