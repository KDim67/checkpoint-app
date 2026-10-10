/** one Linear check: what changed since the last one in the followed teams, or in any issue with a card, then the open issues of a team just followed; settled by the engine */

import type Database from 'better-sqlite3'
import { getSetting, setSetting } from '../../db'
import { linearPriority } from '../../../shared/linear'
import { allDay, dueDay } from '../../../shared/dueDate'
import { settleBatch, type Adapter, type FieldPatch, type RemoteItem, type SyncReport } from '../engine'
import { fail, type Result } from '../result'
import type { IssueInput, LinearClient, LinearIssue, LinearState } from './client'
import type { Follow } from './teams'

// where Linear was read up to, and what was learned on the way; this computer only
export const SYNC_STATE_KEY = 'linear_sync_state'

interface LinearSyncState {
  /** the newest change Linear has shown, as an ISO time */
  cursor: string | null
  /** team and scope pairs followed at the last check, so a new one is read whole */
  followed: string[]
  /** every team the key can see, for the Connections tab and badges */
  teams: Record<string, { key: string; name: string }>
  /** the team each issue with a card was last seen in */
  issueTeams: Record<string, string>
}

export interface LinearSyncDeps {
  db: Database.Database
  client: LinearClient
  /** the key's own user, for whose issues are yours */
  viewerId: string
  /** team to workspace */
  follows: Map<string, Follow>
  /** teams this key may only read; added to when Linear refuses a change */
  readOnly: Set<string>
  now: () => number
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

export function readLinearState(): LinearSyncState {
  const raw = getSetting<unknown>(SYNC_STATE_KEY, {})
  const s = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const teams: LinearSyncState['teams'] = {}
  if (s.teams && typeof s.teams === 'object') {
    for (const [id, value] of Object.entries(s.teams as Record<string, unknown>)) {
      const v = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
      teams[id] = { key: str(v.key), name: str(v.name) || str(v.key) || 'A team' }
    }
  }
  const issueTeams: Record<string, string> = {}
  if (s.issueTeams && typeof s.issueTeams === 'object') {
    for (const [id, team] of Object.entries(s.issueTeams as Record<string, unknown>)) {
      if (typeof team === 'string') issueTeams[id] = team
    }
  }
  return {
    cursor: str(s.cursor) || null,
    followed: Array.isArray(s.followed) ? s.followed.filter((x): x is string => typeof x === 'string') : [],
    teams,
    issueTeams
  }
}

const pad = (n: number): string => String(n).padStart(2, '0')

/** Linear keeps dates as days, so a moment is sent as the day it falls on here */
export function linearDueDay(due: number | null): string | null {
  if (due === null) return null
  const d = dueDay(due)
  return `${d.year}-${pad(d.month + 1)}-${pad(d.day)}`
}

function dueFrom(day: string | null): number | null {
  if (!day) return null
  const [year, month, date] = day.split('-').map(Number)
  return allDay({ year, month: month - 1, day: date })
}

function toRemote(issue: LinearIssue, state: LinearSyncState, deps: LinearSyncDeps): RemoteItem {
  const follow = deps.follows.get(issue.teamId)
  const inScope = follow !== undefined && (follow.scope === 'all' || issue.assigneeId === deps.viewerId)
  const team = state.teams[issue.teamId]
  return {
    remoteId: issue.id,
    source: issue.teamId,
    workspace: inScope && follow ? follow.slug : null,
    state: issue.trashed ? 'deleted' : issue.state.type === 'completed' || issue.state.type === 'canceled' ? 'closed' : 'open',
    title: issue.title,
    body: issue.description,
    due: dueFrom(issue.dueDate),
    dueMode: 'both',
    dueLocked: null,
    labels: issue.labels,
    url: issue.url,
    ...(team ? { place: team.name } : {}),
    ...(issue.identifier ? { ref: issue.identifier } : {}),
    ...(issue.state.name ? { stateName: issue.state.name } : {}),
    updatedAt: issue.updatedAt,
    priority: linearPriority(issue.priority)
  }
}

/** Done is the team's first completed state; leaving it is the first not yet started one */
function stateFor(states: LinearState[], wanted: 'open' | 'closed'): LinearState | undefined {
  if (wanted === 'closed') return states.find(s => s.type === 'completed')
  return states.find(s => s.type === 'unstarted') ?? states.find(s => s.type === 'backlog') ?? states.find(s => s.type === 'triage')
}

function adapterFor(deps: LinearSyncDeps, state: LinearSyncState): Adapter {
  // each team's workflow is asked once a check, and only when a card needs it
  const workflows = new Map<string, Promise<Result<LinearState[]>>>()
  const workflow = (team: string): Promise<Result<LinearState[]>> => {
    const known = workflows.get(team)
    if (known) return known
    const asked = deps.client.states(team)
    workflows.set(team, asked)
    return asked
  }
  const teamName = (team: string): string => state.teams[team]?.name ?? 'this team'
  return {
    service: 'linear',
    fieldModes: { title: 'both', body: 'both' },
    sendsDue: true,
    async setState(remoteId, wanted) {
      const team = state.issueTeams[remoteId]
      if (!team) return fail('not-found', 'Linear could not find that.')
      const states = await workflow(team)
      if (!states.ok) return states
      const target = stateFor(states.value, wanted)
      if (!target) return fail('bad', `${teamName(team)} has no ${wanted === 'closed' ? 'Done' : 'Todo'} state to move it to.`)
      const result = await deps.client.update(remoteId, { stateId: target.id })
      return result.ok ? { ok: true, value: toRemote(result.value, state, deps) } : result
    },
    async setFields(remoteId, patch: FieldPatch) {
      const input: IssueInput = {
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.body !== undefined ? { description: patch.body } : {}),
        ...(patch.due !== undefined ? { dueDate: linearDueDay(patch.due) } : {})
      }
      const result = await deps.client.update(remoteId, input)
      return result.ok ? { ok: true, value: toRemote(result.value, state, deps) } : result
    },
    sourceOf: remoteId => state.issueTeams[remoteId] ?? null,
    readOnlyNote: (team, kept) => `This key can only read ${teamName(team)}'s issues, so Linear kept it ${kept === 'closed' ? 'done' : 'open'}.`
  }
}

