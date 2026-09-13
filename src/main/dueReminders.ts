/** due_at never fired before; in main so it works unfocused, via the shared layer for quiet hours */

import { getDb } from './db'
import { notify } from './notificationService'
import { emitPluginEvent } from './pluginEvents'

const CHECK_INTERVAL_MS = 15 * 60 * 1000
const STARTUP_DELAY_MS = 12_000

/** once per item per day, useful not naggy */
const DEDUPE_WINDOW_MS = 20 * 60 * 60 * 1000

/** older overdue work is backlog, not news */
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

/** skips finished and week-old overdue work, or first run floods months of stale dates */
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
        // keyed by item so it repeats tomorrow, not every fifteen minutes
        dedupeKey: `due:${row.id}`,
        dedupeWindowMs: DEDUPE_WINDOW_MS,
        itemId: row.id,
        now
      })
      if (delivered) {
        fired++
        emitPluginEvent('due:reminded', { itemId: row.id, title: row.title || 'Untitled' })
      }
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

function shutdownDueReminders(): void {
  if (timer) { clearInterval(timer); timer = null }
  if (startupTimer) { clearTimeout(startupTimer); startupTimer = null }
}
