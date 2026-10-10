/** Todoist's API, to api.todoist.com only and through the guard; every answer is a result, never a throw */

import { guardedFetch, readCapped } from '../../guardedFetch'
import { isTodoistId } from '../../../shared/todoist'
import { fail, type ClientDeps, type Result } from '../result'

const API = 'https://api.todoist.com/api/v1'
const TIMEOUT_MS = 30_000
// a whole account read at once, on the first check, can be large
const MAX_BYTES = 20 * 1024 * 1024
// when Todoist asks for a pause without saying how long
const DEFAULT_WAIT_S = 60

export interface TodoistDue {
  /** YYYY-MM-DD, a floating YYYY-MM-DDTHH:MM:SS, or a moment ending in Z */
  date: string
  isRecurring: boolean
  /** the words it was set with, such as "every monday" */
  string: string
}

export interface TodoistTask {
  id: string
  projectId: string
  content: string
  description: string
  checked: boolean
  deleted: boolean
  due: TodoistDue | null
  labels: string[]
  /** 4 is p1 */
  priority: number
  updatedAt: number
}

export interface TodoistProjectChange {
  id: string
  name: string
  /** archived or deleted */
  gone: boolean
}

export interface TodoistSync {
  tasks: TodoistTask[]
  projects: TodoistProjectChange[]
  token: string
  full: boolean
}

export interface TodoistPatch {
  content?: string
  description?: string
  due_date?: string
  due_datetime?: string
  due_string?: string
}

export interface TodoistClient {
  me(): Promise<Result<{ name: string }>>
  /** everything changed since the token; * for everything there is now */
  sync(token: string): Promise<Result<TodoistSync>>
  task(id: string): Promise<Result<TodoistTask>>
  close(id: string): Promise<Result<void>>
  reopen(id: string): Promise<Result<void>>
  update(id: string, patch: TodoistPatch): Promise<Result<TodoistTask>>
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

function readDue(raw: unknown): TodoistDue | null {
  if (!raw || typeof raw !== 'object') return null
  const d = raw as Record<string, unknown>
  const date = str(d.date)
  if (!/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?Z?)?$/.test(date)) return null
  return { date, isRecurring: d.is_recurring === true, string: str(d.string).slice(0, 200) }
}

/** one task from Todoist's shape; anything malformed is left out */
function readTask(raw: unknown): TodoistTask | null {
  if (!raw || typeof raw !== 'object') return null
  const t = raw as Record<string, unknown>
  const id = str(t.id)
  const projectId = str(t.project_id)
  if (!isTodoistId(id) || !isTodoistId(projectId) || typeof t.content !== 'string') return null
  const updatedAt = Date.parse(str(t.updated_at) || str(t.added_at))
  return {
    id,
    projectId,
    content: t.content.slice(0, 500),
    description: str(t.description).slice(0, 200_000),
    checked: t.checked === true,
    deleted: t.is_deleted === true,
    due: readDue(t.due),
    labels: (Array.isArray(t.labels) ? t.labels : []).filter((x): x is string => typeof x === 'string').slice(0, 30),
    priority: typeof t.priority === 'number' ? t.priority : 1,
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : 0
  }
}

function readProject(raw: unknown): TodoistProjectChange | null {
  if (!raw || typeof raw !== 'object') return null
  const p = raw as Record<string, unknown>
  const id = str(p.id)
  if (!isTodoistId(id)) return null
  return { id, name: str(p.name).slice(0, 200) || 'Untitled project', gone: p.is_deleted === true || p.is_archived === true }
}

