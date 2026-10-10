import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDb, getAgreed, getAgreedFields, getDb, getItemById, initDb, setSetting, updateItem } from '../src/main/db'
import { settleBatch, type Adapter, type FieldPatch, type RemoteItem, type SyncReport } from '../src/main/connections/engine'
import type { FailureKind } from '../src/main/connections/result'
import { cardIdFor, dueLockOf, linkOf } from '../src/shared/connections'
import { allDay, DAY_MS } from '../src/shared/dueDate'

// one two-way service, kept in memory, the way Todoist behaves

let clock = Date.now()
const tick = (): number => (clock += 1000)

const MONDAY = allDay({ year: 2026, month: 9, day: 12 })

const item = (id: string, extra: Partial<RemoteItem> = {}): RemoteItem => ({
  remoteId: id,
  source: 'p1',
  workspace: 'work',
  state: 'open',
  title: `Task ${id}`,
  body: 'Notes',
  due: null,
  dueMode: 'both',
  dueLocked: null,
  labels: ['errands'],
  url: `https://app.todoist.com/app/task/${id}`,
  place: 'Groceries',
  updatedAt: tick(),
  ...extra
})

function fakeService(initial: RemoteItem[]) {
  const items = new Map(initial.map(i => [i.remoteId, { ...i }]))
  const calls: string[] = []
  let failing: FailureKind | null = null
  const failure = () => ({ ok: false as const, kind: failing as FailureKind, message: failing === 'refused' ? 'The workflow can\'t move it to Done.' : 'offline' })
  const adapter: Adapter = {
    service: 'todoist',
    fieldModes: { title: 'both', body: 'both' },
    sendsDue: true,
    async setState(remoteId, state) {
      calls.push(`state ${remoteId} ${state}`)
      if (failing) return failure()
      const found = items.get(remoteId) as RemoteItem
      // a repeating task done once moves to its next date and stays open
      if (state === 'closed' && found.dueMode === 'remote' && found.due !== null) Object.assign(found, { due: found.due + 7 * DAY_MS, updatedAt: tick() })
      else Object.assign(found, { state, updatedAt: tick() })
      return { ok: true, value: { ...found } }
    },
    async setFields(remoteId, patch: FieldPatch) {
      calls.push(`fields ${remoteId} ${Object.keys(patch).join(',')}`)
      if (failing) return failure()
      const found = items.get(remoteId) as RemoteItem
      // the service tidies what it is sent
      Object.assign(found, patch, patch.title !== undefined ? { title: patch.title.trim() } : {}, { updatedAt: tick() })
      return { ok: true, value: { ...found } }
    },
    sourceOf: () => null,
    readOnlyNote: (_source, kept) => `Kept ${kept}.`
  }
  return {
    adapter,
    items,
    calls,
    edit: (id: string, patch: Partial<RemoteItem>) => Object.assign(items.get(id) as RemoteItem, patch, { updatedAt: tick() }),
    fail: (kind: FailureKind | null) => { failing = kind }
  }
}

/** a read like Todoist's: every changed item, or all of them */
async function run(fake: ReturnType<typeof fakeService>, sent: string[] | 'all' = 'all', gone: string[] = [], readOnly = new Set<string>()): Promise<SyncReport> {
  const report: SyncReport = { changed: 0, problems: [] }
  const items = [...fake.items.values()].filter(i => sent === 'all' || sent.includes(i.remoteId)).map(i => ({ ...i }))
  await settleBatch({ db: getDb(), adapter: fake.adapter, readOnly, now: () => Date.now() }, { items, covers: () => true, gone }, report)
  return report
}

const card = (id: string) => getItemById(cardIdFor('todoist', id))

let dir = ''
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'checkpoint-engine-'))
  initDb(dir)
  setSetting('contexts_list', JSON.stringify([
    { slug: 'work', name: 'Work', color: '#535e85' },
    { slug: 'home', name: 'Home', color: '#535e85' }
  ]))
})

