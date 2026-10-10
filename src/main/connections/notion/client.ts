/** Notion's API, to api.notion.com only and through the guard; every answer is a result, never a throw */

import { guardedFetch, readCapped } from '../../guardedFetch'
import { isNotionId, type NotionProperty } from '../../../shared/notion'
import { fail, type ClientDeps, type Result } from '../result'

const API = 'https://api.notion.com/v1'
// the version this was written against; Notion keeps answering an older version the same way
const VERSION = '2026-03-11'
const TIMEOUT_MS = 30_000
const MAX_BYTES = 10 * 1024 * 1024
const PAGE_SIZE = 100
// past twenty pages of changes at once the rest wait for the next check
const MAX_PAGES = 20
const DEFAULT_WAIT_S = 2

/** one column's value on a page, as much as Checkpoint reads */
export interface NotionValue {
  title?: string
  /** a status's option id */
  status?: string | null
  checkbox?: boolean
  /** the start, as Notion sends it */
  date?: string | null
  multi?: string[]
  /** a select's option name */
  select?: string | null
}

export interface NotionPage {
  id: string
  url: string
  lastEdited: number
  inTrash: boolean
  /** the data source it sits in */
  source: string | null
  /** keyed by column id, which survives a rename */
  values: Record<string, NotionValue>
}

export interface NotionClient {
  me(): Promise<Result<{ name: string }>>
  sources(): Promise<Result<{ id: string; name: string }[]>>
  schema(source: string): Promise<Result<NotionProperty[]>>
  /** every page, or those edited on or after a moment */
  query(source: string, since: string | null): Promise<Result<NotionPage[]>>
  /** ids of pages in the trash, most recently trashed first */
  trash(): Promise<Result<string[]>>
  update(page: string, properties: Record<string, unknown>): Promise<Result<NotionPage>>
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null)
const plain = (rich: unknown): string => (Array.isArray(rich) ? rich.map(r => str(obj(r)?.plain_text)).join('') : '')

function readValue(raw: Record<string, unknown>): NotionValue | null {
  switch (raw.type) {
    case 'title':
      return { title: plain(raw.title).slice(0, 500) }
    case 'status':
      return { status: str(obj(raw.status)?.id) || null }
    case 'checkbox':
      return { checkbox: raw.checkbox === true }
    case 'date':
      return { date: str(obj(raw.date)?.start) || null }
    case 'multi_select':
      return { multi: (Array.isArray(raw.multi_select) ? raw.multi_select : []).map(o => str(obj(o)?.name)).filter(Boolean).slice(0, 30) }
    case 'select':
      return { select: str(obj(raw.select)?.name) || null }
    default:
      return null
  }
}

