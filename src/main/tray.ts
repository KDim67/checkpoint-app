/** frameless window, not a native Menu: windows menus can't be styled, show counts or hold toggles */

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

const STARTUP_SETTING_KEY = 'startup_settings'

const PANEL_WIDTH = 288
/** starting height only; the panel measures itself since font size grows it and a fixed height clipped Quit */
const PANEL_HEIGHT = 380
/** so a bad measurement can't fill the screen */
const PANEL_MIN_HEIGHT = 200
const PANEL_MAX_HEIGHT = 720

let panelHeight = PANEL_HEIGHT
/** keeps the panel off the taskbar */
const PANEL_MARGIN = 8

let tray: Tray | null = null
let panel: BrowserWindow | null = null

export function getStartupSettings(): StartupSettings {
  return normalizeStartupSettings(getSetting<unknown>(STARTUP_SETTING_KEY, null))
}

/** openAtLogin lives in the registry, so write it through or the checkbox drifts */
export function setStartupSettings(next: unknown): StartupSettings {
  const settings = reconcile(normalizeStartupSettings(next))
  setSetting(STARTUP_SETTING_KEY, settings)

  try {
    app.setLoginItemSettings({
      openAtLogin: settings.openAtLogin,
      // lets a login launch start hidden, read back at startup
      args: settings.startMinimised ? [MINIMISED_FLAG] : []
    })
  } catch (err) {
    console.error('[tray] Could not update the login item:', err)
  }

  if (settings.showTrayIcon) createTray()
  else destroyTray()

  // same switches in the tray and Settings, keep them in step
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(IpcChannels.STARTUP_CHANGED, settings)
  }

  return settings
}

/** started at login, stay in the tray */
export function launchedMinimised(): boolean {
  // a failed settings read mustn't cost the window
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
  // getBounds is empty on some windows setups, fall back to the cursor that clicked
  const anchor = bounds && bounds.width > 0 ? bounds : { x: cursor.x, y: cursor.y, width: 0, height: 0 }
  const display = screen.getDisplayNearestPoint({ x: anchor.x, y: anchor.y })
  const area = display.workArea

  // taskbar can be on any edge, so go above or below by which half the icon's in
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
    // focusable so blur can dismiss it
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

/** reposition too: it sits above the taskbar, growing downward would push it off-screen */
export function setPanelHeight(height: number): void {
  const next = Math.round(Math.min(Math.max(height, PANEL_MIN_HEIGHT), PANEL_MAX_HEIGHT))
  if (next === panelHeight) return
  panelHeight = next
  if (!panel || panel.isDestroyed()) return
  panel.setContentSize(PANEL_WIDTH, panelHeight)
  const { x, y } = panelPosition()
  panel.setPosition(x, y, false)
}

function showPanel(): void {
  const win = createPanel()
  const { x, y } = panelPosition()
  win.setPosition(x, y, false)
  win.show()
  win.focus()
}

export function hidePanel(): void {
  if (panel && !panel.isDestroyed() && panel.isVisible()) panel.hide()
}

function togglePanel(): void {
  if (panel && !panel.isDestroyed() && panel.isVisible()) hidePanel()
  else showPanel()
}

export function showMainWindow(): void {
  hidePanel()
  const win = BrowserWindow.getAllWindows().find(w => !w.isDestroyed() && !w.getParentWindow() && w.isResizable())
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

function createTray(): void {
  if (tray && !tray.isDestroyed()) return

  const icon = nativeImage.createFromPath(join(__dirname, '../../resources/icon.png'))
  if (icon.isEmpty()) {
    console.error('[tray] Icon could not be loaded; not creating a tray icon.')
    return
  }

  // windows wants a small icon, full size comes out blurry
  tray = new Tray(icon.resize({ width: 16, height: 16 }))
  tray.setToolTip('Checkpoint')

  // left-click opens the app, right-click the panel, like the rest of the tray
  tray.on('click', () => showMainWindow())
  tray.on('double-click', () => showMainWindow())
  tray.on('right-click', () => togglePanel())
}

function destroyTray(): void {
  hidePanel()
  if (panel && !panel.isDestroyed()) { panel.destroy(); panel = null }
  if (tray && !tray.isDestroyed()) { tray.destroy(); tray = null }
}

export function initializeTray(): void {
  const settings = getStartupSettings()
  if (settings.showTrayIcon) createTray()
}
