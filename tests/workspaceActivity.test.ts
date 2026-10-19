import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDb, getDb, initDb } from '../src/main/db'
import { workspaceActivity } from '../src/main/db/workspaceActivity'
import { DAY_MS } from '../src/shared/dueDate'

// what main reads for the lanes, straight from a real database

const NOW = new Date(2026, 9, 14, 15, 0).getTime()
let dir = ''

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'checkpoint-activity-'))
  initDb(dir)
})
afterEach(() => {
  closeDb()
  rmSync(dir, { recursive: true, force: true })
})

let counter = 0
function addItem(fields: { context: string; type?: string; title?: string; body?: string; status?: string; due?: number | null; updated?: number }): string {
  const id = `item-${++counter}`
  getDb().prepare(
    `INSERT INTO items (id, type, context, title, body, status, created_at, updated_at, due_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, fields.type ?? 'task', fields.context, fields.title ?? id, fields.body ?? '', fields.status ?? 'open', NOW - DAY_MS, fields.updated ?? NOW - DAY_MS, fields.due ?? null)
  return id
}
function addFocus(context: string, at: number, minutes: number): void {
  getDb().prepare(`INSERT INTO focus_sessions (id, context, duration_ms, completed_at) VALUES (?, ?, ?, ?)`).run(`focus-${++counter}`, context, minutes * 60_000, at)
}

describe('what main reads for each lane', () => {
  it('counts open cards and tasks the way the tray does, leaving out done, archived and log entries', () => {
    addItem({ context: 'work', type: 'card' })
    addItem({ context: 'work', type: 'task', status: 'in-progress' })
    addItem({ context: 'work', status: 'done' })
    addItem({ context: 'work', status: 'archived' })
    addItem({ context: 'work', type: 'log' })
    addItem({ context: 'home' })
    const activity = workspaceActivity(getDb(), NOW)
    expect(activity.work.open).toBe(2)
    expect(activity.home.open).toBe(1)
  })

  it('sends every late date and the ones ahead in the strip, oldest first, and nothing further out', () => {
    const ancient = addItem({ context: 'work', due: NOW - 90 * DAY_MS })
    const soon = addItem({ context: 'work', due: NOW + 3 * DAY_MS })
    addItem({ context: 'work', due: NOW + 40 * DAY_MS })
    addItem({ context: 'work', due: NOW - DAY_MS, status: 'done' })
    addItem({ context: 'work', due: null })
    expect(workspaceActivity(getDb(), NOW).work.dated.map(item => item.id)).toEqual([ancient, soon])
  })

  it('sends focus from just before the strip on, with when it ended and how long it ran', () => {
    addFocus('work', NOW - 2 * DAY_MS, 25)
    addFocus('work', NOW - 30 * DAY_MS, 50)
    expect(workspaceActivity(getDb(), NOW).work.focus).toEqual([{ at: NOW - 2 * DAY_MS, ms: 25 * 60_000 }])
  })

  it('names the last thing changed in each workspace, a log entry by its first line when it has no title', () => {
    addItem({ context: 'work', title: 'older card', type: 'card', updated: NOW - 3 * DAY_MS })
    const latest = addItem({ context: 'work', type: 'log', title: '', body: '\n  Fixed the sync bug  \nmore detail', updated: NOW - 60_000 })
    addItem({ context: 'work', title: 'finished one', status: 'done', updated: NOW - 2 * DAY_MS })
    expect(workspaceActivity(getDb(), NOW).work.lastChanged).toEqual({ id: latest, type: 'log', title: 'Fixed the sync bug', at: NOW - 60_000 })
  })

  it('cuts a very long title to a tooltip line', () => {
    addItem({ context: 'work', title: 'x'.repeat(500), due: NOW + DAY_MS })
    const activity = workspaceActivity(getDb(), NOW)
    expect(activity.work.dated[0].title).toHaveLength(120)
    expect(activity.work.lastChanged?.title).toHaveLength(120)
  })

  it('has no entry for a workspace with nothing in it, which the page shows as an empty lane', () => {
    expect(workspaceActivity(getDb(), NOW)).toEqual({})
  })
})