function readPage(raw: unknown): NotionPage | null {
  const p = obj(raw)
  if (!p || p.object !== 'page') return null
  const id = str(p.id)
  const url = str(p.url)
  const lastEdited = Date.parse(str(p.last_edited_time))
  if (!isNotionId(id) || !/^https:\/\/(www\.)?notion\.(so|com)\//.test(url) || !Number.isFinite(lastEdited)) return null
  const values: Record<string, NotionValue> = {}
  for (const value of Object.values(obj(p.properties) ?? {})) {
    const v = obj(value)
    const read = v ? readValue(v) : null
    if (v && read && str(v.id)) values[str(v.id)] = read
  }
  const parent = obj(p.parent)
  return {
    id,
    url,
    lastEdited,
    inTrash: p.in_trash === true || p.archived === true,
    source: str(parent?.data_source_id) || null,
    values
  }
}

function readProperty(name: string, raw: unknown): NotionProperty | null {
  const p = obj(raw)
  if (!p || !str(p.id) || !str(p.type)) return null
  const out: NotionProperty = { id: str(p.id), name: str(p.name) || name, type: str(p.type) }
  const details = obj(p[out.type])
  if (out.type === 'status' || out.type === 'select') {
    out.options = (Array.isArray(details?.options) ? details.options : []).map(obj)
      .filter((o): o is Record<string, unknown> => o !== null && str(o.id) !== '')
      .map(o => ({ id: str(o.id), name: str(o.name) }))
  }
  if (out.type === 'status') {
    out.groups = (Array.isArray(details?.groups) ? details.groups : []).map(obj)
      .filter((g): g is Record<string, unknown> => g !== null)
      .map(g => ({ name: str(g.name), optionIds: (Array.isArray(g.option_ids) ? g.option_ids : []).filter((x): x is string => typeof x === 'string') }))
  }
  return out
}

export function createNotionClient(key: string, deps: ClientDeps): NotionClient {
  async function call(path: string, init: { method?: string; json?: unknown } = {}): Promise<Result<Record<string, unknown>>> {
    const headers: Record<string, string> = { Authorization: `Bearer ${key}`, 'Notion-Version': VERSION }
    if (init.json !== undefined) headers['Content-Type'] = 'application/json'
    let fetched: Awaited<ReturnType<typeof guardedFetch>>
    try {
      fetched = await guardedFetch(
        `${API}${path}`,
        { signal: AbortSignal.timeout(TIMEOUT_MS), headers, method: init.method, body: init.json === undefined ? undefined : JSON.stringify(init.json) },
        { fetch: deps.fetch, isAllowed: async hop => hop.protocol === 'https:' && hop.hostname === 'api.notion.com' },
        'notion'
      )
    } catch (err) {
      const reason = err instanceof Error && err.name === 'TimeoutError' ? 'it took more than 30 seconds' : err instanceof Error ? err.message : String(err)
      return fail('network', `Couldn't reach Notion: ${reason}.`)
    }
    if (!fetched) return fail('network', 'Checkpoint only talks to api.notion.com, and was sent elsewhere.')
    const { response } = fetched
    const bytes = await readCapped(response, MAX_BYTES + 1).catch(() => new Uint8Array())
    if (bytes.byteLength > MAX_BYTES) return fail('bad', 'Notion sent more than Checkpoint reads at once.')
    let body: Record<string, unknown> | null = null
    try {
      body = obj(JSON.parse(new TextDecoder().decode(bytes)))
    } catch {
      body = null
    }
    if (response.ok) return body ? { ok: true, value: body } : fail('bad', "Notion sent something Checkpoint couldn't read.")

    const code = str(body?.code)
    const said = str(body?.message).slice(0, 200)
    if (response.status === 401 || code === 'unauthorized') return fail('auth', 'Your Notion secret stopped working, or the integration was removed. Copy it again and connect again.')
    if (response.status === 429 || code === 'rate_limited') {
      const wait = Number(response.headers.get('retry-after'))
      return fail('rate', "Notion's limit for this integration was reached.", deps.now() + (wait > 0 ? wait : DEFAULT_WAIT_S) * 1000)
    }
    if (response.status === 403 || code === 'restricted_resource') return fail('forbidden', `Notion refused: ${said || 'the integration may not do that'}.`)
    if (response.status === 404 || code === 'object_not_found') return fail('not-found', 'Notion can\'t find that, or it isn\'t shared with the integration.')
    return fail('bad', `Notion answered ${response.status}${said ? `: ${said}` : ''}.`)
  }

  const unreadable = <T>(): Result<T> => fail('bad', "Notion sent something Checkpoint couldn't read.")
  const badId = <T>(): Result<T> => fail('bad', 'That is not something in Notion Checkpoint can change.')

  /** a search or query, page after page */
  async function every(path: string, body: Record<string, unknown>): Promise<Result<unknown[]>> {
    const results: unknown[] = []
    let cursor: string | null = null
    for (let page = 0; page < MAX_PAGES; page++) {
      const got = await call(path, { method: 'POST', json: { ...body, page_size: PAGE_SIZE, ...(cursor ? { start_cursor: cursor } : {}) } })
      if (!got.ok) return got
      if (!Array.isArray(got.value.results)) return unreadable()
      results.push(...got.value.results)
      cursor = got.value.has_more === true ? str(got.value.next_cursor) || null : null
      if (!cursor) break
    }
    return { ok: true, value: results }
  }

  return {
    async me() {
      const got = await call('/users/me')
      if (!got.ok) return got
      const bot = obj(got.value.bot)
      return { ok: true, value: { name: str(bot?.workspace_name).trim() || str(got.value.name).trim() || 'your Notion workspace' } }
    },

    async sources() {
      const got = await every('/search', { filter: { property: 'object', value: 'data_source' } })
      if (!got.ok) return got
      const sources = got.value.map(obj)
        .filter((s): s is Record<string, unknown> => s !== null && s.object === 'data_source' && isNotionId(str(s.id)))
        .map(s => ({ id: str(s.id), name: plain(s.title).slice(0, 200) || 'Untitled database' }))
      return { ok: true, value: sources }
    },

    async schema(source) {
      if (!isNotionId(source)) return badId()
      const got = await call(`/data_sources/${source}`)
      if (!got.ok) return got
      const properties = obj(got.value.properties)
      if (!properties) return unreadable()
      return { ok: true, value: Object.entries(properties).map(([name, raw]) => readProperty(name, raw)).filter((p): p is NotionProperty => p !== null) }
    },

    async query(source, since) {
      if (!isNotionId(source)) return badId()
      const got = await every(`/data_sources/${source}/query`, since
        ? { filter: { timestamp: 'last_edited_time', last_edited_time: { on_or_after: since } } }
        : {})
      if (!got.ok) return got
      return { ok: true, value: got.value.map(readPage).filter((p): p is NotionPage => p !== null) }
    },

    async trash() {
      const got = await call('/search', {
        method: 'POST',
        json: { filter: { property: 'object', value: 'page', in_trash: true }, sort: { direction: 'descending', timestamp: 'last_edited_time' }, page_size: PAGE_SIZE }
      })
      if (!got.ok) return got
      if (!Array.isArray(got.value.results)) return unreadable()
      return { ok: true, value: got.value.results.map(r => str(obj(r)?.id)).filter(isNotionId) }
    },

    async update(page, properties) {
      if (!isNotionId(page)) return badId()
      const got = await call(`/pages/${page}`, { method: 'PATCH', json: { properties } })
      if (!got.ok) return got
      const read = readPage(got.value)
      return read ? { ok: true, value: read } : unreadable()
    }
  }
}
