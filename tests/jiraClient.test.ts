import { describe, expect, it } from 'vitest'
import { createJiraClient } from '../src/main/connections/jira/client'
import type { ClientDeps } from '../src/main/connections/result'

interface Call { url: string; method: string; headers: Record<string, string>; body?: string }

const SITE = 'https://acme.atlassian.net'
const CREDS = { site: SITE, email: 'maria@example.com', token: 'ATATT-test-token' }

function fakeJira(responses: (Response | Error)[]): { deps: ClientDeps; calls: Call[] } {
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

const issue = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  key: `ENG-${id}`,
  fields: {
    summary: 'Fix login',
    description: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Steps' }] }] },
    status: { id: '3', name: 'In Review', statusCategory: { key: 'indeterminate' } },
    assignee: { accountId: 'acc-1' },
    project: { id: '10000', key: 'ENG', name: 'Engineering' },
    labels: ['bug'],
    priority: { name: 'High' },
    duedate: '2026-10-12',
    updated: '2026-10-09T10:00:00.000+0200',
    ...extra
  }
})

describe('the Jira client', () => {
  it('says who the token belongs to, signing in with the email and token at that site only', async () => {
    const { deps, calls } = fakeJira([json({ accountId: 'acc-1', displayName: 'Maria Garcia', emailAddress: 'maria@example.com' })])
    expect(await createJiraClient(CREDS, deps).me()).toStrictEqual({ ok: true, value: { id: 'acc-1', name: 'Maria Garcia' } })
    expect(calls[0].url).toBe(`${SITE}/rest/api/3/myself`)
    expect(calls[0].headers.Authorization).toBe(`Basic ${Buffer.from('maria@example.com:ATATT-test-token').toString('base64')}`)
  })

  it('lists projects across pages', async () => {
    const { deps, calls } = fakeJira([
      json({ values: [{ id: '10000', key: 'ENG', name: 'Engineering' }, { id: 'x' }], isLast: false }),
      json({ values: [{ id: '10001', key: 'DES', name: 'Design' }], isLast: true })
    ])
    expect(await createJiraClient(CREDS, deps).projects()).toStrictEqual({ ok: true, value: [
      { id: '10000', key: 'ENG', name: 'Engineering' }, { id: '10001', key: 'DES', name: 'Design' }
    ] })
    expect(calls[1].url).toContain('startAt=2')
  })

  it('searches with JQL across pages, reading each issue\'s fields', async () => {
    const { deps, calls } = fakeJira([
      json({ issues: [issue('1'), { id: 'bad' }], nextPageToken: 'more' }),
      json({ issues: [issue('2', { assignee: null, duedate: null, status: { id: '9', name: 'Done', statusCategory: { key: 'done' } } })], isLast: true })
    ])
    const result = await createJiraClient(CREDS, deps).search('project = 10000')
    if (!result.ok) throw new Error(result.message)
    expect(result.value.map(i => [i.id, i.key, i.statusCategory, i.assigneeId, i.duedate])).toStrictEqual([
      ['1', 'ENG-1', 'indeterminate', 'acc-1', '2026-10-12'], ['2', 'ENG-2', 'done', null, null]
    ])
    expect(result.value[0]).toMatchObject({ summary: 'Fix login', statusName: 'In Review', projectId: '10000', labels: ['bug'], priorityName: 'High', updatedAt: Date.UTC(2026, 9, 9, 8) })
    expect(calls[0]).toMatchObject({ url: `${SITE}/rest/api/3/search/jql`, method: 'POST' })
    expect(JSON.parse(calls[0].body ?? '')).toMatchObject({ jql: 'project = 10000', maxResults: 100 })
    expect(JSON.parse(calls[1].body ?? '').nextPageToken).toBe('more')
  })

  it('lists, runs and edits, then reads an issue back', async () => {
    const { deps, calls } = fakeJira([
      json({ transitions: [{ id: '31', name: 'Done', to: { name: 'Done', statusCategory: { key: 'done' } } }, { id: 'x' }] }),
      new Response(null, { status: 204 }),
      new Response(null, { status: 204 }),
      json(issue('1'))
    ])
    const client = createJiraClient(CREDS, deps)
    expect(await client.transitions('1')).toStrictEqual({ ok: true, value: [{ id: '31', name: 'Done', toName: 'Done', toCategory: 'done' }] })
    expect(await client.transition('1', '31')).toStrictEqual({ ok: true, value: undefined })
    expect(await client.edit('1', { summary: 'Fixed', duedate: null })).toStrictEqual({ ok: true, value: undefined })
    expect((await client.issue('1')).ok).toBe(true)
    expect(calls.map(c => `${c.method} ${c.url.replace(SITE, '')}`)).toStrictEqual([
      'GET /rest/api/3/issue/1/transitions',
      'POST /rest/api/3/issue/1/transitions',
      'PUT /rest/api/3/issue/1',
      `GET /rest/api/3/issue/1?fields=${encodeURIComponent('summary,description,status,assignee,project,labels,priority,duedate,updated')}`
    ])
    expect(JSON.parse(calls[1].body ?? '')).toStrictEqual({ transition: { id: '31' } })
    expect(JSON.parse(calls[2].body ?? '')).toStrictEqual({ fields: { summary: 'Fixed', duedate: null } })
  })

  it('says in words what went wrong', async () => {
    const { deps } = fakeJira([
      new Response('', { status: 401 }),
      new Response('', { status: 403, headers: { 'x-seraph-loginreason': 'AUTHENTICATION_DENIED' } }),
      json({ errorMessages: ['You do not have permission to edit this issue.'] }, { status: 403 }),
      json({ errorMessages: ['Issue does not exist'] }, { status: 404 }),
      new Response('', { status: 429, headers: { 'retry-after': '30' } }),
      json({ errorMessages: [], errors: { duedate: 'Field cannot be set.' } }, { status: 400 }),
      new TypeError('fetch failed')
    ])
    const client = createJiraClient(CREDS, deps)
    expect(await client.me()).toMatchObject({ ok: false, kind: 'auth', message: expect.stringContaining('stopped working') })
    expect(await client.me()).toMatchObject({ ok: false, kind: 'auth', message: expect.stringContaining('sign in on the website') })
    expect(await client.edit('1', { summary: 'x' })).toMatchObject({ ok: false, kind: 'forbidden', message: expect.stringContaining('permission to edit') })
    expect(await client.issue('1')).toMatchObject({ ok: false, kind: 'not-found' })
    expect(await client.search('x')).toMatchObject({ ok: false, kind: 'rate', resetAt: Date.UTC(2026, 9, 10, 12) + 30_000 })
    expect(await client.edit('1', { duedate: null })).toMatchObject({ ok: false, kind: 'bad', message: expect.stringContaining('Field cannot be set') })
    expect(await client.me()).toMatchObject({ ok: false, kind: 'network', message: expect.stringContaining('Jira') })
  })

  it('refuses an issue id that isn\'t one, without asking', async () => {
    const { deps, calls } = fakeJira([])
    expect(await createJiraClient(CREDS, deps).issue('../myself')).toMatchObject({ ok: false, kind: 'bad' })
    expect(calls).toHaveLength(0)
  })
})
