/**
 * widget.ts, Phase 9 Desktop Widget
 *
 * Creates a transparent, frameless, always-on-top BrowserWindow that displays
 * a live summary overlay. Windows-only, returns null on other platforms.
 *
 * Usage:
 *   import { toggleWidget } from './widget'
 *   ipcMain.handle(IpcChannels.WIDGET_TOGGLE, () => toggleWidget())
 */

import { BrowserWindow, screen } from 'electron'
import { join } from 'path'

let widgetWindow: BrowserWindow | null = null

const WIDGET_WIDTH  = 280
const WIDGET_HEIGHT = 160

/** Creates the widget window. Returns null on non-Windows platforms. */
export function createWidget(): BrowserWindow | null {
  if (process.platform !== 'win32') return null

  // Position bottom-right by default, with 16px margin
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize
  const x = sw - WIDGET_WIDTH  - 16
  const y = sh - WIDGET_HEIGHT - 16

  const preloadPath = join(__dirname, '../preload/index.mjs')

  widgetWindow = new BrowserWindow({
    width:       WIDGET_WIDTH,
    height:      WIDGET_HEIGHT,
    x,
    y,
    frame:       false,
    transparent: true,
    skipTaskbar: true,
    resizable:   false,
    focusable:   false,          // will NOT steal focus from IDE/editor
    alwaysOnTop: true,
    type:        'toolbar',      // keeps it off the taskbar on Windows
    show:        false,
    webPreferences: {
      preload:          preloadPath,
      contextIsolation: true,
      nodeIntegration:  false,
      sandbox:          false
    }
  })

  // Null reference on close to allow GC
  widgetWindow.on('closed', () => {
    widgetWindow = null
  })

  widgetWindow.once('ready-to-show', () => {
    widgetWindow?.showInactive() // showInactive never steals focus
  })

  // Load the main renderer with the #widget hash route
  if (process.env['ELECTRON_RENDERER_URL']) {
    widgetWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#widget`)
  } else {
    widgetWindow.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'widget' })
  }

  return widgetWindow
}

/** Toggles widget visibility: creates it if null, destroys if exists. */
export function toggleWidget(): void {
  if (widgetWindow) {
    widgetWindow.destroy()
    widgetWindow = null
  } else {
    createWidget()
  }
}

/** Sets widget position (called from Settings). */
export function setWidgetPosition(
  position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
): void {
  if (!widgetWindow) return

  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize
  const margin = 16

  const positions: Record<typeof position, { x: number; y: number }> = {
    'top-left':     { x: margin,                      y: margin },
    'top-right':    { x: sw - WIDGET_WIDTH  - margin, y: margin },
    'bottom-left':  { x: margin,                      y: sh - WIDGET_HEIGHT - margin },
    'bottom-right': { x: sw - WIDGET_WIDTH  - margin, y: sh - WIDGET_HEIGHT - margin }
  }

  const { x, y } = positions[position]
  widgetWindow.setPosition(x, y)
}

/** Sets widget opacity (0.5–1.0). */
export function setWidgetOpacity(opacity: number): void {
  if (!widgetWindow) return
  widgetWindow.setOpacity(Math.max(0.1, Math.min(1.0, opacity)))
}
