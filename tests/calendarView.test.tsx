// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { CalendarEntry, CalendarQuery } from '../src/shared/calendar'

/** a main process that answers with whatever the test put on the calendar */
const fake = vi.hoisted(() => ({
  entries: [] as CalendarEntry[],
  queries: [] as CalendarQuery[],
  added: [] as unknown[],
  moved: [] as [string, number][]
}))

vi.mock('../src/renderer/src/data/calendar', () => {
  const ok = <T,>(value: T) => ({ ok: true as const, value })
  return {
    entries: vi.fn(async (query: CalendarQuery) => {
      fake.queries.push(query)
      return ok({ entries: [...fake.entries], problems: [] })
    }),
    move: vi.fn(async (id: string, due: number) => {
      fake.moved.push([id, due])
      return ok({ item: { id }, previous: null })
    }),
    quickAdd: vi.fn(async (input: { title: string }) => {
      fake.added.push(input)
      return ok({ id: 'new', title: input.title })
    }),
    subscriptions: vi.fn(async () => ok([])),
    refresh: vi.fn(async () => ok(false)),
    onChanged: () => () => {}
  }
})
vi.mock('../src/renderer/src/lib/settings', () => ({
  getEnumSetting: vi.fn(async (_k: string, _allowed: string[], fallback: string) => fallback),
  getJsonSetting: vi.fn(async (_k: string, fallback: unknown) => fallback),
  getBoolSetting: vi.fn(async (_k: string, fallback: boolean) => fallback),
  setStringSetting: vi.fn(async () => {}),
  setJsonSetting: vi.fn(async () => {}),
  setBoolSetting: vi.fn(async () => {})
}))

import CalendarView from '../src/renderer/src/components/CalendarView'
import { ToastProvider } from '../src/renderer/src/components/ui/Toast'
import { useAppStore } from '../src/renderer/src/store/appStore'
import { allDay, localDayOf } from '../src/shared/dueDate'
import { CALENDAR_NUDGE_SETTLE_MS } from '../src/renderer/src/lib/timings'

const today = localDayOf(Date.now())
const label = (d: { year: number; month: number; day: number }): string =>
  new Date(d.year, d.month, d.day).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })

const due = (title: string, start: number, extra: Partial<CalendarEntry> = {}): CalendarEntry => ({
  id: `item:${title}`, layer: 'due', title, start, end: null, allDay: true, days: 1, workspace: 'work', color: null,
  movable: true, state: 'open', ref: { kind: 'item', id: title }, detail: 'Task', ...extra
})

async function show(): Promise<void> {
  await act(async () => {
    render(<ToastProvider><CalendarView /></ToastProvider>)
  })
}

beforeEach(() => {
  fake.entries = []
  fake.queries = []
  fake.added = []
  fake.moved = []
  useAppStore.setState({
    activeWorkspace: 'work',
    availableWorkspaces: ['work', 'home'],
    workspaceList: [{ slug: 'work', name: 'Work', color: '#1e45fc' }, { slug: 'home', name: 'Home', color: '#10b981' }]
  })
})
afterEach(cleanup)

describe('the Calendar screen', () => {
  it('opens on this month, asks for the current workspace only, and puts each entry on its day', async () => {
    fake.entries = [due('Ship the report', allDay(today))]
    await show()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(new Date().toLocaleDateString(undefined, { month: 'long', year: 'numeric' }))
    expect(fake.queries.at(-1)?.workspaces).toStrictEqual(['work'])
    const cell = screen.getByRole('gridcell', { name: label(today) })
    expect(within(cell).getByRole('button', { name: /^Ship the report/ })).toBeTruthy()
  })

  it('asks for every workspace once that is switched on', async () => {
    await show()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'All workspaces' })) })
    expect(fake.queries.at(-1)?.workspaces).toBeNull()
  })

  it('adds a task due on the day that was clicked', async () => {
    await show()
    await act(async () => { fireEvent.click(screen.getByRole('gridcell', { name: label(today) })) })
    const dialog = screen.getByRole('dialog', { name: 'Add to the calendar' })
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Title' }), { target: { value: 'Pay the invoice' } })
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Add' })) })
    expect(fake.added).toStrictEqual([{ title: 'Pay the invoice', type: 'task', context: 'work', due: allDay(today) }])
  })

  it('switches views from the keyboard, the way calendars usually do', async () => {
    await show()
    await act(async () => { fireEvent.keyDown(window, { key: 'w' }) })
    expect(screen.getByRole('grid', { name: 'Week' })).toBeTruthy()
    await act(async () => { fireEvent.keyDown(window, { key: 'a' }) })
    expect(screen.queryByRole('grid')).toBeNull()
  })

  it('shows a late item on today as well, marked late', async () => {
    const weekAgo = new Date(today.year, today.month, today.day - 7)
    fake.entries = [due('Overdue form', allDay(localDayOf(weekAgo.getTime())), { state: 'late' })]
    await show()
    const cell = screen.getByRole('gridcell', { name: label(today) })
    expect(within(cell).getByRole('button', { name: /^Overdue form.*late$/ })).toBeTruthy()
  })

  // mid-month, so a couple of days either way stay on the page whatever today is
  const tenth = { year: today.year, month: today.month, day: 10 }

  it('draws an event over several days as a bar, not a chip on every day', async () => {
    fake.entries = [due('Trip', allDay(tenth), { id: 'event:trip', layer: 'events', days: 3, movable: false, ref: { kind: 'event', calendarId: 'c', uid: 'u' } })]
    await show()
    const bars = screen.getAllByRole('button', { name: /^Trip/ })
    expect(bars.length).toBeLessThan(3)
    expect(bars.some(b => Number(b.dataset.span) >= 2)).toBe(true)
  })

  it('says on hover why a date that belongs to a connected service can\'t be picked up, and leaves it where it is', async () => {
    const lock = 'This task repeats in Todoist (every monday), so change its date there.'
    fake.entries = [due('Water plants', allDay(tenth), { movable: false, locked: lock })]
    await show()
    const chip = screen.getByRole('button', { name: /^Water plants/ })
    expect(chip.getAttribute('title')).toContain(lock)
    expect(chip.getAttribute('draggable')).toBe('false')
    await act(async () => { fireEvent.keyDown(chip, { key: 'ArrowRight', altKey: true }) })
    expect(within(screen.getByRole('gridcell', { name: label(tenth) })).getByRole('button', { name: /^Water plants/ })).toBeTruthy()
    expect(fake.moved).toStrictEqual([])
  })

  it('moves a due date with Alt and the arrow keys, as one move once the presses stop, and keeps focus on it', async () => {
    fake.entries = [due('Ship the report', allDay(tenth))]
    await show()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const chip = () => screen.getByRole('button', { name: /^Ship the report/ })
      chip().focus()
      await act(async () => { fireEvent.keyDown(chip(), { key: 'ArrowRight', altKey: true }) })
      await act(async () => { fireEvent.keyDown(chip(), { key: 'ArrowRight', altKey: true }) })
      expect(within(screen.getByRole('gridcell', { name: label({ ...tenth, day: 12 }) })).getByRole('button', { name: /^Ship the report/ })).toBe(document.activeElement)
      expect(fake.moved).toStrictEqual([])
      await act(async () => { vi.advanceTimersByTime(CALENDAR_NUDGE_SETTLE_MS) })
      expect(fake.moved).toStrictEqual([['Ship the report', allDay({ ...tenth, day: 12 })]])
    } finally {
      vi.useRealTimers()
    }
  })
})
