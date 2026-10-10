import { describe, expect, it } from 'vitest'
import { createTodoistClient } from '../src/main/connections/todoist/client'
import type { ClientDeps } from '../src/main/connections/result'

interface Call { url: string; method: string; headers: Record<string, string>; body?: string }

/** answers each request with the next canned response, and keeps what was asked */
function fakeTodoist(responses: (Response | Error)[]): { deps: ClientDeps; calls: Call[] } {
  const calls: Call[] = []
  const deps: ClientDeps = {
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), method: init?.method ?? 'GET', headers: init?.headers as Record<string, string>, body: init?.body ? String(init.body) : undefined })
      const next = responses.shift()
      if (!next) throw new Error('no more canned responses')
      if (next instanceof Error) throw next
      return next
    }) as typeof fetch,
    now: () => Date.UTC(2026, 9, 10, 12)
  }
  return { deps, calls }
}

const json = (body: unknown, init: ResponseInit = {}): Response =>
  new Response(JSON.stringify(body), { status: 200, ...init, headers: { 'content-type': 'application/json', ...(init.headers ?? {}) } })

const task = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  project_id: 'p1',
  content: `Task ${id}`,
  description: 'Notes',
  checked: false,
  is_deleted: false,
  due: { date: '2026-10-12', is_recurring: false, string: 'Oct 12', lang: 'en' },
  labels: ['errands'],
  priority: 4,
  updated_at: '2026-10-09T10:00:00.000000Z',
  ...extra
})

describe('the Todoist client', () => {
  it('says whose token it is, asking api.todoist.com with it and nowhere else', async () => {
    const { deps, calls } = fakeTodoist([json({ id: '1', full_name: 'Maria Garcia', email: 'maria@example.com' })])
    expect(await createTodoistClient('t0ken', deps).me()).toStrictEqual({ ok: true, value: { name: 'Maria Garcia' } })
    expect(calls[0].url).toBe('https://api.todoist.com/api/v1/user')
    expect(calls[0].headers.Authorization).toBe('Bearer t0ken')
  })

  it('reads what changed since a sync token: tasks done, deleted and dated, and projects renamed or gone', async () => {
    const { deps, calls } = fakeTodoist([json({
      sync_token: 'next',
      full_sync: false,
      items: [
        task('a'),
        task('b', { checked: true, due: null }),
        task('c', { is_deleted: true }),
        task('d', { due: { date: '2026-10-12T09:30:00', is_recurring: true, string: 'every monday at 9:30' } }),
        { id: 'broken' }
      ],
      projects: [{ id: 'p1', name: 'Groceries' }, { id: 'p2', name: 'Old', is_archived: true }, { id: 'p3', name: 'Gone', is_deleted: true }]
    })])
    const result = await createTodoistClient('k', deps).sync('before')
    expect(calls[0]).toMatchObject({ url: 'https://api.todoist.com/api/v1/sync', method: 'POST' })
    expect(new URLSearchParams(calls[0].body).get('sync_token')).toBe('before')
    expect(JSON.parse(new URLSearchParams(calls[0].body).get('resource_types') ?? '')).toStrictEqual(['items', 'projects'])
    if (!result.ok) throw new Error(result.message)
    expect(result.value.token).toBe('next')
    expect(result.value.full).toBe(false)
    expect(result.value.tasks.map(t => [t.id, t.checked, t.deleted, t.due?.isRecurring ?? null])).toStrictEqual([
      ['a', false, false, false], ['b', true, false, null], ['c', false, true, false], ['d', false, false, true]
    ])
    expect(result.value.tasks[0]).toMatchObject({ projectId: 'p1', content: 'Task a', description: 'Notes', labels: ['errands'], priority: 4, updatedAt: Date.UTC(2026, 9, 9, 10) })
    expect(result.value.projects).toStrictEqual([{ id: 'p1', name: 'Groceries', gone: false }, { id: 'p2', name: 'Old', gone: true }, { id: 'p3', name: 'Gone', gone: true }])
  })

  it('completes, reopens and changes a task, and reads one back', async () => {
    const { deps, calls } = fakeTodoist([
      new Response(null, { status: 204 }),
      new Response(null, { status: 204 }),
      json(task('a', { content: 'Buy oat milk' })),
      json(task('a'))
    ])
    const client = createTodoistClient('k', deps)
    expect(await client.close('a')).toStrictEqual({ ok: true, value: undefined })
    expect(await client.reopen('a')).toStrictEqual({ ok: true, value: undefined })
    const updated = await client.update('a', { content: 'Buy oat milk', due_string: 'no date' })
    expect(updated.ok && updated.value.content).toBe('Buy oat milk')
    expect((await client.task('a')).ok).toBe(true)
    expect(calls.map(c => `${c.method} ${c.url}`)).toStrictEqual([
      'POST https://api.todoist.com/api/v1/tasks/a/close',
      'POST https://api.todoist.com/api/v1/tasks/a/reopen',
      'POST https://api.todoist.com/api/v1/tasks/a',
      'GET https://api.todoist.com/api/v1/tasks/a'
    ])
    expect(JSON.parse(calls[2].body ?? '')).toStrictEqual({ content: 'Buy oat milk', due_string: 'no date' })
  })

  it('says in words what went wrong', async () => {
    const { deps } = fakeTodoist([
      new Response('Unauthorized', { status: 401 }),
      new Response('Forbidden', { status: 403 }),
      new Response('Task not found', { status: 404 }),
      new Response('Too many requests', { status: 429, headers: { 'retry-after': '120' } }),
      new Response('Service unavailable', { status: 503 }),
      new TypeError('fetch failed'),
      new Response('not json', { status: 200 })
    ])
    const client = createTodoistClient('k', deps)
    expect(await client.me()).toMatchObject({ ok: false, kind: 'auth', message: expect.stringContaining('stopped working') })
    expect(await client.close('a')).toMatchObject({ ok: false, kind: 'forbidden' })
    expect(await client.task('a')).toMatchObject({ ok: false, kind: 'not-found' })
    expect(await client.sync('*')).toMatchObject({ ok: false, kind: 'rate', resetAt: Date.UTC(2026, 9, 10, 12) + 120_000 })
    expect(await client.sync('*')).toMatchObject({ ok: false, kind: 'bad', message: expect.stringContaining('503') })
    expect(await client.me()).toMatchObject({ ok: false, kind: 'network', message: expect.stringContaining('Todoist') })
    expect(await client.me()).toMatchObject({ ok: false, kind: 'bad' })
  })

  it('refuses a task id that could leave the path, without asking', async () => {
    const { deps, calls } = fakeTodoist([])
    expect(await createTodoistClient('k', deps).close('../user')).toMatchObject({ ok: false, kind: 'bad' })
    expect(calls).toHaveLength(0)
  })
})
