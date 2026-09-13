/** single choke point: applies policy and a persisted dedupe, since restarts would re-announce everything */

import { Notification, BrowserWindow, nativeImage } from 'electron'
import { join } from 'path'
import { getSetting, setSetting } from './db'
import {
  normalizePolicy,
  pruneDedupe,
  shouldNotify,
  type DedupeEntry,
  type NotificationCategory
} from '../shared/notificationPolicy'

export const POLICY_SETTING_KEY = 'notification_policy'

/** explicit icon: AUMID needs an installed shortcut; PNG since toasts render .ico badly; loaded once */
const NOTIFICATION_ICON = nativeImage.createFromPath(
  join(__dirname, '../../resources/icon.png')
)
const DEDUPE_SETTING_KEY = 'notification_dedupe'

const DEDUPE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

interface NotifyInput {
  category: NotificationCategory
  title: string
  body: string
  /** omit for events that are new each time */
  dedupeKey?: string
  dedupeWindowMs?: number
  /** opened on click */
  itemId?: string
  /** defaults to now; sweeps pass the instant they queried with so both use one clock */
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

/** never throws, a failed notification mustn't take down real work */
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

    const notification = new Notification({
      title: input.title,
      body: input.body,
      silent: false,
      // an empty image blanks the icon instead of falling back
      ...(NOTIFICATION_ICON.isEmpty() ? {} : { icon: NOTIFICATION_ICON })
    })

    notification.on('click', () => {
      const win = BrowserWindow.getAllWindows()[0]
      if (!win || win.isDestroyed()) return
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
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

/** due-date dedupe lasts a day, so testing a reminder change needs a reset */
export function resetNotificationDedupe(): void {
  saveDedupe(new Map())
}
