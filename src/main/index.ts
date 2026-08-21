import { app, BrowserWindow, nativeImage, ipcMain, Menu, shell, globalShortcut, dialog, clipboard, protocol, net, screen } from 'electron'
import path, { join, relative, isAbsolute } from 'path'
import fs, { writeFileSync, existsSync } from 'fs'
import { pathToFileURL } from 'url'
import { IpcChannels } from '../shared/ipcChannels'
import type { ShortcutMap } from '../shared/types'
import { getSetting, setSetting, closeDb } from './db'
import { enableHud, disableHud } from './hud'
import { initTitleBarSync, updateNativeTitleBarFromSettings } from './titleBarSync'
import {
  initCheatsheets,
  listCheatsheets,
  addCheatsheet,
  renameCheatsheet,
  removeCheatsheet,
  selectFile,
  getCheatsheetsDir,
  getCheatsheetText
} from './cheatsheetService'
import { batchRenameFiles, selectTextureFile, loadTextureFile, savePbrMaps, saveSeamlessTexture, selectFolder, saveSpriteAtlas, saveSlicedSprites, saveLutTexture, saveUpscaledTexture } from './gamedevService'
import { SyncService } from './syncService'

const syncService = new SyncService()

// Register protocols as privileged before app.whenReady()
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'cheatsheet',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      bypassCSP: true,
      stream: true
    }
  },
  {
    scheme: 'checkpoint-media',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      bypassCSP: true,
      stream: true
    }
  }
])

// Disable background throttling BEFORE app.whenReady()
// Critical: allows the app to function fully alongside Unity/VS/JetBrains.
app.commandLine.appendSwitch('disable-background-timer-throttling')
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('wm-window-animations-disabled')
app.commandLine.appendSwitch('log-level', '3')

// Suppress default Electron menu bar entirely
Menu.setApplicationMenu(null)

let mainWindow: BrowserWindow | null = null
let activeClipboardHotkey = ''

// Single Instance Lock
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
}

export function registerAppShortcuts(): void {
  // Unregister existing custom shortcut if any
  if (activeClipboardHotkey) {
    globalShortcut.unregister(activeClipboardHotkey)
    activeClipboardHotkey = ''
  }

  // Load customizer status
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
      console.error('[index.ts] Failed to parse customizer_shortcuts:', err)
    }
  }

  // 1. HUD Toggle shortcut (via hud module)
  try {
    const featureHud = getSetting<string>('feature_hud', 'true')
    if (featureHud !== 'false') {
      enableHud(hudKey)
    } else {
      disableHud()
    }
  } catch (err) {
    console.error('[index.ts] Failed to bind HUD shortcut:', err)
  }

  // 2. Clipboard Toggle shortcut
  activeClipboardHotkey = clipboardKey
  const registered = globalShortcut.register(activeClipboardHotkey, () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
      mainWindow.webContents.send(IpcChannels.APP_NAVIGATE_TO_VIEW, 'clipboard')
    }
  })

  if (!registered) {
    console.error(`Failed to register global clipboard hotkey: ${activeClipboardHotkey}`)
    activeClipboardHotkey = ''
  }
}

/**
 * shell.openExternal hands the URL to the OS, which will happily run a
 * file:// path or a registered protocol handler. Links reach us from note
 * markdown, cheatsheets and AI responses, so the scheme is checked before
 * anything leaves the app.
 */
const EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])

function openExternalSafely(url: string): void {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    console.warn('[index.ts] Refusing to open unparseable URL:', url)
    return
  }
  if (!EXTERNAL_PROTOCOLS.has(parsed.protocol)) {
    console.warn('[index.ts] Refusing to open non-web URL:', parsed.protocol)
    return
  }
  shell.openExternal(parsed.href).catch(err => {
    console.error('Failed to open external URL:', err)
  })
}

interface WindowBounds {
  width: number
  height: number
  x?: number
  y?: number
  maximized?: boolean
}

const DEFAULT_BOUNDS: WindowBounds = { width: 1280, height: 800 }

/**
 * Restores the saved bounds, but only if the window would still land on a
 * connected display, otherwise unplugging a second monitor strands the app
 * off-screen with no way to drag it back (the titlebar is custom).
 */
function loadWindowBounds(): WindowBounds {
  try {
    const raw = getSetting<string | null>('window_bounds', null)
    if (!raw) return DEFAULT_BOUNDS
    const saved = (typeof raw === 'string' ? JSON.parse(raw) : raw) as WindowBounds
    if (!Number.isFinite(saved.width) || !Number.isFinite(saved.height)) return DEFAULT_BOUNDS

    const bounds: WindowBounds = {
      width: Math.max(800, Math.round(saved.width)),
      height: Math.max(600, Math.round(saved.height)),
      maximized: !!saved.maximized
    }
    const x = saved.x
    const y = saved.y
    if (typeof x === 'number' && Number.isFinite(x) && typeof y === 'number' && Number.isFinite(y)) {
      const visible = screen.getAllDisplays().some(d => {
        const a = d.workArea
        return x < a.x + a.width && x + bounds.width > a.x
          && y < a.y + a.height && y + bounds.height > a.y
      })
      if (visible) {
        bounds.x = Math.round(x)
        bounds.y = Math.round(y)
      }
    }
    return bounds
  } catch (err) {
    console.error('[index.ts] Failed to read window bounds:', err)
    return DEFAULT_BOUNDS
  }
}

let saveBoundsTimer: NodeJS.Timeout | null = null

