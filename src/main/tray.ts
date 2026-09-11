/**
 * The system-tray icon and its panel.
 *
 * The panel is a frameless BrowserWindow at `#tray`, not a native `Menu`:
 * Windows draws those and they cannot be styled, show live counts, or hold a
 * toggle. Same pattern as the widget and the quick-capture HUD.
 *
 * The cost is that positioning and dismissal are ours, which is most of this file.
 */

import { app, BrowserWindow, Tray, nativeImage, screen } from 'electron'
import { join } from 'path'
import { IpcChannels } from '../shared/ipcChannels'
import { getSetting, setSetting } from './db'
import {
  normalizeStartupSettings,
  reconcile,
  shouldStartHidden,
  MINIMISED_FLAG,
  type StartupSettings
} from '../shared/startupSettings'

export const STARTUP_SETTING_KEY = 'startup_settings'

const PANEL_WIDTH = 288
/**
 * Starting height only. The panel measures its own content and asks to be
 * resized, because the content grows with the user's font-size setting and a
 * fixed height clipped the Quit button at anything above the default.
 */
const PANEL_HEIGHT = 380
/** Bounds on what the panel may ask for, so a bad measurement cannot fill the screen. */
const PANEL_MIN_HEIGHT = 200
const PANEL_MAX_HEIGHT = 720

let panelHeight = PANEL_HEIGHT
/** Gap between the tray icon and the panel, so it does not touch the taskbar. */
const PANEL_MARGIN = 8

let tray: Tray | null = null
let panel: BrowserWindow | null = null

export function getStartupSettings(): StartupSettings {
  return normalizeStartupSettings(getSetting<unknown>(STARTUP_SETTING_KEY, null))
}

/**
 * Stores settings and applies the ones the OS owns.
 *
 * `openAtLogin` is not a value we keep. It is a Windows registry entry that
 * Electron manages, so it is written through rather than merely recorded, or the
 * checkbox would drift from what actually happens at login.
 */
export function setStartupSettings(next: unknown): StartupSettings {
  const settings = reconcile(normalizeStartupSettings(next))
  setSetting(STARTUP_SETTING_KEY, settings)

  try {
    app.setLoginItemSettings({
      openAtLogin: settings.openAtLogin,
      // Passed so a login launch can start hidden; the app reads it back at
      // startup rather than guessing from the absence of a window.
      args: settings.startMinimised ? [MINIMISED_FLAG] : []
    })
  } catch (err) {
    console.error('[tray] Could not update the login item:', err)
  }

  if (settings.showTrayIcon) createTray()
  else destroyTray()

  // The same switches appear in the tray panel and in Settings. Without this the
  // two drift apart the moment one of them is used.
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(IpcChannels.STARTUP_CHANGED, settings)
  }

  return settings
}

/** True when Windows started this at login and it should stay in the tray. */
export function launchedMinimised(): boolean {
  // A failed settings read must not cost the window.
  try {
    return shouldStartHidden(process.argv, getStartupSettings())
  } catch (err) {
    console.error('[tray] Could not read the startup settings:', err)
    return false
  }
}

function panelPosition(): { x: number; y: number } {
  const bounds = tray?.getBounds()
  const cursor = screen.getCursorScreenPoint()
  // getBounds is empty on some Windows configurations, so the cursor is the
  // fallback. The click that opened this happened at it.
  const anchor = bounds && bounds.width > 0 ? bounds : { x: cursor.x, y: cursor.y, width: 0, height: 0 }
  const display = screen.getDisplayNearestPoint({ x: anchor.x, y: anchor.y })
  const area = display.workArea

  // Centred on the icon, then pulled back inside the work area. The taskbar can
  // sit on any edge, so the panel goes above or below depending on which half of
  // the screen the icon is in rather than assuming the bottom.
  const x = Math.round(
    Math.min(Math.max(anchor.x + anchor.width / 2 - PANEL_WIDTH / 2, area.x + PANEL_MARGIN),
      area.x + area.width - PANEL_WIDTH - PANEL_MARGIN)
  )
  const below = anchor.y < area.y + area.height / 2
  const y = below
    ? Math.round(anchor.y + anchor.height + PANEL_MARGIN)
    : Math.round(anchor.y - panelHeight - PANEL_MARGIN)

  return { x, y: Math.round(Math.min(Math.max(y, area.y + PANEL_MARGIN), area.y + area.height - panelHeight - PANEL_MARGIN)) }
}

function createPanel(): BrowserWindow {
  if (panel && !panel.isDestroyed()) return panel

  panel = new BrowserWindow({
    width: PANEL_WIDTH,
    height: panelHeight,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    // Focusable so blur can dismiss it. An unfocusable panel would have to be
    // closed some other way, and there is nothing obvious to click.
    focusable: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  panel.on('blur', () => hidePanel())
  panel.on('closed', () => { panel = null })

  if (process.env['ELECTRON_RENDERER_URL']) {
    panel.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#tray`)
  } else {
    panel.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'tray' })
  }
  return panel
}

/**
 * Resizes to the height the panel measured, then repositions.
 *
 * Repositioning matters as much as the size: the panel usually sits above the
 * taskbar, so growing it downward would push it off-screen rather than upward
 * away from the tray.
 */
export function setPanelHeight(height: number): void {
  const next = Math.round(Math.min(Math.max(height, PANEL_MIN_HEIGHT), PANEL_MAX_HEIGHT))
  if (next === panelHeight) return
  panelHeight = next
  if (!panel || panel.isDestroyed()) return
  panel.setContentSize(PANEL_WIDTH, panelHeight)
  const { x, y } = panelPosition()
  panel.setPosition(x, y, false)
}

export function showPanel(): void {
  const win = createPanel()
  const { x, y } = panelPosition()
  win.setPosition(x, y, false)
  win.show()
  win.focus()
}

export function hidePanel(): void {
  if (panel && !panel.isDestroyed() && panel.isVisible()) panel.hide()
}

export function togglePanel(): void {
  if (panel && !panel.isDestroyed() && panel.isVisible()) hidePanel()
  else showPanel()
}

/** Brings the main window forward, restoring and creating it as needed. */
export function showMainWindow(): void {
  hidePanel()
  const win = BrowserWindow.getAllWindows().find(w => !w.isDestroyed() && !w.getParentWindow() && w.isResizable())
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

export function createTray(): void {
  if (tray && !tray.isDestroyed()) return

  const icon = nativeImage.createFromPath(join(__dirname, '../../resources/icon.png'))
  if (icon.isEmpty()) {
    console.error('[tray] Icon could not be loaded; not creating a tray icon.')
    return
  }

  // Windows wants a small icon; passing the full-size image gives a blurry one.
  tray = new Tray(icon.resize({ width: 16, height: 16 }))
  tray.setToolTip('Checkpoint')

  // Left-click goes straight to the app, right-click opens the panel. The
  // convention Windows users already have from everything else in the tray.
  tray.on('click', () => showMainWindow())
  tray.on('double-click', () => showMainWindow())
  tray.on('right-click', () => togglePanel())
}

export function destroyTray(): void {
  hidePanel()
  if (panel && !panel.isDestroyed()) { panel.destroy(); panel = null }
  if (tray && !tray.isDestroyed()) { tray.destroy(); tray = null }
}

export function initializeTray(): void {
  const settings = getStartupSettings()
  if (settings.showTrayIcon) createTray()
}
