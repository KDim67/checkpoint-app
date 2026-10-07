/** the one writer of renewals, so whatever reaches the table has been through normalizeRenewal */

import { v4 as uuidv4 } from 'uuid'
import {
  deleteRenewalRow,
  getDb,
  getRenewalRow,
  getSetting,
  insertRenewalRow,
  listRenewalRows,
  setSetting,
  updateRenewalRow
} from './db'
import { advancePast, normalizeRenewal, renewTo, type RenewalMeta } from '../shared/renewal'
import { normalizeKinds, RENEWAL_KINDS_SETTING, renameLinkedFields, type RenewalKind } from '../shared/renewalKinds'
import type {
  RenewalCreateInput,
  RenewalLookupState,
  RenewalPatch,
  RenewalRecord,
  RenewalResult,
  RenewalRow,
  RenewalSnapshot
} from '../shared/renewalApi'

// on this machine only: none of these is in the sync allowlist
export const WARNED_SETTING = 'renewal_warned'
const SNOOZED_SETTING = 'renewal_snoozed'
export const LOOKUP_STATE_SETTING = 'renewal_lookup_state'

const TITLE_MAX = 200
const BODY_MAX = 20_000

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** a settings map that may have been damaged; anything unreadable starts empty */
export function readMap<T>(key: string): Record<string, T> {
  try {
    const raw = getSetting<unknown>(key, {})
    return isObject(raw) ? (raw as Record<string, T>) : {}
  } catch (err) {
    console.error(`[renewals] Could not read ${key}:`, err)
    return {}
  }
}

const ok = <T>(value: T): RenewalResult<T> => ({ ok: true, value })
const fail = <T>(reason: string): RenewalResult<T> => ({ ok: false, reason })

function toRecord(row: RenewalRow, snoozed: Record<string, number>, lookups: Record<string, RenewalLookupState>, now: number): RenewalRecord {
  const { meta, dropped } = normalizeRenewal(row.metadata)
  const until = snoozed[row.id]
  return {
    id: row.id,
    context: row.context,
    title: row.title,
    body: row.body,
    status: row.status === 'cancelled' ? 'cancelled' : 'active',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    meta,
    dropped,
    snoozedUntil: typeof until === 'number' && until > now ? until : null,
    lookupState: lookups[row.id] ?? null
  }
}

export function listRenewals(context?: string, now = Date.now()): RenewalRecord[] {
  const snoozed = readMap<number>(SNOOZED_SETTING)
  const lookups = readMap<RenewalLookupState>(LOOKUP_STATE_SETTING)
  return listRenewalRows(context).map(row => toRecord(row, snoozed, lookups, now))
}

const rowOf = (id: unknown): RenewalRow | null => (typeof id === 'string' && id ? getRenewalRow(id) : null)

export function getRenewal(id: string, now = Date.now()): RenewalRecord | null {
  const row = rowOf(id)
  return row ? toRecord(row, readMap(SNOOZED_SETTING), readMap(LOOKUP_STATE_SETTING), now) : null
}

/** what was just written, as the renderer will see it */
function readBack(id: string, now = Date.now()): RenewalResult<RenewalRecord> {
  const record = getRenewal(id, now)
  return record ? ok(record) : fail('The renewal was saved but could not be read back.')
}

const snapshotOf = (row: RenewalRow): RenewalSnapshot => ({
  id: row.id,
  context: row.context,
  title: row.title,
  body: row.body,
  status: row.status,
  metadata: row.metadata,
  createdAt: row.created_at
})

const cleanTitle = (v: unknown): string => (typeof v === 'string' ? v.trim().slice(0, TITLE_MAX) : '')
const cleanBody = (v: unknown): string => (typeof v === 'string' ? v.slice(0, BODY_MAX) : '')
const cleanContext = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
const serialise = (meta: unknown): string => JSON.stringify(normalizeRenewal(meta).meta)

export function createRenewal(input: RenewalCreateInput, now = Date.now()): RenewalResult<RenewalRecord> {
  if (!isObject(input)) return fail('Nothing to create.')
  const context = cleanContext(input.context)
  const title = cleanTitle(input.title)
  if (!context) return fail('Pick a workspace for it.')
  if (!title) return fail('Give it a name.')
  const id = uuidv4()
  insertRenewalRow({
    id,
    context,
    title,
    body: cleanBody(input.body),
    status: 'active',
    created_at: now,
    updated_at: now,
    metadata: serialise(input.meta)
  })
  return readBack(id, now)
}

export function updateRenewal(id: string, patch: RenewalPatch): RenewalResult<RenewalRecord> {
  if (!rowOf(id)) return fail('That renewal no longer exists.')
  if (!isObject(patch)) return fail('Nothing to change.')
  const changes: Parameters<typeof updateRenewalRow>[1] = {}
  if (patch.title !== undefined) {
    const title = cleanTitle(patch.title)
    if (!title) return fail('Give it a name.')
    changes.title = title
  }
  if (patch.body !== undefined) changes.body = cleanBody(patch.body)
  if (patch.status === 'active' || patch.status === 'cancelled') changes.status = patch.status
  if (patch.context !== undefined) {
    const context = cleanContext(patch.context)
    if (!context) return fail('Pick a workspace for it.')
    changes.context = context
  }
  if (patch.meta !== undefined) changes.metadata = serialise(patch.meta)
  updateRenewalRow(id, changes)
  return readBack(id)
}

