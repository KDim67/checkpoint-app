/** launch at login, and how the app comes up */

import { ipcMain } from 'electron'
import { IpcChannels } from '../../shared/ipcChannels'

export function registerStartupHandlers(): void {
  ipcMain.handle(IpcChannels.STARTUP_GET, async () => {
    const { getStartupSettings } = await import('../tray')
    return getStartupSettings()
  })

  ipcMain.handle(IpcChannels.STARTUP_SET, async (_event, next: unknown) => {
    const { setStartupSettings } = await import('../tray')
    return setStartupSettings(next)
  })
}
