/** the calendar screen; every handler answers with a result, a throw would reach the renderer as main's stack */

import { ipcMain } from 'electron'
import { IpcChannels } from '../../shared/ipcChannels'
import type { CalendarResult } from '../../shared/calendarApi'

// often enough that a meeting added an hour ago shows; each calendar still waits its own half hour
const SWEEP_MS = 5 * 60_000

async function guarded<T>(what: string, fn: () => CalendarResult<T> | Promise<CalendarResult<T>>): Promise<CalendarResult<T>> {
  try {
    return await fn()
  } catch (err) {
    console.error(`[calendar] Could not ${what}:`, err)
    return { ok: false, reason: err instanceof Error ? err.message : String(err) }
  }
}

async function announce(): Promise<void> {
  const { sendToWindow } = await import('../windows')
  sendToWindow(IpcChannels.CALENDAR_CHANGED)
}

let sweeping = false

/** subscribed calendars refresh while the app is open, the tab or not */
export function startCalendarRefresh(): void {
  setInterval(() => {
    if (sweeping) return
    sweeping = true
    void (async () => {
      try {
        const { refreshSubscriptions } = await import('../calendar/icalStore')
        if (await refreshSubscriptions()) await announce()
      } catch (err) {
        console.error('[calendar] The refresh sweep failed:', err)
      } finally {
        sweeping = false
      }
    })()
  }, SWEEP_MS)
}

export function registerCalendarHandlers(): void {
  ipcMain.handle(IpcChannels.CALENDAR_ENTRIES, (_event, query) =>
    guarded('read the calendar', async () => {
      const { calendarEntries } = await import('../calendar/service')
      return calendarEntries(query)
    })
  )

  ipcMain.handle(IpcChannels.CALENDAR_MOVE, (_event, itemId: unknown, due: unknown) =>
    guarded('move a due date', async () => {
      const { moveDue } = await import('../calendar/service')
      return moveDue(itemId, due)
    })
  )

  ipcMain.handle(IpcChannels.CALENDAR_QUICK_ADD, (_event, input) =>
    guarded('add from the calendar', async () => {
      const { quickAdd } = await import('../calendar/service')
      return quickAdd(input)
    })
  )

  ipcMain.handle(IpcChannels.CALENDAR_SUBSCRIPTIONS, () =>
    guarded('list calendars', async () => {
      const { listSubscriptions } = await import('../calendar/icalStore')
      return { ok: true, value: listSubscriptions() }
    })
  )

  ipcMain.handle(IpcChannels.CALENDAR_SUBSCRIBE, (_event, input) =>
    guarded('add a calendar', async () => {
      const { addSubscription } = await import('../calendar/icalStore')
      const added = await addSubscription(input ?? {})
      if (added.ok) await announce()
      return added
    })
  )

  ipcMain.handle(IpcChannels.CALENDAR_UPDATE_SUBSCRIPTION, (_event, id: unknown, patch: unknown) =>
    guarded('change a calendar', async () => {
      const { updateSubscription } = await import('../calendar/icalStore')
      if (typeof id !== 'string' || !patch || typeof patch !== 'object') return { ok: false, reason: 'That change was malformed.' }
      const updated = updateSubscription(id, patch)
      if (!updated.ok) return updated
      await announce()
      return { ok: true, value: true as const }
    })
  )

  ipcMain.handle(IpcChannels.CALENDAR_UNSUBSCRIBE, (_event, id: unknown) =>
    guarded('remove a calendar', async () => {
      const { removeSubscription } = await import('../calendar/icalStore')
      if (typeof id !== 'string') return { ok: false, reason: 'No calendar named.' }
      removeSubscription(id)
      await announce()
      return { ok: true, value: true as const }
    })
  )

  ipcMain.handle(IpcChannels.CALENDAR_REFRESH, (_event, force: unknown, olderThanMs: unknown) =>
    guarded('refresh calendars', async () => {
      const { refreshSubscriptions, REFRESH_EVERY_MS } = await import('../calendar/icalStore')
      const age = typeof olderThanMs === 'number' && olderThanMs >= 0 ? olderThanMs : REFRESH_EVERY_MS
      const changed = await refreshSubscriptions(force === true, age)
      if (changed) await announce()
      return { ok: true, value: changed }
    })
  )
}
