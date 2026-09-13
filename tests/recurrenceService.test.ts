import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  initDb,
  closeDb,
  getDb,
  getItemsPaginated,
  getRecurrenceById,
  updateItem,
  setRecurrenceInstanceClosedHandler
} from '../src/main/db'
import {
  createRecurrence,
  materialiseDueRecurrences,
  onInstanceClosed
} from '../src/main/recurrenceService'
import { defined } from './helpers/defined'

// at most one open instance per rule, or a month-old daily makes thirty cards

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'checkpoint-rec-'))
  initDb(dir)
})

afterEach(() => {
  setRecurrenceInstanceClosedHandler(null)
  closeDb()
  rmSync(dir, { recursive: true, force: true })
})

const DAY = 86_400_000
const tasks = () => getItemsPaginated('test', 'task', 1, 100).items

const daily = (startAt: number, over: Record<string, unknown> = {}) =>
  createRecurrence({
    context: 'test',
    title: 'Water the plants',
    rule: { freq: 'daily', interval: 1, startAt, untilAt: null },
    ...over
  })

describe('createRecurrence', () => {
  it('stores a rule and works out when it first fires', () => {
    const row = daily(Date.now() + DAY)
    expect(row).not.toBeNull()
    expect(defined(row).next_due).toBeGreaterThan(Date.now())
    expect(defined(row).active).toBe(1)
  })

  it('refuses a rule it cannot understand', () => {
    expect(createRecurrence({ context: 'test', title: 'x', rule: { freq: 'hourly', startAt: 1 } })).toBeNull()
    expect(createRecurrence({ context: 'test', title: '   ', rule: { freq: 'daily', startAt: Date.now() } })).toBeNull()
  })

  it('does not backfill a rule that started long ago', () => {
    // a year-old rule is due once, not 365 times
    const row = daily(Date.now() - 365 * DAY)
    expect(defined(row).next_due).toBeGreaterThan(Date.now() - DAY)
  })
})

describe('materialising', () => {
  it('creates the item when the rule comes due', () => {
    daily(Date.now() - DAY)
    expect(materialiseDueRecurrences()).toBe(1)

    const items = tasks()
    expect(items).toHaveLength(1)
    expect(items[0].title).toBe('Water the plants')
  })

  it('stamps the instance so it can be traced back to its rule', () => {
    const row = daily(Date.now() - DAY)
    materialiseDueRecurrences()
    expect(JSON.parse(tasks()[0].metadata)).toMatchObject({ recurrenceId: defined(row).id })
  })

  it('creates nothing while the previous instance is still open', () => {
    daily(Date.now() - 10 * DAY)
    materialiseDueRecurrences()
    expect(tasks()).toHaveLength(1)

    // ten more sweeps, still one card
    for (let i = 0; i < 10; i++) materialiseDueRecurrences(Date.now() + i * DAY)
    expect(tasks()).toHaveLength(1)
  })

  it('creates the next one once the previous is done', () => {
    daily(Date.now() - 2 * DAY)
    materialiseDueRecurrences()
    const first = tasks()[0]

    updateItem(getDb(), first.id, { status: 'done' })
    materialiseDueRecurrences(Date.now() + DAY)

    const open = tasks().filter(i => i.status !== 'done')
    expect(open).toHaveLength(1)
    expect(tasks()).toHaveLength(2)
  })

  it('treats an archived instance as finished', () => {
    daily(Date.now() - 2 * DAY)
    materialiseDueRecurrences()
    updateItem(getDb(), tasks()[0].id, { status: 'archived' })

    materialiseDueRecurrences(Date.now() + DAY)
    expect(tasks().filter(i => i.status === 'open')).toHaveLength(1)
  })

  it('does nothing for a rule that is not due yet', () => {
    daily(Date.now() + 5 * DAY)
    expect(materialiseDueRecurrences()).toBe(0)
    expect(tasks()).toHaveLength(0)
  })

  it('advances next_due past the occurrence it just created', () => {
    const row = daily(Date.now() - DAY)
    const before = defined(defined(getRecurrenceById(defined(row).id)).next_due)
    materialiseDueRecurrences()
    expect(defined(defined(getRecurrenceById(defined(row).id)).next_due)).toBeGreaterThan(before)
  })

  it('deactivates a rule once it passes its end date', () => {
    const start = Date.now() - 2 * DAY
    const row = createRecurrence({
      context: 'test',
      title: 'Short-lived',
      rule: { freq: 'daily', interval: 1, startAt: start, untilAt: start + DAY }
    })
    materialiseDueRecurrences()
    expect(defined(getRecurrenceById(defined(row).id)).active).toBe(0)
  })
})

describe('completing an instance', () => {
  it('creates nothing when the next occurrence is not due yet', () => {
    // wired like index.ts; on-time completion mustn't spawn tomorrow's early
    setRecurrenceInstanceClosedHandler(onInstanceClosed)

    daily(Date.now() - 2 * DAY)
    materialiseDueRecurrences()
    updateItem(getDb(), tasks()[0].id, { status: 'done' })

    expect(tasks()).toHaveLength(1)
  })

  it('creates the replacement at once when the rule is already overdue', () => {
    const row = daily(Date.now() - 2 * DAY)
    materialiseDueRecurrences()
    const open = tasks()[0]

    // sweeps skip the open instance and leave next_due, so it's overdue at completion
    const dueBefore = defined(getRecurrenceById(defined(row).id)).next_due
    materialiseDueRecurrences(Date.now() + 3 * DAY)
    expect(defined(getRecurrenceById(defined(row).id)).next_due).toBe(dueBefore)
    expect(tasks()).toHaveLength(1)

    updateItem(getDb(), open.id, { status: 'done' })
    onInstanceClosed(defined(row).id, Date.now() + 3 * DAY)

    expect(tasks()).toHaveLength(2)
    expect(tasks().filter(i => i.status === 'open')).toHaveLength(1)
  })

  it('ignores an item that belongs to no rule', () => {
    setRecurrenceInstanceClosedHandler(onInstanceClosed)
    const item = getDb() && createRecurrence({ context: 'test', title: 'anchor', rule: { freq: 'daily', startAt: Date.now() - DAY } })
    materialiseDueRecurrences()

    const plain = tasks()[0]
    updateItem(getDb(), plain.id, { metadata: '{}' })
    expect(() => updateItem(getDb(), plain.id, { status: 'done' })).not.toThrow()
    expect(item).not.toBeNull()
  })

  it('does not fire again for an item that was already finished', () => {
    setRecurrenceInstanceClosedHandler(onInstanceClosed)
    daily(Date.now() - 2 * DAY)
    materialiseDueRecurrences()

    const first = tasks()[0]
    updateItem(getDb(), first.id, { status: 'done' })
    const afterFirst = tasks().length

    // editing a done item mustn't spawn another
    updateItem(getDb(), first.id, { title: 'Water the plants (edited)' })
    updateItem(getDb(), first.id, { status: 'done' })
    expect(tasks()).toHaveLength(afterFirst)
  })
})
