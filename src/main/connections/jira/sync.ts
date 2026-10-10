/** one Jira check: what changed since the last one in the followed projects or in any issue with a card, the open issues of a project just followed, and once an hour a sweep for deleted ones; settled by the engine */

import type Database from 'better-sqlite3'
import { getSetting, setSetting } from '../../db'
import { jiraIssueUrl, jiraPriority } from '../../../shared/jira'
import { adfToMarkdown } from '../../../shared/adf'
import { allDay, dueDay } from '../../../shared/dueDate'
import { settleBatch, type Adapter, type FieldPatch, type RemoteItem, type SyncReport } from '../engine'
import { fail } from '../result'
import type { JiraClient, JiraIssue } from './client'
import type { JiraFollow } from './projects'

// what this computer learned from Jira and when it last asked; never synced
export const JIRA_SYNC_STATE_KEY = 'jira_sync_state'

// Jira reads JQL dates in each person's own timezone, so changes are asked for by how long ago, with room to spare
const OVERLAP_MINUTES = 5
const SWEEP_EVERY_MS = 60 * 60_000
// an id list long enough to find every card, short enough for one query
const IDS_PER_QUERY = 100

interface JiraSyncState {
  /** when the last finished check began, on this computer's clock */
  checkedAt: number | null
  sweptAt: number | null
  /** project and scope pairs followed at the last check, so a new one is read whole */
  followed: string[]
  projects: Record<string, { key: string; name: string }>
  /** each issue with a card: its project, key and status as last seen */
  issues: Record<string, { project: string; key: string; status: string }>
}

export interface JiraSyncDeps {
  db: Database.Database
  client: JiraClient
  site: string
  /** the token's own account, for whose issues are yours */
  viewerId: string
  /** project to workspace */
  follows: Map<string, JiraFollow>
  /** projects this account may only read; added to when Jira refuses a change */
  readOnly: Set<string>
  now: () => number
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})

export function readJiraState(): JiraSyncState {
  const s = rec(getSetting<unknown>(JIRA_SYNC_STATE_KEY, {}))
  const projects: JiraSyncState['projects'] = {}
  for (const [id, value] of Object.entries(rec(s.projects))) {
    const v = rec(value)
    projects[id] = { key: str(v.key), name: str(v.name) || str(v.key) || 'A project' }
  }
  const issues: JiraSyncState['issues'] = {}
  for (const [id, value] of Object.entries(rec(s.issues))) {
    const v = rec(value)
    if (str(v.project)) issues[id] = { project: str(v.project), key: str(v.key), status: str(v.status) }
  }
  return {
    checkedAt: num(s.checkedAt),
    sweptAt: num(s.sweptAt),
    followed: Array.isArray(s.followed) ? s.followed.filter((x): x is string => typeof x === 'string') : [],
    projects,
    issues
  }
}

const pad = (n: number): string => String(n).padStart(2, '0')

/** Jira keeps dates as days, so a moment is sent as the day it falls on here */
export function jiraDueDay(due: number | null): string | null {
  if (due === null) return null
  const d = dueDay(due)
  return `${d.year}-${pad(d.month + 1)}-${pad(d.day)}`
}

function dueFrom(day: string | null): number | null {
  if (!day) return null
  const [year, month, date] = day.split('-').map(Number)
  return allDay({ year, month: month - 1, day: date })
}

const chunks = <T>(list: T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size))

function toRemote(issue: JiraIssue, state: JiraSyncState, deps: JiraSyncDeps): RemoteItem {
  const follow = deps.follows.get(issue.projectId)
  const inScope = follow !== undefined && (follow.scope === 'all' || issue.assigneeId === deps.viewerId)
  const project = state.projects[issue.projectId]
  return {
    remoteId: issue.id,
    source: issue.projectId,
    workspace: inScope && follow ? follow.slug : null,
    state: issue.statusCategory === 'done' ? 'closed' : 'open',
    title: issue.summary,
    body: adfToMarkdown(issue.description),
    due: dueFrom(issue.duedate),
    dueMode: 'both',
    dueLocked: null,
    labels: issue.labels,
    url: jiraIssueUrl(deps.site, issue.key),
    ...(project ? { place: project.name } : {}),
    ref: issue.key,
    ...(issue.statusName ? { stateName: issue.statusName } : {}),
    updatedAt: issue.updatedAt,
    priority: jiraPriority(issue.priorityName)
  }
}

