import { describe, it, expect, vi } from 'vitest'
import { ipcMain } from 'electron'
import { registerClipboardVaultHandlers } from '../src/main/ipc/clipboardVault'
import { IpcChannels } from '../src/shared/ipcChannels'

describe('registerClipboardVaultHandlers', () => {
  it('registers handlers for clipboard history channels on ipcMain', () => {
    const registered: string[] = []
    vi.spyOn(ipcMain, 'handle').mockImplementation((channel: string) => {
      registered.push(channel)
    })

    registerClipboardVaultHandlers()

    expect(registered).toContain(IpcChannels.CLIPBOARD_GET_HISTORY)
    expect(registered).toContain(IpcChannels.CLIPBOARD_TOGGLE_PIN)
    expect(registered).toContain(IpcChannels.CLIPBOARD_UPDATE_LABEL)
    expect(registered).toContain(IpcChannels.CLIPBOARD_DELETE_ITEM)
    expect(registered).toContain(IpcChannels.CLIPBOARD_RESTORE_ITEM)
    expect(registered).toContain(IpcChannels.CLIPBOARD_CLEAR_HISTORY)
    expect(registered).toContain(IpcChannels.CLIPBOARD_CREATE_SNIPPET)
  })
})
