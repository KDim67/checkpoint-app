/** settles outside items with cards for any service: open and done by decide(), each two-way field against what both sides last agreed, and changes made here sent back through the service's adapter */

import type Database from 'better-sqlite3'
import { createItem, getAgreed, getAgreedFields, getItemById, listAgreed, setAgreed, setAgreedFields, updateItem, type AgreedFields } from '../db'
import { readBoardConfig } from '../mcp/toolKit'
import { cardIdFor, dueLockOf, linkOf, SERVICES, type ConnectionLink, type ConnectionService, type LinkState } from '../../shared/connections'
import type { Item, ItemPriority } from '../../shared/types'
import { decide, mergeField, type LocalState } from './reconcile'
import type { FailureKind, Result } from './result'

/** one outside item, in the card's own terms */
export interface RemoteItem {
  remoteId: string
  /** the repository or project it is in now */
  source: string
  /** the workspace following that source, or null when none does or it no longer counts, such as unassigned from you */
  workspace: string | null
  state: 'open' | 'closed' | 'deleted'
  title: string
  body: string
  /** in the dueDate encoding: a whole day or a moment */
  due: number | null
  /** remote: the service's date always wins; both: settled like the text; none: the card keeps its own */
  dueMode: 'remote' | 'both' | 'none'
  /** the sentence shown where the date can't be changed, when it belongs to the service */
  dueLocked: string | null
  labels: string[]
  url: string
  /** the list it is in, when its id doesn't say */
  place?: string
  /** its short name there, such as ENG-123 */
  ref?: string
  /** the service's own word for its state */
  stateName?: string
  updatedAt: number
  /** only used when its card is made */
  priority?: ItemPriority
}

export interface FieldPatch {
  title?: string
  body?: string
  due?: number | null
}

/** the only part that knows a service's API */
export interface Adapter {
  service: ConnectionService
  /** per field, remote: the service keeps it and the card only shows it; both: either side may change it; none: it stays the card's own */
  fieldModes: { title: 'remote' | 'both' | 'none'; body: 'remote' | 'both' | 'none' }
  /** a date changed on a card is sent; otherwise only the service's date is ever taken */
  sendsDue: boolean
  /** the item as it stands afterwards, which may differ from what was asked, such as a repeating task staying open; null when it can't be read back, taken as done as asked */
  setState(remoteId: string, state: 'open' | 'closed'): Promise<Result<RemoteItem | null>>
  setFields?(remoteId: string, patch: FieldPatch): Promise<Result<RemoteItem>>
  /** where an item lives, for knowing whether the key may change it; null when the id doesn't say */
  sourceOf(remoteId: string): string | null
  /** said on a card when the key turned out able only to read where it lives */
  readOnlyNote(source: string, kept: 'open' | 'closed'): string
}

/** one read from the service */
export interface Batch {
  items: RemoteItem[]
  /** agreed items this read speaks for; those it didn't send are checked for changes made here */
  covers(remoteId: string): boolean
  /** items known to be deleted though the read couldn't send them, such as ones a search no longer finds */
  gone?: string[]
}

export interface SyncProblem {
  /** the repository or list it is about, or null for the whole service */
  where: string | null
  kind: FailureKind
  message: string
  resetAt?: number
}

export interface SyncReport {
  changed: number
  problems: SyncProblem[]
}

export interface EngineDeps {
  db: Database.Database
  adapter: Adapter
  /** sources this key may only read; added to when the service refuses a change */
  readOnly: Set<string>
  now: () => number
}

const FIELDS = ['title', 'body', 'due'] as const
type Field = typeof FIELDS[number]

const FIELD_WORDS: Record<Field, string> = { title: 'title', body: 'description', due: 'date' }

const localState = (item: Item): 'open' | 'closed' => (item.status === 'done' || item.status === 'archived' ? 'closed' : 'open')

const tombstoned = (db: Database.Database, id: string): boolean =>
  db.prepare('SELECT 1 FROM sync_tombstones WHERE id = ? AND table_name = ?').get(id, 'items') !== undefined

/** a reopened item lands where new work does */
function firstColumn(slug: string): string {
  return readBoardConfig(slug).columns.find(c => c.id !== 'done')?.id ?? 'open'
}

