/** Window controls, file dialogs and the updater. */

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

  /**
   * The text sibling above cannot carry a PNG: writing bytes through a string
   * mangles them. This takes the buffer as it is.
   */
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

  // Imported here rather than at the top so a dev run never pulls
  // electron-updater in at all, the same way the startup check does.
  ipcMain.handle(IpcChannels.APP_CHECK_FOR_UPDATES, async () => {
    const { checkForUpdatesNow } = await import('../updater')
    return checkForUpdatesNow()
  })

  // What the background download is doing right now. Asked once when the panel
  // opens, because a download that finished before then has no events left to
  // send and the panel would otherwise show nothing at all.
  ipcMain.handle(IpcChannels.APP_UPDATE_STATE, async () => {
    const { currentUpdateProgress } = await import('../updater')
    return currentUpdateProgress()
  })
}
