/** quick-capture overlay */

import { ipcMain } from 'electron'
import { IpcChannels } from '../../shared/ipcChannels'

export function registerHudHandlers(): void {
  // only Settings switches the feature; the HUD itself hides through HUD_HIDE
  ipcMain.handle(IpcChannels.HUD_TOGGLE, async (_event, active?: boolean) => {
    const { enableHud, disableHud, toggleHud } = await import('../hud')
    const { hudShortcut } = await import('../appShortcuts')
    if (active === true) {
      enableHud(hudShortcut())
    } else if (active === false) {
      disableHud()
    } else {
      toggleHud()
    }
  })

  ipcMain.handle(IpcChannels.HUD_HIDE, async () => {
    const { hideHud } = await import('../hud')
    hideHud()
  })

  ipcMain.on(IpcChannels.HUD_RESIZE, (_event, height: number) => {
    import('../hud').then(({ resizeHud }) => {
      resizeHud(height)
    }).catch(console.error)
  })
}
