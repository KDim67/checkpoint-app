/**
 * Recurrence rules and the date maths behind them.
 *
 * The materialisation strategy is the important decision here, so it is worth
 * stating: a recurrence is a **template**, and at most **one unfinished instance
 * exists at a time**. When that instance is completed or its due date passes,
 * the next one is created. Generating a year of occurrences up front would grow
 * the items table without bound and fill the board with work that is not due
 * yet; rescheduling a single row instead would lose the history of having done
 * it eight times. One-at-a-time keeps both properties.
 *
 * All arithmetic is in local time, deliberately. "Every Tuesday at 9am" means
 * 9am where the user is, and must keep meaning that across a daylight-saving
 * change, which fixed millisecond offsets do not survive.
 */

export type Frequency = 'daily' | 'weekly' | 'monthly'

export interface RecurrenceRule {
  freq: Frequency
  /** Every N days/weeks/months. Always at least 1. */
  interval: number
  /** For weekly rules: 0 = Sunday … 6 = Saturday. Empty means "same weekday as the start". */
  byWeekday: number[]
  /** First occurrence, and the anchor for the time of day and day of month. */
  startAt: number
  /** Inclusive end. Null means it repeats indefinitely. */
  untilAt: number | null
}

export const FREQUENCIES: Frequency[] = ['daily', 'weekly', 'monthly']

/**
 * What the renderer needs to list a recurrence.
 *
 * The rule itself stays in main: the UI only ever shows the description main
 * already rendered, so shipping the raw rule across IPC would be one more shape
 * to keep in step for no benefit.
 */
export interface RecurrenceSummary {
  id: string
  context: string
  title: string
  type: string
  active: boolean
  nextDue: number | null
  description: string
}

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** Guards the stepping loop. 4000 steps is over a decade of daily occurrences. */
const MAX_STEPS = 4000

const clampInterval = (n: unknown): number => {
  const value = Math.floor(Number(n))
  return Number.isFinite(value) && value > 0 ? Math.min(value, 365) : 1
}

/**
 * Coerces stored or model-supplied input into a usable rule.
 *
 * Returns null rather than a patched-up guess when the frequency or start is
 * unusable: a recurrence with a meaningless rule would spawn work forever at the
 * wrong time, which is worse than one that refuses to be created.
 */
export function normalizeRule(raw: unknown): RecurrenceRule | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>

  const freq = o.freq
  if (freq !== 'daily' && freq !== 'weekly' && freq !== 'monthly') return null

  const startAt = Number(o.startAt)
  if (!Number.isFinite(startAt) || startAt <= 0) return null

  const untilRaw = o.untilAt
  const untilAt =
    untilRaw === null || untilRaw === undefined || untilRaw === ''
      ? null
      : Number.isFinite(Number(untilRaw))
        ? Number(untilRaw)
        : null

  // A window that closes before it opens can never fire; treat it as open-ended
  // rather than silently creating a rule that does nothing.
  if (untilAt !== null && untilAt < startAt) return null

  const byWeekday = Array.isArray(o.byWeekday)
    ? [...new Set(o.byWeekday.map(d => Math.floor(Number(d))).filter(d => d >= 0 && d <= 6))].sort(
        (a, b) => a - b
      )
    : []

  return {
    freq,
    interval: clampInterval(o.interval),
    // Weekdays only mean anything for a weekly rule; carrying them on a daily or
    // monthly one would imply a filter that is never applied.
    byWeekday: freq === 'weekly' ? byWeekday : [],
    startAt,
    untilAt
  }
}

/** Copies the time of day from the anchor onto a date. */
function withAnchorTime(date: Date, anchor: Date): Date {
  const out = new Date(date)
  out.setHours(anchor.getHours(), anchor.getMinutes(), anchor.getSeconds(), anchor.getMilliseconds())
  return out
}

function addDays(date: Date, days: number): Date {
  const out = new Date(date)
  out.setDate(out.getDate() + days)
  return out
}

/**
 * Adds months while keeping the anchor's day of month where the target allows.
 *
 * A rule anchored on the 31st must fire on the 30th in April and the 28th in
 * February, and then return to the 31st in May. Letting Date roll over would
 * turn "31 January" into 2 or 3 March and permanently shift every later
 * occurrence, so the day is clamped to the target month's length each time.
 */
