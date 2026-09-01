/**
 * The one place a notification is raised.
 *
 * Before this, three call sites each did their own thing through two different
 * APIs, Electron's Notification in main, the web one in the renderer, with no
 * setting to turn any of them off. Everything now goes through `notify`, which
 * applies the user's policy and remembers what it has already said.
 *
 * The dedupe memory is **persisted**, not held in a variable. Checkpoint is
 * restarted most days, and an in-memory map would re-announce every overdue task
 * on every launch, which is precisely the behaviour that makes people turn
 * notifications off.
 */

import { Notification, BrowserWindow } from 'electron'
import { getSetting, setSetting } from './db'
import {
  normalizePolicy,
  pruneDedupe,
  shouldNotify,
  type DedupeEntry,
  type NotificationCategory
} from '../shared/notificationPolicy'

export const POLICY_SETTING_KEY = 'notification_policy'
const DEDUPE_SETTING_KEY = 'notification_dedupe'

/** Dedupe entries older than this are forgotten. */
const DEDUPE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

export interface NotifyInput {
  category: NotificationCategory
  title: string
  body: string
  /** Suppresses repeats of the same thing. Omit for events that are genuinely new each time. */
  dedupeKey?: string
  dedupeWindowMs?: number
  /** Item to open when the notification is clicked. */
  itemId?: string
  /**
   * The moment to judge against, for quiet hours and dedupe.
   *
   * Defaults to now. A caller sweeping on a schedule passes the same instant it
   * used to select rows, so the decision cannot be made against a different
   * clock than the query was.
   */
  now?: number
}

function loadDedupe(): Map<string, DedupeEntry> {
  try {
    const raw = getSetting<unknown>(DEDUPE_SETTING_KEY, null)
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (parsed && typeof parsed === 'object') {
      const out = new Map<string, DedupeEntry>()
      for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        const at = Number((value as { at?: unknown })?.at)
        if (Number.isFinite(at)) out.set(key, { at })
      }
      return out
    }
  } catch (err) {
    console.error('[notify] Could not read dedupe state:', err)
  }
  return new Map()
}

function saveDedupe(seen: Map<string, DedupeEntry>): void {
  try {
    setSetting(DEDUPE_SETTING_KEY, Object.fromEntries(seen))
  } catch (err) {
    console.error('[notify] Could not save dedupe state:', err)
  }
}

export function getNotificationPolicy() {
  return normalizePolicy(getSetting<unknown>(POLICY_SETTING_KEY, null))
}

/**
 * Raises a notification if the policy allows it. Returns whether it fired.
 *
 * Never throws: a notification failing must not take down whatever was doing
 * real work when it asked for one.
 */
export function notify(input: NotifyInput): boolean {
  try {
    if (!Notification.isSupported()) return false

    const now = input.now ?? Date.now()
    const policy = getNotificationPolicy()
    const seen = input.dedupeKey ? loadDedupe() : undefined

    const decision = shouldNotify(policy, input.category, now, {
      dedupeKey: input.dedupeKey,
      seen,
      dedupeWindowMs: input.dedupeWindowMs
    })
    if (!decision.allow) return false

    const notification = new Notification({ title: input.title, body: input.body, silent: false })

    notification.on('click', () => {
      const win = BrowserWindow.getAllWindows()[0]
      if (!win || win.isDestroyed()) return
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
      // Let the renderer decide what to do with it; main has no view state.
      if (input.itemId) win.webContents.send('notification:activated', { itemId: input.itemId })
    })

    notification.show()

    if (input.dedupeKey && seen) {
      seen.set(input.dedupeKey, { at: now })
      pruneDedupe(seen, now, DEDUPE_MAX_AGE_MS)
      saveDedupe(seen)
    }
    return true
  } catch (err) {
    console.error('[notify] Failed to raise a notification:', err)
    return false
  }
}

/**
 * Clears the memory of what has been announced.
 *
 * Exposed because the dedupe window for due dates is a day: without a way to
 * reset, testing a change to a reminder means waiting until tomorrow.
 */
export function resetNotificationDedupe(): void {
  saveDedupe(new Map())
}
