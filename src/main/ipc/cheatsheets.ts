/** Reference documents the assistant can quote from. */

import { ipcMain } from 'electron'
import { IpcChannels } from '../../shared/ipcChannels'
import { addCheatsheet, getCheatsheetText, listCheatsheets, removeCheatsheet, renameCheatsheet, selectFile } from '../cheatsheetService'

export function registerCheatsheetsHandlers(): void {
  ipcMain.handle(IpcChannels.CHEATSHEETS_LIST, async () => {
    return listCheatsheets()
  })

  ipcMain.handle(IpcChannels.CHEATSHEETS_ADD, async (_event, filePath: string) => {
    return addCheatsheet(filePath)
  })

  ipcMain.handle(IpcChannels.CHEATSHEETS_REMOVE, async (_event, name: string) => {
    return removeCheatsheet(name)
  })

  ipcMain.handle(IpcChannels.CHEATSHEETS_RENAME, async (_event, oldName: string, newName: string) => {
    return renameCheatsheet(oldName, newName)
  })

  ipcMain.handle(IpcChannels.CHEATSHEETS_SELECT, async () => {
    return selectFile()
  })

  ipcMain.handle(IpcChannels.CHEATSHEETS_GET_TEXT, async (_event, name: string) => {
    return getCheatsheetText(name)
  })

  ipcMain.handle(IpcChannels.CHEATSHEETS_GET_RELEVANT, async (_event, name: string, query: string, maxChars?: number) => {
    const { getCheatsheetRelevant } = await import('../cheatsheetService')
    return getCheatsheetRelevant(name, query, maxChars)
  })

  ipcMain.handle(IpcChannels.CHEATSHEETS_SEARCH, async (_event, query: string) => {
    const { searchCheatsheets } = await import('../cheatsheetService')
    return searchCheatsheets(typeof query === 'string' ? query : '')
  })
}
