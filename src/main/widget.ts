/**
 * A transparent, frameless, always-on-top summary overlay. Windows only,
 * returns null elsewhere.
 *
 * The three widget_* settings are read here, not just in the panel that writes
 * them. Nothing in main used to consult them, so the window came back
 * bottom-right at full opacity every launch, and since nothing restored it at
 * startup the toggle inverted: the panel painted the switch ON from the stored
 * flag with no window present, so the next click ran a blind flip that made one.
 */

import { BrowserWindow, screen } from 'electron'
import { join } from 'path'
import { getSetting } from './db'

export type WidgetPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

let widgetWindow: BrowserWindow | null = null

const WIDGET_WIDTH  = 280
const WIDGET_HEIGHT = 160
const WIDGET_MARGIN = 16

// Must match the defaults the settings panel falls back to, or the widget
// appears somewhere the UI is not showing.
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
  // Validated rather than cast: this value reaches an index into the corner
  // table, and a stale or hand-edited row should not place the window offscreen.
  return POSITIONS.includes(raw as WidgetPosition) ? (raw as WidgetPosition) : DEFAULT_POSITION
}

function storedOpacity(): number {
  const raw = Number(getSetting<string>('widget_opacity', String(DEFAULT_OPACITY)))
  return Number.isFinite(raw) ? clampOpacity(raw) : DEFAULT_OPACITY
}

/** Creates the widget window. Returns null on non-Windows platforms. */
export function createWidget(): BrowserWindow | null {
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

/**
 * Applies an explicit desired state. Idempotent, unlike the blind flip this
 * replaced. The caller knows whether the user asked for the widget, and the
 * window can be absent for reasons the caller cannot see (a previous launch,
 * a non-Windows platform), so a flip and the switch drift apart.
 */
export function setWidgetEnabled(active: boolean): void {
  if (active) {
    if (!widgetWindow) createWidget()
  } else if (widgetWindow) {
    widgetWindow.destroy()
    widgetWindow = null
  }
}

/** Recreates the widget at launch if it was left on. Safe to call always. */
export function restoreWidget(): void {
  if (getSetting<string>('widget_enabled', 'false') === 'true') setWidgetEnabled(true)
}

/** Sets widget position (called from Settings). */
export function setWidgetPosition(position: WidgetPosition): void {
  if (!widgetWindow) return
  const { x, y } = cornerFor(position)
  widgetWindow.setPosition(x, y)
}

/** Sets widget opacity (0.3–1.0 from the settings slider). */
export function setWidgetOpacity(opacity: number): void {
  if (!widgetWindow) return
  widgetWindow.setOpacity(clampOpacity(opacity))
}
