/** markdown notes on disk, and vault import */

import { ipcMain } from 'electron'
import { IpcChannels } from '../../shared/ipcChannels'
import { errorMessage } from '../../shared/errors'
import { BrowserWindow, dialog } from 'electron'

export function registerNotesHandlers(): void {
  ipcMain.handle(IpcChannels.NOTES_LIST, async () => {
    const { listNotes } = await import('../notesFsService')
    return listNotes()
  })

  ipcMain.handle(IpcChannels.NOTES_READ, async (_event, title: string) => {
    const { readNote } = await import('../notesFsService')
    return readNote(title)
  })

  ipcMain.handle(IpcChannels.NOTES_WRITE, async (_event, title: string, content: string, oldTitle?: string) => {
    const { writeNote } = await import('../notesFsService')
    return writeNote(title, content, oldTitle)
  })

  ipcMain.handle(IpcChannels.NOTES_DELETE, async (_event, title: string) => {
    const { deleteNote } = await import('../notesFsService')
    return deleteNote(title)
  })

  ipcMain.handle(IpcChannels.NOTES_SEARCH, async (_event, query: string) => {
    const { searchNotes } = await import('../notesFsService')
    return searchNotes(query)
  })

  // a vault is a folder, so pick a directory
  ipcMain.handle(IpcChannels.NOTES_IMPORT_VAULT, async () => {
    try {
      const window = BrowserWindow.getFocusedWindow()
      if (!window) return { success: false, error: 'No active window' }

      const { filePaths } = await dialog.showOpenDialog(window, {
        title: 'Choose an Obsidian vault',
        properties: ['openDirectory']
      })
      if (!filePaths || filePaths.length === 0) return { success: false, cancelled: true }

      const { importObsidianVault, vaultName } = await import('../obsidianService')
      const result = importObsidianVault(filePaths[0])
      return { success: true, vault: vaultName(filePaths[0]), result }
    } catch (err) {
      console.error('Failed to import an Obsidian vault:', err)
      return { success: false, error: errorMessage(err) }
    }
  })
}
