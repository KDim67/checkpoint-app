/** tray panel contents, size and actions */

import { ipcMain } from 'electron'
import { IpcChannels } from '../../shared/ipcChannels'
import { beginQuit } from '../windows'
import { app } from 'electron'
import { isDueToday, isOverdue } from '../../shared/dueDate'

export function registerTrayHandlers(): void {
  ipcMain.handle(IpcChannels.TRAY_SUMMARY, async () => {
    const { getDb, getSetting } = await import('../db')
    try {
      const now = Date.now()
      // read out and counted here: a whole day is late only once that day is over in this timezone
      const rows = getDb()
        .prepare(
          `SELECT due_at FROM items
           WHERE status NOT IN ('done', 'archived') AND type IN ('card', 'task')`
        )
        .all() as { due_at: number | null }[]
      const dated = rows.flatMap(r => (r.due_at === null ? [] : [r.due_at]))
      const { listRenewals } = await import('../renewals')
      const { needsAttention } = await import('../../shared/renewal')

      return {
        context: getSetting<string>('active_context', 'default'),
        overdue: dated.filter(due => isOverdue(due, now)).length,
        // still to do today, the late ones are counted above
        dueToday: dated.filter(due => isDueToday(due, now) && !isOverdue(due, now)).length,
        open: rows.length,
        renewalsSoon: listRenewals(undefined, now).filter(r => needsAttention(r.status, r.meta, now)).length
      }
    } catch (err) {
      console.error('[tray] Could not build the summary:', err)
      return { context: '', overdue: 0, dueToday: 0, open: 0, renewalsSoon: 0 }
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
      case 'renewals': {
        showMainWindow()
        const { sendToWindow } = await import('../windows')
        sendToWindow(IpcChannels.APP_NAVIGATE_TO_VIEW, 'renewals')
        break
      }
      case 'capture': {
        hidePanel()
        // showHud not enableHud, the latter only registers the hotkey so the button did nothing
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
