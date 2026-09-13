/** at most one open instance; local time so DST doesn't shift "9am" */

type Frequency = 'daily' | 'weekly' | 'monthly'

export interface RecurrenceRule {
  freq: Frequency
  /** at least 1 */
  interval: number
  /** 0 Sunday to 6 Saturday; empty means the start's weekday */
  byWeekday: number[]
  /** anchors time of day and day of month */
  startAt: number
  /** inclusive; null repeats forever */
  untilAt: number | null
}

/** the rule stays in main, the UI only shows main's description */
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

/** over a decade of dailies */
const MAX_STEPS = 4000

const clampInterval = (n: unknown): number => {
  const value = Math.floor(Number(n))
  return Number.isFinite(value) && value > 0 ? Math.min(value, 365) : 1
}

/** null over a patched guess, a bad rule spawns work forever */
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

  // a window closing before it opens never fires
  if (untilAt !== null && untilAt < startAt) return null

  const byWeekday = Array.isArray(o.byWeekday)
    ? [...new Set(o.byWeekday.map(d => Math.floor(Number(d))).filter(d => d >= 0 && d <= 6))].sort(
        (a, b) => a - b
      )
    : []

  return {
    freq,
    interval: clampInterval(o.interval),
    // weekdays only for weekly rules
    byWeekday: freq === 'weekly' ? byWeekday : [],
    startAt,
    untilAt
  }
}

/** copies the anchor's time */
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

/** clamp to the month's length so the 31st doesn't drift into March */
function addMonthsClamped(date: Date, months: number, anchorDayOfMonth: number): Date {
  const out = new Date(date)
  out.setDate(1)
  out.setMonth(out.getMonth() + months)
  const daysInMonth = new Date(out.getFullYear(), out.getMonth() + 1, 0).getDate()
  out.setDate(Math.min(anchorDayOfMonth, daysInMonth))
  return out
}

/** strictly after, so completing one can't return it again */
export function nextOccurrence(rule: RecurrenceRule, after: number): number | null {
  const anchor = new Date(rule.startAt)
  const anchorDayOfMonth = anchor.getDate()

  if (rule.startAt > after) {
    return rule.untilAt !== null && rule.startAt > rule.untilAt ? null : rule.startAt
  }

  let cursor = new Date(rule.startAt)
  let steps = 0

  // fast-forward whole periods first
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
      // only on the chosen weekdays
      if (rule.freq !== 'weekly' || rule.byWeekday.length === 0 || rule.byWeekday.includes(cursor.getDay())) {
        return time
      }
    }

    if (rule.freq === 'daily') {
      cursor = withAnchorTime(addDays(cursor, rule.interval), anchor)
    } else if (rule.freq === 'weekly') {
      // walk days to land on each chosen one, interval applies per week
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

/** for the UI and MCP output */
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
