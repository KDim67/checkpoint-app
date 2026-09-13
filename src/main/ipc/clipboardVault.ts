/** clipboard history: snippets, pins, labels */

import { ipcMain } from 'electron'
import { IpcChannels } from '../../shared/ipcChannels'
import { handleSafe } from './handleSafe'
import { z } from 'zod'
import {
  clearClipboardHistory,
  createClipboardSnippet,
  deleteClipboardItem,
  getClipboardHistory,
  restoreClipboardItem,
  toggleClipboardPin,
  updateClipboardLabel
} from '../db'

export function registerClipboardVaultHandlers(): void {
  ipcMain.handle(IpcChannels.CLIPBOARD_GET_HISTORY, () => {
    return handleSafe(() => getClipboardHistory())
  })

  ipcMain.handle(IpcChannels.CLIPBOARD_TOGGLE_PIN, (_event, id: unknown, isPinned: unknown) => {
    return handleSafe(() => {
      const parsedId = z.string().parse(id)
      const parsedPin = z.boolean().parse(isPinned)
      toggleClipboardPin(parsedId, parsedPin)
    })
  })

  ipcMain.handle(IpcChannels.CLIPBOARD_UPDATE_LABEL, (_event, id: unknown, label: unknown) => {
    return handleSafe(() => {
      const parsedId = z.string().parse(id)
      const parsedLabel = z.string().nullable().parse(label)
      updateClipboardLabel(parsedId, parsedLabel)
    })
  })

  ipcMain.handle(IpcChannels.CLIPBOARD_DELETE_ITEM, (_event, id: unknown) => {
    return handleSafe(() => {
      const parsedId = z.string().parse(id)
      deleteClipboardItem(parsedId)
    })
  })

  ipcMain.handle(IpcChannels.CLIPBOARD_RESTORE_ITEM, (_event, content: unknown, isPinned: unknown, label: unknown) => {
    return handleSafe(() => {
      const parsedContent = z.string().parse(content)
      const parsedPin = z.boolean().parse(isPinned)
      const parsedLabel = z.string().nullable().parse(label)
      restoreClipboardItem(parsedContent, parsedPin, parsedLabel)
    })
  })

  ipcMain.handle(IpcChannels.CLIPBOARD_CLEAR_HISTORY, () => {
    return handleSafe(() => clearClipboardHistory())
  })

  ipcMain.handle(IpcChannels.CLIPBOARD_CREATE_SNIPPET, (_event, content: unknown, label: unknown) => {
    return handleSafe(() => {
      const parsedContent = z.string().parse(content)
      const parsedLabel = z.string().nullable().parse(label)
      createClipboardSnippet(parsedContent, parsedLabel)
    })
  })
}
