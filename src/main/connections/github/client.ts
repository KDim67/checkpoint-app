/** GitHub's REST API, to api.github.com only and through the guard; every answer is a result, never a throw */

import { guardedFetch, readCapped } from '../../guardedFetch'
import { isRepoName } from '../../../shared/github'
import { fail, type ClientDeps, type Result } from '../result'

const API = 'https://api.github.com'
const TIMEOUT_MS = 30_000
const MAX_BYTES = 5 * 1024 * 1024
// a hundred issues a page; past a thousand changed at once the rest wait for the next check
const MAX_PAGES = 10

export interface RemoteIssue {
  number: number
  title: string
  body: string
  state: 'open' | 'closed'
  updatedAt: number
  assignees: string[]
  labels: string[]
  url: string
  /** the milestone's due date as GitHub gives it, or null */
  milestoneDue: string | null
}

export type { ClientDeps, FailureKind, Result } from '../result'

export interface IssueQuery {
  state: 'open' | 'all'
  /** a login, or * for anyone assigned; absent for every issue */
  assignee?: string
  /** ISO time: only issues changed since */
  since?: string
}

export interface GitHubClient {
  me(): Promise<Result<{ login: string; expiresAt: number | null }>>
  issues(repo: string, query: IssueQuery, etag?: string | null): Promise<Result<{ issues: RemoteIssue[]; etag: string | null } | 'unchanged'>>
  setState(repo: string, number: number, state: 'open' | 'closed'): Promise<Result<RemoteIssue>>
}

/** "2026-11-10 12:00:00 UTC", or with an offset; null when absent or unreadable */
export function parseExpiry(header: string | null): number | null {
  if (!header) return null
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})\s*(UTC|Z|[+-]\d{2}:?\d{2})?$/.exec(header.trim())
  if (!m) return null
  const zone = !m[3] || m[3] === 'UTC' || m[3] === 'Z' ? 'Z' : m[3].replace(/^([+-]\d{2})(\d{2})$/, '$1:$2')
  const at = Date.parse(`${m[1]}T${m[2]}${zone}`)
  return Number.isFinite(at) ? at : null
}

