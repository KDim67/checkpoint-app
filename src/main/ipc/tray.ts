/** The tray panel: its contents, its size and its actions. */

import { ipcMain } from 'electron'
import { IpcChannels } from '../../shared/ipcChannels'
import { beginQuit } from '../windows'
import { app } from 'electron'

export function registerTrayHandlers(): void {
  /** Live counts for the tray panel, so it says something worth reading. */
  ipcMain.handle(IpcChannels.TRAY_SUMMARY, async () => {
    const { getDb, getSetting } = await import('../db')
    try {
      const now = Date.now()
      const endOfDay = new Date(now)
      endOfDay.setHours(23, 59, 59, 999)

      const counts = getDb()
        .prepare(
          `SELECT
             SUM(CASE WHEN due_at IS NOT NULL AND due_at < ? THEN 1 ELSE 0 END) AS overdue,
             SUM(CASE WHEN due_at IS NOT NULL AND due_at >= ? AND due_at <= ? THEN 1 ELSE 0 END) AS today,
             COUNT(*) AS open
           FROM items
           WHERE status NOT IN ('done', 'archived') AND type IN ('card', 'task')`
        )
        .get(now, now, endOfDay.getTime()) as { overdue: number | null; today: number | null; open: number | null }

      return {
        context: getSetting<string>('active_context', 'default'),
        overdue: counts.overdue ?? 0,
        dueToday: counts.today ?? 0,
        open: counts.open ?? 0
      }
    } catch (err) {
      console.error('[tray] Could not build the summary:', err)
      return { context: '', overdue: 0, dueToday: 0, open: 0 }
    }
  })

  ipcMain.handle(IpcChannels.TRAY_RESIZE, async (_event, height: number) => {
    const { setPanelHeight } = await import('../tray')
    if (Number.isFinite(height)) setPanelHeight(height)
    return { ok: true as const }
  })

  ipcMain.handle(IpcChannels.TRAY_ACTION, async (_event, action: string) => {
    const { showMainWindow, hidePanel } = await import('../tray')
    switch (action) {
      case 'open':
        showMainWindow()
        break
      case 'capture': {
        hidePanel()
        // showHud, not enableHud: the latter only registers the global hotkey
        // and pre-creates the window hidden, so the button appeared to do
        // nothing. showHud creates the window if needed and displays it.
        const { showHud } = await import('../hud')
        showHud()
        break
      }
      case 'quit':
        hidePanel()
        beginQuit()
        app.quit()
        break
      case 'close':
        hidePanel()
        break
    }
    return { ok: true as const }
  })
}
