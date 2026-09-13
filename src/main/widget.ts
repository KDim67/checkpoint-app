/** windows only; main reads the widget_* settings, or it reset position every launch and the toggle inverted */

import { BrowserWindow, screen } from 'electron'
import { join } from 'path'
import { getSetting } from './db'

export type WidgetPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

let widgetWindow: BrowserWindow | null = null

const WIDGET_WIDTH  = 280
const WIDGET_HEIGHT = 160
const WIDGET_MARGIN = 16

// must match the settings panel defaults
const DEFAULT_POSITION: WidgetPosition = 'bottom-right'
const DEFAULT_OPACITY = 0.9

const POSITIONS: readonly WidgetPosition[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right']

function cornerFor(position: WidgetPosition): { x: number; y: number } {
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize
  const right  = sw - WIDGET_WIDTH  - WIDGET_MARGIN
  const bottom = sh - WIDGET_HEIGHT - WIDGET_MARGIN

  switch (position) {
    case 'top-left':    return { x: WIDGET_MARGIN, y: WIDGET_MARGIN }
    case 'top-right':   return { x: right,         y: WIDGET_MARGIN }
    case 'bottom-left': return { x: WIDGET_MARGIN, y: bottom }
    default:            return { x: right,         y: bottom }
  }
}

function clampOpacity(value: number): number {
  return Math.max(0.1, Math.min(1.0, value))
}

function storedPosition(): WidgetPosition {
  const raw = getSetting<string>('widget_position', DEFAULT_POSITION)
  // validated not cast, it indexes the corner table and a bad row could land offscreen
  return POSITIONS.includes(raw as WidgetPosition) ? (raw as WidgetPosition) : DEFAULT_POSITION
}

function storedOpacity(): number {
  const raw = Number(getSetting<string>('widget_opacity', String(DEFAULT_OPACITY)))
  return Number.isFinite(raw) ? clampOpacity(raw) : DEFAULT_OPACITY
}

function createWidget(): BrowserWindow | null {
  if (process.platform !== 'win32') return null

  const { x, y } = cornerFor(storedPosition())
  const preloadPath = join(__dirname, '../preload/index.mjs')

  widgetWindow = new BrowserWindow({
    width:       WIDGET_WIDTH,
    height:      WIDGET_HEIGHT,
    x,
    y,
    opacity:     storedOpacity(),
    frame:       false,
    transparent: true,
    skipTaskbar: true,
    resizable:   false,
    focusable:   false,          // won't steal focus from the IDE
    alwaysOnTop: true,
    type:        'toolbar',      // off the windows taskbar
    show:        false,
    webPreferences: {
      preload:          preloadPath,
      contextIsolation: true,
      nodeIntegration:  false,
      sandbox:          false
    }
  })

  widgetWindow.on('closed', () => {
    widgetWindow = null
  })

  widgetWindow.once('ready-to-show', () => {
    widgetWindow?.showInactive() // showInactive never steals focus
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    widgetWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#widget`)
  } else {
    widgetWindow.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'widget' })
  }

  return widgetWindow
}

/** explicit state, not a blind flip: the window can be missing for reasons the caller can't see */
export function setWidgetEnabled(active: boolean): void {
  if (active) {
    if (!widgetWindow) createWidget()
  } else if (widgetWindow) {
    widgetWindow.destroy()
    widgetWindow = null
  }
}

/** safe to call always */
export function restoreWidget(): void {
  if (getSetting<string>('widget_enabled', 'false') === 'true') setWidgetEnabled(true)
}

export function setWidgetPosition(position: WidgetPosition): void {
  if (!widgetWindow) return
  const { x, y } = cornerFor(position)
  widgetWindow.setPosition(x, y)
}

/** 0.3 to 1.0 from the slider */
export function setWidgetOpacity(opacity: number): void {
  if (!widgetWindow) return
  widgetWindow.setOpacity(clampOpacity(opacity))
}
