/** Linear's GraphQL API, to api.linear.app only and through the guard; every answer is a result, never a throw */

import { guardedFetch, readCapped } from '../../guardedFetch'
import { isLinearId } from '../../../shared/linear'
import type { LinearTeam } from '../../../shared/connections'
import { fail, type ClientDeps, type FailureKind, type Result } from '../result'

const API = 'https://api.linear.app/graphql'
const TIMEOUT_MS = 30_000
const MAX_BYTES = 10 * 1024 * 1024
// fifty a page keeps each question well inside Linear's per-query complexity; past ten pages the rest wait for the next check
const PAGE_SIZE = 50
const MAX_PAGES = 10
const DEFAULT_WAIT_MS = 60_000

export interface LinearState {
  id: string
  name: string
  /** triage, backlog, unstarted, started, completed or canceled */
  type: string
  position: number
}

export interface LinearIssue {
  id: string
  identifier: string
  title: string
  description: string
  url: string
  /** 0 none, 1 urgent to 4 low */
  priority: number
  /** a day, YYYY-MM-DD */
  dueDate: string | null
  updatedAt: number
  /** deleted, waiting in Linear's trash */
  trashed: boolean
  state: { id: string; name: string; type: string }
  teamId: string
  assigneeId: string | null
  labels: string[]
}

/** either everything changed since a moment, or one team's open issues */
export type IssueQuery =
  | { since: string; teams: string[]; ids: string[] }
  | { team: string; openOnly: true; mine: boolean }

export interface IssueInput {
  stateId?: string
  title?: string
  description?: string
  dueDate?: string | null
}

export interface LinearClient {
  me(): Promise<Result<{ id: string; name: string }>>
  teams(): Promise<Result<LinearTeam[]>>
  states(teamId: string): Promise<Result<LinearState[]>>
  issues(query: IssueQuery): Promise<Result<LinearIssue[]>>
  update(id: string, input: IssueInput): Promise<Result<LinearIssue>>
}

const ISSUE_FIELDS = `id identifier title description url priority dueDate updatedAt trashed
  state { id name type } team { id } assignee { id } labels(first: 10) { nodes { name } }`

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null)

/** one issue from Linear's shape; anything malformed is left out */
function readIssue(raw: unknown): LinearIssue | null {
  const i = obj(raw)
  const state = obj(i?.state)
  const team = obj(i?.team)
  if (!i || !state || !team) return null
  const id = str(i.id)
  const url = str(i.url)
  const updatedAt = Date.parse(str(i.updatedAt))
  if (!isLinearId(id) || !isLinearId(str(team.id)) || !url.startsWith('https://linear.app/') || !Number.isFinite(updatedAt)) return null
  const due = str(i.dueDate)
  const labels = obj(i.labels)?.nodes
  return {
    id,
    identifier: str(i.identifier).slice(0, 50),
    title: str(i.title).slice(0, 500),
    description: str(i.description).slice(0, 200_000),
    url,
    priority: typeof i.priority === 'number' ? i.priority : 0,
    dueDate: /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : null,
    updatedAt,
    trashed: i.trashed === true,
    state: { id: str(state.id), name: str(state.name).slice(0, 80), type: str(state.type) },
    teamId: str(team.id),
    assigneeId: str(obj(i.assignee)?.id) || null,
    labels: (Array.isArray(labels) ? labels : []).map(l => str(obj(l)?.name)).filter(Boolean)
  }
}

function filterFor(query: IssueQuery): Record<string, unknown> {
  if ('team' in query) {
    return {
      team: { id: { eq: query.team } },
      state: { type: { nin: ['completed', 'canceled'] } },
      ...(query.mine ? { assignee: { isMe: { eq: true } } } : {})
    }
  }
  const where = [
    ...(query.teams.length > 0 ? [{ team: { id: { in: query.teams } } }] : []),
    ...(query.ids.length > 0 ? [{ id: { in: query.ids } }] : [])
  ]
  return { updatedAt: { gt: query.since }, ...(where.length === 1 ? where[0] : { or: where }) }
}

const CODES: Record<string, FailureKind> = {
  AUTHENTICATION_ERROR: 'auth',
  FORBIDDEN: 'forbidden',
  RATELIMITED: 'rate',
  ENTITY_NOT_FOUND: 'not-found'
}