function saveWindowBoundsNow(): void {
  if (saveBoundsTimer) {
    clearTimeout(saveBoundsTimer)
    saveBoundsTimer = null
  }
  if (!mainWindow || mainWindow.isDestroyed()) return
  try {
    const maximized = mainWindow.isMaximized()
    // getBounds() reports the maximized frame; persist the restore size so
    // un-maximizing returns to the size the user actually chose.
    const { width, height, x, y } = maximized ? mainWindow.getNormalBounds() : mainWindow.getBounds()
    setSetting('window_bounds', JSON.stringify({ width, height, x, y, maximized }))
  } catch (err) {
    console.error('[index.ts] Failed to save window bounds:', err)
  }
}

/** Debounced: resize and move fire continuously while dragging. */
function scheduleSaveWindowBounds(): void {
  if (saveBoundsTimer) clearTimeout(saveBoundsTimer)
  saveBoundsTimer = setTimeout(saveWindowBoundsNow, 400)
}

function createWindow(): void {
  const preloadPath = join(__dirname, '../preload/index.mjs')
  const iconPath = join(__dirname, '../../resources/icon.ico')
  const appIcon = nativeImage.createFromPath(iconPath)

  const bounds = loadWindowBounds()

  mainWindow = new BrowserWindow({
    icon: appIcon,
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    minWidth: 800,
    minHeight: 600,
    show: false,                    // show: false prevents white flash on startup
    frame: false,                   // custom titlebar
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#0b0c10',
      symbolColor: '#f1f5f9',
      height: 32
    },
    backgroundColor: '#0b0c10',    // matches --color-background, prevents flash
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      // sandbox: false is required because better-sqlite3 runs in the main process
      // via IPC, not the renderer. The renderer itself is sandboxed via contextIsolation.
      sandbox: false
    }
  })

  // Reveal the window once it can paint, eliminates the white flash. This is
  // guarded and backed by `did-finish-load` plus a safety timeout so a slow or
  // racy dev server (where `ready-to-show` may never fire after a failed initial
  // load) can never leave us with only a detached DevTools window and no app.
  let hasShown = false
  const revealWindow = (): void => {
    if (hasShown || !mainWindow || mainWindow.isDestroyed()) return
    hasShown = true
    clearTimeout(revealTimeout)    // cancel safety fallback if an event fires first
    if (bounds.maximized) mainWindow.maximize()
    mainWindow.show()
    mainWindow.focus()
  }
  // Absolute fallback: if neither event fires (hard load-failure loop), show anyway.
  const revealTimeout = setTimeout(revealWindow, 8000)
  mainWindow.on('ready-to-show', revealWindow)
  mainWindow.webContents.on('did-finish-load', revealWindow)

  mainWindow.on('resize', scheduleSaveWindowBounds)
  mainWindow.on('move', scheduleSaveWindowBounds)
  mainWindow.on('maximize', scheduleSaveWindowBounds)
  mainWindow.on('unmaximize', scheduleSaveWindowBounds)
  // Flush before teardown, or a resize inside the debounce window is lost.
  mainWindow.on('close', saveWindowBoundsNow)

  // Null reference on close, allows V8 garbage collection of the window
  mainWindow.on('closed', () => {
    mainWindow = null
    // Quit the app when the main window is closed on non-macOS platforms
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })

  // Open external links in the system browser, not a new Electron window
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternalSafely(url)
    return { action: 'deny' }
  })

  // Load the renderer
  if (process.env['ELECTRON_RENDERER_URL']) {
    const devUrl = process.env['ELECTRON_RENDERER_URL']
    mainWindow.loadURL(devUrl)

    // Open DevTools only AFTER the app has actually loaded, so a failed initial
    // load can never leave a lone DevTools window floating over a hidden app.
    mainWindow.webContents.once('did-finish-load', () => {
      if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDevToolsOpened()) {
        mainWindow.webContents.openDevTools()
      }
    })

    // Retry loading if the dev server is not warm yet, stored handle cancels on success.
    let failRetryTimeout: NodeJS.Timeout | null = null
    mainWindow.webContents.on('did-finish-load', () => {
      if (failRetryTimeout) { clearTimeout(failRetryTimeout); failRetryTimeout = null }
    })
    mainWindow.webContents.on('did-fail-load', (_event, errorCode, _errorDescription, validatedURL) => {
      if (validatedURL.startsWith(devUrl)) {
        console.log(`[Dev Server] Port not ready yet (error code: ${errorCode}). Retrying load in 1s...`)
        failRetryTimeout = setTimeout(() => {
          failRetryTimeout = null
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.loadURL(devUrl)
          }
        }, 1000)
      }
    })
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// IPC Handlers

// One live stream per consumer channel ('assistant', 'standup', …). The legacy
// no-id call maps to the '' channel, so old callers keep single-stream semantics.
const aiStreamControllers = new Map<string, AbortController>()
let structuredAbortController: AbortController | null = null