function adapterFor(deps: JiraSyncDeps, state: JiraSyncState): Adapter {
  const projectName = (project: string): string => state.projects[project]?.name ?? 'this project'
  const readBack = async (id: string) => {
    const back = await deps.client.issue(id)
    if (!back.ok) return back
    state.issues[id] = { project: back.value.projectId, key: back.value.key, status: back.value.statusName }
    return { ok: true as const, value: toRemote(back.value, state, deps) }
  }
  return {
    service: 'jira',
    // the description is Jira's own document format, so it is shown here and changed there
    fieldModes: { title: 'both', body: 'remote' },
    sendsDue: true,
    async setState(id, wanted) {
      const known = state.issues[id]
      const where = known ? `${known.key} from ${known.status}` : 'it'
      const target = wanted === 'closed' ? 'Done' : 'To Do'
      const refused = (why: string) => fail<RemoteItem>('refused', `Jira won't move ${where} to ${target}; ${why}.`)
      const transitions = await deps.client.transitions(id)
      if (!transitions.ok) return transitions
      // only the moves this account may make are listed, so none fitting is the workflow or a permission
      const pick = wanted === 'closed'
        ? transitions.value.find(t => t.toCategory === 'done')
        : transitions.value.find(t => t.toCategory === 'new') ?? transitions.value.find(t => t.toCategory === 'indeterminate')
      if (!pick) return refused('the workflow or your permissions don\'t allow it')
      const moved = await deps.client.transition(id, pick.id)
      // a transition that asks for fields of its own, such as a resolution, can't be filled in from here
      if (!moved.ok) return moved.kind === 'bad' ? refused(moved.message.replace(/\.$/, '')) : moved
      return readBack(id)
    },
    async setFields(id, patch: FieldPatch) {
      const fields = {
        ...(patch.title !== undefined ? { summary: patch.title } : {}),
        ...(patch.due !== undefined ? { duedate: jiraDueDay(patch.due) } : {})
      }
      const saved = await deps.client.edit(id, fields)
      return saved.ok ? readBack(id) : saved
    },
    sourceOf: id => state.issues[id]?.project ?? null,
    readOnlyNote: (project, kept) => `This account can't change ${projectName(project)}'s issues, so Jira kept it ${kept === 'closed' ? 'done' : 'open'}.`
  }
}

export async function syncJira(deps: JiraSyncDeps): Promise<SyncReport> {
  const report: SyncReport = { changed: 0, problems: [] }
  const startedAt = deps.now()
  const state = readJiraState()

  const projects = await deps.client.projects()
  if (!projects.ok) {
    report.problems.push({ where: null, kind: projects.kind, message: projects.message, resetAt: projects.resetAt })
    return report
  }
  state.projects = Object.fromEntries(projects.value.map(p => [p.id, { key: p.key, name: p.name }]))

  const adapter = adapterFor(deps, state)
  const engine = { db: deps.db, adapter, readOnly: deps.readOnly, now: deps.now }
  const covers = (id: string): boolean => deps.follows.has(state.issues[id]?.project ?? '')
  // every read is gathered first and settled once, so a change made here is sent once a check however many questions found it
  const collected = new Map<string, JiraIssue>()
  const gone = new Set<string>()
  const keep = (issues: JiraIssue[]): void => {
    for (const i of issues) {
      // an issue with no card that isn't in a followed project is none of Checkpoint's business
      if (!deps.follows.has(i.projectId) && state.issues[i.id] === undefined) continue
      const prior = collected.get(i.id)
      if (!prior || i.updatedAt >= prior.updatedAt) collected.set(i.id, i)
      state.issues[i.id] = { project: i.projectId, key: i.key, status: i.statusName }
    }
  }
  const ask = async (jql: string): Promise<JiraIssue[] | null> => {
    const got = await deps.client.search(jql)
    if (got.ok) return got.value
    report.problems.push({ where: null, kind: got.kind, message: got.message, resetAt: got.resetAt })
    return null
  }

  const followed = [...deps.follows.keys()]
  let finished = true

  // changes first, so nothing done meanwhile is missed; issues with cards are asked for by id, so a move to another project is seen
  if (state.checkedAt !== null) {
    const minutes = Math.ceil((startedAt - state.checkedAt) / 60_000) + OVERLAP_MINUTES
    const since = `updated >= -${minutes}m ORDER BY updated ASC`
    const linked = Object.keys(state.issues)
    const questions = [
      ...(followed.length > 0 ? [`project in (${followed.join(', ')})`] : []),
      ...chunks(linked, IDS_PER_QUERY).map(ids => `id in (${ids.join(', ')})`)
    ]
    for (const where of questions) {
      const changed = await ask(`(${where}) AND ${since}`)
      if (changed === null) {
        finished = false
        break
      }
      keep(changed)
    }
  }

  // a project followed since the last check is read whole once
  if (finished) {
    for (const [project, follow] of deps.follows) {
      if (state.checkedAt !== null && state.followed.includes(`${project}:${follow.scope}`)) continue
      const open = await ask(`project = ${project} AND statusCategory != Done${follow.scope === 'assigned' ? ' AND assignee = currentUser()' : ''}`)
      if (open === null) {
        finished = false
        break
      }
      keep(open)
    }
  }

  // Jira's search never says an issue was deleted, so every card's issue is asked for now and then; one not returned is gone
  if (finished && (state.sweptAt === null || startedAt - state.sweptAt >= SWEEP_EVERY_MS)) {
    for (const ids of chunks(Object.keys(state.issues), IDS_PER_QUERY)) {
      const found = await ask(`id in (${ids.join(', ')})`)
      if (found === null) {
        finished = false
        break
      }
      const seen = new Set(found.map(i => i.id))
      keep(found)
      for (const id of ids.filter(id => !seen.has(id))) {
        gone.add(id)
        collected.delete(id)
        delete state.issues[id]
      }
    }
    if (finished) state.sweptAt = startedAt
  }

  await settleBatch(engine, { items: [...collected.values()].map(i => toRemote(i, state, deps)), covers, gone: [...gone] }, report)

  if (finished) {
    state.checkedAt = startedAt
    state.followed = [...deps.follows].map(([project, f]) => `${project}:${f.scope}`).sort()
  }
  setSetting(JIRA_SYNC_STATE_KEY, state)
  return report
}
