/** clipboard key is held so the old binding is released first; registering over a live one keeps the old */

import { globalShortcut } from 'electron'
import { IpcChannels } from '../shared/ipcChannels'
import { getSetting } from './db'
import { enableHud, disableHud } from './hud'
import { getMainWindow } from './windows'

let activeClipboardHotkey = ''

/** the keys you bound in Shortcuts, or the defaults when they can't be read; picking a light or dark theme used to switch yours off with the custom colours */
function boundKeys(): { hudKey: string; clipboardKey: string } {
  const keys = { hudKey: 'CommandOrControl+Shift+Space', clipboardKey: 'CommandOrControl+Shift+V' }
  try {
    const shortcuts = JSON.parse(getSetting<string>('customizer_shortcuts', '{}'))
    if (shortcuts.hud_toggle) keys.hudKey = shortcuts.hud_toggle
    if (shortcuts.clipboard_toggle) keys.clipboardKey = shortcuts.clipboard_toggle
  } catch (err) {
    console.error('[shortcuts] Failed to parse customizer_shortcuts:', err)
  }
  return keys
}

/** switching Quick Capture back on in Settings used to bring back the default key over your own */
export function hudShortcut(): string {
  return boundKeys().hudKey
}

export function registerAppShortcuts(): void {
  if (activeClipboardHotkey) {
    globalShortcut.unregister(activeClipboardHotkey)
    activeClipboardHotkey = ''
  }

  const { hudKey, clipboardKey } = boundKeys()

  try {
    const featureHud = getSetting<string>('feature_hud', 'true')
    if (featureHud !== 'false') {
      enableHud(hudKey)
    } else {
      disableHud()
    }
  } catch (err) {
    console.error('[shortcuts] Failed to bind HUD shortcut:', err)
  }

  activeClipboardHotkey = clipboardKey
  const registered = globalShortcut.register(activeClipboardHotkey, () => {
    const win = getMainWindow()
    if (win) {
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
      win.webContents.send(IpcChannels.APP_NAVIGATE_TO_VIEW, 'clipboard')
    }
  })

  if (!registered) {
    console.error(`Failed to register global clipboard hotkey: ${activeClipboardHotkey}`)
    activeClipboardHotkey = ''
  }
}
