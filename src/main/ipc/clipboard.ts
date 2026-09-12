/** Pasting a stored snippet back out. */

import { ipcMain } from 'electron'
import { IpcChannels } from '../../shared/ipcChannels'
import { getMainWindow } from '../windows'
import { clipboard } from 'electron'

export function registerClipboardHandlers(): void {
  ipcMain.handle(IpcChannels.CLIPBOARD_PASTE, (_event, content: string) => {
    clipboard.writeText(content)
    getMainWindow()?.hide()
    return true
  })
}
