/** one open instance per rule, so an ignored daily task makes one card; hourly sweep is fine, it's not a reminder */

import { v4 as uuidv4 } from 'uuid'
import {
  createItem,
  getDb,
  getDueRecurrences,
  getRecurrenceById,
  hasOpenRecurrenceInstance,
  insertRecurrence,
  setRecurrenceNextDue,
  type RecurrenceRow
} from './db'
import { nextOccurrence, normalizeRule, type RecurrenceRule } from '../shared/recurrence'
import type { CreateItemPayload, Item } from '../shared/types'

const CHECK_INTERVAL_MS = 60 * 60 * 1000
const STARTUP_DELAY_MS = 8000

let timer: NodeJS.Timeout | null = null
let startupTimer: NodeJS.Timeout | null = null
let onSpawned: (() => void) | null = null

export function setRecurrenceSpawnHandler(handler: (() => void) | null): void {
  onSpawned = handler
}

export function ruleFromRow(row: RecurrenceRow): RecurrenceRule | null {
  let byWeekday: unknown = []
  try {
    byWeekday = JSON.parse(row.by_weekday || '[]')
  } catch {
    byWeekday = []
  }
  return normalizeRule({
    freq: row.freq,
    interval: row.interval,
    byWeekday,
    startAt: row.start_at,
    untilAt: row.until_at
  })
}

interface CreateRecurrenceInput {
  context: string
  title: string
  body?: string
  type?: 'card' | 'task'
  status?: string
  priority?: number
  rule: unknown
}

/** null for rules it can't parse, better than firing at an unpredictable time */
export function createRecurrence(input: CreateRecurrenceInput): RecurrenceRow | null {
  const rule = normalizeRule(input.rule)
  if (!rule || !input.title.trim()) return null

  const now = Date.now()
  // past start is due now, not backfilled; closed window stored inactive
  const nextDue =
    rule.startAt > now
      ? rule.startAt
      : rule.untilAt !== null && now > rule.untilAt
        ? null
        : now

  const row: RecurrenceRow = {
    id: uuidv4(),
    context: input.context,
    type: input.type ?? 'task',
    title: input.title.trim(),
    body: input.body ?? '',
    status: input.status ?? 'open',
    priority: input.priority ?? 2,
    freq: rule.freq,
    interval: rule.interval,
    by_weekday: JSON.stringify(rule.byWeekday),
    start_at: rule.startAt,
    until_at: rule.untilAt,
    next_due: nextDue,
    active: nextDue === null ? 0 : 1,
    created_at: now
  }
  insertRecurrence(row)
  return row
}

function spawn(row: RecurrenceRow, now: number): Item | null {
  const rule = ruleFromRow(row)
  if (!rule) {
    // deactivate unreadable rules instead of retrying hourly
    console.error(`[recurrence] Rule ${row.id} is unusable; deactivating.`)
    setRecurrenceNextDue(row.id, null)
    return null
  }

  // checked here, not in the query, so a rule with an open instance still advances next_due
  if (hasOpenRecurrenceInstance(row.id)) return null

  const payload: CreateItemPayload = {
    type: row.type as Item['type'],
    context: row.context,
    title: row.title,
    body: row.body,
    status: row.status,
    priority: row.priority as Item['priority'],
    position: now,
    due_at: row.next_due,
    // lets hasOpenRecurrenceInstance and the UI find the rule
    metadata: JSON.stringify({ recurrenceId: row.id })
  }

  const created = createItem(getDb(), payload)
  const next = nextOccurrence(rule, row.next_due ?? now)
  setRecurrenceNextDue(row.id, next)
  return created
}

/** safe anytime: open instances skip, each rule advances one occurrence per sweep */
export function materialiseDueRecurrences(now = Date.now()): number {
  let created = 0
  try {
    for (const row of getDueRecurrences(now)) {
      if (spawn(row, now)) created++
    }
  } catch (err) {
    console.error('[recurrence] Sweep failed:', err)
  }
  if (created > 0) {
    try {
      onSpawned?.()
    } catch (err) {
      console.error('[recurrence] Could not notify renderer:', err)
    }
  }
  return created
}

/** only when overdue: the sweep doesn't advance past an open instance, so the replacement shows at once */
export function onInstanceClosed(recurrenceId: string, now = Date.now()): void {
  const row = getRecurrenceById(recurrenceId)
  if (!row || row.active !== 1) return
  if (row.next_due !== null && row.next_due <= now) {
    if (spawn(row, now)) onSpawned?.()
  }
}

export function initializeRecurrenceScheduler(): void {
  shutdownRecurrenceScheduler()
  startupTimer = setTimeout(() => {
    startupTimer = null
    materialiseDueRecurrences()
  }, STARTUP_DELAY_MS)
  timer = setInterval(() => materialiseDueRecurrences(), CHECK_INTERVAL_MS)
}

function shutdownRecurrenceScheduler(): void {
  if (timer) { clearInterval(timer); timer = null }
  if (startupTimer) { clearTimeout(startupTimer); startupTimer = null }
}
