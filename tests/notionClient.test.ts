import { describe, expect, it } from 'vitest'
import { createNotionClient } from '../src/main/connections/notion/client'
import type { ClientDeps } from '../src/main/connections/result'

interface Call { url: string; method: string; headers: Record<string, string>; body?: unknown }

function fakeNotion(responses: (Response | Error)[]): { deps: ClientDeps; calls: Call[] } {
  const calls: Call[] = []
  const deps: ClientDeps = {
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), method: init?.method ?? 'GET', headers: init?.headers as Record<string, string>, body: init?.body ? JSON.parse(String(init.body)) : undefined })
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

const ID = 'be633bf1-dfa0-436d-b259-571129a590e5'
const DS = '2f26ee68-df30-4251-aad4-8ddc420cba3d'
const rich = (text: string) => [{ type: 'text', plain_text: text }]

const page = (id = ID, extra: Record<string, unknown> = {}) => ({
  object: 'page',
  id,
  url: `https://www.notion.so/Bug-bash-${id.replace(/-/g, '')}`,
  last_edited_time: '2026-10-09T10:00:00.000Z',
  in_trash: false,
  parent: { type: 'data_source_id', data_source_id: DS, database_id: 'db-1' },
  properties: {
    Name: { id: 'title', type: 'title', title: rich('Bug bash') },
    Status: { id: 's1', type: 'status', status: { id: 'o-todo', name: 'Not started' } },
    Done: { id: 'c1', type: 'checkbox', checkbox: false },
    Due: { id: 'd1', type: 'date', date: { start: '2026-10-12', end: null } },
    Tags: { id: 't1', type: 'multi_select', multi_select: [{ name: 'bug' }, { name: 'ui' }] },
    Priority: { id: 'p1', type: 'select', select: { name: 'High' } }
  },
  ...extra
})

