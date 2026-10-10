/** Jira Cloud's REST API, to the one site connected and through the guard; every answer is a result, never a throw */

import { guardedFetch, readCapped } from '../../guardedFetch'
import { isJiraId, normalizeJiraSite } from '../../../shared/jira'
import { fail, type ClientDeps, type Result } from '../result'

const TIMEOUT_MS = 30_000
const MAX_BYTES = 10 * 1024 * 1024
const PAGE_SIZE = 100
// past ten pages of changes at once the rest wait for the next check
const MAX_PAGES = 10
const MAX_PROJECT_PAGES = 20
const DEFAULT_WAIT_S = 60
const FIELDS = ['summary', 'description', 'status', 'assignee', 'project', 'labels', 'priority', 'duedate', 'updated']

export interface JiraCredentials {
  /** https://name.atlassian.net */
  site: string
  email: string
  token: string
}

export interface JiraIssue {
  id: string
  key: string
  summary: string
  /** Jira's document format, as sent */
  description: unknown
  statusName: string
  /** new, indeterminate or done */
  statusCategory: string
  projectId: string
  assigneeId: string | null
  labels: string[]
  priorityName: string
  /** a day, YYYY-MM-DD */
  duedate: string | null
  updatedAt: number
}

export interface JiraProject {
  id: string
  key: string
  name: string
}

export interface JiraTransition {
  id: string
  name: string
  toName: string
  toCategory: string
}

export interface JiraClient {
  me(): Promise<Result<{ id: string; name: string }>>
  projects(): Promise<Result<JiraProject[]>>
  search(jql: string): Promise<Result<JiraIssue[]>>
  issue(id: string): Promise<Result<JiraIssue>>
  transitions(id: string): Promise<Result<JiraTransition[]>>
  transition(id: string, transitionId: string): Promise<Result<void>>
  edit(id: string, fields: { summary?: string; duedate?: string | null }): Promise<Result<void>>
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null)

function readIssue(raw: unknown): JiraIssue | null {
  const i = obj(raw)
  const f = obj(i?.fields)
  const status = obj(f?.status)
  const project = obj(f?.project)
  if (!i || !f || !status || !project) return null
  const id = str(i.id)
  const updatedAt = Date.parse(str(f.updated))
  if (!isJiraId(id) || !isJiraId(str(project.id)) || !str(i.key) || !Number.isFinite(updatedAt)) return null
  const due = str(f.duedate)
  return {
    id,
    key: str(i.key).slice(0, 60),
    summary: str(f.summary).slice(0, 500),
    description: f.description ?? null,
    statusName: str(status.name).slice(0, 80),
    statusCategory: str(obj(status.statusCategory)?.key),
    projectId: str(project.id),
    assigneeId: str(obj(f.assignee)?.accountId) || null,
    labels: (Array.isArray(f.labels) ? f.labels : []).filter((x): x is string => typeof x === 'string').slice(0, 30),
    priorityName: str(obj(f.priority)?.name),
    duedate: /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : null,
    updatedAt
  }
}

/** what Jira said went wrong, from its errorMessages and per-field errors */
function saidOf(body: Record<string, unknown> | null): string {
  if (!body) return ''
  const messages = (Array.isArray(body.errorMessages) ? body.errorMessages : []).filter((x): x is string => typeof x === 'string')
  const fields = Object.values(obj(body.errors) ?? {}).filter((x): x is string => typeof x === 'string')
  return [...messages, ...fields].join(' ').slice(0, 200)
}

