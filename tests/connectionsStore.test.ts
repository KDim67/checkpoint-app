import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDb, getAgreed, getDb, initDb, listAgreed, setAgreed, setSetting } from '../src/main/db'
import { getConnectionKey, removeConnectionKey, setConnectionKey } from '../src/main/connections/keys'
import { readStatus, writeStatus } from '../src/main/connections/status'
import { isMainOnlySetting, isSecretSetting } from '../src/main/secureSettings'
import { isSyncableSettingKey } from '../src/shared/syncSettings'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'checkpoint-connections-'))
  initDb(dir)
})

afterEach(() => {
  closeDb()
  rmSync(dir, { recursive: true, force: true })
})

describe('a connection key', () => {
  it('is a secret the screen can never read, and stays on this computer', () => {
    expect(isSecretSetting('connection_key:github')).toBe(true)
    expect(isMainOnlySetting('connection_key:github')).toBe(true)
    expect(isSyncableSettingKey('connection_key:github')).toBe(false)
  })

  it('is kept, read and forgotten', () => {
    expect(getConnectionKey('github')).toBeNull()
    setConnectionKey('github', 'github_pat_abc')
    expect(getConnectionKey('github')).toBe('github_pat_abc')
    removeConnectionKey('github')
    expect(getConnectionKey('github')).toBeNull()
  })
})

describe('a connection\'s status', () => {
  it('starts empty, takes patches, and reads a damaged record as empty', () => {
    expect(readStatus('github')).toMatchObject({ login: null, failures: 0, readOnlyRepos: [] })
    writeStatus('github', { login: 'octo', readOnlyRepos: ['octo/repo'] })
    writeStatus('github', { failures: 2 })
    expect(readStatus('github')).toMatchObject({ login: 'octo', readOnlyRepos: ['octo/repo'], failures: 2 })
    setSetting('connection_status:github', 'garbage')
    expect(readStatus('github').login).toBeNull()
  })

  it('stays home, while the repositories each workspace follows sync', () => {
    expect(isSyncableSettingKey('connection_status:github')).toBe(false)
    expect(isSyncableSettingKey('github_repos')).toBe(true)
  })
})

describe('what both sides last agreed on', () => {
  it('is recorded per item and updated in place', () => {
    const db = getDb()
    expect(getAgreed(db, 'github', 'octo/repo#1')).toBeNull()
    setAgreed(db, 'github', 'octo/repo#1', 'card-1', 'open')
    setAgreed(db, 'github', 'octo/repo#1', 'card-1', 'closed')
    setAgreed(db, 'github', 'octo/repo#2', 'card-2', 'ignored')
    expect(getAgreed(db, 'github', 'octo/repo#1')).toStrictEqual({ remoteId: 'octo/repo#1', itemId: 'card-1', agreed: 'closed' })
    expect(listAgreed(db, 'github').map(r => r.agreed).sort()).toStrictEqual(['closed', 'ignored'])
  })
})
