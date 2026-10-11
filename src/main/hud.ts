import { BrowserWindow, globalShortcut } from 'electron'
import { join } from 'path'
import { IpcChannels } from '../shared/ipcChannels'

let hudWindow: BrowserWindow | null = null

const HUD_WIDTH = 600
/** the bar alone, and the bar with its longest list of suggestions */
const HUD_MIN_HEIGHT = 64
const HUD_MAX_HEIGHT = 420

function createHudWindow(): BrowserWindow {
  if (hudWindow) return hudWindow

  const preloadPath = join(__dirname, '../preload/index.mjs')

  hudWindow = new BrowserWindow({
    width: HUD_WIDTH,
    height: HUD_MIN_HEIGHT,
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

/** also sends a reset signal; the HUD sizes itself to what it shows after that */
export function hideHud(): void {
  if (hudWindow && hudWindow.isVisible()) {
    hudWindow.hide()
    hudWindow.webContents.send(IpcChannels.HUD_RESET)
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

/** the HUD asks for its content's height; a bad or huge ask can't hide it or cover the screen */
export function resizeHud(height: number): void {
  if (!hudWindow || typeof height !== 'number' || !Number.isFinite(height)) return
  // setSize only ever grows a transparent window that can't be resized by hand; this shrinks it too
  hudWindow.setContentSize(HUD_WIDTH, Math.round(Math.min(HUD_MAX_HEIGHT, Math.max(HUD_MIN_HEIGHT, height))))
}