export function createJiraClient(creds: JiraCredentials, deps: ClientDeps): JiraClient {
  const host = new URL(creds.site).hostname
  const authorization = `Basic ${Buffer.from(`${creds.email}:${creds.token}`).toString('base64')}`

  async function call(path: string, init: { method?: string; json?: unknown } = {}): Promise<Result<Record<string, unknown> | null>> {
    const headers: Record<string, string> = { Authorization: authorization, Accept: 'application/json' }
    if (init.json !== undefined) headers['Content-Type'] = 'application/json'
    let fetched: Awaited<ReturnType<typeof guardedFetch>>
    try {
      fetched = await guardedFetch(
        `${creds.site}${path}`,
        { signal: AbortSignal.timeout(TIMEOUT_MS), headers, method: init.method, body: init.json === undefined ? undefined : JSON.stringify(init.json) },
        { fetch: deps.fetch, isAllowed: async hop => hop.protocol === 'https:' && hop.hostname === host },
        'jira'
      )
    } catch (err) {
      const reason = err instanceof Error && err.name === 'TimeoutError' ? 'it took more than 30 seconds' : err instanceof Error ? err.message : String(err)
      return fail('network', `Couldn't reach Jira: ${reason}.`)
    }
    if (!fetched) return fail('network', `Checkpoint only talks to ${host}, and was sent elsewhere.`)
    const { response } = fetched
    if (response.status === 204) return { ok: true, value: null }

    const bytes = await readCapped(response, MAX_BYTES + 1).catch(() => new Uint8Array())
    if (bytes.byteLength > MAX_BYTES) return fail('bad', 'Jira sent more than Checkpoint reads at once.')
    let body: Record<string, unknown> | null = null
    try {
      body = obj(JSON.parse(new TextDecoder().decode(bytes)))
    } catch {
      body = null
    }
    if (response.ok) return body ? { ok: true, value: body } : fail('bad', "Jira sent something Checkpoint couldn't read.")

    const said = saidOf(body)
    if (response.status === 401) return fail('auth', 'Your Jira token stopped working, or the email doesn\'t match it. Make a new token and connect again.')
    // after several failed tries Atlassian wants a person to sign in once and pass a check
    if (/AUTHENTICATION_DENIED|AUTHENTICATED_FAILED/i.test(response.headers.get('x-seraph-loginreason') ?? '')) {
      return fail('auth', 'Jira wants you to sign in on the website once before Checkpoint can connect again.')
    }
    if (response.status === 429) {
      const wait = Number(response.headers.get('retry-after'))
      return fail('rate', "Jira's limit for this token was reached.", deps.now() + (wait > 0 ? wait : DEFAULT_WAIT_S) * 1000)
    }
    if (response.status === 403) return fail('forbidden', `Jira refused: ${said || 'this account may not do that'}.`)
    if (response.status === 404) return fail('not-found', 'Jira could not find that.')
    return fail('bad', `Jira answered ${response.status}${said ? `: ${said}` : ''}.`)
  }

  const unreadable = <T>(): Result<T> => fail('bad', "Jira sent something Checkpoint couldn't read.")
  const badId = <T>(): Result<T> => fail('bad', 'That is not an issue Checkpoint can change.')

  return {
    async me() {
      const got = await call('/rest/api/3/myself')
      if (!got.ok) return got
      const id = str(got.value?.accountId)
      if (!id) return unreadable()
      return { ok: true, value: { id, name: str(got.value?.displayName).trim() || 'your Jira account' } }
    },

    async projects() {
      const projects: JiraProject[] = []
      // the next page starts after everything sent, kept or not
      let startAt = 0
      for (let page = 0; page < MAX_PROJECT_PAGES; page++) {
        const got = await call(`/rest/api/3/project/search?maxResults=50&startAt=${startAt}`)
        if (!got.ok) return got
        const values = Array.isArray(got.value?.values) ? got.value.values : []
        for (const raw of values) {
          const p = obj(raw)
          if (p && isJiraId(str(p.id))) projects.push({ id: str(p.id), key: str(p.key).slice(0, 20), name: str(p.name).slice(0, 200) || str(p.key) })
        }
        startAt += values.length
        if (got.value?.isLast !== false || values.length === 0) break
      }
      return { ok: true, value: projects }
    },

    async search(jql) {
      const issues: JiraIssue[] = []
      let token: string | null = null
      for (let page = 0; page < MAX_PAGES; page++) {
        const got = await call('/rest/api/3/search/jql', {
          method: 'POST',
          json: { jql, fields: FIELDS, maxResults: PAGE_SIZE, ...(token ? { nextPageToken: token } : {}) }
        })
        if (!got.ok) return got
        if (!got.value || !Array.isArray(got.value.issues)) return unreadable()
        for (const raw of got.value.issues) {
          const read = readIssue(raw)
          if (read) issues.push(read)
        }
        token = str(got.value.nextPageToken) || null
        if (!token || got.value.isLast === true) break
      }
      return { ok: true, value: issues }
    },

    async issue(id) {
      if (!isJiraId(id)) return badId()
      const got = await call(`/rest/api/3/issue/${id}?fields=${encodeURIComponent(FIELDS.join(','))}`)
      if (!got.ok) return got
      const read = readIssue(got.value)
      return read ? { ok: true, value: read } : unreadable()
    },

    async transitions(id) {
      if (!isJiraId(id)) return badId()
      const got = await call(`/rest/api/3/issue/${id}/transitions`)
      if (!got.ok) return got
      const list = Array.isArray(got.value?.transitions) ? got.value.transitions : []
      const transitions = list.map(obj).filter((t): t is Record<string, unknown> => t !== null && str(t.id) !== '' && obj(t.to) !== null)
        .map(t => {
          const to = obj(t.to) as Record<string, unknown>
          return { id: str(t.id), name: str(t.name), toName: str(to.name), toCategory: str(obj(to.statusCategory)?.key) }
        })
      return { ok: true, value: transitions }
    },

    async transition(id, transitionId) {
      if (!isJiraId(id) || !/^\d{1,18}$/.test(transitionId)) return badId()
      const got = await call(`/rest/api/3/issue/${id}/transitions`, { method: 'POST', json: { transition: { id: transitionId } } })
      return got.ok ? { ok: true, value: undefined } : got
    },

    async edit(id, fields) {
      if (!isJiraId(id)) return badId()
      const got = await call(`/rest/api/3/issue/${id}`, { method: 'PUT', json: { fields } })
      return got.ok ? { ok: true, value: undefined } : got
    }
  }
}

/** the site, email and token kept together as one secret; null when what was kept is damaged */
export function readJiraCredentials(stored: string): JiraCredentials | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(stored)
  } catch {
    return null
  }
  const c = obj(parsed)
  const site = normalizeJiraSite(str(c?.site))
  const email = str(c?.email).trim()
  const token = str(c?.token).trim()
  return site && email && token ? { site, email, token } : null
}
