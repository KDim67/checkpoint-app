/**
 * Materialises recurring work into real items. At most one unfinished instance
 * per recurrence, so a daily task left for a month gives one card, not thirty.
 *
 * Scheduled like backups (see backupVault.initializeBackupScheduler): a sweep at
 * startup, then hourly. A recurrence is not a reminder, so an hour late is fine.
 */

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

/** Reassembles the rule from its stored columns. */
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

/**
 * Stores a new recurrence and works out when it should first fire.
 *
 * Returns null when the rule cannot be understood. Better than accepting it and
 * producing work at an unpredictable time.
 */
export function createRecurrence(input: CreateRecurrenceInput): RecurrenceRow | null {
  const rule = normalizeRule(input.rule)
  if (!rule || !input.title.trim()) return null

  const now = Date.now()
  // A rule starting in the future waits for that moment. One whose start has
  // already passed is due immediately, not at its next future occurrence, which
  // would mean creating a daily task today and seeing nothing until tomorrow,
  // and not backfilled, which would spawn every occurrence it ever missed.
  // A rule whose window has already closed is stored inactive.
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

/** Creates the item for one occurrence and advances the rule. */
function spawn(row: RecurrenceRow, now: number): Item | null {
  const rule = ruleFromRow(row)
  if (!rule) {
    // An unreadable rule is deactivated rather than retried every hour.
    console.error(`[recurrence] Rule ${row.id} is unusable; deactivating.`)
    setRecurrenceNextDue(row.id, null)
    return null
  }

  // The guard that bounds the table. Checked here rather than in the query so a
  // rule whose instance is still open still gets its next_due advanced below.
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
    // Stamped so hasOpenRecurrenceInstance can find it, and so the UI can show
    // an item as belonging to a rule.
    metadata: JSON.stringify({ recurrenceId: row.id })
  }

  const created = createItem(getDb(), payload)
  const next = nextOccurrence(rule, row.next_due ?? now)
  setRecurrenceNextDue(row.id, next)
  return created
}

/**
 * Creates every occurrence that has come due. Returns how many were made.
 *
 * Safe to call at any time: rules with an instance still open are skipped, and
 * each rule advances by exactly one occurrence per sweep.
 */
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

/**
 * Advances a rule whose instance was just completed, but only when it is
 * already overdue. The sweep skips an open instance without advancing next_due,
 * so a daily task ignored since Monday is still due Tuesday when ticked off on
 * Thursday, and its replacement should appear at once.
 *
 * Completing one that is merely on schedule creates nothing.
 */
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