export function createLinearClient(key: string, deps: ClientDeps): LinearClient {
  async function call(query: string, variables: Record<string, unknown> = {}): Promise<Result<Record<string, unknown>>> {
    let fetched: Awaited<ReturnType<typeof guardedFetch>>
    try {
      fetched = await guardedFetch(
        API,
        {
          signal: AbortSignal.timeout(TIMEOUT_MS),
          // a personal key goes bare; Bearer is for OAuth tokens
          headers: { Authorization: key, 'Content-Type': 'application/json' },
          method: 'POST',
          body: JSON.stringify({ query, variables })
        },
        { fetch: deps.fetch, isAllowed: async hop => hop.protocol === 'https:' && hop.hostname === 'api.linear.app' },
        'linear'
      )
    } catch (err) {
      const reason = err instanceof Error && err.name === 'TimeoutError' ? 'it took more than 30 seconds' : err instanceof Error ? err.message : String(err)
      return fail('network', `Couldn't reach Linear: ${reason}.`)
    }
    if (!fetched) return fail('network', 'Checkpoint only talks to api.linear.app, and was sent elsewhere.')
    const { response } = fetched
    const bytes = await readCapped(response, MAX_BYTES + 1).catch(() => new Uint8Array())
    if (bytes.byteLength > MAX_BYTES) return fail('bad', 'Linear sent more than Checkpoint reads at once.')
    const text = new TextDecoder().decode(bytes)
    let body: Record<string, unknown> | null = null
    try {
      body = obj(JSON.parse(text))
    } catch {
      body = null
    }

    // GraphQL says what went wrong in its errors, whatever the status
    const first = Array.isArray(body?.errors) ? obj(body.errors[0]) : null
    if (first) {
      const extensions = obj(first.extensions)
      const kind = CODES[str(extensions?.code)] ?? 'bad'
      const said = (str(extensions?.userPresentableMessage) || str(first.message)).slice(0, 200)
      if (kind === 'auth') return fail('auth', 'Your Linear key stopped working. Make a new one and connect again.')
      if (kind === 'rate') {
        const reset = Number(response.headers.get('x-ratelimit-requests-reset') ?? response.headers.get('x-ratelimit-complexity-reset'))
        return fail('rate', "Linear's limit for this key was reached.", reset > deps.now() ? reset : deps.now() + DEFAULT_WAIT_MS)
      }
      if (kind === 'forbidden') return fail('forbidden', `Linear refused: ${said || 'this key may not do that'}.`)
      if (kind === 'not-found') return fail('not-found', 'Linear could not find that.')
      return fail('bad', `Linear said: ${said || 'something went wrong'}.`)
    }
    if (response.status === 401) return fail('auth', 'Your Linear key stopped working. Make a new one and connect again.')
    if (!response.ok) return fail('bad', `Linear answered ${response.status}${text.trim() ? `: ${text.trim().slice(0, 200)}` : ''}.`)
    const data = obj(body?.data)
    return data ? { ok: true, value: data } : fail('bad', "Linear sent something Checkpoint couldn't read.")
  }

  const unreadable = <T>(): Result<T> => fail('bad', "Linear sent something Checkpoint couldn't read.")

  return {
    async me() {
      const got = await call('query { viewer { id name displayName } }')
      if (!got.ok) return got
      const viewer = obj(got.value.viewer)
      const id = str(viewer?.id)
      if (!viewer || !id) return unreadable()
      return { ok: true, value: { id, name: str(viewer.name).trim() || str(viewer.displayName).trim() || 'your Linear account' } }
    },

    async teams() {
      const got = await call('query { teams(first: 100) { nodes { id key name } } }')
      if (!got.ok) return got
      const nodes = obj(got.value.teams)?.nodes
      if (!Array.isArray(nodes)) return unreadable()
      const teams = nodes.map(obj).filter((t): t is Record<string, unknown> => t !== null && isLinearId(str(t.id)))
        .map(t => ({ id: str(t.id), key: str(t.key).slice(0, 20), name: str(t.name).slice(0, 200) || str(t.key) }))
      return { ok: true, value: teams }
    },

    async states(teamId) {
      if (!isLinearId(teamId)) return fail('bad', 'That is not a Linear team.')
      const got = await call('query($id: String!) { team(id: $id) { states(first: 100) { nodes { id name type position } } } }', { id: teamId })
      if (!got.ok) return got
      const nodes = obj(obj(got.value.team)?.states)?.nodes
      if (!Array.isArray(nodes)) return unreadable()
      const states = nodes.map(obj).filter((s): s is Record<string, unknown> => s !== null && str(s.id) !== '')
        .map(s => ({ id: str(s.id), name: str(s.name), type: str(s.type), position: typeof s.position === 'number' ? s.position : 0 }))
        .sort((a, b) => a.position - b.position)
      return { ok: true, value: states }
    },

    async issues(query) {
      const filter = filterFor(query)
      const archived = !('team' in query)
      const issues: LinearIssue[] = []
      let after: string | null = null
      for (let page = 0; page < MAX_PAGES; page++) {
        const got = await call(
          `query($filter: IssueFilter, $after: String, $archived: Boolean) {
            issues(first: ${PAGE_SIZE}, after: $after, filter: $filter, includeArchived: $archived) { nodes { ${ISSUE_FIELDS} } pageInfo { hasNextPage endCursor } }
          }`,
          { filter, after, archived }
        )
        if (!got.ok) return got
        const connection = obj(got.value.issues)
        if (!connection || !Array.isArray(connection.nodes)) return unreadable()
        for (const raw of connection.nodes) {
          const read = readIssue(raw)
          if (read) issues.push(read)
        }
        const info = obj(connection.pageInfo)
        after = info?.hasNextPage === true ? str(info.endCursor) || null : null
        if (!after) break
      }
      return { ok: true, value: issues }
    },

    async update(id, input) {
      if (!isLinearId(id)) return fail('bad', 'That is not an issue Checkpoint can change.')
      const got = await call(
        `mutation($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success issue { ${ISSUE_FIELDS} } } }`,
        { id, input }
      )
      if (!got.ok) return got
      const read = readIssue(obj(got.value.issueUpdate)?.issue)
      return read ? { ok: true, value: read } : unreadable()
    }
  }
}
