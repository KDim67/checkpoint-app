import { describe, expect, it } from 'vitest'
import { allDay, moment } from '../src/shared/dueDate'
import {
  AHEAD_DAYS,
  focusShare,
  formatFocus,
  laneLabel,
  laneOf,
  PAST_DAYS,
  spokenFocus,
  STRIP_DAYS,
  weekBegan,
  type DatedItem,
  type WorkspaceActivity
} from '../src/shared/workspaceLanes'

// a lane's days around today, in local time: what's late, what's due, where focus went

// mid-afternoon, local time, so the tests mean the same in every timezone
const NOW = new Date(2026, 9, 14, 15, 0).getTime()
const at = (dayOffset: number, hour: number, minute = 0): number => new Date(2026, 9, 14 + dayOffset, hour, minute).getTime()
const wholeDay = (dayOffset: number): number => {
  const d = new Date(2026, 9, 14 + dayOffset)
  return allDay({ year: d.getFullYear(), month: d.getMonth(), day: d.getDate() })
}
const item = (id: string, due: number): DatedItem => ({ id, type: 'task', title: id, due })
const activity = (patch: Partial<WorkspaceActivity>): WorkspaceActivity => ({ open: 0, dated: [], focus: [], lastChanged: null, ...patch })
const dueOn = (lane: ReturnType<typeof laneOf>, offset: number) => lane.days[offset + PAST_DAYS].due

describe('the days a lane covers', () => {
  it('runs from two weeks back to nearly two ahead, with today in the middle', () => {
    const lane = laneOf(undefined, NOW, 1)
    expect(lane.days).toHaveLength(STRIP_DAYS)
    expect(lane.days[0]).toMatchObject({ offset: -PAST_DAYS, day: { year: 2026, month: 8, day: 30 } })
    expect(lane.days[PAST_DAYS]).toMatchObject({ offset: 0, day: { year: 2026, month: 9, day: 14 } })
    expect(lane.days[STRIP_DAYS - 1]).toMatchObject({ offset: AHEAD_DAYS, day: { year: 2026, month: 9, day: 27 } })
  })

  it('is empty, not broken, for a workspace with nothing recorded', () => {
    const lane = laneOf(undefined, NOW, 1)
    expect(lane).toMatchObject({ open: 0, late: 0, dueToday: 0, olderLate: 0, focusWeekMs: 0, lastChanged: null })
    expect(lane.days.every(day => day.focusMs === 0 && day.due.length === 0)).toBe(true)
  })
})

describe('what is late and what is due', () => {
  it('keeps a whole day on time until it is over, counting it as due today', () => {
    const lane = laneOf(activity({ open: 1, dated: [item('report', wholeDay(0))] }), NOW, 1)
    expect(dueOn(lane, 0)).toEqual([{ id: 'report', type: 'task', title: 'report', late: false }])
    expect(lane).toMatchObject({ late: 0, dueToday: 1 })
  })

  it('makes a time earlier today late, in today, and not also due today', () => {
    const lane = laneOf(activity({ open: 1, dated: [item('standup', moment(new Date(at(0, 9, 30))))] }), NOW, 1)
    expect(dueOn(lane, 0)).toEqual([expect.objectContaining({ id: 'standup', late: true })])
    expect(lane).toMatchObject({ late: 1, dueToday: 0 })
  })

  it('puts a late item on the day it was due, and one beyond the strip in the older count', () => {
    const lane = laneOf(activity({ open: 2, dated: [item('yesterday', wholeDay(-1)), item('ages ago', wholeDay(-20))] }), NOW, 1)
    expect(dueOn(lane, -1)).toEqual([expect.objectContaining({ id: 'yesterday', late: true })])
    expect(lane.olderLate).toBe(1)
    expect(lane.late).toBe(2)
    expect(lane.days.flatMap(day => day.due).map(due => due.id)).not.toContain('ages ago')
  })

  it('shows the last day ahead and leaves out anything past it', () => {
    const lane = laneOf(activity({ open: 2, dated: [item('edge', wholeDay(AHEAD_DAYS)), item('later', wholeDay(AHEAD_DAYS + 1))] }), NOW, 1)
    expect(dueOn(lane, AHEAD_DAYS).map(due => due.id)).toEqual(['edge'])
    expect(lane.days.flatMap(day => day.due).map(due => due.id)).not.toContain('later')
    expect(lane.open).toBe(2)
  })

  it('puts an evening time on its own local day', () => {
    const lane = laneOf(activity({ dated: [item('evening', moment(new Date(at(2, 23, 30))))] }), NOW, 1)
    expect(dueOn(lane, 2).map(due => due.id)).toEqual(['evening'])
  })
})

describe('where focus went', () => {
  it('adds each session to the local day it ended on, and ignores ones before the strip or still to come', () => {
    const lane = laneOf(activity({
      focus: [
        { at: at(-2, 23, 30), ms: 25 * 60_000 },
        { at: at(-2, 10), ms: 50 * 60_000 },
        { at: at(0, 11), ms: 30 * 60_000 },
        { at: at(-15, 12), ms: 60 * 60_000 },
        { at: at(1, 9), ms: 60 * 60_000 }
      ]
    }), NOW, 1)
    expect(lane.days[PAST_DAYS - 2].focusMs).toBe(75 * 60_000)
    expect(lane.days[PAST_DAYS].focusMs).toBe(30 * 60_000)
    expect(lane.days.reduce((sum, day) => sum + day.focusMs, 0)).toBe(105 * 60_000)
  })

  it('counts this week from the day the week starts where you are', () => {
    const today = new Date(NOW).getDay()
    const yesterday = (today + 6) % 7
    const focus = [{ at: at(-1, 12), ms: 40 * 60_000 }, { at: at(0, 12), ms: 20 * 60_000 }]
    // a week that began yesterday holds both; one that begins today holds only today's
    expect(laneOf(activity({ focus }), NOW, yesterday).focusWeekMs).toBe(60 * 60_000)
    expect(laneOf(activity({ focus }), NOW, today).focusWeekMs).toBe(20 * 60_000)
    expect(weekBegan(NOW, today)).toBe(new Date(2026, 9, 14).getTime())
  })
})

describe('saying it', () => {
  it('writes focus short for the screen and in words for a screen reader', () => {
    expect([0, 45, 120, 400].map(min => formatFocus(min * 60_000))).toEqual(['0m', '45m', '2h', '6h 40m'])
    expect([0, 1, 45, 60, 400].map(min => spokenFocus(min * 60_000))).toEqual(['no focus time', '1 minute', '45 minutes', '1 hour', '6 hours 40 minutes'])
  })

  it('scales every bar against the same full height', () => {
    expect(focusShare(0)).toBe(0)
    expect(focusShare(90 * 60_000)).toBe(0.5)
    expect(focusShare(10 * 60 * 60_000)).toBe(1)
  })

  it('names everything the strip shows, since the strip is hidden from screen readers', () => {
    const lane = laneOf(activity({ open: 14, dated: [item('a', wholeDay(-1)), item('b', wholeDay(0))], focus: [{ at: at(0, 11), ms: 400 * 60_000 }] }), NOW, new Date(NOW).getDay())
    expect(laneLabel('Checkpoint', lane, { current: true, shared: true }))
      .toBe('Checkpoint, current workspace, shared, 14 open, 1 late, 1 due today, 6 hours 40 minutes this week')
    expect(laneLabel('Personal', laneOf(undefined, NOW, 1), { current: false, shared: false })).toBe('Personal, nothing open, no focus time this week')
  })
})
