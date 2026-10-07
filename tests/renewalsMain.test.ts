import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDb, createItem, getDb, getSetting, initDb, setSetting } from '../src/main/db'
import {
  createRenewal,
  deleteRenewal,
  getKinds,
  listRenewals,
  markRenewed,
  renameTemplateField,
  restoreRenewal,
  saveKinds,
  snoozeRenewal,
  templateFieldUses,
  updateRenewal,
  WARNED_SETTING
} from '../src/main/renewals'
import { checkRenewals, rollForward } from '../src/main/renewalReminders'
import { SyncService } from '../src/main/syncService'
import { POLICY_SETTING_KEY, resetNotificationDedupe } from '../src/main/notificationService'
import { DEFAULT_POLICY } from '../src/shared/notificationPolicy'
import { allDay, localDayOf } from '../src/shared/dueDate'
import { kindById, newRenewalMeta } from '../src/shared/renewalKinds'
import { shown } from './stubs/electron'

/** the value, or a failure that says it was missing */
function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('expected a value')
  return value
}

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'checkpoint-renewals-'))
  initDb(dir)
  shown.length = 0
  setSetting(POLICY_SETTING_KEY, { ...DEFAULT_POLICY, quietEnabled: false })
  resetNotificationDedupe()
})

afterEach(() => {
  closeDb()
  rmSync(dir, { recursive: true, force: true })
})

const today = localDayOf(Date.now())
const dayFromToday = (offset: number): number => allDay({ ...today, day: today.day + offset })
let n = 0
const makeId = (): string => `field-${++n}`

function create(title: string, meta: unknown, context = 'work') {
  const result = createRenewal({ context, title, meta })
  if (!result.ok) throw new Error(result.reason)
  return result.value
}

describe('storing renewals', () => {
  it('stores what it was given only after normalising it', () => {
    const r = create('acme.dev', { kind: 'domain', expiresAt: dayFromToday(40), url: 'javascript:x', fields: [{ type: 'bogus' }] })
    expect(r.meta.url).toBe('')
    expect(r.meta.fields).toStrictEqual([])
    const row = getDb().prepare('SELECT status, metadata FROM renewals WHERE id = ?').get(r.id) as { status: string; metadata: string }
    expect(row.status).toBe('active')
    expect(JSON.parse(row.metadata)).toStrictEqual(r.meta)
  })

  it('wants a name and a workspace', () => {
    expect(createRenewal({ context: 'work', title: '  ', meta: {} })).toMatchObject({ ok: false })
    expect(createRenewal({ context: '', title: 'x', meta: {} })).toMatchObject({ ok: false })
  })

  it('lists one workspace or all of them, and only renewals', () => {
    create('a', {}, 'work')
    create('b', {}, 'home')
    createItem(getDb(), { type: 'task', context: 'work', title: 'not one', body: '', status: 'open', priority: 0, position: 0, due_at: null, metadata: '{}' })
    expect(listRenewals('work').map(r => r.title)).toStrictEqual(['a'])
    expect(listRenewals().map(r => r.title).sort()).toStrictEqual(['a', 'b'])
  })

  it('updates, cancels and refuses to touch what is not a renewal', () => {
    const r = create('a', {})
    expect(updateRenewal(r.id, { status: 'cancelled', title: 'b' })).toMatchObject({ ok: true, value: { status: 'cancelled', title: 'b' } })
    const task = createItem(getDb(), { type: 'task', context: 'work', title: 't', body: '', status: 'open', priority: 0, position: 0, due_at: null, metadata: '{}' })
    expect(updateRenewal(task.id, { title: 'x' })).toMatchObject({ ok: false })
  })
})

