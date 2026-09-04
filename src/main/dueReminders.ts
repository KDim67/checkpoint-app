/**
 * Reminders for work that has reached its due date. `due_at` was stored and
 * displayed from the start with nothing ever firing on it, which made the field
 * look like a promise the app did not keep.
 *
 * Goes through the shared notification layer, so it obeys quiet hours and says
 * each thing once. In main, because a reminder needing the app focused to fire
 * is not a reminder.
 */

import { getDb } from './db'
import { notify } from './notificationService'

const CHECK_INTERVAL_MS = 15 * 60 * 1000
const STARTUP_DELAY_MS = 12_000

/** One reminder per item per day: enough to be useful, not enough to nag. */
const DEDUPE_WINDOW_MS = 20 * 60 * 60 * 1000

/** How far back to look. Older overdue work is a backlog problem, not news. */
const LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000

let timer: NodeJS.Timeout | null = null
let startupTimer: NodeJS.Timeout | null = null

interface DueRow {
  id: string
  title: string
  context: string
  due_at: number
  status: string
}

/**
 * Notifies about everything due. Returns how many reminders fired.
 *
 * The query deliberately excludes finished work and anything overdue by more
 * than a week. On first run after this ships, a database with months of stale
 * due dates would otherwise produce a wall of notifications at once.
 */
export function checkDueItems(now = Date.now()): number {
  let fired = 0
  try {
    const rows = getDb()
      .prepare(
        `SELECT id, title, context, due_at, status
         FROM items
         WHERE due_at IS NOT NULL
           AND due_at <= ?
           AND due_at >= ?
           AND status NOT IN ('done', 'archived')
         ORDER BY due_at`
      )
      .all(now, now - LOOKBACK_MS) as DueRow[]

    for (const row of rows) {
      const overdueMs = now - row.due_at
      const overdueDays = Math.floor(overdueMs / 86_400_000)
      const body =
        overdueDays >= 1
          ? `${overdueDays} day${overdueDays === 1 ? '' : 's'} overdue · ${row.context}`
          : `Due now · ${row.context}`

      const delivered = notify({
        category: 'due',
        title: row.title || 'Untitled',
        body,
        // Keyed by item, so an item still open tomorrow is mentioned again then
        // rather than every fifteen minutes today.
        dedupeKey: `due:${row.id}`,
        dedupeWindowMs: DEDUPE_WINDOW_MS,
        itemId: row.id,
        now
      })
      if (delivered) fired++
    }
  } catch (err) {
    console.error('[due] Check failed:', err)
  }
  return fired
}

export function initializeDueReminders(): void {
  shutdownDueReminders()
  startupTimer = setTimeout(() => {
    startupTimer = null
    checkDueItems()
  }, STARTUP_DELAY_MS)
  timer = setInterval(() => checkDueItems(), CHECK_INTERVAL_MS)
}

export function shutdownDueReminders(): void {
  if (timer) { clearInterval(timer); timer = null }
  if (startupTimer) { clearTimeout(startupTimer); startupTimer = null }
}
