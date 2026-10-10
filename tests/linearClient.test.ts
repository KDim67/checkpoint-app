import { describe, expect, it } from 'vitest'
import { createLinearClient } from '../src/main/connections/linear/client'
import type { ClientDeps } from '../src/main/connections/result'

interface Call { url: string; headers: Record<string, string>; body: { query: string; variables?: Record<string, unknown> } }

function fakeLinear(responses: (Response | Error)[]): { deps: ClientDeps; calls: Call[] } {
  const calls: Call[] = []
  const deps: ClientDeps = {
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), headers: init?.headers as Record<string, string>, body: JSON.parse(String(init?.body)) })
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

const issue = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  identifier: 'ENG-1',
  title: 'Fix login',
  description: 'Steps',
  url: 'https://linear.app/acme/issue/ENG-1/fix-login',
  priority: 2,
  dueDate: '2026-10-12',
  updatedAt: '2026-10-09T10:00:00.000Z',
  trashed: null,
  state: { id: 's-todo', name: 'Todo', type: 'unstarted' },
  team: { id: 'team-1' },
  assignee: { id: 'me' },
  labels: { nodes: [{ name: 'bug' }] },
  ...extra
})

const page = (nodes: unknown[], next: string | null = null) =>
  json({ data: { issues: { nodes, pageInfo: { hasNextPage: next !== null, endCursor: next } } } })

describe('the Linear client', () => {
  it('says who the key belongs to, sending it bare to api.linear.app and nowhere else', async () => {
    const { deps, calls } = fakeLinear([json({ data: { viewer: { id: 'me', name: 'Maria Garcia', displayName: 'maria' } } })])
    expect(await createLinearClient('lin_api_abc', deps).me()).toStrictEqual({ ok: true, value: { id: 'me', name: 'Maria Garcia' } })
    expect(calls[0].url).toBe('https://api.linear.app/graphql')
    expect(calls[0].headers.Authorization).toBe('lin_api_abc')
  })

  it('lists teams and a team\'s states in their order', async () => {
    const { deps } = fakeLinear([
      json({ data: { teams: { nodes: [{ id: 't1', key: 'ENG', name: 'Engineering' }, { id: 7 }] } } }),
      json({ data: { team: { states: { nodes: [
        { id: 's2', name: 'Done', type: 'completed', position: 3 },
        { id: 's1', name: 'Todo', type: 'unstarted', position: 1 }
      ] } } } })
    ])
    const client = createLinearClient('k', deps)
    expect(await client.teams()).toStrictEqual({ ok: true, value: [{ id: 't1', key: 'ENG', name: 'Engineering' }] })
    expect(await client.states('t1')).toStrictEqual({ ok: true, value: [
      { id: 's1', name: 'Todo', type: 'unstarted', position: 1 },
      { id: 's2', name: 'Done', type: 'completed', position: 3 }
    ] })
  })

  it('reads issues changed since a time in followed teams or with cards, across pages, archived ones included', async () => {
    const { deps, calls } = fakeLinear([
      page([issue('a'), { id: 'broken' }], 'next-page'),
      page([issue('b', { trashed: true, dueDate: null, assignee: null, state: { id: 's-done', name: 'Canceled', type: 'canceled' } })])
    ])
    const result = await createLinearClient('k', deps).issues({ since: '2026-10-09T00:00:00.000Z', teams: ['team-1'], ids: ['b'] })
    if (!result.ok) throw new Error(result.message)
    expect(result.value.map(i => [i.id, i.trashed, i.state.type, i.assigneeId, i.dueDate])).toStrictEqual([
      ['a', false, 'unstarted', 'me', '2026-10-12'], ['b', true, 'canceled', null, null]
    ])
    expect(result.value[0]).toMatchObject({ identifier: 'ENG-1', teamId: 'team-1', labels: ['bug'], priority: 2, updatedAt: Date.UTC(2026, 9, 9, 10) })
    expect(calls[0].body.variables).toMatchObject({
      archived: true,
      filter: { updatedAt: { gt: '2026-10-09T00:00:00.000Z' }, or: [{ team: { id: { in: ['team-1'] } } }, { id: { in: ['b'] } }] }
    })
    expect(calls[1].body.variables?.after).toBe('next-page')
  })

  it('asks a team for its open issues, only yours when that is what is followed', async () => {
    const { deps, calls } = fakeLinear([page([])])
    await createLinearClient('k', deps).issues({ team: 'team-1', openOnly: true, mine: true })
    expect(calls[0].body.variables).toMatchObject({
      archived: false,
      filter: { team: { id: { eq: 'team-1' } }, state: { type: { nin: ['completed', 'canceled'] } }, assignee: { isMe: { eq: true } } }
    })
  })

  it('changes an issue and reads it back', async () => {
    const { deps, calls } = fakeLinear([json({ data: { issueUpdate: { success: true, issue: issue('a', { title: 'Fixed' }) } } })])
    const result = await createLinearClient('k', deps).update('a', { stateId: 's-done', dueDate: null })
    expect(result.ok && result.value.title).toBe('Fixed')
    expect(calls[0].body.variables).toStrictEqual({ id: 'a', input: { stateId: 's-done', dueDate: null } })
  })

  it('says in words what went wrong', async () => {
    const reset = Date.UTC(2026, 9, 10, 13)
    const { deps } = fakeLinear([
      json({ errors: [{ message: 'Authentication required', extensions: { code: 'AUTHENTICATION_ERROR' } }] }, { status: 400 }),
      json({ errors: [{ message: 'Rate limit exceeded', extensions: { code: 'RATELIMITED' } }] }, { status: 400, headers: { 'x-ratelimit-requests-reset': String(reset) } }),
      json({ errors: [{ message: 'Forbidden', extensions: { code: 'FORBIDDEN', userPresentableMessage: 'You don\'t have access to this team.' } }] }),
      json({ errors: [{ message: 'Entity not found', extensions: { code: 'ENTITY_NOT_FOUND' } }] }),
      new Response('Bad gateway', { status: 502 }),
      new TypeError('fetch failed'),
      json({ data: null })
    ])
    const client = createLinearClient('k', deps)
    expect(await client.me()).toMatchObject({ ok: false, kind: 'auth', message: expect.stringContaining('stopped working') })
    expect(await client.teams()).toMatchObject({ ok: false, kind: 'rate', resetAt: reset })
    expect(await client.update('a', { stateId: 's' })).toMatchObject({ ok: false, kind: 'forbidden', message: expect.stringContaining('access to this team') })
    expect(await client.update('a', { stateId: 's' })).toMatchObject({ ok: false, kind: 'not-found' })
    expect(await client.teams()).toMatchObject({ ok: false, kind: 'bad', message: expect.stringContaining('502') })
    expect(await client.me()).toMatchObject({ ok: false, kind: 'network', message: expect.stringContaining('Linear') })
    expect(await client.me()).toMatchObject({ ok: false, kind: 'bad' })
  })
})
