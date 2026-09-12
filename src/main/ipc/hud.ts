/** The quick-capture overlay. */

import { ipcMain } from 'electron'
import { IpcChannels } from '../../shared/ipcChannels'

export function registerHudHandlers(): void {
  ipcMain.handle(IpcChannels.HUD_TOGGLE, async (_event, active?: boolean) => {
    const { enableHud, disableHud, toggleHud } = await import('../hud')
    if (active === true) {
      enableHud()
    } else if (active === false) {
      disableHud()
    } else {
      toggleHud()
    }
  })

  ipcMain.on(IpcChannels.HUD_RESIZE, (_event, height: number) => {
    import('../hud').then(({ resizeHud }) => {
      resizeHud(height)
    }).catch(console.error)
  })
}