function addMonthsClamped(date: Date, months: number, anchorDayOfMonth: number): Date {
  const out = new Date(date)
  out.setDate(1)
  out.setMonth(out.getMonth() + months)
  const daysInMonth = new Date(out.getFullYear(), out.getMonth() + 1, 0).getDate()
  out.setDate(Math.min(anchorDayOfMonth, daysInMonth))
  return out
}

/**
 * The first occurrence strictly after `after`, or null once the rule has ended.
 *
 * `after` is exclusive so that completing an instance and asking for the next
 * one cannot return the same moment again.
 */
export function nextOccurrence(rule: RecurrenceRule, after: number): number | null {
  const anchor = new Date(rule.startAt)
  const anchorDayOfMonth = anchor.getDate()

  if (rule.startAt > after) {
    return rule.untilAt !== null && rule.startAt > rule.untilAt ? null : rule.startAt
  }

  let cursor = new Date(rule.startAt)
  let steps = 0

  // Fast-forward whole periods before stepping, so a daily rule started years
  // ago does not walk day by day to reach today.
  if (rule.freq === 'daily') {
    const periodDays = rule.interval
    const elapsedDays = Math.floor((after - rule.startAt) / 86_400_000)
    const jump = Math.max(0, Math.floor(elapsedDays / periodDays) * periodDays)
    cursor = withAnchorTime(addDays(cursor, jump), anchor)
  } else if (rule.freq === 'weekly') {
    const elapsedWeeks = Math.floor((after - rule.startAt) / (7 * 86_400_000))
    const jump = Math.max(0, Math.floor(elapsedWeeks / rule.interval) * rule.interval - 1)
    cursor = withAnchorTime(addDays(cursor, jump * 7), anchor)
  } else {
    const monthsElapsed =
      (new Date(after).getFullYear() - anchor.getFullYear()) * 12 +
      (new Date(after).getMonth() - anchor.getMonth())
    const jump = Math.max(0, Math.floor(monthsElapsed / rule.interval) * rule.interval - rule.interval)
    cursor = withAnchorTime(addMonthsClamped(cursor, jump, anchorDayOfMonth), anchor)
  }

  while (steps < MAX_STEPS) {
    steps++

    if (cursor.getTime() > after) {
      const time = cursor.getTime()
      if (rule.untilAt !== null && time > rule.untilAt) return null
      // A weekly rule with explicit weekdays only fires on those days.
      if (rule.freq !== 'weekly' || rule.byWeekday.length === 0 || rule.byWeekday.includes(cursor.getDay())) {
        return time
      }
    }

    if (rule.freq === 'daily') {
      cursor = withAnchorTime(addDays(cursor, rule.interval), anchor)
    } else if (rule.freq === 'weekly') {
      // With explicit weekdays the cursor walks a day at a time so it can land
      // on each selected day; the interval then applies to whole weeks.
      cursor = rule.byWeekday.length > 0
        ? withAnchorTime(addDays(cursor, 1), anchor)
        : withAnchorTime(addDays(cursor, rule.interval * 7), anchor)
    } else {
      cursor = withAnchorTime(addMonthsClamped(cursor, rule.interval, anchorDayOfMonth), anchor)
    }

    if (rule.untilAt !== null && cursor.getTime() > rule.untilAt) return null
  }

  return null
}

/** Human description for the UI and for MCP tool output. */
export function describeRule(rule: RecurrenceRule): string {
  const every = rule.interval === 1 ? '' : ` ${rule.interval}`

  let base: string
  if (rule.freq === 'daily') {
    base = rule.interval === 1 ? 'Every day' : `Every${every} days`
  } else if (rule.freq === 'weekly') {
    if (rule.byWeekday.length > 0) {
      const days = rule.byWeekday.map(d => WEEKDAY_NAMES[d]).join(', ')
      base = rule.interval === 1 ? `Every ${days}` : `Every${every} weeks on ${days}`
    } else {
      base = rule.interval === 1 ? 'Every week' : `Every${every} weeks`
    }
  } else {
    const day = new Date(rule.startAt).getDate()
    base = rule.interval === 1 ? `Monthly on day ${day}` : `Every${every} months on day ${day}`
  }

  if (rule.untilAt !== null) {
    base += ` until ${new Date(rule.untilAt).toLocaleDateString()}`
  }
  return base
}
