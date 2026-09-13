import { BrowserWindow, globalShortcut } from 'electron'
import { join } from 'path'
import { IpcChannels } from '../shared/ipcChannels'

let hudWindow: BrowserWindow | null = null

function createHudWindow(): BrowserWindow {
  if (hudWindow) return hudWindow

  const preloadPath = join(__dirname, '../preload/index.mjs')

  hudWindow = new BrowserWindow({
    width: 600,
    height: 64,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    center: true,
    show: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  hudWindow.on('closed', () => {
    hudWindow = null
  })

  hudWindow.on('blur', () => {
    hideHud()
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    hudWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#hud`)
  } else {
    hudWindow.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'hud' })
  }

  return hudWindow
}

export function showHud(): void {
  if (!hudWindow) {
    createHudWindow()
  }
  if (hudWindow) {
    hudWindow.show()
    hudWindow.focus()
  }
}

/** also sends a reset signal */
function hideHud(): void {
  if (hudWindow && hudWindow.isVisible()) {
    hudWindow.hide()
    hudWindow.webContents.send(IpcChannels.HUD_RESET)
    hudWindow.setSize(600, 64)
  }
}

export function toggleHud(): void {
  if (hudWindow && hudWindow.isVisible()) {
    hideHud()
  } else {
    showHud()
  }
}

let activeHotkey = ''

/** registers the shortcut and pre-creates the window hidden */
export function enableHud(shortcut: string = 'CommandOrControl+Shift+Space'): void {
  if (activeHotkey) {
    globalShortcut.unregister(activeHotkey)
  }

  activeHotkey = shortcut
  const registered = globalShortcut.register(activeHotkey, () => {
    toggleHud()
  })

  if (!registered) {
    console.error(`Failed to register global HUD hotkey: ${activeHotkey}`)
    activeHotkey = ''
  }

  createHudWindow()
}

export function disableHud(): void {
  if (activeHotkey) {
    globalShortcut.unregister(activeHotkey)
    activeHotkey = ''
  }

  if (hudWindow) {
    hudWindow.destroy()
    hudWindow = null
  }
}

/** e.g. to fit validation errors */
export function resizeHud(height: number): void {
  if (hudWindow) {
    hudWindow.setSize(600, height)
  }
}