function registerIpcHandlers(): void {
  ipcMain.handle(IpcChannels.APP_GET_VERSION, () => app.getVersion())

  ipcMain.handle(IpcChannels.APP_GET_DATA_PATH, () => app.getPath('userData'))

  ipcMain.handle(IpcChannels.APP_OPEN_EXTERNAL, (_event, url: unknown) => {
    if (typeof url === 'string') openExternalSafely(url)
  })

  ipcMain.on(IpcChannels.APP_MINIMIZE, () => mainWindow?.minimize())
  ipcMain.on(IpcChannels.APP_MAXIMIZE, () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize()
    } else {
      mainWindow?.maximize()
    }
  })
  ipcMain.on(IpcChannels.APP_CLOSE, () => mainWindow?.close())

  ipcMain.handle(IpcChannels.APP_SAVE_FILE, async (_event, defaultName: string, content: string) => {
    if (!mainWindow) return false
    const { filePath, canceled } = await dialog.showSaveDialog(mainWindow, {
      defaultPath: defaultName,
      filters: [{ name: 'Markdown', extensions: ['md'] }]
    })
    if (canceled || !filePath) return false
    try {
      writeFileSync(filePath, content, 'utf8')
      return true
    } catch (err) {
      console.error('Failed to write exported backlog file:', err)
      return false
    }
  })

  ipcMain.handle(IpcChannels.APP_SHOW_ITEM_IN_FOLDER, (_event, filePath: string) => {
    try {
      shell.showItemInFolder(filePath)
    } catch (err) {
      console.error('Failed to show item in folder:', err)
    }
  })

  // AI Streaming Handlers
  // Each consumer passes a streamId ('assistant', 'standup', …) so multiple
  // features can stream concurrently without cross-talk. Events carry the id
  // back so renderer subscribers can filter to their own stream.
  ipcMain.handle(IpcChannels.AI_STREAM_START, async (_event, params: unknown, streamId?: unknown) => {
    const id = typeof streamId === 'string' ? streamId : ''

    // Starting a new stream on the same channel replaces the old one
    const existing = aiStreamControllers.get(id)
    if (existing) {
      existing.abort()
      aiStreamControllers.delete(id)
    }

    const send = (channel: string, ...args: unknown[]): void => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(channel, ...args)
      }
    }

    try {
      const parsedParams = params as import('../shared/types').AiStreamParams
      const { startAiStream } = await import('./aiService')

      const controller = startAiStream(
        parsedParams,
        (chunk) => send(IpcChannels.AI_CHUNK, chunk, id),
        () => {
          send(IpcChannels.AI_DONE, id)
          aiStreamControllers.delete(id)
        },
        (err) => {
          send(IpcChannels.AI_ERROR, err.message, id)
          aiStreamControllers.delete(id)
        }
      )
      aiStreamControllers.set(id, controller)
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error)
      send(IpcChannels.AI_ERROR, errMsg, id)
      aiStreamControllers.delete(id)
    }
  })

  ipcMain.handle(IpcChannels.AI_STREAM_ABORT, (_event, streamId?: unknown) => {
    const id = typeof streamId === 'string' ? streamId : undefined
    if (id === undefined) {
      // Legacy no-id abort: stop everything
      for (const controller of aiStreamControllers.values()) controller.abort()
      aiStreamControllers.clear()
    } else {
      aiStreamControllers.get(id)?.abort()
      aiStreamControllers.delete(id)
    }
    return true
  })

  // Reliable structured generation (board / plan / dialogue), request/response,
  // not streamed. Uses tool-calling / JSON-schema when the endpoint supports it.
  ipcMain.handle(IpcChannels.AI_GENERATE_STRUCTURED, async (_event, params: unknown) => {
    if (structuredAbortController) {
      structuredAbortController.abort()
    }
    const controller = new AbortController()
    structuredAbortController = controller
    try {
      const { generateStructured } = await import('./aiActions')
      const typed = params as import('../shared/types').AiStructuredParams
      const result = await generateStructured(typed, controller.signal)
      return result
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error)
      return { ok: false, error: errMsg }
    } finally {
      if (structuredAbortController === controller) structuredAbortController = null
    }
  })

  ipcMain.handle(IpcChannels.AI_GENERATE_ABORT, () => {
    if (structuredAbortController) {
      structuredAbortController.abort()
      structuredAbortController = null
    }
    return true
  })
  
  ipcMain.handle(IpcChannels.AI_TEST_CONNECTION, async (_event, baseURL: string, apiKey: string) => {
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      const trimmedKey = apiKey.trim()
      if (trimmedKey && trimmedKey !== 'ollama') {
        headers['Authorization'] = `Bearer ${trimmedKey}`
      }
      const res = await fetch(`${baseURL.replace(/\/+$/, '')}/models`, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(8000)
      })
      if (res.ok) {
        return { success: true }
      } else {
        const text = await res.text().catch(() => '')
        return { success: false, error: `HTTP ${res.status}: ${text || res.statusText}` }
      }
    } catch (err) {
      return { success: false, error: (err as Error).message || 'Network request failed' }
    }
  })

  // AI Cookbook Handlers
  ipcMain.handle(IpcChannels.HARDWARE_GET_SPECS, async () => {
    const { getHardwareSpecs } = await import('./profiler')
    return getHardwareSpecs()
  })

  ipcMain.handle(IpcChannels.OLLAMA_CHECK_INSTALLED, async () => {
    const { checkOllama } = await import('./ollamaManager')
    return checkOllama()
  })

  ipcMain.handle(IpcChannels.OLLAMA_LIST_LOCAL, async () => {
    const { listLocalModels } = await import('./ollamaManager')
    return listLocalModels()
  })

  ipcMain.handle(IpcChannels.OLLAMA_PULL, async (_event, modelTag: string) => {
    if (!mainWindow) return
    const { pullModel } = await import('./ollamaManager')
    // Run in background and stream progress via push IPC
    pullModel(modelTag, mainWindow).catch(console.error)
  })

  ipcMain.handle(IpcChannels.OLLAMA_STOP, async () => {
    const { stopPull } = await import('./ollamaManager')
    stopPull()
  })

  ipcMain.handle(IpcChannels.OLLAMA_DELETE, async (_event, modelTag: string) => {
    const { deleteModel } = await import('./ollamaManager')
    return deleteModel(modelTag)
  })
  // Widget Handlers
  ipcMain.handle(IpcChannels.WIDGET_TOGGLE, async () => {
    const { toggleWidget } = await import('./widget')
    toggleWidget()
  })

  ipcMain.handle(IpcChannels.WIDGET_SET_POSITION, async (_event, position: string) => {
    const { setWidgetPosition } = await import('./widget')
    setWidgetPosition(position as 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right')
  })

  ipcMain.handle(IpcChannels.WIDGET_SET_OPACITY, async (_event, opacity: number) => {
    const { setWidgetOpacity } = await import('./widget')
    setWidgetOpacity(opacity)
  })

  // Markdown Notes Handlers
  ipcMain.handle(IpcChannels.NOTES_LIST, async () => {
    const { listNotes } = await import('./notesFsService')
    return listNotes()
  })

  ipcMain.handle(IpcChannels.NOTES_READ, async (_event, title: string) => {
    const { readNote } = await import('./notesFsService')
    return readNote(title)
  })

  ipcMain.handle(IpcChannels.NOTES_WRITE, async (_event, title: string, content: string, oldTitle?: string) => {
    const { writeNote } = await import('./notesFsService')
    return writeNote(title, content, oldTitle)
  })

  ipcMain.handle(IpcChannels.NOTES_DELETE, async (_event, title: string) => {
    const { deleteNote } = await import('./notesFsService')
    return deleteNote(title)
  })

  ipcMain.handle(IpcChannels.NOTES_SEARCH, async (_event, query: string) => {
    const { searchNotes } = await import('./notesFsService')
    return searchNotes(query)
  })

  // Maps Handlers
  ipcMain.handle('maps:list', async () => {
    const { listMaps } = await import('./mapsFsService')
    return listMaps()
  })

  ipcMain.handle('maps:read', async (_event, name: string) => {
    const { readMap } = await import('./mapsFsService')
    return readMap(name)
  })

  ipcMain.handle('maps:write', async (_event, name: string, content: string) => {
    const { writeMap } = await import('./mapsFsService')
    return writeMap(name, content)
  })

  ipcMain.handle('maps:delete', async (_event, name: string) => {
    const { deleteMap } = await import('./mapsFsService')
    return deleteMap(name)
  })

  // Git Integration Handlers
  ipcMain.handle(IpcChannels.GIT_CHECK, async (_event, repoPath: string) => {
    const { checkRepo } = await import('./gitService')
    return checkRepo(repoPath)
  })

  ipcMain.handle(IpcChannels.GIT_STATUS, async (_event, repoPath: string) => {
    const { getGitStatus } = await import('./gitService')
    return getGitStatus(repoPath)
  })

  ipcMain.handle(IpcChannels.GIT_LOG, async (_event, repoPath: string) => {
    const { getGitLog } = await import('./gitService')
    return getGitLog(repoPath)
  })

  ipcMain.handle(IpcChannels.CLIPBOARD_PASTE, (_event, content: string) => {
    clipboard.writeText(content)
    mainWindow?.hide()
    return true
  })

  ipcMain.handle(IpcChannels.ANALYTICS_GET_DATA, async (_event, context?: string | null) => {
    const { getAnalyticsData } = await import('./analyticsService')
    return getAnalyticsData(context ?? null)
  })

  ipcMain.handle(IpcChannels.WEBHOOK_TOGGLE, async (_event, active: boolean, port: number) => {
    const { toggleWebhookGateway } = await import('./webhookGateway')
    const actualPort = await toggleWebhookGateway(active, port)
    if (active && actualPort) {
      const { setSetting } = await import('./db')
      setSetting('webhook_port', String(actualPort))
    }
    return actualPort
  })

  ipcMain.handle(IpcChannels.HUD_TOGGLE, async (_event, active?: boolean) => {
    const { enableHud, disableHud, toggleHud } = await import('./hud')
    if (active === true) {
      enableHud()
    } else if (active === false) {
      disableHud()
    } else {
      toggleHud()
    }
  })

  ipcMain.on('hud:resize', (_event, height: number) => {
    import('./hud').then(({ resizeHud }) => {
      resizeHud(height)
    }).catch(console.error)
  })

  // Backup Handlers
  ipcMain.handle(IpcChannels.BACKUP_RUN, async (_event, action?: 'backup' | 'restore' | 'delete' | 'init', filename?: string) => {
    const { runBackup, runRestore, deleteBackup, initializeBackupScheduler } = await import('./backupVault')
    if (action === 'restore' && filename) {
      await runRestore(filename)
    } else if (action === 'delete' && filename) {
      deleteBackup(filename)
    } else if (action === 'init') {
      initializeBackupScheduler()
    } else {
      await runBackup()
    }
  })

  ipcMain.handle(IpcChannels.BACKUP_STATUS, async () => {
    const { getBackupDir, listCompletedBackups } = await import('./backupVault')
    const { getSetting } = await import('./db')
    const enabled = getSetting<string>('feature_backup', 'true') !== 'false'
    const interval = getSetting<string>('backup_interval', 'daily')
    const path = getBackupDir()
    const maxCountStr = getSetting<string>('backup_max_count', '10')
    const maxCount = parseInt(maxCountStr, 10) || 10
    const backups = listCompletedBackups()
    return { enabled, interval, path, maxCount, backups }
  })

  // Activity Tracker Handlers
  ipcMain.handle(IpcChannels.TRACKER_TOGGLE, async (_event, active: boolean) => {
    const { toggleTracker } = await import('./tracker')
    toggleTracker(active)
  })

  ipcMain.handle(IpcChannels.TRACKER_GET_STATE, async () => {
    const { getTrackerState } = await import('./tracker')
    return getTrackerState()
  })

  // Phase 22 Customizer & Extensions Handlers
  ipcMain.handle('customizer:toggleEngine', async (_event, active: boolean) => {
    const { enableCustomizer, disableCustomizer } = await import('./customizer')
    const { setSetting } = await import('./db')
    setSetting('customizer_enabled', String(active))
    if (active) {
      await enableCustomizer()
    } else {
      await disableCustomizer()
    }
    // Re-register hotkeys in either case to apply new or default mappings
    registerAppShortcuts()
  })

  ipcMain.handle('customizer:getEngineState', async () => {
    const { getSetting } = await import('./db')
    return getSetting<string>('customizer_enabled', 'false') === 'true'
  })

  ipcMain.handle(IpcChannels.CUSTOMIZER_UPDATE_THEME, async (_event, vars: Record<string, string>) => {
    const { setSetting } = await import('./db')
    const { buildCssVariablesString, broadcastTheme, updateTitleBarOverlay } = await import('./customizer')
    setSetting('customizer_theme_vars', JSON.stringify(vars))
    const css = buildCssVariablesString(vars)
    broadcastTheme(css)
    updateTitleBarOverlay(vars)
  })

  ipcMain.handle('customizer:getTheme', async () => {
    const { getSetting } = await import('./db')
    const rawVars = getSetting('customizer_theme_vars', '{}')
    try {
      return JSON.parse(rawVars as string)
    } catch {
      return {}
    }
  })

  ipcMain.handle(IpcChannels.CUSTOMIZER_GET_PLUGINS, async () => {
    const { scanPlugins } = await import('./pluginRegistry')
    const { getSetting } = await import('./db')
    const rawPlugins = getSetting('customizer_active_plugins', '[]')
    let activePlugins: string[] = []
    try {
      activePlugins = JSON.parse(rawPlugins as string)
    } catch {
      // ignore
    }
    return scanPlugins(activePlugins)
  })

  ipcMain.handle(IpcChannels.CUSTOMIZER_TOGGLE_PLUGIN, async (_event, filename: string, active: boolean) => {
    const { getSetting, setSetting } = await import('./db')
    const { loadPlugin, unloadPlugin } = await import('./pluginRegistry')
    
    const rawPlugins = getSetting('customizer_active_plugins', '[]')
    let activePlugins: string[] = []
    try {
      activePlugins = JSON.parse(rawPlugins as string)
    } catch {
      // ignore
    }

    if (active) {
      if (!activePlugins.includes(filename)) {
        activePlugins.push(filename)
      }
      loadPlugin(filename)
    } else {
      activePlugins = activePlugins.filter(name => name !== filename)
      unloadPlugin(filename)
    }

    setSetting('customizer_active_plugins', JSON.stringify(activePlugins))
  })

  ipcMain.handle(IpcChannels.CUSTOMIZER_OPEN_PLUGINS_FOLDER, async () => {
    const { getPluginsDir } = await import('./paths')
    const dir = getPluginsDir()
    await shell.openPath(dir)
  })

  ipcMain.handle(IpcChannels.CUSTOMIZER_REGISTER_SHORTCUTS, async (_event, shortcuts: ShortcutMap) => {
    const { setSetting } = await import('./db')
    setSetting('customizer_shortcuts', JSON.stringify(shortcuts))
    registerAppShortcuts()
  })

  ipcMain.handle('customizer:getShortcuts', async () => {
    const { getSetting } = await import('./db')
    const rawShortcuts = getSetting('customizer_shortcuts', '{}')
    try {
      return JSON.parse(rawShortcuts as string)
    } catch {
      return {}
    }
  })

  // Cheatsheets Handlers
  ipcMain.handle(IpcChannels.CHEATSHEETS_LIST, async () => {
    return listCheatsheets()
  })

  ipcMain.handle(IpcChannels.CHEATSHEETS_ADD, async (_event, filePath: string) => {
    return addCheatsheet(filePath)
  })

  ipcMain.handle(IpcChannels.CHEATSHEETS_REMOVE, async (_event, name: string) => {
    return removeCheatsheet(name)
  })

  ipcMain.handle(IpcChannels.CHEATSHEETS_RENAME, async (_event, oldName: string, newName: string) => {
    return renameCheatsheet(oldName, newName)
  })

  ipcMain.handle(IpcChannels.CHEATSHEETS_SELECT, async () => {
    return selectFile()
  })

  ipcMain.handle(IpcChannels.CHEATSHEETS_GET_TEXT, async (_event, name: string) => {
    return getCheatsheetText(name)
  })

  // P2P Network Sync Handlers
  ipcMain.handle(IpcChannels.SYNC_START_HOST, (_event, port?: number) => {
    syncService.startHost(port)
  })

  ipcMain.handle(IpcChannels.SYNC_STOP_HOST, () => {
    syncService.stopHost()
  })

  ipcMain.handle(IpcChannels.SYNC_CONNECT_AND_SYNC, async (_event, hostIp: string, port: number, pairingCode: string) => {
    const dataPath = app.getPath('userData')
    return syncService.connectAndSync(hostIp, port, pairingCode, dataPath)
  })

  ipcMain.handle(IpcChannels.SYNC_GET_STATUS, () => {
    return syncService.getStatus()
  })

  ipcMain.handle(IpcChannels.SYNC_GET_DISCOVERED_PEERS, () => {
    return syncService.getDiscoveredPeers()
  })

  ipcMain.handle(IpcChannels.SYNC_GET_DB_PAYLOAD, () => {
    return syncService.getDatabasePayload()
  })

  ipcMain.handle(IpcChannels.SYNC_APPLY_DB_PAYLOAD, (_event, payload: any) => {
    return syncService.applyDatabasePayload(payload)
  })

  ipcMain.handle(IpcChannels.SYNC_GET_FILE_INDEX, (_event, subDir: 'notes' | 'media') => {
    const dataPath = app.getPath('userData')
    return syncService.getFileIndex(subDir, dataPath)
  })

  ipcMain.handle(IpcChannels.SYNC_READ_FILE_CHUNK, async (_event, subDir: 'notes' | 'media', relPath: string) => {
    const dataPath = app.getPath('userData')
    const filePath = path.join(dataPath, subDir, relPath)
    if (!fs.existsSync(filePath)) return null
    return fs.readFileSync(filePath)
  })

  ipcMain.handle(IpcChannels.SYNC_WRITE_FILE_CHUNK, async (_event, subDir: 'notes' | 'media', relPath: string, buffer: ArrayBuffer, mtime?: number) => {
    const dataPath = app.getPath('userData')
    const destDir = path.join(dataPath, subDir)
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true })
    }
    const destPath = path.join(destDir, relPath)
    fs.writeFileSync(destPath, Buffer.from(buffer))
    if (mtime) {
      const timeSecs = mtime / 1000
      fs.utimesSync(destPath, timeSecs, timeSecs)
    }
  })

  ipcMain.handle(IpcChannels.SYNC_DELETE_FILE, async (_event, subDir: 'notes' | 'media', relPath: string) => {
    const dataPath = app.getPath('userData')
    const filePath = path.join(dataPath, subDir, relPath)
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
    }
  })

  ipcMain.handle(IpcChannels.SYNC_APPLY_BOARD_BASELINE, async (_event, context: string, items: any[], tags: any[], itemTags: any[], relations: any[]) => {
    const { applyBoardBaselineTx } = await import('./db')
    return applyBoardBaselineTx(context, items, tags, itemTags, relations)
  })

  ipcMain.handle(IpcChannels.SYNC_APPLY_REMOTE_MUTATION, async (_event, mutation: any) => {
    const { applyRemoteMutationTx } = await import('./db')
    return applyRemoteMutationTx(mutation)
  })

  ipcMain.handle(IpcChannels.CHEATSHEETS_GET_RELEVANT, async (_event, name: string, query: string, maxChars?: number) => {
    const { getCheatsheetRelevant } = await import('./cheatsheetService')
    return getCheatsheetRelevant(name, query, maxChars)
  })

  ipcMain.handle(IpcChannels.CHEATSHEETS_SEARCH, async (_event, query: string) => {
    const { searchCheatsheets } = await import('./cheatsheetService')
    return searchCheatsheets(typeof query === 'string' ? query : '')
  })

  ipcMain.handle(IpcChannels.GAMEDEV_BATCH_RENAME, async (_event, files: any) => {
    try {
      return await batchRenameFiles(files)
    } catch (err: any) {
      console.error('IPC batchRenameFiles failed:', err)
      return { success: false, renamedCount: 0, errors: [{ oldPath: '', newPath: '', error: err.message || String(err) }] }
    }
  })

  ipcMain.handle(IpcChannels.GAMEDEV_SELECT_TEXTURE, async () => {
    try {
      return await selectTextureFile()
    } catch (err: any) {
      console.error('IPC selectTextureFile failed:', err)
      return null
    }
  })

  ipcMain.handle(IpcChannels.GAMEDEV_LOAD_TEXTURE, async (_event, path: string) => {
    try {
      return await loadTextureFile(path)
    } catch (err: any) {
      console.error('IPC loadTextureFile failed:', err)
      return null
    }
  })

  ipcMain.handle(IpcChannels.GAMEDEV_SAVE_MAPS, async (_event, params: { albedoPath: string; maps: any }) => {
    try {
      return await savePbrMaps(params.albedoPath, params.maps)
    } catch (err: any) {
      console.error('IPC savePbrMaps failed:', err)
      return { success: false, writtenFiles: [], error: err.message || String(err) }
    }
  })

  ipcMain.handle(IpcChannels.GAMEDEV_SAVE_SEAMLESS, async (_event, params: { originalPath: string; dataUrl: string }) => {
    try {
      return await saveSeamlessTexture(params.originalPath, params.dataUrl)
    } catch (err: any) {
      console.error('IPC saveSeamlessTexture failed:', err)
      return { success: false, error: err.message || String(err) }
    }
  })

  ipcMain.handle(IpcChannels.GAMEDEV_SELECT_SPRITE_FOLDER, async () => {
    try {
      return await selectFolder()
    } catch (err: any) {
      console.error('IPC selectFolder failed:', err)
      return null
    }
  })

  ipcMain.handle(IpcChannels.GAMEDEV_SAVE_SPRITE_ATLAS, async (_event, params: { folderPath: string; atlasDataUrl: string; atlasJson: string }) => {
    try {
      return await saveSpriteAtlas(params.folderPath, params.atlasDataUrl, params.atlasJson)
    } catch (err: any) {
      console.error('IPC saveSpriteAtlas failed:', err)
      return { success: false, error: err.message || String(err) }
    }
  })

  ipcMain.handle(IpcChannels.GAMEDEV_SAVE_SLICES, async (_event, params: { originalPath: string; files: Array<{ index: number; dataUrl: string }> }) => {
    try {
      return await saveSlicedSprites(params.originalPath, params.files)
    } catch (err: any) {
      console.error('IPC saveSlices failed:', err)
      return { success: false, count: 0, error: err.message || String(err) }
    }
  })

  ipcMain.handle(IpcChannels.GAMEDEV_SAVE_LUT, async (_event, params: { originalPath: string; dataUrl: string }) => {
    try {
      return await saveLutTexture(params.originalPath, params.dataUrl)
    } catch (err: any) {
      console.error('IPC saveLut failed:', err)
      return { success: false, error: err.message || String(err) }
    }
  })

  ipcMain.handle(IpcChannels.GAMEDEV_SAVE_UPSCALED, async (_event, params: { originalPath: string; suffix: string; dataUrl: string }) => {
    try {
      return await saveUpscaledTexture(params.originalPath, params.suffix, params.dataUrl)
    } catch (err: any) {
      console.error('IPC saveUpscaled failed:', err)
      return { success: false, error: err.message || String(err) }
    }
  })

  // Local Media Handlers
  ipcMain.handle(IpcChannels.MEDIA_SAVE_FROM_BUFFER, async (_event, arrayBuffer: ArrayBuffer, extension: string) => {
    try {
      const { saveBufferToMedia } = await import('./mediaService')
      const buffer = Buffer.from(arrayBuffer)
      return saveBufferToMedia(buffer, extension)
    } catch (err) {
      console.error('IPC media:saveFromBuffer failed:', err)
      throw err
    }
  })

  ipcMain.handle(IpcChannels.MEDIA_SAVE_FILE_PATHS, async (_event, filePaths: string[]) => {
    try {
      const { saveFilesToMedia } = await import('./mediaService')
      return saveFilesToMedia(filePaths)
    } catch (err) {
      console.error('IPC media:saveFilePaths failed:', err)
      throw err
    }
  })

  ipcMain.handle(IpcChannels.MEDIA_SCAN_AND_PRUNE, async () => {
    try {
      const { scanAndPruneOrphanedMedia } = await import('./mediaService')
      return scanAndPruneOrphanedMedia()
    } catch (err) {
      console.error('IPC media:scanAndPrune failed:', err)
      throw err
    }
  })

  ipcMain.handle(IpcChannels.MEDIA_GET_STORAGE_INFO, async () => {
    try {
      const { getStorageInfo } = await import('./mediaService')
      return getStorageInfo()
    } catch (err) {
      console.error('IPC media:getStorageInfo failed:', err)
      throw err
    }
  })
}

