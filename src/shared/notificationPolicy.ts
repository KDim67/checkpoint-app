/**
 * Whether a notification is allowed to fire. Split from delivery because the
 * judgement is the part that goes subtly wrong: quiet hours wrapping midnight,
 * and dedupe.
 *
 * Dedupe is why this layer exists. The scheduler re-examines the same overdue
 * items every pass, so without a memory of what was already said, one overdue
 * task becomes an alert an hour forever.
 */

export type NotificationCategory = 'due' | 'focus' | 'webhook' | 'recurrence' | 'agent'

export const NOTIFICATION_CATEGORIES: {
  id: NotificationCategory
  label: string
  description: string
  defaultOn: boolean
}[] = [
  { id: 'due', label: 'Due dates', description: 'When a card or task reaches its due date.', defaultOn: true },
  { id: 'focus', label: 'Focus timer', description: 'When a focus interval or break ends.', defaultOn: true },
  { id: 'webhook', label: 'Webhook events', description: 'Events delivered by external tools.', defaultOn: true },
  { id: 'recurrence', label: 'Repeating work', description: 'When a repeating task creates its next occurrence.', defaultOn: false },
  { id: 'agent', label: 'Agent activity', description: 'When an external agent changes something over MCP.', defaultOn: false }
]

export interface NotificationPolicy {
  /** Master switch. Off silences every category. */
  enabled: boolean
  /** Per-category switches, keyed by category id. */
  categories: Record<string, boolean>
  /** Suppress between these hours, 0–23. Equal values mean no quiet period. */
  quietFrom: number
  quietTo: number
  quietEnabled: boolean
}

export const DEFAULT_POLICY: NotificationPolicy = {
  enabled: true,
  categories: Object.fromEntries(NOTIFICATION_CATEGORIES.map(c => [c.id, c.defaultOn])),
  quietFrom: 22,
  quietTo: 8,
  quietEnabled: false
}

const clampHour = (n: unknown): number => {
  const v = Math.floor(Number(n))
  return Number.isFinite(v) && v >= 0 && v <= 23 ? v : 0
}

/** Coerces a stored policy, filling anything missing from the defaults. */
export function normalizePolicy(raw: unknown): NotificationPolicy {
  let parsed: unknown = raw
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw)
    } catch {
      return { ...DEFAULT_POLICY, categories: { ...DEFAULT_POLICY.categories } }
    }
  }
  if (!parsed || typeof parsed !== 'object') {
    return { ...DEFAULT_POLICY, categories: { ...DEFAULT_POLICY.categories } }
  }
  const o = parsed as Record<string, unknown>
  const categories = { ...DEFAULT_POLICY.categories }
  if (o.categories && typeof o.categories === 'object') {
    for (const c of NOTIFICATION_CATEGORIES) {
      const value = (o.categories as Record<string, unknown>)[c.id]
      if (typeof value === 'boolean') categories[c.id] = value
    }
  }
  return {
    enabled: typeof o.enabled === 'boolean' ? o.enabled : DEFAULT_POLICY.enabled,
    categories,
    quietFrom: clampHour(o.quietFrom ?? DEFAULT_POLICY.quietFrom),
    quietTo: clampHour(o.quietTo ?? DEFAULT_POLICY.quietTo),
    quietEnabled: typeof o.quietEnabled === 'boolean' ? o.quietEnabled : DEFAULT_POLICY.quietEnabled
  }
}

/**
 * True while the given hour falls inside the quiet window.
 *
 * The window is allowed to wrap midnight, which is the normal case, 22:00 to
 * 08:00 is two disjoint ranges on the clock, and comparing `from <= h < to`
 * would silence exactly the hours it should let through.
 */
export function isQuietHour(policy: NotificationPolicy, hour: number): boolean {
  if (!policy.quietEnabled) return false
  const { quietFrom: from, quietTo: to } = policy
  if (from === to) return false
  return from < to ? hour >= from && hour < to : hour >= from || hour < to
}

export interface DedupeEntry {
  /** When this key was last delivered. */
  at: number
}

export interface NotifyDecision {
  allow: boolean
  /** Why it was suppressed. Useful in the log, and for explaining silence. */
  reason?: 'disabled' | 'category-off' | 'quiet-hours' | 'duplicate'
}

/**
 * Decides whether one notification should be delivered.
 *
 * `dedupeWindowMs` is how long a given key stays suppressed. A due-date reminder
 * uses a long window so an overdue item is mentioned once a day rather than once
 * a sweep; a focus alert passes no key at all, since two intervals ending really
 * are two separate things to say.
 */
export function shouldNotify(
  policy: NotificationPolicy,
  category: NotificationCategory,
  now: number,
  options: { dedupeKey?: string; seen?: Map<string, DedupeEntry>; dedupeWindowMs?: number } = {}
): NotifyDecision {
  if (!policy.enabled) return { allow: false, reason: 'disabled' }
  if (policy.categories[category] === false) return { allow: false, reason: 'category-off' }
  if (isQuietHour(policy, new Date(now).getHours())) return { allow: false, reason: 'quiet-hours' }

  const { dedupeKey, seen, dedupeWindowMs } = options
  if (dedupeKey && seen) {
    const previous = seen.get(dedupeKey)
    // A window of 0 or less means "never repeat", so any prior delivery blocks it.
    if (previous && (dedupeWindowMs === undefined || dedupeWindowMs <= 0 || now - previous.at < dedupeWindowMs)) {
      return { allow: false, reason: 'duplicate' }
    }
  }
  return { allow: true }
}

/** Drops dedupe entries older than the window, so the map cannot grow forever. */
export function pruneDedupe(seen: Map<string, DedupeEntry>, now: number, maxAgeMs: number): void {
  for (const [key, entry] of seen) {
    if (now - entry.at > maxAgeMs) seen.delete(key)
  }
}
