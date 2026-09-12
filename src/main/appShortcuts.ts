/**
 * The global hotkeys, rebound whenever the customizer changes them.
 *
 * The clipboard key is held so the old binding can be released before a new one
 * is taken; registering over a live binding leaves the first one holding the key.
 */

import { globalShortcut } from 'electron'
import { IpcChannels } from '../shared/ipcChannels'
import { getSetting } from './db'
import { enableHud, disableHud } from './hud'
import { getMainWindow } from './windows'

let activeClipboardHotkey = ''

export function registerAppShortcuts(): void {
  if (activeClipboardHotkey) {
    globalShortcut.unregister(activeClipboardHotkey)
    activeClipboardHotkey = ''
  }

  const customizerEnabled = getSetting<string>('customizer_enabled', 'false') === 'true'

  let hudKey = 'CommandOrControl+Shift+Space'
  let clipboardKey = 'CommandOrControl+Shift+V'

  if (customizerEnabled) {
    try {
      const rawShortcuts = getSetting<string>('customizer_shortcuts', '{}')
      const shortcuts = JSON.parse(rawShortcuts)
      if (shortcuts.hud_toggle) hudKey = shortcuts.hud_toggle
      if (shortcuts.clipboard_toggle) clipboardKey = shortcuts.clipboard_toggle
    } catch (err) {
      console.error('[shortcuts] Failed to parse customizer_shortcuts:', err)
    }
  }

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
