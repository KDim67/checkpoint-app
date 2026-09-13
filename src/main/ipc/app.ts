/** window controls, file dialogs, updater */

import { ipcMain } from 'electron'
import { IpcChannels } from '../../shared/ipcChannels'
import { openExternalSafely } from '../openExternal'
import { getMainWindow } from '../windows'
import { app, dialog, shell } from 'electron'
import { writeFileSync } from 'fs'

export function registerAppHandlers(): void {
  ipcMain.handle(IpcChannels.APP_GET_VERSION, () => app.getVersion())

  ipcMain.handle(IpcChannels.APP_GET_DATA_PATH, () => app.getPath('userData'))

  ipcMain.handle(IpcChannels.APP_OPEN_EXTERNAL, (_event, url: unknown) => {
    if (typeof url === 'string') openExternalSafely(url)
  })

  ipcMain.on(IpcChannels.APP_MINIMIZE, () => getMainWindow()?.minimize())
  ipcMain.on(IpcChannels.APP_MAXIMIZE, () => {
    const win = getMainWindow()
    if (win?.isMaximized()) {
      win.unmaximize()
    } else {
      win?.maximize()
    }
  })
  ipcMain.on(IpcChannels.APP_CLOSE, () => getMainWindow()?.close())

  ipcMain.handle(IpcChannels.APP_SAVE_FILE, async (_event, defaultName: string, content: string) => {
    const win = getMainWindow()
    if (!win) return false
    const { filePath, canceled } = await dialog.showSaveDialog(win, {
      defaultPath: defaultName,
      filters: [{ name: 'Markdown', extensions: ['md'] }]
    })
    if (canceled || !filePath) return false
    try {
      writeFileSync(filePath, content, 'utf8')
      return true
    } catch (err) {
      console.error('Failed to write exported backlog file:', err)
      return false
    }
  })

  /** PNG needs the buffer, bytes through a string get mangled */
  ipcMain.handle(
    IpcChannels.APP_SAVE_BINARY_FILE,
    async (_event, defaultName: string, data: ArrayBuffer, extension: string) => {
      const win = getMainWindow()
      if (!win) return false
      const { filePath, canceled } = await dialog.showSaveDialog(win, {
        defaultPath: defaultName,
        filters: [{ name: extension.toUpperCase(), extensions: [extension] }]
      })
      if (canceled || !filePath) return false
      try {
        writeFileSync(filePath, Buffer.from(data))
        return true
      } catch (err) {
        console.error('Failed to write exported file:', err)
        return false
      }
    }
  )

  ipcMain.handle(IpcChannels.APP_SHOW_ITEM_IN_FOLDER, (_event, filePath: string) => {
    try {
      shell.showItemInFolder(filePath)
    } catch (err) {
      console.error('Failed to show item in folder:', err)
    }
  })

  // lazy so dev runs never load electron-updater
  ipcMain.handle(IpcChannels.APP_CHECK_FOR_UPDATES, async () => {
    const { checkForUpdatesNow } = await import('../updater')
    return checkForUpdatesNow()
  })

  // asked on panel open; a finished download has no events left to send
  ipcMain.handle(IpcChannels.APP_UPDATE_STATE, async () => {
    const { currentUpdateProgress } = await import('../updater')
    return currentUpdateProgress()
  })
}
