import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDb, createItem, getDb, getRecurrences, getSetting, initDb, readContextList, renameContextData, setSetting } from '../src/main/db'
import { createRecurrence } from '../src/main/recurrenceService'
import { SyncService } from '../src/main/syncService'
import { boardConfigKey } from '../src/shared/boardModel'
import type { SyncPayload } from '../src/shared/types'

// two machines, each its own database; the sync is the host's payload applied on the client, then the client's back

const dirs: Record<'A' | 'B', string> = { A: '', B: '' }
const service = new SyncService()

const on = (machine: 'A' | 'B'): void => {
  closeDb()
  initDb(dirs[machine])
}

/** one session the way the protocol runs it: the host's state lands on the client first */
function sync(host: 'A' | 'B', client: 'A' | 'B'): void {
  on(host)
  const fromHost = service.getDatabasePayload()
  on(client)
  service.applyDatabasePayload(fromHost)
  const fromClient = service.getDatabasePayload()
  on(host)
  service.applyDatabasePayload(fromClient)
}

const workspaces = (list: { slug: string; name: string }[]): void => {
  // the renderer stores the list as a JSON string
  setSetting('contexts_list', JSON.stringify(list.map(w => ({ ...w, color: '#535e85' }))))
}

const titlesIn = (context: string): string[] =>
  (getDb().prepare('SELECT title FROM items WHERE context = ? ORDER BY title').all(context) as { title: string }[]).map(r => r.title)

const slugs = (): string[] => (readContextList(getDb()) ?? []).map(e => e.slug)

let taskId = ''

beforeEach(() => {
  dirs.A = mkdtempSync(join(tmpdir(), 'checkpoint-machine-a-'))
  dirs.B = mkdtempSync(join(tmpdir(), 'checkpoint-machine-b-'))
  // A makes the workspace, B gets it from the first sync
  on('A')
  workspaces([{ slug: 'work', name: 'Work' }])
  setSetting('active_context', 'work')
  setSetting(boardConfigKey('work'), { columns: [{ id: 'todo', name: 'To do' }] })
  taskId = createItem(getDb(), { type: 'task', context: 'work', title: 'Ship it', body: '', status: 'open', priority: 0, position: 0, due_at: null, metadata: '{}' }).id
  sync('A', 'B')
  on('B')
  // repeating tasks never sync, each machine has its own
  createRecurrence({ context: 'work', title: 'Standup notes', rule: { freq: 'daily', startAt: Date.now() + 3_600_000 } })
})

afterEach(() => {
  closeDb()
  rmSync(dirs.A, { recursive: true, force: true })
  rmSync(dirs.B, { recursive: true, force: true })
})

/** A renames, the way Settings does it: the data first, then the list it shows */
function renameOnA(from: string, to: string, name: string): void {
  on('A')
  renameContextData(getDb(), from, to)
  workspaces([{ slug: to, name }])
}

describe('a rename reaching the other machine', () => {
  it('moves the other machine\'s cards, repeating tasks, board and list when it syncs from the renamed one', () => {
    renameOnA('work', 'job', 'Job')
    sync('A', 'B')

    on('B')
    expect(titlesIn('job')).toStrictEqual(['Ship it'])
    expect(titlesIn('work')).toStrictEqual([])
    expect(getRecurrences('job').map(r => r.title)).toStrictEqual(['Standup notes'])
    expect(getSetting(boardConfigKey('job'), null)).toStrictEqual({ columns: [{ id: 'todo', name: 'To do' }] })
    expect(getSetting(boardConfigKey('work'), null)).toBeNull()
    expect(slugs()).toStrictEqual(['job'])
    expect(getSetting('active_context', '')).toBe('job')
  })

  it('holds when the machine that hasn\'t heard syncs first, even with an edit of its own', () => {
    on('B')
    getDb().prepare('UPDATE items SET title = ?, updated_at = updated_at + 60000 WHERE id = ?').run('Ship it today', taskId)
    renameOnA('work', 'job', 'Job')
    // B is the host, so its stale rows, board and list land on A before A says a word
    sync('B', 'A')

    for (const machine of ['A', 'B'] as const) {
      on(machine)
      expect(titlesIn('job')).toStrictEqual(['Ship it today'])
      expect(titlesIn('work')).toStrictEqual([])
      expect(slugs()).toStrictEqual(['job'])
      expect(getSetting(boardConfigKey('job'), null)).toStrictEqual({ columns: [{ id: 'todo', name: 'To do' }] })
      expect(getSetting(boardConfigKey('work'), null)).toBeNull()
      expect(getSetting('active_context', '')).toBe('job')
    }
    on('A')
    // A's own name for it, not the stale one B sent
    expect(readContextList(getDb())?.[0]).toMatchObject({ slug: 'job', name: 'Job' })
  })

  it('never folds a new workspace that took the old name into the renamed one', () => {
    renameOnA('work', 'job', 'Job')
    workspaces([{ slug: 'job', name: 'Job' }, { slug: 'work', name: 'Work again' }])
    createItem(getDb(), { type: 'task', context: 'work', title: 'Fresh start', body: '', status: 'open', priority: 0, position: 0, due_at: null, metadata: '{}' })
    sync('A', 'B')
    sync('B', 'A')

    on('A')
    expect(titlesIn('work')).toStrictEqual(['Fresh start'])
    expect(titlesIn('job')).toStrictEqual(['Ship it'])
    expect(slugs().sort()).toStrictEqual(['job', 'work'])
  })

  it('makes each rename once, however often the same payload arrives', () => {
    renameOnA('work', 'job', 'Job')
    on('A')
    const payload: SyncPayload = service.getDatabasePayload()
    on('B')
    service.applyDatabasePayload(payload)
    service.applyDatabasePayload(payload)
    expect(getDb().prepare('SELECT COUNT(*) AS c FROM context_renames').get()).toStrictEqual({ c: 1 })
    expect(titlesIn('job')).toStrictEqual(['Ship it'])
  })

  it('follows two renames in the order they were made', () => {
    renameOnA('work', 'job', 'Job')
    renameOnA('job', 'career', 'Career')
    sync('A', 'B')

    on('B')
    expect(titlesIn('career')).toStrictEqual(['Ship it'])
    expect(getRecurrences('career')).toHaveLength(1)
    expect(slugs()).toStrictEqual(['career'])
  })

  it('takes a payload from an older version, which has no renames in it, without undoing one', () => {
    renameOnA('work', 'job', 'Job')
    on('B')
    const older = { ...service.getDatabasePayload(), context_renames: undefined }
    on('A')
    service.applyDatabasePayload(older)
    expect(titlesIn('job')).toStrictEqual(['Ship it'])
    expect(slugs()).toStrictEqual(['job'])
  })
})
