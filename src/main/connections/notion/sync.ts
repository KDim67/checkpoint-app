/** one Notion check: each followed database's pages edited since the last one, or all of them the first time, and once an hour a look in the trash; settled by the engine */

import type Database from 'better-sqlite3'
import { getSetting, setSetting } from '../../db'
import { notionPriority, resolveColumns, type NotionColumns, type NotionProperty } from '../../../shared/notion'
import { allDay, dueDay, isAllDay, moment } from '../../../shared/dueDate'
import { settleBatch, type Adapter, type FieldPatch, type RemoteItem, type SyncReport } from '../engine'
import { fail } from '../result'
import type { NotionClient, NotionPage } from './client'
import type { NotionFollow } from './databases'

// what this computer learned from Notion and how far it has read; never synced
export const NOTION_SYNC_STATE_KEY = 'notion_sync_state'

const TRASH_EVERY_MS = 60 * 60_000

interface NotionSyncState {
  /** every database shared with the integration, by name */
  names: Record<string, string>
  /** each followed database's columns, and the newest edit read from it */
  sources: Record<string, { schema: NotionProperty[]; cursor: string | null }>
  /** the database each page with a card was last seen in */
  pages: Record<string, string>
  /** databases followed at the last check, so one followed again is read whole */
  followed: string[]
  trashedAt: number | null
}

export interface NotionSyncDeps {
  db: Database.Database
  client: NotionClient
  /** data source to workspace */
  follows: Map<string, NotionFollow>
  /** databases the integration may only read; added to when Notion refuses a change */
  readOnly: Set<string>
  now: () => number
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})

function readSchema(raw: unknown): NotionProperty[] {
  return (Array.isArray(raw) ? raw : []).map(rec).filter(p => str(p.id) && str(p.type)).map(p => ({
    id: str(p.id),
    name: str(p.name),
    type: str(p.type),
    ...(Array.isArray(p.options) ? { options: p.options.map(rec).map(o => ({ id: str(o.id), name: str(o.name) })) } : {}),
    ...(Array.isArray(p.groups) ? { groups: p.groups.map(rec).map(g => ({ name: str(g.name), optionIds: (Array.isArray(g.optionIds) ? g.optionIds : []).filter((x): x is string => typeof x === 'string') })) } : {})
  }))
}

export function readNotionState(): NotionSyncState {
  const s = rec(getSetting<unknown>(NOTION_SYNC_STATE_KEY, {}))
  const sources: NotionSyncState['sources'] = {}
  for (const [id, value] of Object.entries(rec(s.sources))) {
    const v = rec(value)
    sources[id] = { schema: readSchema(v.schema), cursor: str(v.cursor) || null }
  }
  const strings = (raw: unknown): Record<string, string> =>
    Object.fromEntries(Object.entries(rec(raw)).filter((e): e is [string, string] => typeof e[1] === 'string'))
  return {
    names: strings(s.names),
    sources,
    pages: strings(s.pages),
    followed: Array.isArray(s.followed) ? s.followed.filter((x): x is string => typeof x === 'string') : [],
    trashedAt: typeof s.trashedAt === 'number' ? s.trashedAt : null
  }
}

/** a day stays a day; anything with a time is that moment */
export function notionDue(start: string | null | undefined): number | null {
  if (!start) return null
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(start)
  if (day) return allDay({ year: Number(day[1]), month: Number(day[2]) - 1, day: Number(day[3]) })
  const at = Date.parse(start)
  return Number.isFinite(at) ? moment(new Date(at)) : null
}

const pad = (n: number): string => String(n).padStart(2, '0')

export function notionDateValue(due: number | null): { start: string } | null {
  if (due === null) return null
  if (!isAllDay(due)) return { start: new Date(due).toISOString() }
  const d = dueDay(due)
  return { start: `${d.year}-${pad(d.month + 1)}-${pad(d.day)}` }
}

function isDone(page: NotionPage, cols: NotionColumns): boolean {
  const done = cols.done
  if (!done) return false
  const value = page.values[done.id]
  return done.kind === 'checkbox' ? value?.checkbox === true : done.complete.includes(value?.status ?? '')
}

function toRemote(page: NotionPage, source: string, cols: NotionColumns, state: NotionSyncState, deps: NotionSyncDeps): RemoteItem {
  const follow = deps.follows.get(source)
  return {
    remoteId: page.id,
    source,
    workspace: follow ? follow.slug : null,
    state: page.inTrash ? 'deleted' : isDone(page, cols) ? 'closed' : 'open',
    title: cols.title ? page.values[cols.title]?.title ?? '' : '',
    body: '',
    due: cols.date ? notionDue(page.values[cols.date.id]?.date) : null,
    // a database without a date column leaves the card's own date alone
    dueMode: cols.date ? 'both' : 'none',
    dueLocked: null,
    labels: cols.tags ? page.values[cols.tags]?.multi ?? [] : [],
    url: page.url,
    ...(state.names[source] ? { place: state.names[source] } : {}),
    updatedAt: page.lastEdited,
    priority: cols.priority ? notionPriority(page.values[cols.priority]?.select) : 0
  }
}

