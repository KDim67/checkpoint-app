import { describe, expect, it } from 'vitest'
import { createGitHubClient, type ClientDeps } from '../src/main/connections/github/client'

interface Call { url: string; method: string; headers: Record<string, string>; body?: string }

/** answers each request with the next canned response, and keeps what was asked */
function fakeGitHub(responses: Response[]): { deps: ClientDeps; calls: Call[] } {
  const calls: Call[] = []
  const deps: ClientDeps = {
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), method: init?.method ?? 'GET', headers: init?.headers as Record<string, string>, body: init?.body as string | undefined })
      const next = responses.shift()
      if (!next) throw new Error('no more canned responses')
      return next
    }) as typeof fetch,
    now: () => Date.UTC(2026, 9, 10, 12)
  }
  return { deps, calls }
}

const json = (body: unknown, init: ResponseInit = {}): Response =>
  new Response(JSON.stringify(body), { status: 200, ...init, headers: { 'content-type': 'application/json', ...(init.headers ?? {}) } })

const issue = (number: number, extra: Record<string, unknown> = {}) => ({
  number,
  title: `Issue ${number}`,
  body: 'Steps to reproduce',
  state: 'open',
  updated_at: '2026-10-09T10:00:00Z',
  html_url: `https://github.com/octo/repo/issues/${number}`,
  assignees: [{ login: 'octo' }],
  labels: [{ name: 'bug' }, 'plain'],
  milestone: { due_on: '2026-10-31T07:00:00Z' },
  ...extra
})

describe('the GitHub client', () => {
  it('says who the key belongs to and when it expires, asking api.github.com with the key', async () => {
    const { deps, calls } = fakeGitHub([json({ login: 'octo' }, { headers: { 'github-authentication-token-expiration': '2026-11-10 12:00:00 UTC' } })])
    const result = await createGitHubClient('github_pat_x', deps).me()
    expect(result).toStrictEqual({ ok: true, value: { login: 'octo', expiresAt: Date.UTC(2026, 10, 10, 12) } })
    expect(calls[0].url).toBe('https://api.github.com/user')
    expect(calls[0].headers).toMatchObject({ Authorization: 'Bearer github_pat_x', Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' })
  })

  it('lists issues across pages, leaving pull requests out and reading labels and milestone dates', async () => {
    const { deps, calls } = fakeGitHub([
      json([issue(1), issue(2, { pull_request: { url: 'x' } })], { headers: { etag: 'W/"abc"', link: '<https://api.github.com/repositories/9/issues?page=2>; rel="next"' } }),
      json([issue(3, { state: 'closed', milestone: null })])
    ])
    const result = await createGitHubClient('k', deps).issues('octo/repo', { state: 'open', assignee: 'octo' })
    if (!result.ok || result.value === 'unchanged') throw new Error('expected issues')
    expect(result.value.etag).toBe('W/"abc"')
    expect(result.value.issues.map(i => [i.number, i.state, i.labels, i.milestoneDue])).toStrictEqual([
      [1, 'open', ['bug', 'plain'], '2026-10-31T07:00:00Z'],
      [3, 'closed', ['bug', 'plain'], null]
    ])
    expect(calls[0].url).toBe('https://api.github.com/repos/octo/repo/issues?state=open&per_page=100&assignee=octo')
    expect(calls[1].url).toBe('https://api.github.com/repositories/9/issues?page=2')
  })

  it('treats an unchanged answer as unchanged, sending what it saw last time', async () => {
    const { deps, calls } = fakeGitHub([new Response(null, { status: 304 })])
    expect(await createGitHubClient('k', deps).issues('octo/repo', { state: 'all', since: '2026-10-09T00:00:00Z' }, 'W/"abc"'))
      .toStrictEqual({ ok: true, value: 'unchanged' })
    expect(calls[0].headers['If-None-Match']).toBe('W/"abc"')
    expect(calls[0].url).toContain('since=2026-10-09T00%3A00%3A00Z')
  })

  it('closes as completed and reopens', async () => {
    const { deps, calls } = fakeGitHub([json(issue(4, { state: 'closed' })), json(issue(4))])
    const client = createGitHubClient('k', deps)
    expect((await client.setState('octo/repo', 4, 'closed')).ok).toBe(true)
    expect(await client.setState('octo/repo', 4, 'open')).toMatchObject({ ok: true, value: { state: 'open' } })
    expect([calls[0].method, JSON.parse(calls[0].body ?? '{}')]).toStrictEqual(['PATCH', { state: 'closed', state_reason: 'completed' }])
    expect(JSON.parse(calls[1].body ?? '{}')).toStrictEqual({ state: 'open' })
  })

  it('says in words what went wrong', async () => {
    const reset = Math.floor(Date.UTC(2026, 9, 10, 13) / 1000)
    const { deps } = fakeGitHub([
      json({ message: 'Bad credentials' }, { status: 401 }),
      json({ message: 'Not Found' }, { status: 404 }),
      json({ message: 'API rate limit exceeded' }, { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset) } }),
      json({ message: 'Resource not accessible by personal access token' }, { status: 403 }),
      new Response('not json', { status: 200 })
    ])
    const client = createGitHubClient('k', deps)
    expect(await client.me()).toMatchObject({ ok: false, kind: 'auth', message: expect.stringContaining('stopped working') })
    expect(await client.issues('octo/repo', { state: 'open' })).toMatchObject({ ok: false, kind: 'not-found', message: expect.stringContaining('octo/repo') })
    expect(await client.issues('octo/repo', { state: 'open' })).toMatchObject({ ok: false, kind: 'rate', resetAt: reset * 1000 })
    expect(await client.setState('octo/repo', 1, 'closed')).toMatchObject({ ok: false, kind: 'forbidden', message: expect.stringContaining('Resource not accessible') })
    expect(await client.me()).toMatchObject({ ok: false, kind: 'bad' })
  })

  it('never follows a next page off api.github.com', async () => {
    const { deps, calls } = fakeGitHub([json([issue(1)], { headers: { link: '<https://evil.example/steal>; rel="next"' } })])
    const result = await createGitHubClient('k', deps).issues('octo/repo', { state: 'open' })
    expect(result.ok).toBe(true)
    expect(calls).toHaveLength(1)
  })

  it('refuses a repository name that is not owner/repo', async () => {
    const { deps, calls } = fakeGitHub([])
    expect(await createGitHubClient('k', deps).issues('../../user', { state: 'open' })).toMatchObject({ ok: false, kind: 'bad' })
    expect(calls).toHaveLength(0)
  })
})