export async function syncLinear(deps: LinearSyncDeps): Promise<SyncReport> {
  const report: SyncReport = { changed: 0, problems: [] }
  const state = readLinearState()

  const teams = await deps.client.teams()
  if (!teams.ok) {
    report.problems.push({ where: null, kind: teams.kind, message: teams.message, resetAt: teams.resetAt })
    return report
  }
  state.teams = Object.fromEntries(teams.value.map(t => [t.id, { key: t.key, name: t.name }]))

  const adapter = adapterFor(deps, state)
  const engine = { db: deps.db, adapter, readOnly: deps.readOnly, now: deps.now }
  const covers = (id: string): boolean => deps.follows.has(state.issueTeams[id] ?? '')
  // every read is gathered first and settled once, so a change made here is sent once a check however many reads found it
  const collected = new Map<string, LinearIssue>()
  const keep = (issues: LinearIssue[]): void => {
    for (const i of issues) {
      // an issue that has no card yet and isn't in a followed team is none of Checkpoint's business
      if (!deps.follows.has(i.teamId) && state.issueTeams[i.id] === undefined) continue
      const prior = collected.get(i.id)
      if (!prior || i.updatedAt >= prior.updatedAt) collected.set(i.id, i)
      if (i.trashed) delete state.issueTeams[i.id]
      else state.issueTeams[i.id] = i.teamId
    }
  }

  const followedNow = [...deps.follows].map(([team, f]) => `${team}:${f.scope}`).sort()
  let newest = 0
  let finished = true

  // changes first, so nothing done meanwhile is missed; issues with cards are asked for by id, so a move to another team is seen
  if (state.cursor) {
    const teamsFollowed = [...deps.follows.keys()]
    const linked = Object.keys(state.issueTeams)
    if (teamsFollowed.length > 0 || linked.length > 0) {
      const changed = await deps.client.issues({ since: state.cursor, teams: teamsFollowed, ids: linked })
      if (changed.ok) {
        newest = changed.value.reduce((max, i) => Math.max(max, i.updatedAt), 0)
        keep(changed.value)
      } else {
        report.problems.push({ where: null, kind: changed.kind, message: changed.message, resetAt: changed.resetAt })
        finished = false
      }
    }
  }

  // a team followed since the last check, or with whose issues changed, is read whole once
  if (finished) {
    for (const [team, follow] of deps.follows) {
      if (state.cursor && state.followed.includes(`${team}:${follow.scope}`)) continue
      const open = await deps.client.issues({ team, openOnly: true, mine: follow.scope === 'assigned' })
      if (!open.ok) {
        report.problems.push({ where: state.teams[team]?.name ?? null, kind: open.kind, message: open.message, resetAt: open.resetAt })
        finished = false
        break
      }
      newest = Math.max(newest, ...open.value.map(i => i.updatedAt))
      keep(open.value)
    }
  }

  await settleBatch(engine, { items: [...collected.values()].map(i => toRemote(i, state, deps)), covers }, report)

  if (finished) {
    const prior = state.cursor ? Date.parse(state.cursor) : 0
    state.cursor = new Date(Math.max(newest, prior) || deps.now() - 60_000).toISOString()
    state.followed = followedNow
  }
  setSetting(SYNC_STATE_KEY, state)
  return report
}
