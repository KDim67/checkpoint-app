import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDb, createItem, getDb, getItemById, initDb, setSetting } from '../src/main/db'
import { createRecurrence } from '../src/main/recurrenceService'
import { createRenewal } from '../src/main/renewals'
import { calendarEntries, moveDue, quickAdd } from '../src/main/calendar/service'
import { commitEntries } from '../src/main/calendar/commits'
import { allDay } from '../src/shared/dueDate'
import { boardConfigKey } from '../src/shared/boardModel'
import type { CalendarLayer, CalendarQuery } from '../src/shared/calendar'
import type { Item } from '../src/shared/types'
import { defined } from './helpers/defined'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'checkpoint-calendar-'))
  initDb(dir)
  setSetting('contexts_list', JSON.stringify([{ slug: 'work', name: 'Work', color: '#535e85' }, { slug: 'home', name: 'Home', color: '#535e85' }]))
})

afterEach(() => {
  closeDb()
  rmSync(dir, { recursive: true, force: true })
})

const OCT = { from: new Date(2026, 9, 1).getTime(), to: new Date(2026, 10, 1).getTime() }
// mid-October, so the late items before the month are fetched too
const NOW = new Date(2026, 9, 10, 12).getTime()

const make = (over: Partial<Item>): Item => createItem(getDb(), {
  type: 'task', context: 'work', title: 'Untitled', body: '', status: 'open', priority: 0, position: 0, due_at: null, metadata: '{}', ...over
})

async function entries(layers: CalendarLayer[], workspaces: string[] | null = ['work'], range = OCT, now = NOW) {
  const query: CalendarQuery = { ...range, workspaces, layers }
  const answer = await calendarEntries(query, now)
  if (!answer.ok) throw new Error(answer.reason)
  return answer.value
}

describe('due cards and tasks', () => {
  it('shows what is due in range, in the workspaces asked for, whole days and moments alike', async () => {
    make({ title: 'Report', due_at: allDay({ year: 2026, month: 9, day: 14 }) })
    make({ title: 'Call', type: 'card', status: 'todo', due_at: new Date(2026, 9, 15, 10).getTime() })
    make({ title: 'Elsewhere', context: 'home', due_at: allDay({ year: 2026, month: 9, day: 14 }) })
    make({ title: 'Put away', status: 'archived', due_at: allDay({ year: 2026, month: 9, day: 14 }) })
    make({ title: 'Next month', due_at: allDay({ year: 2026, month: 11, day: 1 }) })

    const { entries: found } = await entries(['due'])
    expect(found.map(e => [e.title, e.allDay, e.movable])).toStrictEqual([['Report', true, true], ['Call', false, true]])
    expect((await entries(['due'], null)).entries.map(e => e.title).sort()).toStrictEqual(['Call', 'Elsewhere', 'Report'])
  })

  it('marks finished ones done, and brings in late open ones from before the range while today is on screen', async () => {
    make({ title: 'Done', status: 'done', due_at: allDay({ year: 2026, month: 9, day: 3 }) })
    make({ title: 'Forgotten', due_at: allDay({ year: 2026, month: 8, day: 1 }) })
    make({ title: 'Finished late', status: 'done', due_at: allDay({ year: 2026, month: 8, day: 2 }) })

    const states = (await entries(['due'])).entries.map(e => [e.title, e.state])
    expect(states).toStrictEqual([['Forgotten', 'late'], ['Done', 'done']])
    // a range without today leaves the old ones in their own months
    const november = { from: new Date(2026, 10, 1).getTime(), to: new Date(2026, 11, 1).getTime() }
    expect((await entries(['due'], ['work'], november)).entries).toStrictEqual([])
  })
})

describe('the other layers', () => {
  it('projects a repeat\'s coming occurrences as ghosts that can\'t be dragged', async () => {
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    tomorrow.setHours(9, 0, 0, 0)
    createRecurrence({ context: 'work', title: 'Standup', rule: { freq: 'daily', startAt: tomorrow.getTime() } })
    const week = { from: tomorrow.getTime() - 3_600_000, to: tomorrow.getTime() + 7 * 86_400_000 - 3_600_000 }
    // a day of padding each side keeps whole days near midnight; the screen only draws the days it shows
    const ghosts = (await entries(['repeats'], ['work'], week, Date.now())).entries.filter(g => g.start >= week.from && g.start < week.to)
    expect(ghosts).toHaveLength(7)
    expect(ghosts.every(g => g.state === 'ghost' && !g.movable && g.ref.kind === 'recurrence')).toBe(true)
  })

  it('shows when a renewal expires and when its warnings start', async () => {
    const created = createRenewal({ context: 'work', title: 'acme.dev', meta: { kind: 'domain', expiresAt: allDay({ year: 2026, month: 9, day: 28 }), warnAt: [7] } })
    expect(created.ok).toBe(true)
    const found = (await entries(['renewals'])).entries
    expect(found.map(e => [e.title, e.state])).toStrictEqual([['acme.dev warnings start', 'warning'], ['acme.dev', null]])
    expect(new Date(found[0].start).getDate()).toBe(21)
  })

  it('draws focus sessions as the time they took, and log entries by when they were written', async () => {
    const end = new Date(2026, 9, 12, 11).getTime()
    getDb().prepare("INSERT INTO focus_sessions (id, context, duration_ms, completed_at, notes, tasks_json) VALUES ('f1', 'work', ?, ?, 'Deep work\nmore', '[]')")
      .run(25 * 60_000, end)
    const [session] = (await entries(['focus'])).entries
    expect(session).toMatchObject({ title: 'Deep work', start: end - 25 * 60_000, end, allDay: false })

    const log = make({ type: 'log', title: 'Shipped the fix' })
    const today = { from: Date.now() - 86_400_000, to: Date.now() + 86_400_000 }
    expect((await entries(['log'], ['work'], today, Date.now())).entries.map(e => e.ref)).toStrictEqual([{ kind: 'item', id: log.id }])
  })

  it('keeps drawing the other layers when one fails, and says which', async () => {
    make({ title: 'Report', due_at: allDay({ year: 2026, month: 9, day: 14 }) })
    getDb().exec('DROP TABLE focus_sessions')
    const answer = await entries(['due', 'focus'])
    expect(answer.entries.map(e => e.title)).toStrictEqual(['Report'])
    expect(answer.problems.map(p => p.layer)).toStrictEqual(['focus'])
  })

  it('refuses a range nobody could be looking at', async () => {
    expect(await calendarEntries({ from: 10, to: 5, workspaces: null, layers: ['due'] })).toMatchObject({ ok: false })
    expect(await calendarEntries({ from: 0, to: 10 * 365 * 86_400_000, workspaces: null, layers: ['due'] })).toMatchObject({ ok: false })
  })
})