export function createTodoistClient(key: string, deps: ClientDeps): TodoistClient {
  async function call(path: string, init: { method?: string; json?: unknown; form?: URLSearchParams } = {}): Promise<Result<unknown>> {
    const headers: Record<string, string> = { Authorization: `Bearer ${key}` }
    let body: string | undefined
    if (init.json !== undefined) {
      headers['Content-Type'] = 'application/json'
      body = JSON.stringify(init.json)
    } else if (init.form) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded'
      body = init.form.toString()
    }
    let fetched: Awaited<ReturnType<typeof guardedFetch>>
    try {
      fetched = await guardedFetch(
        `${API}${path}`,
        { signal: AbortSignal.timeout(TIMEOUT_MS), headers, method: init.method, body },
        { fetch: deps.fetch, isAllowed: async hop => hop.protocol === 'https:' && hop.hostname === 'api.todoist.com' },
        'todoist'
      )
    } catch (err) {
      const reason = err instanceof Error && err.name === 'TimeoutError' ? 'it took more than 30 seconds' : err instanceof Error ? err.message : String(err)
      return fail('network', `Couldn't reach Todoist: ${reason}.`)
    }
    if (!fetched) return fail('network', 'Checkpoint only talks to api.todoist.com, and was sent elsewhere.')
    const { response } = fetched
    if (response.status === 204) return { ok: true, value: null }

    const bytes = await readCapped(response, MAX_BYTES + 1).catch(() => new Uint8Array())
    const text = new TextDecoder().decode(bytes)
    if (response.ok) {
      if (bytes.byteLength > MAX_BYTES) return fail('bad', 'Todoist sent more than Checkpoint reads at once.')
      try {
        return { ok: true, value: JSON.parse(text) as unknown }
      } catch {
        return fail('bad', "Todoist sent something Checkpoint couldn't read.")
      }
    }
    const said = text.trim().slice(0, 200)
    if (response.status === 401) return fail('auth', 'Your Todoist token stopped working. Copy it again from Todoist and connect again.')
    if (response.status === 429) {
      const wait = Number(response.headers.get('retry-after'))
      return fail('rate', "Todoist's limit for this token was reached.", deps.now() + (wait > 0 ? wait : DEFAULT_WAIT_S) * 1000)
    }
    if (response.status === 403) return fail('forbidden', `Todoist refused: ${said || 'this token may not do that'}.`)
    if (response.status === 404 || response.status === 410) return fail('not-found', 'Todoist could not find that.')
    return fail('bad', `Todoist answered ${response.status}${said ? `: ${said}` : ''}.`)
  }

  const badId = <T>(): Result<T> => fail('bad', 'That is not a task Checkpoint can change.')

  async function readOne(path: string, init: { method?: string; json?: unknown } = {}): Promise<Result<TodoistTask>> {
    const got = await call(path, init)
    if (!got.ok) return got
    const task = readTask(got.value)
    return task ? { ok: true, value: task } : fail('bad', "Todoist sent something Checkpoint couldn't read.")
  }

  return {
    async me() {
      const got = await call('/user')
      if (!got.ok) return got
      const name = got.value && typeof got.value === 'object' ? str((got.value as Record<string, unknown>).full_name).trim() : ''
      // only the name is kept; the rest of the answer is dropped here
      return { ok: true, value: { name: name || 'your Todoist account' } }
    },

    async sync(token) {
      const form = new URLSearchParams({ sync_token: token, resource_types: JSON.stringify(['items', 'projects']) })
      const got = await call('/sync', { method: 'POST', form })
      if (!got.ok) return got
      const data = got.value && typeof got.value === 'object' ? (got.value as Record<string, unknown>) : null
      const next = data ? str(data.sync_token) : ''
      if (!data || !next) return fail('bad', "Todoist sent something Checkpoint couldn't read.")
      const list = <T>(raw: unknown, read: (x: unknown) => T | null): T[] =>
        (Array.isArray(raw) ? raw : []).map(read).filter((x): x is T => x !== null)
      return {
        ok: true,
        value: { tasks: list(data.items, readTask), projects: list(data.projects, readProject), token: next, full: data.full_sync === true }
      }
    },

    async task(id) {
      return isTodoistId(id) ? readOne(`/tasks/${id}`) : badId()
    },

    async close(id) {
      if (!isTodoistId(id)) return badId()
      const got = await call(`/tasks/${id}/close`, { method: 'POST' })
      return got.ok ? { ok: true, value: undefined } : got
    },

    async reopen(id) {
      if (!isTodoistId(id)) return badId()
      const got = await call(`/tasks/${id}/reopen`, { method: 'POST' })
      return got.ok ? { ok: true, value: undefined } : got
    },

    async update(id, patch) {
      return isTodoistId(id) ? readOne(`/tasks/${id}`, { method: 'POST', json: patch }) : badId()
    }
  }
}