const nextPage = (link: string | null): string | null => {
  const m = link ? /<([^>]+)>;\s*rel="next"/.exec(link) : null
  return m ? m[1] : null
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/** one issue from GitHub's shape; pull requests and anything malformed are left out */
function readIssue(raw: unknown): RemoteIssue | null {
  if (!raw || typeof raw !== 'object') return null
  const i = raw as Record<string, unknown>
  if (i.pull_request) return null
  if (typeof i.number !== 'number' || !Number.isInteger(i.number) || i.number <= 0) return null
  if (i.state !== 'open' && i.state !== 'closed') return null
  const updatedAt = Date.parse(str(i.updated_at))
  const url = str(i.html_url)
  if (!Number.isFinite(updatedAt) || !url.startsWith('https://github.com/')) return null
  const names = (list: unknown, field: string): string[] => (Array.isArray(list) ? list : [])
    .map(x => (typeof x === 'string' ? x : x && typeof x === 'object' ? str((x as Record<string, unknown>)[field]) : ''))
    .filter(Boolean)
  const milestone = i.milestone && typeof i.milestone === 'object' ? (i.milestone as Record<string, unknown>) : null
  return {
    number: i.number,
    title: str(i.title).slice(0, 500),
    body: str(i.body).slice(0, 200_000),
    state: i.state,
    updatedAt,
    assignees: names(i.assignees, 'login'),
    labels: names(i.labels, 'name').slice(0, 30),
    url,
    milestoneDue: milestone && str(milestone.due_on) ? str(milestone.due_on) : null
  }
}

export function createGitHubClient(key: string, deps: ClientDeps): GitHubClient {
  async function call(url: string, init: { method?: string; body?: unknown; etag?: string | null } = {}): Promise<Result<{ response: Response; data: unknown }> | Result<'unchanged'>> {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${key}`,
      'X-GitHub-Api-Version': '2022-11-28'
    }
    if (init.etag) headers['If-None-Match'] = init.etag
    if (init.body !== undefined) headers['Content-Type'] = 'application/json'
    let fetched: Awaited<ReturnType<typeof guardedFetch>>
    try {
      fetched = await guardedFetch(
        url,
        { signal: AbortSignal.timeout(TIMEOUT_MS), headers, method: init.method, body: init.body === undefined ? undefined : JSON.stringify(init.body) },
        { fetch: deps.fetch, isAllowed: async hop => hop.protocol === 'https:' && hop.hostname === 'api.github.com' },
        'github'
      )
    } catch (err) {
      const reason = err instanceof Error && err.name === 'TimeoutError' ? 'it took more than 30 seconds' : err instanceof Error ? err.message : String(err)
      return fail('network', `Couldn't reach GitHub: ${reason}.`)
    }
    if (!fetched) return fail('network', 'Checkpoint only talks to api.github.com, and was sent elsewhere.')
    const { response } = fetched
    if (response.status === 304) return { ok: true, value: 'unchanged' }

    const bytes = await readCapped(response, MAX_BYTES + 1).catch(() => new Uint8Array())
    let data: unknown = null
    try {
      data = JSON.parse(new TextDecoder().decode(bytes))
    } catch {
      data = null
    }
    const said = data && typeof data === 'object' ? str((data as Record<string, unknown>).message).slice(0, 200) : ''

    if (response.ok) {
      if (bytes.byteLength > MAX_BYTES) return fail('bad', 'GitHub sent more than Checkpoint reads at once.')
      if (data === null) return fail('bad', "GitHub sent something Checkpoint couldn't read.")
      return { ok: true, value: { response, data } }
    }
    const remaining = response.headers.get('x-ratelimit-remaining')
    const retryAfter = Number(response.headers.get('retry-after'))
    if (response.status === 429 || (response.status === 403 && (remaining === '0' || retryAfter > 0))) {
      const reset = Number(response.headers.get('x-ratelimit-reset'))
      const resetAt = remaining === '0' && reset > 0 ? reset * 1000 : deps.now() + (retryAfter > 0 ? retryAfter : 60) * 1000
      return fail('rate', "GitHub's limit for this key was reached.", resetAt)
    }
    if (response.status === 401) return fail('auth', 'Your GitHub key stopped working. Make a new one and connect again.')
    if (response.status === 403) {
      if (response.headers.get('x-github-sso')) return fail('forbidden', 'Your organisation needs this key authorised for single sign-on on GitHub.')
      return fail('forbidden', `GitHub refused: ${said || 'this key may not do that'}.`)
    }
    if (response.status === 404 || response.status === 410) return fail('not-found', 'GitHub could not find that.')
    return fail('bad', `GitHub answered ${response.status}${said ? `: ${said}` : ''}.`)
  }

  return {
    async me() {
      const got = await call(`${API}/user`)
      if (!got.ok) return got
      if (got.value === 'unchanged') return fail('bad', "GitHub sent something Checkpoint couldn't read.")
      const login = str((got.value.data as Record<string, unknown>).login)
      if (!login) return fail('bad', "GitHub didn't say whose key this is.")
      return { ok: true, value: { login, expiresAt: parseExpiry(got.value.response.headers.get('github-authentication-token-expiration')) } }
    },

    async issues(repo, query, etag) {
      if (!isRepoName(repo)) return fail('bad', `"${repo}" is not a repository name like owner/repo.`)
      const params = new URLSearchParams({ state: query.state, per_page: '100' })
      if (query.assignee) params.set('assignee', query.assignee)
      if (query.since) params.set('since', query.since)
      let url: string | null = `${API}/repos/${repo}/issues?${params.toString()}`
      const issues: RemoteIssue[] = []
      let firstEtag: string | null = null
      for (let page = 0; url && page < MAX_PAGES; page++) {
        const got = await call(url, { etag: page === 0 ? etag : null })
        if (!got.ok) {
          if (got.kind === 'not-found') return fail('not-found', `GitHub can't find ${repo}, or this key doesn't cover it. Add the repository to the key.`)
          return got
        }
        if (got.value === 'unchanged') return { ok: true, value: 'unchanged' }
        if (page === 0) firstEtag = got.value.response.headers.get('etag')
        if (Array.isArray(got.value.data)) {
          for (const raw of got.value.data) {
            const read = readIssue(raw)
            if (read) issues.push(read)
          }
        }
        url = nextPage(got.value.response.headers.get('link'))
        // the guard would refuse it too; stopping here keeps the key from even being offered
        if (url && !url.startsWith(`${API}/`)) url = null
      }
      return { ok: true, value: { issues, etag: firstEtag } }
    },

    async setState(repo, number, state) {
      if (!isRepoName(repo) || !Number.isInteger(number) || number <= 0) return fail('bad', 'That is not an issue Checkpoint can change.')
      const got = await call(`${API}/repos/${repo}/issues/${number}`, {
        method: 'PATCH',
        body: state === 'closed' ? { state: 'closed', state_reason: 'completed' } : { state: 'open' }
      })
      if (!got.ok) return got
      const read = got.value === 'unchanged' ? null : readIssue(got.value.data)
      return read ? { ok: true, value: read } : fail('bad', "GitHub sent something Checkpoint couldn't read.")
    }
  }
}