// App Lifecycle

app.whenReady().then(async () => {
  // The database opens before the window because createWindow restores the
  // saved bounds through getSetting. initDb is synchronous, and the window is
  // created hidden regardless, it is not revealed until ready-to-show, which
  // waits on the renderer bundle and dwarfs the cost of opening SQLite.
  const { initDb, registerDbHandlers } = await import('./db')
  const db = initDb(app.getPath('userData'))

  createWindow()
  registerIpcHandlers()

  // Register cheatsheet protocol handler and ensure its directory exists
  try {
    await initCheatsheets()
    protocol.handle('cheatsheet', async (request) => {
      try {
        const url = new URL(request.url)
        let rawPath = url.host ? (url.host + url.pathname) : url.pathname
        // Strip the dummy 'show/' host/prefix if present
        if (rawPath.toLowerCase().startsWith('show/')) {
          rawPath = rawPath.substring(5)
        }
        const filename = decodeURIComponent(rawPath.replace(/^\//, '')).replace(/\/$/, '')
        const dir = getCheatsheetsDir()
        const filePath = join(dir, filename)

        // Prevent directory traversal
        const relativePath = relative(dir, filePath)
        if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
          return new Response('Access Denied', { status: 403 })
        }

        if (!existsSync(filePath)) {
          return new Response('File Not Found', { status: 404 })
        }

        return net.fetch(pathToFileURL(filePath).toString())
      } catch (err) {
        console.error('Failed to serve cheatsheet file:', err)
        return new Response('Error loading file', { status: 500 })
      }
    })
  } catch (err) {
    console.error('Failed to initialize cheatsheets folder/protocol:', err)
  }

  // Register checkpoint-media protocol handler and ensure its directory exists
  try {
    const { ensureMediaDir } = await import('./mediaService')
    const { getMediaDir } = await import('./paths')
    ensureMediaDir()
    protocol.handle('checkpoint-media', async (request) => {
      try {
        const url = new URL(request.url)
        const rawPath = url.host ? (url.host + url.pathname) : url.pathname
        const filename = decodeURIComponent(rawPath.replace(/^\//, '')).replace(/\/$/, '')
        const dir = getMediaDir()
        const filePath = join(dir, filename)

        // Prevent directory traversal
        const relativePath = relative(dir, filePath)
        if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
          return new Response('Access Denied', { status: 403 })
        }

        if (!existsSync(filePath)) {
          return new Response('File Not Found', { status: 404 })
        }

        return net.fetch(pathToFileURL(filePath).toString())
      } catch (err) {
        console.error('Failed to serve media file:', err)
        return new Response('Error loading file', { status: 500 })
      }
    })
  } catch (err) {
    console.error('Failed to initialize checkpoint-media folder/protocol:', err)
  }

  registerDbHandlers(db)

  // Context Export
  ipcMain.handle(IpcChannels.DB_EXPORT_CONTEXT, async (_event, context: string, contextName: string) => {
    try {
      const window = BrowserWindow.getFocusedWindow()
      if (!window) return { success: false, error: 'No active window' }

      const { filePath } = await dialog.showSaveDialog(window, {
        title: `Export Workspace Context: ${contextName}`,
        defaultPath: `${contextName.toLowerCase()}-workspace.json`,
        filters: [{ name: 'JSON Workspace', extensions: ['json'] }]
      })

      if (!filePath) return { success: false, cancelled: true }

      const { exportContextData } = await import('./db')
      const payload = exportContextData(db, context)
      
      fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8')
      return { success: true, filePath }
    } catch (err: any) {
      console.error('Failed to export workspace context:', err)
      return { success: false, error: err.message || String(err) }
    }
  })

  // Context Import File Selector
  ipcMain.handle(IpcChannels.DB_IMPORT_CONTEXT, async () => {
    try {
      const window = BrowserWindow.getFocusedWindow()
      if (!window) return { success: false, error: 'No active window' }

      const { filePaths } = await dialog.showOpenDialog(window, {
        title: 'Import Workspace Context',
        filters: [{ name: 'JSON Workspace', extensions: ['json'] }],
        properties: ['openFile']
      })

      if (!filePaths || filePaths.length === 0) return { success: false, cancelled: true }

      const filePath = filePaths[0]
      const raw = fs.readFileSync(filePath, 'utf8')
      const parsed = JSON.parse(raw)

      if (!parsed.context || !Array.isArray(parsed.items)) {
        return { success: false, error: 'Invalid workspace context file format.' }
      }

      return { success: true, payload: parsed }
    } catch (err: any) {
      console.error('Failed to import workspace context:', err)
      return { success: false, error: err.message || String(err) }
    }
  })

  // Context Import Data Insertion
  ipcMain.handle(IpcChannels.DB_IMPORT_CONTEXT_DATA, async (_event, newContextSlug: string, data: any) => {
    try {
      const { importContextData } = await import('./db')
      importContextData(db, newContextSlug, data)
      return { success: true }
    } catch (err: any) {
      console.error('Failed to save imported workspace data:', err)
      return { success: false, error: err.message || String(err) }
    }
  })

  // Context Rename
  ipcMain.handle(IpcChannels.DB_RENAME_CONTEXT, async (_event, oldSlug: string, newSlug: string) => {
    try {
      db.transaction(() => {
        db.prepare('UPDATE items SET context = ? WHERE context = ?').run(newSlug, oldSlug)
        db.prepare('UPDATE focus_sessions SET context = ? WHERE context = ?').run(newSlug, oldSlug)
        db.prepare('UPDATE ai_memories SET context = ? WHERE context = ?').run(newSlug, oldSlug)
        db.prepare('UPDATE activity_tracking_logs SET context = ? WHERE context = ?').run(newSlug, oldSlug)
      })()
      return { success: true }
    } catch (err: any) {
      console.error('Failed to rename context:', err)
      return { success: false, error: err.message || String(err) }
    }
  })

  // Initialize AI Memory & Workspace IPC Services
  try {
    const { initMemoryIpc } = await import('./memoryService')
    const { initWorkspaceIpc } = await import('./workspaceService')
    initMemoryIpc()
    initWorkspaceIpc()
  } catch (err) {
    console.error('Failed to initialize AI Memory or Workspace IPC:', err)
  }

  // Synchronize native titlebar overlay colors
  try {
    initTitleBarSync(() => getSetting<string>('app_theme', 'dark'))
    const appTheme = getSetting<string>('app_theme', 'dark')
    updateNativeTitleBarFromSettings(appTheme)
  } catch (err) {
    console.error('Failed to initialize titlebar synchronization:', err)
  }

  // Start Backup Vaulting
  try {
    const { initializeBackupScheduler } = await import('./backupVault')
    initializeBackupScheduler()
  } catch (err) {
    console.error('Failed to initialize Backup Vaulting:', err)
  }

  // Clipboard Watcher, record the capture, then push a change event so the
  // renderer refreshes instantly instead of waiting on a slow poll. Only starts
  // when the Clipboard feature is on; setSetting flips it live after that.
  const { configureClipboardWatcher, setClipboardCaptureEnabled } = await import('./clipboardWatcher')
  const { recordClipboardCopy } = await import('./db')
  configureClipboardWatcher((text) => {
    recordClipboardCopy(text)
    mainWindow?.webContents.send(IpcChannels.CLIPBOARD_HISTORY_CHANGED)
  })
  setClipboardCaptureEnabled(getSetting<string>('feature_view_clipboard', 'true') !== 'false')

  // Load customization engine if enabled
  try {
    const { getSetting } = await import('./db')
    const customizerEnabled = getSetting<string>('customizer_enabled', 'false') === 'true'
    if (customizerEnabled) {
      const { enableCustomizer } = await import('./customizer')
      await enableCustomizer()
    }
  } catch (err) {
    console.error('Failed to initialize Customizer Engine:', err)
  }

  // Register application hotkeys (HUD & Clipboard)
  registerAppShortcuts()

  // Phase 17, Start Webhook Gateway if enabled
  try {
    const { getSetting } = await import('./db')
    const featureWebhook = getSetting<string>('feature_webhook', 'true')
    if (featureWebhook !== 'false') {
      const portSetting = getSetting<string>('webhook_port', '9988')
      const port = parseInt(portSetting, 10) || 9988
      const { toggleWebhookGateway } = await import('./webhookGateway')
      await toggleWebhookGateway(true, port)
    }
  } catch (err) {
    console.error('Failed to auto-start Webhook Gateway:', err)
  }

  // Phase 21, Start Passive Activity Tracker if enabled
  try {
    const { initializeActivityTracker } = await import('./tracker')
    initializeActivityTracker()
  } catch (err) {
    console.error('Failed to auto-start Passive Activity Tracker:', err)
  }

  app.on('activate', () => {
    // macOS: re-create window on dock click if no main window exists
    if (!mainWindow || mainWindow.isDestroyed()) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  // Quit on non-macOS platforms
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('will-quit', (e) => {
  // Prevent immediate termination so we can perform async cleanup
  e.preventDefault()

  globalShortcut.unregisterAll()

  // Clean up all background services in parallel
  Promise.all([
    import('./clipboardWatcher').then(({ stopClipboardWatcher }) => stopClipboardWatcher()).catch(() => {}),
    import('./customizer').then(({ disableCustomizer }) => disableCustomizer()).catch(() => {}),
    import('./webhookGateway').then(({ stopWebhookServer }) => stopWebhookServer()).catch(() => {}),
    import('./hud').then(({ disableHud }) => disableHud()).catch(() => {}),
    import('./backupVault').then(({ shutdownBackupScheduler }) => shutdownBackupScheduler()).catch(() => {}),
    import('./tracker').then(({ shutdownActivityTracker }) => shutdownActivityTracker()).catch(() => {}),
    Promise.resolve().then(() => { try { syncService.stopHost() } catch {} })
  ]).catch(() => {}).finally(() => {
    closeDb()  // checkpoint WAL and close SQLite cleanly before exit
    app.exit(0)
  })

  // Safety timeout: force exit if cleanup takes longer than 800ms
  setTimeout(() => {
    app.exit(0)
  }, 800)
})

export { mainWindow }