describe('the Notion client', () => {
  it('says which workspace the secret belongs to, asking api.notion.com with the version it speaks', async () => {
    const { deps, calls } = fakeNotion([json({ object: 'user', id: 'bot', type: 'bot', name: 'Checkpoint', bot: { workspace_name: 'Acme' } })])
    expect(await createNotionClient('ntn_abc', deps).me()).toStrictEqual({ ok: true, value: { name: 'Acme' } })
    expect(calls[0].url).toBe('https://api.notion.com/v1/users/me')
    expect(calls[0].headers).toMatchObject({ Authorization: 'Bearer ntn_abc', 'Notion-Version': '2026-03-11' })
  })

  it('lists the databases shared with it, and reads one\'s columns with their status groups', async () => {
    const { deps, calls } = fakeNotion([
      json({ results: [{ object: 'data_source', id: DS, title: rich('Tasks') }, { object: 'data_source', id: 'nope' }], has_more: false, next_cursor: null }),
      json({ object: 'data_source', id: DS, title: rich('Tasks'), properties: {
        Name: { id: 'title', name: 'Name', type: 'title', title: {} },
        Status: { id: 's1', name: 'Status', type: 'status', status: {
          options: [{ id: 'o-todo', name: 'Not started' }, { id: 'o-done', name: 'Done' }],
          groups: [{ id: 'g1', name: 'To-do', option_ids: ['o-todo'] }, { id: 'g2', name: 'Complete', option_ids: ['o-done'] }]
        } }
      } })
    ])
    const client = createNotionClient('k', deps)
    expect(await client.sources()).toStrictEqual({ ok: true, value: [{ id: DS, name: 'Tasks' }] })
    expect(calls[0].body).toMatchObject({ filter: { property: 'object', value: 'data_source' } })
    expect(await client.schema(DS)).toStrictEqual({ ok: true, value: [
      { id: 'title', name: 'Name', type: 'title' },
      { id: 's1', name: 'Status', type: 'status', options: [{ id: 'o-todo', name: 'Not started' }, { id: 'o-done', name: 'Done' }], groups: [{ name: 'To-do', optionIds: ['o-todo'] }, { name: 'Complete', optionIds: ['o-done'] }] }
    ] })
  })

  it('reads pages edited since a time across pages, by column id', async () => {
    const { deps, calls } = fakeNotion([
      json({ results: [page(), { object: 'page', id: 'broken' }], has_more: true, next_cursor: 'c2' }),
      json({ results: [page('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', { properties: { Name: { id: 'title', type: 'title', title: rich('Two') }, Due: { id: 'd1', type: 'date', date: null } } })], has_more: false, next_cursor: null })
    ])
    const result = await createNotionClient('k', deps).query(DS, '2026-10-09T09:00:00.000Z')
    if (!result.ok) throw new Error(result.message)
    expect(result.value).toHaveLength(2)
    expect(result.value[0]).toMatchObject({ id: ID, source: DS, inTrash: false, lastEdited: Date.UTC(2026, 9, 9, 10) })
    expect(result.value[0].values).toStrictEqual({
      title: { title: 'Bug bash' }, s1: { status: 'o-todo' }, c1: { checkbox: false }, d1: { date: '2026-10-12' }, t1: { multi: ['bug', 'ui'] }, p1: { select: 'High' }
    })
    expect(result.value[1].values.d1).toStrictEqual({ date: null })
    expect(calls[0]).toMatchObject({ url: `https://api.notion.com/v1/data_sources/${DS}/query`, method: 'POST' })
    expect(calls[0].body).toMatchObject({ filter: { timestamp: 'last_edited_time', last_edited_time: { on_or_after: '2026-10-09T09:00:00.000Z' } }, page_size: 100 })
    expect(calls[1].body).toMatchObject({ start_cursor: 'c2' })
  })

  it('lists what is in the trash, and changes a page\'s columns', async () => {
    const { deps, calls } = fakeNotion([
      json({ results: [{ object: 'page', id: ID }], has_more: false, next_cursor: null }),
      json(page(ID, { properties: { Name: { id: 'title', type: 'title', title: rich('Renamed') } } }))
    ])
    const client = createNotionClient('k', deps)
    expect(await client.trash()).toStrictEqual({ ok: true, value: [ID] })
    expect(calls[0].body).toMatchObject({ filter: { property: 'object', value: 'page', in_trash: true } })
    const updated = await client.update(ID, { title: { title: [{ type: 'text', text: { content: 'Renamed' } }] } })
    expect(updated.ok && updated.value.values.title).toStrictEqual({ title: 'Renamed' })
    expect(calls[1]).toMatchObject({ url: `https://api.notion.com/v1/pages/${ID}`, method: 'PATCH', body: { properties: { title: { title: [{ type: 'text', text: { content: 'Renamed' } }] } } } })
  })

  it('says in words what went wrong', async () => {
    const err = (status: number, code: string, message = 'x', headers: Record<string, string> = {}) =>
      json({ object: 'error', status, code, message }, { status, headers })
    const { deps } = fakeNotion([
      err(401, 'unauthorized', 'API token is invalid.'),
      err(403, 'restricted_resource', 'Insufficient permissions.'),
      err(404, 'object_not_found', 'Could not find data source.'),
      err(429, 'rate_limited', 'Slow down', { 'retry-after': '3' }),
      err(400, 'validation_error', 'Status is expected to be status.'),
      err(503, 'service_unavailable', 'Try later'),
      new TypeError('fetch failed')
    ])
    const client = createNotionClient('k', deps)
    expect(await client.me()).toMatchObject({ ok: false, kind: 'auth', message: expect.stringContaining('stopped working') })
    expect(await client.sources()).toMatchObject({ ok: false, kind: 'forbidden' })
    expect(await client.schema(DS)).toMatchObject({ ok: false, kind: 'not-found', message: expect.stringContaining('shared with') })
    expect(await client.query(DS, null)).toMatchObject({ ok: false, kind: 'rate', resetAt: Date.UTC(2026, 9, 10, 12) + 3000 })
    expect(await client.update(ID, {})).toMatchObject({ ok: false, kind: 'bad', message: expect.stringContaining('Status is expected') })
    expect(await client.trash()).toMatchObject({ ok: false, kind: 'bad', message: expect.stringContaining('503') })
    expect(await client.me()).toMatchObject({ ok: false, kind: 'network', message: expect.stringContaining('Notion') })
  })

  it('refuses an id that isn\'t one, without asking', async () => {
    const { deps, calls } = fakeNotion([])
    expect(await createNotionClient('k', deps).update('../users/me', {})).toMatchObject({ ok: false, kind: 'bad' })
    expect(calls).toHaveLength(0)
  })
})