describe('renewing and undoing', () => {
  it('moves the date a cycle on and puts it back exactly on Undo', () => {
    const r = create('Workspace', { expiresAt: dayFromToday(-2), cycle: { every: 1, unit: 'month' }, anchorDay: today.day - 2 > 0 ? today.day - 2 : 1 })
    const renewed = markRenewed(r.id)
    if (!renewed.ok) throw new Error(renewed.reason)
    expect(renewed.value.record.meta.expiresAt).toBeGreaterThan(Date.now())
    expect(renewed.value.record.meta.history[0]).toMatchObject({ by: 'you', confirmed: true })

    const undone = restoreRenewal(renewed.value.previous)
    if (!undone.ok) throw new Error(undone.reason)
    expect(undone.value.meta).toStrictEqual(r.meta)
  })

  it('asks for a date when there is no cycle to follow', () => {
    const r = create('Key', { expiresAt: dayFromToday(3), cycle: 'once' })
    expect(markRenewed(r.id)).toStrictEqual({ ok: false, reason: 'Pick the new expiry date.' })
    expect(markRenewed(r.id, dayFromToday(90))).toMatchObject({ ok: true })
  })

  it('brings a deleted one back with its own id, and stops sync carrying the delete', () => {
    const r = create('acme.dev', { expiresAt: dayFromToday(10) })
    const deleted = deleteRenewal(r.id)
    if (!deleted.ok) throw new Error(deleted.reason)
    expect(listRenewals()).toHaveLength(0)
    expect(getDb().prepare('SELECT COUNT(*) AS c FROM sync_tombstones WHERE id = ?').get(r.id)).toStrictEqual({ c: 1 })

    const back = restoreRenewal(deleted.value)
    expect(back).toMatchObject({ ok: true, value: { id: r.id, title: 'acme.dev' } })
    expect(getDb().prepare('SELECT COUNT(*) AS c FROM sync_tombstones WHERE id = ?').get(r.id)).toStrictEqual({ c: 0 })
  })

  it('snoozes until a time and forgets snoozes that have ended', () => {
    const r = create('a', {})
    const until = Date.now() + 60_000
    expect(snoozeRenewal(r.id, until)).toMatchObject({ ok: true, value: { snoozedUntil: until } })
    expect(snoozeRenewal(r.id, null)).toMatchObject({ ok: true, value: { snoozedUntil: null } })
  })
})

describe('kinds and templates', () => {
  it('moves entries of a deleted kind to Other, fields and all', () => {
    const kinds = [...getKinds(), { id: 'pet', name: 'Pet', icon: 'heart', renews: 'manual', cycle: 'once', warnAt: [7], fields: [] }]
    expect(saveKinds(kinds)).toMatchObject({ ok: true })
    const r = create('Rex vaccine', { kind: 'pet', fields: [{ id: 'v', label: 'Vet', type: 'text', value: 'Dr Who' }] })
    saveKinds(getKinds().filter(k => k.id !== 'pet'))
    const after = must(listRenewals().find(x => x.id === r.id))
    expect(after.meta.kind).toBe('other')
    expect(after.meta.fields[0]).toMatchObject({ label: 'Vet', value: 'Dr Who' })
  })

  it('renames a template field, and its copies only when asked', () => {
    const subscription = kindById(getKinds(), 'subscription')
    const a = create('A', newRenewalMeta(subscription, makeId))
    const b = create('B', newRenewalMeta(subscription, makeId))
    expect(templateFieldUses('subscription.cost')).toBe(2)

    expect(renameTemplateField('subscription', 'subscription.cost', 'Price', false)).toMatchObject({ ok: true, value: { renamed: 0 } })
    expect(must(listRenewals().find(r => r.id === a.id)).meta.fields[0].label).toBe('Cost')

    expect(renameTemplateField('subscription', 'subscription.cost', 'Fee', true)).toMatchObject({ ok: true, value: { renamed: 2 } })
    for (const id of [a.id, b.id]) expect(must(listRenewals().find(r => r.id === id)).meta.fields[0].label).toBe('Fee')
    expect(kindById(getKinds(), 'subscription').fields[0].label).toBe('Fee')
  })
})

