import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDb, getDb, getItemById, initDb, setSetting, updateItem } from '../src/main/db'
import { syncTodoist, todoistDue, todoistDuePatch } from '../src/main/connections/todoist/sync'
import { followedProjects, setProjectChoice, workspaceProjects } from '../src/main/connections/todoist/projects'
import type { TodoistClient, TodoistPatch, TodoistTask } from '../src/main/connections/todoist/client'
import { cardIdFor, dueLockOf, linkOf } from '../src/shared/connections'
import { allDay, moment } from '../src/shared/dueDate'
import { isSyncableSettingKey } from '../src/shared/syncSettings'
import { isSecretSetting } from '../src/main/secureSettings'

// Todoist as one fake: every change bumps a version, and a sync token is the version it was read at

let clock = Date.now()
const tick = (): number => (clock += 1000)

const task = (id: string, extra: Partial<TodoistTask> = {}): TodoistTask => ({
  id,
  projectId: 'p1',
  content: `Task ${id}`,
  description: 'Notes',
  checked: false,
  deleted: false,
  due: null,
  labels: ['errands'],
  priority: 1,
  updatedAt: tick(),
  ...extra
})

const addWeek = (date: string): string => {
  const d = new Date(`${date.slice(0, 10)}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 7)
  return d.toISOString().slice(0, 10) + date.slice(10)
}

function fakeTodoist(initial: TodoistTask[], projects: Record<string, string> = { p1: 'Groceries', p2: 'Chores', p3: 'Someday' }) {
  const tasks = new Map(initial.map(t => [t.id, { ...t }]))
  let version = 1
  const changedAt = new Map(initial.map(t => [t.id, version]))
  const calls: string[] = []
  const touch = (id: string, patch: Partial<TodoistTask>) => {
    Object.assign(tasks.get(id) as TodoistTask, patch, { updatedAt: tick() })
    changedAt.set(id, ++version)
  }
  const client: TodoistClient = {
    me: async () => ({ ok: true, value: { name: 'Maria Garcia' } }),
    async sync(token) {
      calls.push(`sync ${token}`)
      const full = token === '*'
      const since = full ? 0 : Number(token)
      const list = [...tasks.values()].filter(t => full ? !t.checked && !t.deleted : (changedAt.get(t.id) ?? 0) > since)
      return {
        ok: true,
        value: {
          tasks: list.map(t => ({ ...t })),
          projects: Object.entries(projects).map(([id, name]) => ({ id, name, gone: false })),
          token: String(version),
          full
        }
      }
    },
    async task(id) {
      const t = tasks.get(id)
      // a completed one-off task can't be read back, as the real one may not be
      if (!t || t.deleted || t.checked) return { ok: false, kind: 'not-found', message: 'Todoist could not find that.' }
      return { ok: true, value: { ...t } }
    },
    async close(id) {
      calls.push(`close ${id}`)
      const t = tasks.get(id) as TodoistTask
      if (t.due?.isRecurring) touch(id, { due: { ...t.due, date: addWeek(t.due.date) } })
      else touch(id, { checked: true })
      return { ok: true, value: undefined }
    },
    async reopen(id) {
      calls.push(`reopen ${id}`)
      touch(id, { checked: false })
      return { ok: true, value: undefined }
    },
    async update(id, patch: TodoistPatch) {
      calls.push(`update ${id} ${JSON.stringify(patch)}`)
      const next: Partial<TodoistTask> = {}
      if (patch.content !== undefined) next.content = patch.content
      if (patch.description !== undefined) next.description = patch.description
      if (patch.due_date) next.due = { date: patch.due_date, isRecurring: false, string: patch.due_date }
      if (patch.due_datetime) next.due = { date: patch.due_datetime.replace(/\.\d+Z$/, 'Z'), isRecurring: false, string: 'then' }
      if (patch.due_string === 'no date') next.due = null
      touch(id, next)
      return { ok: true, value: { ...(tasks.get(id) as TodoistTask) } }
    }
  }
  return { client, tasks, calls, edit: touch }
}

const run = (fake: ReturnType<typeof fakeTodoist>) => syncTodoist({ db: getDb(), client: fake.client, follows: followedProjects(), now: () => Date.now() })

const card = (id: string) => getItemById(cardIdFor('todoist', id))
const linkOfCard = (id: string) => linkOf(card(id)?.metadata ?? '{}')
const MONDAY = allDay({ year: 2026, month: 9, day: 12 })

let dir = ''
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'checkpoint-todoist-'))
  initDb(dir)
  setSetting('contexts_list', JSON.stringify([
    { slug: 'work', name: 'Work', color: '#535e85' },
    { slug: 'home', name: 'Home', color: '#535e85' }
  ]))
  setProjectChoice('work', 'p1')
})

afterEach(() => {
  closeDb()
  rmSync(dir, { recursive: true, force: true })
})

describe('Todoist dates', () => {
  it('reads a whole day, a floating time and a fixed moment', () => {
    expect(todoistDue({ date: '2026-10-12', isRecurring: false, string: '' })).toBe(MONDAY)
    expect(todoistDue({ date: '2026-10-12T09:30:00', isRecurring: false, string: '' })).toBe(moment(new Date(2026, 9, 12, 9, 30)))
    expect(todoistDue({ date: '2026-10-12T07:30:00.000000Z', isRecurring: false, string: '' })).toBe(Date.UTC(2026, 9, 12, 7, 30))
    expect(todoistDue(null)).toBeNull()
  })

  it('sends a whole day as a date, a moment as a moment, and no date as none', () => {
    expect(todoistDuePatch(MONDAY)).toStrictEqual({ due_date: '2026-10-12' })
    expect(todoistDuePatch(Date.UTC(2026, 9, 12, 7, 30))).toStrictEqual({ due_datetime: '2026-10-12T07:30:00Z' })
    expect(todoistDuePatch(null)).toStrictEqual({ due_string: 'no date' })
  })
})

describe('which project a workspace follows', () => {
  it('is one per workspace, the first workspace keeping a project two of them pick', () => {
    setProjectChoice('home', 'p1')
    expect(workspaceProjects().map(w => [w.slug, w.project])).toStrictEqual([['work', 'p1'], ['home', 'p1']])
    expect([...followedProjects()]).toStrictEqual([['p1', 'work']])
    expect(setProjectChoice('home', '../p2')).toMatchObject({ ok: false })
    setProjectChoice('home', null)
    expect(workspaceProjects()[1].project).toBeNull()
  })
})

describe('tasks coming in', () => {
  it('brings the followed project\'s open tasks in with their priority, date, labels and project', async () => {
    const fake = fakeTodoist([task('a', { priority: 4, due: { date: '2026-10-12', isRecurring: false, string: 'Oct 12' } }), task('b', { projectId: 'p3' })])
    expect(await run(fake)).toStrictEqual({ changed: 1, problems: [] })
    expect(card('a')).toMatchObject({ context: 'work', status: 'open', title: 'Task a', body: 'Notes', priority: 3, due_at: MONDAY })
    expect(linkOfCard('a')).toStrictEqual({ service: 'todoist', id: 'a', url: 'https://app.todoist.com/app/task/a', state: 'open', labels: ['errands'], place: 'Groceries' })
    expect(card('b')).toBeNull()
  })

  it('brings in a project\'s tasks when a workspace starts following it', async () => {
    const fake = fakeTodoist([task('a'), task('b', { projectId: 'p2' })])
    await run(fake)
    expect(card('b')).toBeNull()
    setProjectChoice('home', 'p2')
    await run(fake)
    expect(card('b')).toMatchObject({ context: 'home', title: 'Task b' })
  })

  it('still sees a task completed in Todoist while the followed projects changed', async () => {
    const fake = fakeTodoist([task('a'), task('b', { projectId: 'p2' })])
    await run(fake)
    fake.edit('a', { checked: true })
    setProjectChoice('home', 'p2')
    await run(fake)
    expect(card('a')?.status).toBe('done')
    expect(card('b')?.context).toBe('home')
  })
})

describe('done, both ways', () => {
  it('completes the task when its card moves to Done, and moves the card when it is reopened in Todoist', async () => {
    const fake = fakeTodoist([task('a')])
    await run(fake)
    updateItem(getDb(), cardIdFor('todoist', 'a'), { status: 'done' })
    await run(fake)
    expect(fake.calls).toContain('close a')
    expect(fake.tasks.get('a')?.checked).toBe(true)
    expect(linkOfCard('a')?.state).toBe('closed')
    fake.edit('a', { checked: false })
    await run(fake)
    expect(card('a')?.status).toBe('open')
  })

  it('brings a repeating task back on its next date, and keeps that date Todoist\'s', async () => {
    const fake = fakeTodoist([task('a', { due: { date: '2026-10-12', isRecurring: true, string: 'every monday' } })])
    await run(fake)
    expect(dueLockOf(card('a')?.metadata ?? '{}')).toBe('This task repeats in Todoist (every monday), so change its date there.')
    updateItem(getDb(), cardIdFor('todoist', 'a'), { status: 'done' })
    await run(fake)
    expect(card('a')).toMatchObject({ status: 'open', due_at: allDay({ year: 2026, month: 9, day: 19 }) })
    expect(fake.calls.filter(c => c.startsWith('update'))).toStrictEqual([])
  })
})

describe('title, description and date, both ways', () => {
  it('takes Todoist\'s changes and sends the card\'s, clearing a date with no date', async () => {
    const fake = fakeTodoist([task('a')])
    await run(fake)
    fake.edit('a', { content: 'Buy oat milk', description: 'Two cartons' })
    await run(fake)
    expect(card('a')).toMatchObject({ title: 'Buy oat milk', body: 'Two cartons' })

    const nineThirty = moment(new Date(Date.UTC(2026, 9, 12, 7, 30)))
    updateItem(getDb(), cardIdFor('todoist', 'a'), { title: 'Buy milk', due_at: nineThirty })
    await run(fake)
    expect(fake.calls).toContain('update a {"content":"Buy milk","due_datetime":"2026-10-12T07:30:00Z"}')
    expect(card('a')?.due_at).toBe(nineThirty)

    updateItem(getDb(), cardIdFor('todoist', 'a'), { due_at: null })
    await run(fake)
    expect(fake.tasks.get('a')?.due).toBeNull()
    fake.calls.length = 0
    await run(fake)
    expect(fake.calls.filter(c => !c.startsWith('sync'))).toStrictEqual([])
  })
})

describe('leaving', () => {
  it('marks the card of a task deleted in Todoist, and keeps it', async () => {
    const fake = fakeTodoist([task('a')])
    await run(fake)
    fake.edit('a', { deleted: true })
    await run(fake)
    expect(card('a')?.title).toBe('Task a')
    expect(linkOfCard('a')?.state).toBe('gone')
  })

  it('moves the card with its task to another followed project, and marks it when the project isn\'t followed', async () => {
    setProjectChoice('home', 'p2')
    const fake = fakeTodoist([task('a')])
    await run(fake)
    fake.edit('a', { projectId: 'p2' })
    await run(fake)
    expect(card('a')?.context).toBe('home')
    expect(linkOfCard('a')?.place).toBe('Chores')
    fake.edit('a', { projectId: 'p3' })
    await run(fake)
    expect(card('a')?.context).toBe('home')
    expect(linkOfCard('a')?.state).toBe('gone')
  })
})

describe('what syncs between computers', () => {
  it('is which project each workspace follows, never the token or where this computer read up to', () => {
    expect(isSyncableSettingKey('todoist_projects')).toBe(true)
    expect(isSyncableSettingKey('todoist_sync_state')).toBe(false)
    expect(isSyncableSettingKey('connection_status:todoist')).toBe(false)
    expect(isSecretSetting('connection_key:todoist')).toBe(true)
  })
})