export async function syncNotion(deps: NotionSyncDeps): Promise<SyncReport> {
  const report: SyncReport = { changed: 0, problems: [] }
  const startedAt = deps.now()
  const state = readNotionState()

  const listed = await deps.client.sources()
  if (!listed.ok) {
    report.problems.push({ where: null, kind: listed.kind, message: listed.message, resetAt: listed.resetAt })
    return report
  }
  state.names = Object.fromEntries(listed.value.map(s => [s.id, s.name]))

  // each followed database's columns, as they are now
  const columns = new Map<string, NotionColumns>()
  let stopped = false
  for (const [source, follow] of deps.follows) {
    const name = state.names[source] ?? 'A database'
    const schema = await deps.client.schema(source)
    if (!schema.ok) {
      report.problems.push({ where: name, kind: schema.kind, message: schema.message, resetAt: schema.resetAt })
      // the same integration would hit the same wall on every other database
      if (schema.kind === 'auth' || schema.kind === 'rate' || schema.kind === 'network') {
        stopped = true
        break
      }
      continue
    }
    state.sources[source] = { schema: schema.value, cursor: state.sources[source]?.cursor ?? null }
    const cols = resolveColumns(schema.value, follow)
    if (!cols.done || !cols.title) {
      report.problems.push({ where: name, kind: 'bad', message: 'it has no Status or checkbox column to mean done, so it can\'t be followed.' })
      continue
    }
    columns.set(source, cols)
  }

  const adapter: Adapter = {
    service: 'notion',
    fieldModes: { title: 'both', body: 'none' },
    sendsDue: true,
    async setState(id, wanted) {
      const source = state.pages[id]
      const cols = source ? columns.get(source) : undefined
      if (!source || !cols?.done) return fail('not-found', 'Notion can\'t find that, or it isn\'t shared with the integration.')
      const done = cols.done
      const value = done.kind === 'checkbox'
        ? { checkbox: wanted === 'closed' }
        : { status: { id: wanted === 'closed' ? done.doneOption : done.openOption } }
      const result = await deps.client.update(id, { [done.id]: value })
      // the status's options changed under it, or the column can't take that: this page says so, the rest carry on
      if (!result.ok) return result.kind === 'bad' ? fail('refused', `Notion wouldn't change ${done.name}: ${result.message.replace(/^Notion answered \d+: /, '')}`) : result
      return { ok: true, value: toRemote(result.value, source, cols, state, deps) }
    },
    async setFields(id, patch: FieldPatch) {
      const source = state.pages[id]
      const cols = source ? columns.get(source) : undefined
      if (!source || !cols) return fail('not-found', 'Notion can\'t find that, or it isn\'t shared with the integration.')
      const properties: Record<string, unknown> = {}
      if (patch.title !== undefined && cols.title) properties[cols.title] = { title: [{ type: 'text', text: { content: patch.title } }] }
      if (patch.due !== undefined && cols.date) properties[cols.date.id] = { date: notionDateValue(patch.due) }
      const result = await deps.client.update(id, properties)
      return result.ok ? { ok: true, value: toRemote(result.value, source, cols, state, deps) } : result
    },
    sourceOf: id => state.pages[id] ?? null,
    readOnlyNote: (source, kept) => `The integration can only read ${state.names[source] ?? 'this database'}, so Notion kept it ${kept === 'closed' ? 'done' : 'open'}.`
  }

  // every read is gathered first and settled once, so a change made here is sent once a check
  const collected = new Map<string, { page: NotionPage; source: string }>()
  let finished = !stopped
  if (finished) {
    for (const [source] of columns) {
      const known = state.sources[source]
      const since = state.followed.includes(source) ? known?.cursor ?? null : null
      const pages = await deps.client.query(source, since)
      if (!pages.ok) {
        report.problems.push({ where: state.names[source] ?? null, kind: pages.kind, message: pages.message, resetAt: pages.resetAt })
        finished = false
        break
      }
      let newest = since ? Date.parse(since) : 0
      for (const page of pages.value) {
        // a page whose parent isn't said is in the database that returned it
        const home = page.source ?? source
        const prior = collected.get(page.id)
        if (!prior || page.lastEdited >= prior.page.lastEdited) collected.set(page.id, { page, source: home })
        newest = Math.max(newest, page.lastEdited)
      }
      // Notion's edit times are whole minutes, so asking from the newest one read again catches the rest of that minute
      state.sources[source] = { ...state.sources[source], cursor: new Date(newest || startedAt - 60_000).toISOString() }
    }
  }

  const gone: string[] = []
  if (finished && (state.trashedAt === null || startedAt - state.trashedAt >= TRASH_EVERY_MS)) {
    const trashed = await deps.client.trash()
    if (trashed.ok) {
      for (const id of trashed.value) {
        if (state.pages[id] === undefined) continue
        gone.push(id)
        collected.delete(id)
        delete state.pages[id]
      }
      state.trashedAt = startedAt
    } else {
      report.problems.push({ where: null, kind: trashed.kind, message: trashed.message, resetAt: trashed.resetAt })
    }
  }

  const items: RemoteItem[] = []
  for (const { page, source } of collected.values()) {
    const cols = columns.get(source)
    // a page in a database nobody follows, or one that can't be followed, belongs to no workspace
    if (!cols) {
      if (state.pages[page.id] !== undefined) items.push({ ...toRemote(page, source, resolveColumns(state.sources[source]?.schema ?? []), state, deps), workspace: null })
      continue
    }
    if (page.inTrash) delete state.pages[page.id]
    else state.pages[page.id] = source
    items.push(toRemote(page, source, cols, state, deps))
  }
  await settleBatch(
    { db: deps.db, adapter, readOnly: deps.readOnly, now: deps.now },
    { items, covers: id => columns.has(state.pages[id] ?? ''), gone },
    report
  )
  if (finished) state.followed = [...columns.keys()]
  setSetting(NOTION_SYNC_STATE_KEY, state)
  return report
}
