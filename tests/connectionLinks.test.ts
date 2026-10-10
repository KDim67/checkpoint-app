import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { closeDb, getAgreed, getAgreedFields, getDb, initDb, setAgreed, setAgreedFields } from '../src/main/db'
import { cardIdFor, dueLockOf, linkOf, SERVICES } from '../src/shared/connections'
import { issueCardId } from '../src/shared/github'
import { isTodoistId, todoistTaskUrl } from '../src/shared/todoist'
import { isLinearId, linearPriority } from '../src/shared/linear'

const todoist = { service: 'todoist', id: '6XGgmFVcrG5RRjVr', url: 'https://app.todoist.com/app/task/6XGgmFVcrG5RRjVr', state: 'open', labels: ['errands'], place: 'Groceries' }

describe('a card\'s link to any service', () => {
  it('reads a Todoist link with the project it is in', () => {
    expect(linkOf(JSON.stringify({ link: todoist }))).toStrictEqual(todoist)
  })

  it('opens only on the service\'s own site', () => {
    expect(linkOf(JSON.stringify({ link: { ...todoist, url: 'https://github.com/octo/repo/issues/1' } }))).toBeNull()
    expect(linkOf(JSON.stringify({ link: { ...todoist, url: 'https://app.todoist.com.evil.example/task/1' } }))).toBeNull()
    expect(linkOf(JSON.stringify({ link: { ...todoist, service: 'github', url: todoist.url } }))).toBeNull()
  })

  it('reads nothing for a service Checkpoint doesn\'t know', () => {
    expect(linkOf(JSON.stringify({ link: { ...todoist, service: 'trello' } }))).toBeNull()
    expect(linkOf(JSON.stringify({ link: { ...todoist, service: 'toString' } }))).toBeNull()
  })

  it('names each service the way its badge and notes say it', () => {
    expect(SERVICES.github.shortRef('octo/repo#12')).toBe('#12')
    expect(SERVICES.todoist.shortRef(todoist.id)).toBe('')
    expect(`no longer ${SERVICES.todoist.where}`).toBe('no longer in Todoist')
  })
})

describe('a date that belongs to the service', () => {
  it('is read beside the link, and only when it is words', () => {
    expect(dueLockOf(JSON.stringify({ link: todoist, dueLocked: 'This task repeats in Todoist (every monday), so change its date there.' })))
      .toBe('This task repeats in Todoist (every monday), so change its date there.')
    expect(dueLockOf(JSON.stringify({ link: todoist }))).toBeNull()
    expect(dueLockOf(JSON.stringify({ dueLocked: 3 }))).toBeNull()
    expect(dueLockOf(JSON.stringify({ dueLocked: '' }))).toBeNull()
    expect(dueLockOf('not json')).toBeNull()
  })
})

describe('card ids', () => {
  it('stay what they were for GitHub, and differ between services for the same text', () => {
    expect(cardIdFor('github', 'octo/repo#1')).toBe(issueCardId('octo/repo', 1))
    expect(cardIdFor('todoist', 'octo/repo#1')).not.toBe(cardIdFor('github', 'octo/repo#1'))
  })
})

describe('Todoist names', () => {
  it('accepts its ids and nothing that could leave the path', () => {
    expect(isTodoistId('6XGgmFVcrG5RRjVr')).toBe(true)
    expect(isTodoistId('2995104339')).toBe(true)
    expect(isTodoistId('../user')).toBe(false)
    expect(isTodoistId('')).toBe(false)
    expect(todoistTaskUrl('6XGgmFVcrG5RRjVr')).toBe('https://app.todoist.com/app/task/6XGgmFVcrG5RRjVr')
  })
})

describe('the agreed version of each field', () => {
  let dir = ''
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'checkpoint-links-'))
    initDb(dir)
  })
  afterEach(() => {
    closeDb()
    rmSync(dir, { recursive: true, force: true })
  })

  it('is kept per item beside the agreed state, which can change without it', () => {
    const db = getDb()
    expect(getAgreedFields(db, 'todoist', 't1')).toStrictEqual({})
    setAgreed(db, 'todoist', 't1', 'card-1', 'open')
    setAgreedFields(db, 'todoist', 't1', { title: 'Buy milk', due: null })
    setAgreed(db, 'todoist', 't1', 'card-1', 'closed')
    expect(getAgreedFields(db, 'todoist', 't1')).toStrictEqual({ title: 'Buy milk', due: null })
    setAgreedFields(db, 'todoist', 't1', { body: 'Two litres' })
    expect(getAgreedFields(db, 'todoist', 't1')).toStrictEqual({ title: 'Buy milk', body: 'Two litres', due: null })
    expect(getAgreed(db, 'todoist', 't1')?.agreed).toBe('closed')
  })

  it('reads a damaged record as nothing agreed, and keeps only fields of the right kind', () => {
    const db = getDb()
    setAgreed(db, 'todoist', 't1', 'card-1', 'open')
    db.prepare('UPDATE connection_links SET fields = ? WHERE remote_id = ?').run('not json', 't1')
    expect(getAgreedFields(db, 'todoist', 't1')).toStrictEqual({})
    db.prepare('UPDATE connection_links SET fields = ? WHERE remote_id = ?').run(JSON.stringify({ title: 3, body: 'ok', due: 'soon' }), 't1')
    expect(getAgreedFields(db, 'todoist', 't1')).toStrictEqual({ body: 'ok' })
  })

  it('gets its column on a database made before it existed', () => {
    closeDb()
    const old = new Database(join(dir, 'checkpoint.db'))
    old.exec('DROP TABLE connection_links; CREATE TABLE connection_links (service TEXT NOT NULL, remote_id TEXT NOT NULL, item_id TEXT NOT NULL, agreed TEXT NOT NULL, PRIMARY KEY (service, remote_id));')
    old.prepare('INSERT INTO connection_links VALUES (?, ?, ?, ?)').run('github', 'octo/repo#1', 'card-1', 'open')
    old.close()
    initDb(dir)
    expect(getAgreed(getDb(), 'github', 'octo/repo#1')?.agreed).toBe('open')
    expect(getAgreedFields(getDb(), 'github', 'octo/repo#1')).toStrictEqual({})
  })
})

describe('a Linear link', () => {
  const linear = { service: 'linear', id: '0b6b5f8e-6f0a-4c2a-9d1e-1a2b3c4d5e6f', url: 'https://linear.app/acme/issue/ENG-123/fix-login', state: 'closed', labels: ['bug'], ref: 'ENG-123', stateName: 'Canceled' }

  it('reads its key and state name, and opens only on linear.app', () => {
    expect(linkOf(JSON.stringify({ link: linear }))).toStrictEqual(linear)
    expect(linkOf(JSON.stringify({ link: { ...linear, url: 'https://linear.app.evil.example/x' } }))).toBeNull()
  })

  it('accepts its ids, and maps its priorities onto the card\'s', () => {
    expect(isLinearId(linear.id)).toBe(true)
    expect(isLinearId('a b')).toBe(false)
    expect([0, 1, 2, 3, 4, 7].map(linearPriority)).toStrictEqual([0, 3, 3, 2, 1, 0])
  })
})
