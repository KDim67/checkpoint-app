/** one Todoist check: everything changed since the last one, read in a single request across every project, and settled by the engine */

import type Database from 'better-sqlite3'
import { getSetting, setSetting } from '../../db'
import { todoistPriorityFromApi } from '../../../shared/foreignImport'
import { todoistTaskUrl } from '../../../shared/todoist'
import { allDay, dueDay, isAllDay, moment } from '../../../shared/dueDate'
import { settleBatch, type Adapter, type FieldPatch, type RemoteItem, type SyncReport } from '../engine'
import type { TodoistClient, TodoistDue, TodoistPatch, TodoistTask } from './client'

// where Todoist was read up to, and what was learned on the way; this computer only
export const SYNC_STATE_KEY = 'todoist_sync_state'

interface TodoistState {
  /** Todoist's marker for "changes since"; null before the first read */
  token: string | null
  /** projects followed at the last check, so a newly followed one is read whole */
  followed: string[]
  /** names of the projects that still exist, for badges and the Connections tab */
  projects: Record<string, string>
  /** the project each task with a card was last seen in */
  taskProjects: Record<string, string>
}

export interface TodoistSyncDeps {
  db: Database.Database
  client: TodoistClient
  /** project to workspace */
  follows: Map<string, string>
  now: () => number
}

const strings = (raw: unknown): Record<string, string> => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  return Object.fromEntries(Object.entries(raw as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === 'string'))
}

export function readTodoistState(): TodoistState {
  const raw = getSetting<unknown>(SYNC_STATE_KEY, {})
  const s = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  return {
    token: typeof s.token === 'string' && s.token ? s.token : null,
    followed: Array.isArray(s.followed) ? s.followed.filter((x): x is string => typeof x === 'string') : [],
    projects: strings(s.projects),
    taskProjects: strings(s.taskProjects)
  }
}

/** a whole day stays a day; a floating time is that time here; one ending in Z is that moment */
export function todoistDue(due: TodoistDue | null): number | null {
  if (!due) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z)?)?$/.exec(due.date)
  if (!m) return null
  const [year, month, day] = [Number(m[1]), Number(m[2]) - 1, Number(m[3])]
  if (m[4] === undefined) return allDay({ year, month, day })
  const [hour, minute, second] = [Number(m[4]), Number(m[5]), Number(m[6] ?? 0)]
  const at = m[7] ? new Date(Date.UTC(year, month, day, hour, minute, second)) : new Date(year, month, day, hour, minute, second)
  return Number.isFinite(at.getTime()) ? moment(at) : null
}

const pad = (n: number): string => String(n).padStart(2, '0')

/** "no date" is how Todoist is told to clear one */
export function todoistDuePatch(due: number | null): TodoistPatch {
  if (due === null) return { due_string: 'no date' }
  if (isAllDay(due)) {
    const d = dueDay(due)
    return { due_date: `${d.year}-${pad(d.month + 1)}-${pad(d.day)}` }
  }
  // seconds are as fine as Todoist keeps; the millisecond a moment is nudged by never reaches it
  return { due_datetime: new Date(due).toISOString().replace(/\.\d{3}Z$/, 'Z') }
}

function toRemote(task: TodoistTask, state: TodoistState, follows: Map<string, string>): RemoteItem {
  const repeats = task.due?.isRecurring === true
  const said = task.due?.string ? ` (${task.due.string})` : ''
  return {
    remoteId: task.id,
    source: task.projectId,
    workspace: follows.get(task.projectId) ?? null,
    state: task.deleted ? 'deleted' : task.checked ? 'closed' : 'open',
    title: task.content,
    body: task.description,
    due: todoistDue(task.due),
    // a repeating task's pattern lives in Todoist; a date sent from here would replace it
    dueMode: repeats ? 'remote' : 'both',
    dueLocked: repeats ? `This task repeats in Todoist${said}, so change its date there.` : null,
    labels: task.labels,
    url: todoistTaskUrl(task.id),
    ...(state.projects[task.projectId] ? { place: state.projects[task.projectId] } : {}),
    updatedAt: task.updatedAt,
    priority: todoistPriorityFromApi(task.priority)
  }
}

function adapterFor(deps: TodoistSyncDeps, state: TodoistState): Adapter {
  return {
    service: 'todoist',
    fieldModes: { title: 'both', body: 'both' },
    sendsDue: true,
    async setState(remoteId, wanted) {
      const done = wanted === 'closed' ? await deps.client.close(remoteId) : await deps.client.reopen(remoteId)
      if (!done.ok) return done
      // read back, so a repeating task's next date shows at once; a finished one may not be readable, and is done as asked
      const back = await deps.client.task(remoteId)
      return { ok: true, value: back.ok ? toRemote(back.value, state, deps.follows) : null }
    },
    async setFields(remoteId, patch: FieldPatch) {
      const body: TodoistPatch = {
        ...(patch.title !== undefined ? { content: patch.title } : {}),
        ...(patch.body !== undefined ? { description: patch.body } : {}),
        ...(patch.due !== undefined ? todoistDuePatch(patch.due) : {})
      }
      const result = await deps.client.update(remoteId, body)
      return result.ok ? { ok: true, value: toRemote(result.value, state, deps.follows) } : result
    },
    sourceOf: remoteId => state.taskProjects[remoteId] ?? null,
    readOnlyNote: (_project, kept) => `Todoist kept it ${kept === 'closed' ? 'completed' : 'open'}, as this token may not change it.`
  }
}

export async function syncTodoist(deps: TodoistSyncDeps): Promise<SyncReport> {
  const report: SyncReport = { changed: 0, problems: [] }
  const state = readTodoistState()
  const followed = [...deps.follows.keys()].sort()
  // changes first, so nothing done meanwhile is missed; then the whole list once when a project was just followed
  const reads = state.token ? [state.token] : ['*']
  if (state.token && followed.some(p => !state.followed.includes(p))) reads.push('*')

  const adapter = adapterFor(deps, state)
  // both reads are gathered first and settled once, so a change made here is sent once a check
  const collected = new Map<string, TodoistTask>()
  let finished = true
  for (const token of reads) {
    const got = await deps.client.sync(token)
    if (!got.ok) {
      report.problems.push({ where: null, kind: got.kind, message: got.message, resetAt: got.resetAt })
      finished = false
      break
    }
    const { tasks, projects, full } = got.value
    if (full) state.projects = {}
    for (const p of projects) {
      if (p.gone) delete state.projects[p.id]
      else state.projects[p.id] = p.name
    }
    // only tasks in a followed project, or ones that have a card already, are any of Checkpoint's business
    const relevant = tasks.filter(t => deps.follows.has(t.projectId) || state.taskProjects[t.id] !== undefined)
    for (const t of relevant) {
      const prior = collected.get(t.id)
      if (!prior || t.updatedAt >= prior.updatedAt) collected.set(t.id, t)
      if (t.deleted) delete state.taskProjects[t.id]
      else state.taskProjects[t.id] = t.projectId
    }
    state.token = got.value.token
  }
  await settleBatch(
    { db: deps.db, adapter, readOnly: new Set(), now: deps.now },
    { items: [...collected.values()].map(t => toRemote(t, state, deps.follows)), covers: id => deps.follows.has(state.taskProjects[id] ?? '') },
    report
  )
  if (finished) state.followed = followed
  setSetting(SYNC_STATE_KEY, state)
  return report
}