describe('the sweep', () => {
  it('moves one that renews itself on, and clears what starts each cycle empty', () => {
    const r = create('Workspace', {
      expiresAt: dayFromToday(-1),
      renews: 'auto',
      cycle: { every: 1, unit: 'month' },
      fields: [{ id: 'p', label: 'Paid', type: 'checkbox', value: true, clearOnRenewal: true }]
    })
    expect(rollForward()).toBe(1)
    const after = must(listRenewals().find(x => x.id === r.id))
    expect(after.meta.expiresAt).toBeGreaterThan(Date.now())
    expect(after.meta.history[0]).toMatchObject({ by: 'auto', confirmed: true })
    expect(after.meta.fields[0]).toMatchObject({ value: false })
  })

  it('leaves one with a lookup to the lookup', () => {
    create('acme.dev', {
      expiresAt: dayFromToday(-1),
      renews: 'auto',
      cycle: { every: 1, unit: 'year' },
      lookup: { source: 'rdap', target: 'acme.dev', auto: false }
    })
    expect(rollForward()).toBe(0)
  })

  it('warns once and remembers it on this machine', async () => {
    create('OpenAI key', { expiresAt: dayFromToday(2), warnAt: [3] })
    const tenAm = new Date(today.year, today.month, today.day, 10).getTime()
    expect(await checkRenewals(tenAm)).toBe(1)
    expect(shown[0]).toStrictEqual({ title: 'OpenAI key', body: 'Expires in 2 days · Renew manually' })
    expect(await checkRenewals(tenAm + 60_000)).toBe(0)
    expect(Object.keys(getSetting<Record<string, number>>(WARNED_SETTING, {}))).toHaveLength(1)
  })

  it('keeps one held back by quiet hours for later instead of losing it', async () => {
    create('OpenAI key', { expiresAt: dayFromToday(2), warnAt: [3] })
    const tenAm = new Date(today.year, today.month, today.day, 10).getTime()
    setSetting(POLICY_SETTING_KEY, { ...DEFAULT_POLICY, quietEnabled: true, quietFrom: 9, quietTo: 11 })
    expect(await checkRenewals(tenAm)).toBe(0)
    setSetting(POLICY_SETTING_KEY, { ...DEFAULT_POLICY, quietEnabled: false })
    expect(await checkRenewals(tenAm + 3_600_000)).toBe(1)
  })
})

describe('sync', () => {
  const service = new SyncService()

  /** what this machine would send, then a fresh machine that receives it */
  function sendToFreshMachine(): void {
    const payload = service.getDatabasePayload()
    closeDb()
    rmSync(dir, { recursive: true, force: true })
    dir = mkdtempSync(join(tmpdir(), 'checkpoint-renewals-peer-'))
    initDb(dir)
    service.applyDatabasePayload(payload)
  }

  it('carries renewals to another machine', () => {
    const r = create('acme.dev', { kind: 'domain', expiresAt: dayFromToday(30) })
    sendToFreshMachine()
    expect(listRenewals().map(x => [x.id, x.title, x.meta.expiresAt])).toStrictEqual([[r.id, 'acme.dev', r.meta.expiresAt]])
  })

  it('carries a delete over, so the renewal does not come back', () => {
    const r = create('acme.dev', {})
    const payloadBefore = service.getDatabasePayload()
    deleteRenewal(r.id)
    const payloadAfter = service.getDatabasePayload()
    closeDb()
    rmSync(dir, { recursive: true, force: true })
    dir = mkdtempSync(join(tmpdir(), 'checkpoint-renewals-peer-'))
    initDb(dir)
    service.applyDatabasePayload(payloadBefore)
    expect(listRenewals()).toHaveLength(1)
    service.applyDatabasePayload(payloadAfter)
    expect(listRenewals()).toHaveLength(0)
  })

  it('takes a payload from an older version, which has no renewals in it, without touching them', () => {
    create('acme.dev', {})
    const older = { ...service.getDatabasePayload(), renewals: undefined }
    service.applyDatabasePayload(older)
    expect(listRenewals()).toHaveLength(1)
  })

  it('keeps the newer side of an edit made on two machines', () => {
    const r = create('acme.dev', {})
    const payload = service.getDatabasePayload()
    const theirs = must(payload.renewals).map(row => ({ ...row, title: 'theirs', updated_at: row.updated_at + 10_000 }))
    service.applyDatabasePayload({ ...payload, renewals: theirs })
    expect(listRenewals()[0].title).toBe('theirs')
    const stale = must(payload.renewals).map(row => ({ ...row, title: 'stale', updated_at: row.updated_at - 10_000 }))
    service.applyDatabasePayload({ ...payload, renewals: stale })
    expect(must(listRenewals().find(x => x.id === r.id)).title).toBe('theirs')
  })

  it('leaves the items table alone, so nothing an older version reads changes', () => {
    create('acme.dev', { expiresAt: dayFromToday(-1) })
    expect(getDb().prepare('SELECT COUNT(*) AS c FROM items').get()).toStrictEqual({ c: 0 })
  })
})