afterEach(() => {
  closeDb()
  rmSync(dir, { recursive: true, force: true })
})

describe('fields both ways', () => {
  it('brings an item in with its place and priority, and remembers what both sides hold', async () => {
    const fake = fakeService([item('t1', { due: MONDAY, priority: 3 })])
    expect(await run(fake)).toStrictEqual({ changed: 1, problems: [] })
    expect(card('t1')).toMatchObject({ context: 'work', title: 'Task t1', body: 'Notes', due_at: MONDAY, priority: 3 })
    expect(linkOf(card('t1')?.metadata ?? '{}')).toMatchObject({ service: 'todoist', place: 'Groceries', labels: ['errands'] })
    expect(getAgreedFields(getDb(), 'todoist', 't1')).toStrictEqual({ title: 'Task t1', body: 'Notes', due: MONDAY })
  })

  it('takes a change made in the service, and sends one made on the card', async () => {
    const fake = fakeService([item('t1')])
    await run(fake)
    fake.edit('t1', { title: 'Buy oat milk' })
    await run(fake, ['t1'])
    expect(card('t1')?.title).toBe('Buy oat milk')

    updateItem(getDb(), cardIdFor('todoist', 't1'), { title: '  Buy milk and eggs  ', due_at: MONDAY })
    await run(fake, [])
    expect(fake.calls).toContain('fields t1 title,due')
    expect(fake.items.get('t1')).toMatchObject({ title: 'Buy milk and eggs', due: MONDAY })
    // what the service tidied comes back, so the next check has nothing to send
    expect(card('t1')?.title).toBe('Buy milk and eggs')
    fake.calls.length = 0
    await run(fake, [])
    expect(fake.calls).toStrictEqual([])
  })

  it('keeps the service\'s version when both changed, says so, and clears the note on the next change', async () => {
    const fake = fakeService([item('t1')])
    await run(fake)
    updateItem(getDb(), cardIdFor('todoist', 't1'), { title: 'Mine' })
    fake.edit('t1', { title: 'Theirs' })
    await run(fake, ['t1'])
    expect(card('t1')?.title).toBe('Theirs')
    expect(linkOf(card('t1')?.metadata ?? '{}')?.problem).toBe('Changed in both places, so Todoist\'s title was kept.')
    expect(fake.items.get('t1')?.title).toBe('Theirs')

    updateItem(getDb(), cardIdFor('todoist', 't1'), { title: 'Mine again' })
    await run(fake, [])
    expect(fake.items.get('t1')?.title).toBe('Mine again')
    expect(linkOf(card('t1')?.metadata ?? '{}')?.problem).toBeUndefined()
  })

  it('keeps a change made here when the service can\'t be reached, and sends it on a later check', async () => {
    const fake = fakeService([item('t1')])
    await run(fake)
    updateItem(getDb(), cardIdFor('todoist', 't1'), { body: 'Two litres' })
    fake.fail('network')
    const report = await run(fake, [])
    expect(report.problems).toHaveLength(1)
    expect(card('t1')?.body).toBe('Two litres')
    expect(linkOf(card('t1')?.metadata ?? '{}')?.problem).toBe('Waiting to send your changes in Todoist: offline')
    fake.fail(null)
    await run(fake, [])
    expect(fake.items.get('t1')?.body).toBe('Two litres')
    expect(linkOf(card('t1')?.metadata ?? '{}')?.problem).toBeUndefined()
  })
})