describe('commits', () => {
  it('reads git\'s log into entries and says when a repository is missing or unreadable', async () => {
    const git = async (args: string[]) => {
      if (args[1] === 'broken') throw new Error('fatal: not a git repository')
      return 'abc123full\tabc123\tDimitrios\t1791700000\tFix the parser\nbad line'
    }
    const got = await commitEntries(OCT, [{ workspace: 'work', path: dir }, { workspace: 'home', path: join(dir, 'nowhere') }], git)
    expect(got.entries).toMatchObject([{ title: 'Fix the parser', start: 1791700000 * 1000, detail: 'Dimitrios abc123', ref: { kind: 'commit', workspace: 'work', hash: 'abc123full' } }])
    expect(got.problems).toStrictEqual([`The repository for home is not at ${join(dir, 'nowhere')} any more.`])
  })
})

describe('changing things from the calendar', () => {
  it('moves only the due date, through the board\'s own write, and reports the old one for undo', () => {
    const task = make({ title: 'Report', due_at: allDay({ year: 2026, month: 9, day: 14 }) })
    const moved = moveDue(task.id, allDay({ year: 2026, month: 9, day: 20 }))
    expect(moved).toMatchObject({ ok: true, value: { previous: allDay({ year: 2026, month: 9, day: 14 }) } })
    expect(getItemById(task.id)).toMatchObject({ due_at: allDay({ year: 2026, month: 9, day: 20 }), context: 'work', status: 'open' })
  })

  it('can\'t pick up a date that belongs to a connected service, and says why', async () => {
    const lock = 'This task repeats in Todoist (every monday), so change its date there.'
    const card = make({ title: 'Water plants', type: 'card', status: 'todo', due_at: allDay({ year: 2026, month: 9, day: 12 }), metadata: JSON.stringify({ dueLocked: lock }) })
    const { entries: found } = await entries(['due'])
    expect(found.find(e => e.title === 'Water plants')).toMatchObject({ movable: false, locked: lock })
    expect(moveDue(card.id, allDay({ year: 2026, month: 9, day: 20 }))).toStrictEqual({ ok: false, reason: lock })
    expect(getItemById(card.id)?.due_at).toBe(allDay({ year: 2026, month: 9, day: 12 }))
  })

  it('refuses to move a log entry, something put away, or a nonsense date', () => {
    const log = make({ type: 'log', title: 'Note' })
    const away = make({ title: 'Old', status: 'archived', due_at: 1 })
    const task = make({ title: 'Report', due_at: allDay({ year: 2026, month: 9, day: 14 }) })
    expect(moveDue(log.id, allDay({ year: 2026, month: 9, day: 20 }))).toMatchObject({ ok: false })
    expect(moveDue(away.id, allDay({ year: 2026, month: 9, day: 20 }))).toMatchObject({ ok: false })
    expect(moveDue(task.id, Number.NaN)).toMatchObject({ ok: false })
  })

  it('adds a task as open, and a card into its board\'s first column', () => {
    setSetting(boardConfigKey('work'), { columns: [{ id: 'backlog', name: 'Backlog' }, { id: 'done', name: 'Done' }] })
    const due = allDay({ year: 2026, month: 9, day: 22 })
    const task = quickAdd({ context: 'work', type: 'task', title: '  Pay invoice ', due })
    const card = quickAdd({ context: 'work', type: 'card', title: 'Plan', due })
    expect(task).toMatchObject({ ok: true, value: { title: 'Pay invoice', status: 'open', due_at: due } })
    expect(card).toMatchObject({ ok: true, value: { type: 'card', status: 'backlog' } })
    expect(quickAdd({ context: 'work', type: 'task', title: ' ', due })).toMatchObject({ ok: false })
    expect(defined(getItemById(card.ok ? card.value.id : '')).due_at).toBe(due)
  })
})