/** saves a new expiry with its history line; the old row comes back for Undo */
export function saveRenewed(id: string, meta: RenewalMeta): RenewalResult<{ record: RenewalRecord; previous: RenewalSnapshot }> {
  const row = rowOf(id)
  if (!row) return fail('That renewal no longer exists.')
  const previous = snapshotOf(row)
  updateRenewalRow(id, { metadata: serialise(meta) })
  const record = readBack(id)
  return record.ok ? ok({ record: record.value, previous }) : record
}

/** one cycle on, or to the date given for a one-off; a lookup confirms it later where there is one */
export function markRenewed(id: string, to: number | null = null, now = Date.now()): RenewalResult<{ record: RenewalRecord; previous: RenewalSnapshot }> {
  const row = rowOf(id)
  if (!row) return fail('That renewal no longer exists.')
  const { meta } = normalizeRenewal(row.metadata)
  let next: number | null = null
  if (typeof to === 'number' && Number.isFinite(to) && to > 0) next = to
  else if (meta.expiresAt !== null) next = advancePast(meta.expiresAt, meta.cycle, meta.anchorDay, now)
  if (next === null) return fail(meta.expiresAt === null ? 'Set the expiry date first.' : 'Pick the new expiry date.')
  return saveRenewed(id, renewTo(meta, next, 'you', now, meta.lookup === null))
}

/** Undo: writes the row back as it was, recreating it with its own id if it was deleted */
export function restoreRenewal(snapshot: RenewalSnapshot): RenewalResult<RenewalRecord> {
  if (!isObject(snapshot) || typeof snapshot.id !== 'string' || !snapshot.id) return fail('Nothing to restore.')
  const context = cleanContext(snapshot.context)
  const title = cleanTitle(snapshot.title)
  if (!context || !title) return fail('Nothing to restore.')
  const fields = {
    context,
    title,
    body: cleanBody(snapshot.body),
    status: snapshot.status === 'cancelled' ? 'cancelled' : 'active',
    metadata: serialise(snapshot.metadata)
  }
  if (rowOf(snapshot.id)) {
    updateRenewalRow(snapshot.id, fields)
  } else {
    const now = Date.now()
    insertRenewalRow({
      id: snapshot.id,
      ...fields,
      created_at: typeof snapshot.createdAt === 'number' ? snapshot.createdAt : now,
      updated_at: now
    })
  }
  return readBack(snapshot.id)
}

export function deleteRenewal(id: string): RenewalResult<RenewalSnapshot> {
  const row = rowOf(id)
  if (!row) return fail('That renewal no longer exists.')
  deleteRenewalRow(id)
  return ok(snapshotOf(row))
}

export function snoozeRenewal(id: string, until: number | null, now = Date.now()): RenewalResult<RenewalRecord> {
  if (!rowOf(id)) return fail('That renewal no longer exists.')
  const snoozed = readMap<number>(SNOOZED_SETTING)
  // ended snoozes go on every write, so the map stays small
  for (const [key, at] of Object.entries(snoozed)) if (typeof at !== 'number' || at <= now) delete snoozed[key]
  if (typeof until === 'number' && Number.isFinite(until) && until > now) snoozed[id] = until
  else delete snoozed[id]
  setSetting(SNOOZED_SETTING, snoozed)
  return readBack(id, now)
}

export const getKinds = (): RenewalKind[] => normalizeKinds(getSetting<unknown>(RENEWAL_KINDS_SETTING, null))

/** a kind that's gone takes its entries to Other, with their fields kept, in the same write */
export function saveKinds(raw: unknown): RenewalResult<RenewalKind[]> {
  const kinds = normalizeKinds(raw)
  const known = new Set(kinds.map(k => k.id))
  getDb().transaction(() => {
    setSetting(RENEWAL_KINDS_SETTING, kinds)
    for (const row of listRenewalRows()) {
      const { meta } = normalizeRenewal(row.metadata)
      if (!known.has(meta.kind)) updateRenewalRow(row.id, { metadata: serialise({ ...meta, kind: 'other' }) })
    }
  })()
  return ok(kinds)
}

/** the template and, if asked, every entry's copy of it, all or nothing */
export function renameTemplateField(
  kindId: string,
  templateFieldId: string,
  label: string,
  alsoEntries: boolean
): RenewalResult<{ kinds: RenewalKind[]; renamed: number }> {
  const clean = typeof label === 'string' ? label.trim().slice(0, 40) : ''
  if (!clean) return fail('Give the field a name.')
  const kinds = getKinds()
  const kind = kinds.find(k => k.id === kindId)
  if (!kind || !kind.fields.some(f => f.id === templateFieldId)) return fail('That field is no longer in the template.')

  let renamed = 0
  const next = kinds.map(k =>
    k.id === kindId ? { ...k, fields: k.fields.map(f => (f.id === templateFieldId ? { ...f, label: clean } : f)) } : k
  )
  getDb().transaction(() => {
    setSetting(RENEWAL_KINDS_SETTING, next)
    if (!alsoEntries) return
    for (const row of listRenewalRows()) {
      const { meta } = normalizeRenewal(row.metadata)
      if (!meta.fields.some(f => f.templateFieldId === templateFieldId)) continue
      updateRenewalRow(row.id, { metadata: serialise(renameLinkedFields(meta, templateFieldId, clean)) })
      renamed++
    }
  })()
  return ok({ kinds: normalizeKinds(next), renamed })
}

/** how many entries use a template field, so the rename can ask about them */
export function templateFieldUses(templateFieldId: string): number {
  return listRenewalRows().filter(row =>
    normalizeRenewal(row.metadata).meta.fields.some(f => f.templateFieldId === templateFieldId)
  ).length
}
