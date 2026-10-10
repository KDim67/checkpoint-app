/** one GitHub check: each followed repository read since where it was last read up to, and settled by the engine; GitHub keeps the title, text and milestone date */

import type Database from 'better-sqlite3'
import { getSetting, setSetting } from '../../db'
import { allDay } from '../../../shared/dueDate'
import { issueRemoteId } from '../../../shared/github'
import type { WorkspaceRepoView } from '../../../shared/connections'
import { settleBatch, type Adapter, type RemoteItem, type SyncProblem, type SyncReport } from '../engine'
import type { GitHubClient, IssueQuery, RemoteIssue } from './client'

export type { SyncReport } from '../engine'

// where each repository was read up to, and GitHub's tag for that exact question; this computer only
const SYNC_STATE_KEY = 'github_sync_state'

const MILESTONE_LOCK = 'This date comes from the issue\'s milestone on GitHub, so change it there.'

interface RepoCursor {
  /** the newest change GitHub has shown; asking from here again costs nothing while nothing changes */
  cursor: string | null
  query: string | null
  etag: string | null
}

export interface SyncDeps {
  db: Database.Database
  client: GitHubClient
  login: string
  repos: WorkspaceRepoView[]
  /** repositories this key may only read; added to when GitHub refuses a close */
  readOnly: Set<string>
  now: () => number
}

function readCursors(): Record<string, RepoCursor> {
  const raw = getSetting<unknown>(SYNC_STATE_KEY, {})
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, RepoCursor> = {}
  for (const [repo, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue
    const v = value as Record<string, unknown>
    const text = (x: unknown): string | null => (typeof x === 'string' && x ? x : null)
    out[repo] = { cursor: text(v.cursor), query: text(v.query), etag: text(v.etag) }
  }
  return out
}

/** a milestone's date as a whole day; GitHub sends a moment, its date is what people set */
function dueFrom(issue: RemoteIssue): number | null {
  if (!issue.milestoneDue) return null
  const at = new Date(issue.milestoneDue)
  return Number.isFinite(at.getTime()) ? allDay({ year: at.getUTCFullYear(), month: at.getUTCMonth(), day: at.getUTCDate() }) : null
}

/** an issue in the engine's terms; one no longer assigned to you, when that is what the workspace asks for, belongs to no workspace */
function toRemote(issue: RemoteIssue, repo: string, ws: WorkspaceRepoView | undefined, login: string): RemoteItem {
  const inScope = ws !== undefined && (ws.scope === 'all' || issue.assignees.some(a => a.toLowerCase() === login.toLowerCase()))
  const due = dueFrom(issue)
  return {
    remoteId: issueRemoteId(repo, issue.number),
    source: repo,
    workspace: inScope && ws ? ws.slug : null,
    state: issue.state,
    title: issue.title,
    body: issue.body,
    due,
    // a card without a milestone keeps whatever date you gave it
    dueMode: due === null ? 'none' : 'remote',
    dueLocked: due === null ? null : MILESTONE_LOCK,
    labels: issue.labels,
    url: issue.url,
    updatedAt: issue.updatedAt
  }
}

const repoOf = (remoteId: string): string => remoteId.slice(0, remoteId.lastIndexOf('#'))

function adapterFor(deps: SyncDeps, followed: Map<string, WorkspaceRepoView>): Adapter {
  return {
    service: 'github',
    fieldModes: { title: 'remote', body: 'remote' },
    sendsDue: false,
    async setState(remoteId, state) {
      const repo = repoOf(remoteId)
      const number = Number(remoteId.slice(repo.length + 1))
      const result = await deps.client.setState(repo, number, state)
      return result.ok ? { ok: true, value: toRemote(result.value, repo, followed.get(repo), deps.login) } : result
    },
    sourceOf: repoOf,
    readOnlyNote: (repo, kept) => `This key can only read ${repo}'s issues, so GitHub kept it ${kept}.`
  }
}

async function syncRepo(deps: SyncDeps, adapter: Adapter, ws: WorkspaceRepoView, repo: string, cursors: Record<string, RepoCursor>, report: SyncReport): Promise<SyncProblem | null> {
  const prior = cursors[repo]
  // the first look is open issues only; after that, everything changed since, so unassigned and closed ones are seen too
  const query: IssueQuery = prior?.cursor
    ? { state: 'all', since: prior.cursor }
    : { state: 'open', ...(ws.scope === 'assigned' ? { assignee: deps.login } : {}) }
  const queryKey = JSON.stringify(query)
  const got = await deps.client.issues(repo, query, prior?.query === queryKey ? prior.etag : null)
  if (!got.ok) return { where: repo, kind: got.kind, message: got.message, resetAt: got.resetAt }

  const issues = got.value === 'unchanged' ? [] : got.value.issues
  await settleBatch(
    { db: deps.db, adapter, readOnly: deps.readOnly, now: deps.now },
    { items: issues.map(issue => toRemote(issue, repo, ws, deps.login)), covers: id => id.startsWith(`${repo}#`) },
    report
  )

  const newest = issues.reduce((max, issue) => Math.max(max, issue.updatedAt), 0)
  const cursor = newest > 0 ? new Date(newest).toISOString() : prior?.cursor ?? new Date(deps.now() - 60_000).toISOString()
  // the tag answers this exact question; once the cursor moves, the next question is a new one and goes without it
  cursors[repo] = { cursor, query: queryKey, etag: got.value === 'unchanged' ? prior?.etag ?? null : got.value.etag }
  return null
}

export async function syncGitHub(deps: SyncDeps): Promise<SyncReport> {
  const report: SyncReport = { changed: 0, problems: [] }
  const cursors = readCursors()
  // a repository two workspaces follow fills the first
  const followed = new Map<string, WorkspaceRepoView>()
  for (const ws of deps.repos) {
    if (ws.repo && !followed.has(ws.repo)) followed.set(ws.repo, ws)
  }
  const adapter = adapterFor(deps, followed)
  for (const [repo, ws] of followed) {
    let problem: SyncProblem | null
    try {
      problem = await syncRepo(deps, adapter, ws, repo, cursors, report)
    } catch (err) {
      problem = { where: repo, kind: 'bad', message: err instanceof Error ? err.message : String(err) }
    }
    if (!problem) continue
    report.problems.push(problem)
    // the same key would hit the same wall on every other repository
    if (problem.kind === 'auth' || problem.kind === 'rate') break
  }
  setSetting(SYNC_STATE_KEY, cursors)
  return report
}
