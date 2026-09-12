/** The floating desktop widget. */

import { ipcMain } from 'electron'
import { IpcChannels } from '../../shared/ipcChannels'
import type { WidgetPosition } from '../widget'

export function registerWidgetHandlers(): void {
  ipcMain.handle(IpcChannels.WIDGET_TOGGLE, async (_event, active: boolean) => {
    const { setWidgetEnabled } = await import('../widget')
    setWidgetEnabled(active)
  })

  ipcMain.handle(IpcChannels.WIDGET_SET_POSITION, async (_event, position: string) => {
    const { setWidgetPosition } = await import('../widget')
    setWidgetPosition(position as WidgetPosition)
  })

  ipcMain.handle(IpcChannels.WIDGET_SET_OPACITY, async (_event, opacity: number) => {
    const { setWidgetOpacity } = await import('../widget')
    setWidgetOpacity(opacity)
  })
}