const statusFor = (state: 'open' | 'closed', slug: string): string => (state === 'closed' ? 'done' : firstColumn(slug))

function metaOf(item: Item): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(item.metadata || '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

const sameJson = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

const cardValue = (item: Item, field: Field): string | number | null =>
  field === 'title' ? item.title : field === 'body' ? item.body : item.due_at

const remoteValue = (remote: RemoteItem, field: Field): string | number | null => remote[field]

function put(target: FieldPatch | AgreedFields, field: Field, value: string | number | null): void {
  if (field === 'due') target.due = typeof value === 'number' ? value : null
  else target[field] = typeof value === 'string' ? value : ''
}

/** only what can be sent back needs remembering; a field the service always wins is never compared */
const canSend = (adapter: Adapter, field: Field): boolean => (field === 'due' ? adapter.sendsDue : adapter.fieldModes[field] === 'both')

const linkState = (state: RemoteItem['state']): LinkState => (state === 'deleted' ? 'gone' : state)

function fieldMode(adapter: Adapter, remote: RemoteItem, field: Field): 'remote' | 'both' | 'none' {
  return field === 'due' ? remote.dueMode : adapter.fieldModes[field]
}

/** the fields the service owns outright, as the card should show them */
function ownedFields(adapter: Adapter, remote: RemoteItem): FieldPatch {
  const out: FieldPatch = {}
  if (adapter.fieldModes.title === 'remote') out.title = remote.title
  if (adapter.fieldModes.body === 'remote') out.body = remote.body
  if (remote.dueMode === 'remote') out.due = remote.due
  return out
}

function sendable(adapter: Adapter, patch: FieldPatch): AgreedFields {
  const out: AgreedFields = {}
  for (const field of FIELDS) {
    if (field in patch && canSend(adapter, field)) put(out, field, patch[field] ?? null)
  }
  return out
}

function words(fields: Field[]): string {
  const named = fields.map(f => FIELD_WORDS[f])
  return named.length === 1 ? named[0] : `${named.slice(0, -1).join(', ')} and ${named[named.length - 1]}`
}

interface CardChange {
  /** the item as the service has it now; refreshes the link and the date lock */
  remote?: RemoteItem
  fields?: FieldPatch
  status?: string
  state?: LinkState
  context?: string
  /** undefined leaves the card's note as it is, null clears it */
  problem?: string | null
}

/** writes only what differs, so an unchanged card keeps its last-changed time */
function updateCard(db: Database.Database, service: ConnectionService, remoteId: string, item: Item, change: CardChange): boolean {
  const meta = metaOf(item)
  const before = (meta.link && typeof meta.link === 'object' ? meta.link : {}) as Partial<ConnectionLink>
  const link: ConnectionLink = {
    service,
    id: remoteId,
    url: change.remote?.url ?? before.url ?? '',
    state: change.state ?? (change.remote ? linkState(change.remote.state) : undefined) ?? before.state ?? 'open',
    labels: change.remote?.labels ?? before.labels ?? []
  }
  const place = change.remote ? change.remote.place : before.place
  if (place) link.place = place
  const ref = change.remote ? change.remote.ref : before.ref
  if (ref) link.ref = ref
  const stateName = change.remote ? change.remote.stateName : before.stateName
  if (stateName) link.stateName = stateName
  const problem = change.problem === undefined ? before.problem : change.problem
  if (problem) link.problem = problem

  const next: Record<string, unknown> = { ...meta, link }
  const locked = change.remote ? change.remote.dueLocked : dueLockOf(item.metadata)
  if (locked) next.dueLocked = locked
  else delete next.dueLocked

  const patch: Partial<Item> = {}
  const f = change.fields ?? {}
  if (f.title !== undefined && item.title !== f.title) patch.title = f.title
  if (f.body !== undefined && item.body !== f.body) patch.body = f.body
  if (f.due !== undefined && item.due_at !== f.due) patch.due_at = f.due
  if (change.status && item.status !== change.status) patch.status = change.status
  if (change.context && item.context !== change.context) {
    patch.context = change.context
    // another board's columns differ, and a card in a column nobody owns is hidden
    patch.status = statusFor(localState({ ...item, ...patch }), change.context)
  }
  if (!sameJson(meta, next)) patch.metadata = JSON.stringify(next)
  if (Object.keys(patch).length === 0) return false
  updateItem(db, item.id, patch)
  return true
}

interface FieldPlan {
  /** values to write onto the card */
  take: FieldPatch
  /** values to send to the service */
  send: FieldPatch
  /** values both sides now hold */
  agree: AgreedFields
  conflicts: Field[]
  /** a two-way field moved, so an old note about it no longer stands */
  moved: boolean
}

function planFields(adapter: Adapter, item: Item, remote: RemoteItem, agreed: AgreedFields): FieldPlan {
  const plan: FieldPlan = { take: {}, send: {}, agree: {}, conflicts: [], moved: false }
  for (const field of FIELDS) {
    const mode = fieldMode(adapter, remote, field)
    if (mode === 'none') continue
    const local = cardValue(item, field)
    const theirs = remoteValue(remote, field)
    if (mode === 'remote') {
      if (local !== theirs) put(plan.take, field, theirs)
      if (canSend(adapter, field) && agreed[field] !== theirs) put(plan.agree, field, theirs)
      continue
    }
    const move = mergeField<string | number | null>(local, agreed[field], theirs)
    if (move === 'none') continue
    if (move === 'push') {
      put(plan.send, field, local)
    } else {
      if (move !== 'settle') put(plan.take, field, theirs)
      put(plan.agree, field, theirs)
      if (move === 'conflict') plan.conflicts.push(field)
    }
    if (move !== 'settle') plan.moved = true
  }
  return plan
}

const isEmpty = (patch: object): boolean => Object.keys(patch).length === 0

/** sends the card's changed fields; the answer is what both sides now hold, so a value the service tidied comes back to the card */
async function sendFields(deps: EngineDeps, remoteId: string, patch: FieldPatch, report: SyncReport): Promise<{ ok: true; remote: RemoteItem; agree: AgreedFields; take: FieldPatch } | { ok: false; problem: string }> {
  const { adapter } = deps
  const info = SERVICES[adapter.service]
  if (!adapter.setFields) return { ok: false, problem: `${info.name} can't take changes from here.` }
  const sent = await adapter.setFields(remoteId, patch)
  if (!sent.ok) {
    report.problems.push({ where: adapter.sourceOf(remoteId), kind: sent.kind, message: sent.message, resetAt: sent.resetAt })
    return { ok: false, problem: `Waiting to send your changes ${info.where}: ${sent.message}` }
  }
  const agree: AgreedFields = {}
  const take: FieldPatch = {}
  for (const field of FIELDS) {
    if (!(field in patch)) continue
    const value = remoteValue(sent.value, field)
    put(agree, field, value)
    put(take, field, value)
  }
  return { ok: true, remote: sent.value, agree, take }
}

/** asks the service to match the card; a key that may only read leaves the service's state standing and the card follows it */
async function pushState(deps: EngineDeps, remoteId: string, item: Item, slug: string, remoteState: 'open' | 'closed', report: SyncReport, note: string | null): Promise<void> {
  const { db, adapter } = deps
  const info = SERVICES[adapter.service]
  const wanted = localState(item)
  const source = adapter.sourceOf(remoteId) ?? ''
  const result = await adapter.setState(remoteId, wanted)
  if (result.ok) {
    const now = result.value
    if (now === null) {
      setAgreed(db, adapter.service, remoteId, item.id, wanted)
      updateCard(db, adapter.service, remoteId, item, { state: wanted, problem: note })
      report.changed++
      return
    }
    const settled = now.state === 'deleted' ? wanted : now.state
    setAgreed(db, adapter.service, remoteId, item.id, settled)
    const owned = ownedFields(adapter, now)
    const remembered = sendable(adapter, owned)
    if (!isEmpty(remembered)) setAgreedFields(db, adapter.service, remoteId, remembered)
    // a repeating task stays open with its next date, so the card follows it back
    updateCard(db, adapter.service, remoteId, item, {
      remote: now, fields: owned, status: settled !== wanted ? statusFor(settled, slug) : undefined, problem: note
    })
    report.changed++
    return
  }
  // a key that may only read says so for the whole list; a refusal of this one item says why, and the rest carry on
  if (result.kind === 'forbidden' || result.kind === 'refused') {
    if (result.kind === 'forbidden') deps.readOnly.add(source)
    setAgreed(db, adapter.service, remoteId, item.id, remoteState)
    updateCard(db, adapter.service, remoteId, item, {
      status: statusFor(remoteState, slug), state: remoteState,
      problem: result.kind === 'forbidden' ? adapter.readOnlyNote(source, remoteState) : result.message
    })
    report.changed++
    return
  }
  // a blip: the card stays where you put it and the next check tries again
  const verb = wanted === 'closed' ? info.closeVerb : 'reopen'
  if (updateCard(db, adapter.service, remoteId, item, { problem: `Waiting to ${verb} ${info.where}: ${result.message}` })) report.changed++
  report.problems.push({ where: source || null, kind: result.kind, message: result.message, resetAt: result.resetAt })
}

function importCard(deps: EngineDeps, remote: RemoteItem, cardId: string, slug: string): void {
  const { db, adapter } = deps
  const link: ConnectionLink = { service: adapter.service, id: remote.remoteId, url: remote.url, state: 'open', labels: remote.labels }
  if (remote.place) link.place = remote.place
  if (remote.ref) link.ref = remote.ref
  if (remote.stateName) link.stateName = remote.stateName
  createItem(db, {
    type: 'card',
    context: slug,
    title: remote.title,
    body: adapter.fieldModes.body === 'none' ? '' : remote.body,
    status: firstColumn(slug),
    priority: remote.priority ?? 0,
    position: deps.now(),
    due_at: remote.dueMode === 'none' ? null : remote.due,
    metadata: JSON.stringify(remote.dueLocked ? { link, dueLocked: remote.dueLocked } : { link })
  }, [], { id: cardId })
  setAgreed(db, adapter.service, remote.remoteId, cardId, 'open')
  const agree: AgreedFields = {}
  for (const field of FIELDS) {
    if (fieldMode(adapter, remote, field) !== 'none' && canSend(adapter, field)) put(agree, field, remoteValue(remote, field))
  }
  if (!isEmpty(agree)) setAgreedFields(db, adapter.service, remote.remoteId, agree)
}

async function settleItem(deps: EngineDeps, remote: RemoteItem, report: SyncReport): Promise<void> {
  const { db, adapter } = deps
  const service = adapter.service
  const cardId = cardIdFor(service, remote.remoteId)
  const item = getItemById(cardId)
  const agreed = getAgreed(db, service, remote.remoteId)
  const local: LocalState = item ? localState(item) : tombstoned(db, cardId) ? 'deleted' : 'none'
  const slug = remote.state === 'deleted' ? null : remote.workspace
  const decision = decide({
    local,
    agreed: agreed?.agreed ?? null,
    remote: slug !== null && remote.state !== 'deleted' ? remote.state : 'out-of-scope',
    remoteNewer: item ? remote.updatedAt > item.updated_at : true,
    canWrite: !deps.readOnly.has(remote.source)
  })

  if (decision === 'ignore') {
    if (agreed?.agreed !== 'ignored') setAgreed(db, service, remote.remoteId, cardId, 'ignored')
    return
  }
  if (decision === 'import') {
    if (slug === null) return
    importCard(deps, remote, cardId, slug)
    report.changed++
    return
  }
  if (!item) return
  if (decision === 'gone' || slug === null) {
    if (updateCard(db, service, remote.remoteId, item, { remote, fields: ownedFields(adapter, remote), state: 'gone' })) report.changed++
    return
  }

  const plan = planFields(adapter, item, remote, getAgreedFields(db, service, remote.remoteId))
  let note: string | null | undefined = plan.conflicts.length > 0
    ? `Changed in both places, so ${SERVICES[service].name}'s ${words(plan.conflicts)} ${plan.conflicts.length === 1 ? 'was' : 'were'} kept.`
    : plan.moved ? null : undefined
  let current = remote
  if (!isEmpty(plan.send)) {
    const sent = await sendFields(deps, remote.remoteId, plan.send, report)
    if (sent.ok) {
      current = sent.remote
      Object.assign(plan.agree, sent.agree)
      Object.assign(plan.take, sent.take)
    } else {
      note = sent.problem
    }
  }

  if (decision === 'settle' || decision === 'pull') setAgreed(db, service, remote.remoteId, cardId, current.state === 'closed' ? 'closed' : 'open')
  if (!isEmpty(plan.agree) && (agreed || decision === 'settle' || decision === 'pull')) setAgreedFields(db, service, remote.remoteId, plan.agree)

  if (decision === 'push') {
    if (updateCard(db, service, remote.remoteId, item, { remote: current, fields: plan.take, context: slug, problem: note })) report.changed++
    const fresh = getItemById(cardId)
    if (fresh) await pushState(deps, remote.remoteId, fresh, slug, remote.state === 'closed' ? 'closed' : 'open', report, note ?? null)
    return
  }
  const change: CardChange = { remote: current, fields: plan.take, context: slug, problem: decision === 'none' ? note : note ?? null }
  if (decision === 'pull') change.status = statusFor(current.state === 'closed' ? 'closed' : 'open', slug)
  if (updateCard(db, service, remote.remoteId, item, change)) report.changed++
}

/** cards changed here since the last agreement, whose items the service didn't send because they haven't changed there */
async function walkAgreed(deps: EngineDeps, batch: Batch, seen: Set<string>, report: SyncReport): Promise<void> {
  const { db, adapter } = deps
  const service = adapter.service
  for (const row of listAgreed(db, service)) {
    if (row.agreed === 'ignored' || seen.has(row.remoteId) || !batch.covers(row.remoteId)) continue
    let item = getItemById(row.itemId)
    if (!item) {
      if (tombstoned(db, row.itemId)) setAgreed(db, service, row.remoteId, row.itemId, 'ignored')
      continue
    }
    // an item no longer followed is not changed from here
    if (linkOf(item.metadata)?.state === 'gone') continue

    const agreedFields = getAgreedFields(db, service, row.remoteId)
    const send: FieldPatch = {}
    for (const field of FIELDS) {
      const twoWay = canSend(adapter, field) && (field !== 'due' || dueLockOf(item.metadata) === null)
      if (!twoWay || agreedFields[field] === undefined) continue
      const local = cardValue(item, field)
      if (local !== agreedFields[field]) put(send, field, local)
    }
    let note: string | null = null
    if (!isEmpty(send)) {
      const sent = await sendFields(deps, row.remoteId, send, report)
      if (sent.ok) {
        setAgreedFields(db, service, row.remoteId, sent.agree)
        if (updateCard(db, service, row.remoteId, item, { remote: sent.remote, fields: sent.take, problem: null })) report.changed++
      } else {
        note = sent.problem
        if (updateCard(db, service, row.remoteId, item, { problem: note })) report.changed++
      }
      item = getItemById(row.itemId)
      if (!item) continue
    }

    if (localState(item) === row.agreed) continue
    const source = adapter.sourceOf(row.remoteId)
    if (source !== null && deps.readOnly.has(source)) {
      setAgreed(db, service, row.remoteId, item.id, row.agreed)
      if (updateCard(db, service, row.remoteId, item, {
        status: statusFor(row.agreed, item.context), state: row.agreed, problem: adapter.readOnlyNote(source, row.agreed)
      })) report.changed++
      continue
    }
    await pushState(deps, row.remoteId, item, item.context, row.agreed, report, note)
  }
}

/** one read settled: every item it sent, then the cards it speaks for that changed here */
export async function settleBatch(deps: EngineDeps, batch: Batch, report: SyncReport): Promise<void> {
  const seen = new Set<string>()
  for (const remote of batch.items) {
    seen.add(remote.remoteId)
    await settleItem(deps, remote, report)
  }
  for (const remoteId of batch.gone ?? []) {
    seen.add(remoteId)
    const item = getItemById(cardIdFor(deps.adapter.service, remoteId))
    if (item && updateCard(deps.db, deps.adapter.service, remoteId, item, { state: 'gone' })) report.changed++
  }
  await walkAgreed(deps, batch, seen, report)
}
