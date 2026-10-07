/** renewal warnings, in main so they arrive with the window closed; quiet hours and switches via the shared layer */

import { setSetting, updateRenewalRow } from './db'
import { notify } from './notificationService'
import { listRenewals, readMap, WARNED_SETTING } from './renewals'
import { runDueLookups } from './renewalLookup'
import { sendToWindow } from './windows'
import { IpcChannels } from '../shared/ipcChannels'
import { advancePast, isExpired, renewTo } from '../shared/renewal'
import { pruneFired, renewalNotices } from '../shared/renewalWarnings'

const CHECK_INTERVAL_MS = 15 * 60 * 1000
const STARTUP_DELAY_MS = 14_000

let timer: NodeJS.Timeout | null = null
let startupTimer: NodeJS.Timeout | null = null
let running = false

/** one that renews itself and has no lookup moves on when its date passes; one with a lookup waits for what it sees */
export function rollForward(now = Date.now()): number {
  let moved = 0
  for (const entry of listRenewals(undefined, now)) {
    const { meta } = entry
    if (entry.status !== 'active' || meta.renews !== 'auto' || meta.lookup || meta.expiresAt === null) continue
    if (!isExpired(meta.expiresAt, now)) continue
    try {
      const to = advancePast(meta.expiresAt, meta.cycle, meta.anchorDay, now)
      if (to === null) continue
      updateRenewalRow(entry.id, { metadata: JSON.stringify(renewTo(meta, to, 'auto', now, true)) })
      moved++
    } catch (err) {
      console.error('[renewals] Could not move', entry.id, 'on:', err)
    }
  }
  return moved
}

/** sends what is due and remembers it here; returns how many went out */
export async function checkRenewals(now = Date.now()): Promise<number> {
  // a slow registry must not let the next sweep start on top of this one
  if (running) return 0
  running = true
  let sent = 0
  try {
    let changed = rollForward(now)
    try {
      changed += await runDueLookups(now)
    } catch (err) {
      console.error('[renewals] Background lookups failed:', err)
    }
    if (changed > 0) sendToWindow(IpcChannels.MCP_DATA_CHANGED)

    const entries = listRenewals(undefined, now)
    const warned = readMap<number>(WARNED_SETTING)
    const fired = new Set(Object.keys(warned))
    let dirty = false

    for (const entry of entries) {
      try {
        const { notices, mark } = renewalNotices(
          { id: entry.id, title: entry.title, status: entry.status, meta: entry.meta },
          now,
          fired,
          entry.snoozedUntil,
          entry.lookupState
        )
        let delivered = 0
        for (const notice of notices) {
          if (notify({ category: 'renewal', title: notice.title, body: notice.body, itemId: notice.entryId, view: 'renewals', now })) delivered++
        }
        sent += delivered
        // held back by quiet hours or a switch: kept unsent, so it arrives once they allow it
        if (notices.length > 0 && delivered === 0) continue
        for (const key of mark) {
          if (warned[key] === undefined) {
            warned[key] = now
            dirty = true
          }
        }
      } catch (err) {
        console.error('[renewals] Could not check', entry.id, err)
      }
    }

    const pruned = pruneFired(warned, new Set(entries.map(e => e.id)), now)
    if (dirty || Object.keys(pruned).length !== Object.keys(warned).length) setSetting(WARNED_SETTING, pruned)
  } catch (err) {
    console.error('[renewals] Check failed:', err)
  } finally {
    running = false
  }
  return sent
}

export function initializeRenewalReminders(): void {
  shutdownRenewalReminders()
  startupTimer = setTimeout(() => {
    startupTimer = null
    void checkRenewals()
  }, STARTUP_DELAY_MS)
  timer = setInterval(() => void checkRenewals(), CHECK_INTERVAL_MS)
}

export function shutdownRenewalReminders(): void {
  if (timer) { clearInterval(timer); timer = null }
  if (startupTimer) { clearTimeout(startupTimer); startupTimer = null }
}