describe('done and its exceptions', () => {
  it('brings a repeating item back with its next date when its card is done, and keeps that date the service\'s', async () => {
    const lock = 'This task repeats in Todoist (every monday), so change its date there.'
    const fake = fakeService([item('t1', { due: MONDAY, dueMode: 'remote', dueLocked: lock })])
    await run(fake)
    expect(dueLockOf(card('t1')?.metadata ?? '{}')).toBe(lock)
    updateItem(getDb(), cardIdFor('todoist', 't1'), { status: 'done' })
    await run(fake, [])
    expect(fake.calls).toStrictEqual(['state t1 closed'])
    expect(card('t1')).toMatchObject({ status: 'open', due_at: MONDAY + 7 * DAY_MS })
    expect(getAgreed(getDb(), 'todoist', 't1')?.agreed).toBe('open')
    // its date is never sent from here
    updateItem(getDb(), cardIdFor('todoist', 't1'), { due_at: MONDAY })
    fake.calls.length = 0
    await run(fake, [])
    expect(fake.calls).toStrictEqual([])
  })

  it('marks the card of a deleted item and keeps it, without sending it anything again', async () => {
    const fake = fakeService([item('t1')])
    await run(fake)
    fake.edit('t1', { state: 'deleted' })
    await run(fake, ['t1'])
    expect(linkOf(card('t1')?.metadata ?? '{}')?.state).toBe('gone')
    updateItem(getDb(), cardIdFor('todoist', 't1'), { status: 'done', title: 'Changed' })
    fake.calls.length = 0
    await run(fake, [])
    expect(fake.calls).toStrictEqual([])
  })

  it('moves the card when its item moves to a list another workspace follows', async () => {
    const fake = fakeService([item('t1')])
    await run(fake)
    fake.edit('t1', { workspace: 'home', source: 'p2', place: 'Chores' })
    await run(fake, ['t1'])
    expect(card('t1')).toMatchObject({ context: 'home', status: 'open' })
    expect(linkOf(card('t1')?.metadata ?? '{}')?.place).toBe('Chores')
  })
})

describe('quiet checks', () => {
  it('write nothing when nothing changed, so the card keeps its last-changed time', async () => {
    const fake = fakeService([item('t1', { due: MONDAY })])
    await run(fake)
    const before = card('t1')?.updated_at
    await new Promise(resolve => setTimeout(resolve, 5))
    expect(await run(fake)).toStrictEqual({ changed: 0, problems: [] })
    expect(card('t1')?.updated_at).toBe(before)
    expect(fake.calls).toStrictEqual([])
  })
})

describe('refusals and items known gone', () => {
  it('puts a card back where the service has it when one item can\'t be moved, without making the rest read-only', async () => {
    const fake = fakeService([item('t1')])
    await run(fake)
    updateItem(getDb(), cardIdFor('todoist', 't1'), { status: 'done' })
    fake.fail('refused')
    const readOnly = new Set<string>()
    const report = await run(fake, [], [], readOnly)
    expect(card('t1')?.status).toBe('open')
    expect(linkOf(card('t1')?.metadata ?? '{}')?.problem).toBe('The workflow can\'t move it to Done.')
    expect(getAgreed(getDb(), 'todoist', 't1')?.agreed).toBe('open')
    expect(readOnly.size).toBe(0)
    expect(report.problems).toStrictEqual([])
  })

  it('marks a card gone when its item is known to be deleted, leaving its text alone', async () => {
    const fake = fakeService([item('t1')])
    await run(fake)
    await run(fake, [], ['t1'])
    expect(card('t1')).toMatchObject({ title: 'Task t1', body: 'Notes' })
    expect(linkOf(card('t1')?.metadata ?? '{}')?.state).toBe('gone')
  })
})

describe('a field that stays the card\'s own', () => {
  it('is never taken from the service nor sent to it', async () => {
    const fake = fakeService([item('t1', { body: 'Theirs' })])
    fake.adapter.fieldModes = { title: 'both', body: 'none' }
    await run(fake)
    expect(card('t1')?.body).toBe('')
    updateItem(getDb(), cardIdFor('todoist', 't1'), { body: 'Mine' })
    fake.edit('t1', { body: 'Theirs again' })
    await run(fake)
    expect(card('t1')?.body).toBe('Mine')
    expect(fake.calls.filter(c => c.startsWith('fields'))).toStrictEqual([])
  })
})
