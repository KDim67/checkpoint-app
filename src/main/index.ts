import { app, BrowserWindow, nativeImage, ipcMain, Menu, shell, globalShortcut, dialog, clipboard, protocol, net } from 'electron'
import { join, relative, isAbsolute } from 'path'
import { writeFileSync, existsSync } from 'fs'
import { pathToFileURL } from 'url'
import { IpcChannels } from '../shared/ipcChannels'
import type { ShortcutMap } from '../shared/types'
import { getSetting } from './db'
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

// Register cheatsheet protocol as privileged before app.whenReady()
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

export function registerAppShortcuts(): void {
  // Unregister existing custom shortcut if any
  if (activeClipboardHotkey) {
    globalShortcut.unregister(activeClipboardHotkey)
    activeClipboardHotkey = ''
  }

  // Load customizer status
  const customizerEnabled = getSetting('customizer_enabled', 'false') === 'true'

  let hudKey = 'CommandOrControl+Shift+Space'
  let clipboardKey = 'CommandOrControl+Shift+V'

  if (customizerEnabled) {
    try {
      const rawShortcuts = getSetting('customizer_shortcuts', '{}')
      const shortcuts = JSON.parse(rawShortcuts)
      if (shortcuts.hud_toggle) hudKey = shortcuts.hud_toggle
      if (shortcuts.clipboard_toggle) clipboardKey = shortcuts.clipboard_toggle
    } catch (err) {
      console.error('[index.ts] Failed to parse customizer_shortcuts:', err)
    }
  }

  // 1. HUD Toggle shortcut (via hud module)
  try {
    const featureHud = getSetting('feature_hud', 'true')
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

function createWindow(): void {
  const preloadPath = join(__dirname, '../preload/index.mjs')
  const iconPath = join(__dirname, '../../resources/icon.ico')
  const appIcon = nativeImage.createFromPath(iconPath)

  mainWindow = new BrowserWindow({
    icon: appIcon,
    width: 1280,
    height: 800,
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

  // Show window only after it's ready to paint, eliminates white flash
  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  // Null reference on close, allows V8 garbage collection of the window
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // Open external links in the system browser, not a new Electron window
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // Load the renderer
  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// IPC Handlers

let activeAbortController: AbortController | null = null

function registerIpcHandlers(): void {
  ipcMain.handle(IpcChannels.APP_GET_VERSION, () => app.getVersion())

  ipcMain.handle(IpcChannels.APP_GET_DATA_PATH, () => app.getPath('userData'))

  ipcMain.handle(IpcChannels.APP_OPEN_EXTERNAL, (_event, url: string) => {
    shell.openExternal(url)
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

  // AI Streaming Handlers
  ipcMain.handle(IpcChannels.AI_STREAM_START, async (_event, params: unknown) => {
    if (activeAbortController) {
      activeAbortController.abort()
      activeAbortController = null
    }

    try {
      const parsedParams = params as import('../shared/types').AiStreamParams
      const { startAiStream } = await import('./aiService')

      activeAbortController = startAiStream(
        parsedParams,
        (chunk) => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send(IpcChannels.AI_CHUNK, chunk)
          }
        },
        () => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send(IpcChannels.AI_DONE)
          }
          activeAbortController = null
        },
        (err) => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send(IpcChannels.AI_ERROR, err.message)
          }
          activeAbortController = null
        }
      )
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error)
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(IpcChannels.AI_ERROR, errMsg)
      }
      activeAbortController = null
    }
  })

  ipcMain.handle(IpcChannels.AI_STREAM_ABORT, () => {
    if (activeAbortController) {
      activeAbortController.abort()
      activeAbortController = null
    }
    return true
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

  ipcMain.handle(IpcChannels.ANALYTICS_GET_DATA, async () => {
    const { getAnalyticsData } = await import('./analyticsService')
    return getAnalyticsData()
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
    const { getPluginsDir } = await import('./pluginRegistry')
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
}

// App Lifecycle

app.whenReady().then(async () => {
  createWindow()
  registerIpcHandlers()

  // Register cheatsheet protocol handler and ensure its directory exists
  try {
    await initCheatsheets()
    protocol.handle('cheatsheet', async (request) => {
      try {
        const url = new URL(request.url)
        const filename = decodeURIComponent(url.pathname.replace(/^\//, ''))
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

  // Lazy-load the database after window is created
  const { initDb } = await import('./db')
  const dataPath = app.getPath('userData')
  const db = initDb(dataPath)

  // Register DB IPC handlers (Phase 2, db.ts must be created first)
  const { registerDbHandlers } = await import('./db')
  registerDbHandlers(db)

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

  // Start Clipboard Watcher
  const { startClipboardWatcher } = await import('./clipboardWatcher')
  const { recordClipboardCopy } = await import('./db')
  startClipboardWatcher((text) => recordClipboardCopy(text))

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
    // macOS: re-create window on dock click if no windows exist
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  // Quit on non-macOS platforms
  if (process.platform !== 'darwin') {
    globalShortcut.unregisterAll()
    app.quit()
  }
})

app.on('quit', () => {
  globalShortcut.unregisterAll()
  // Stop Clipboard Watcher
  import('./clipboardWatcher').then(({ stopClipboardWatcher }) => {
    stopClipboardWatcher()
  }).catch(console.error)
  // Phase 22, Stop Customizer Engine
  import('./customizer').then(({ disableCustomizer }) => {
    disableCustomizer()
  }).catch(console.error)
  // Phase 17, Stop Webhook Gateway
  import('./webhookGateway').then(({ stopWebhookServer }) => {
    stopWebhookServer()
  }).catch(console.error)
  // Phase 18, Stop Global Quick-Capture HUD
  import('./hud').then(({ disableHud }) => {
    disableHud()
  }).catch(console.error)

  // Phase 20, Stop Backup Scheduler & Exit Backup
  import('./backupVault').then(({ shutdownBackupScheduler }) => {
    shutdownBackupScheduler()
  }).catch(console.error)

  // Phase 21, Stop Passive Activity Tracker
  import('./tracker').then(({ shutdownActivityTracker }) => {
    shutdownActivityTracker()
  }).catch(console.error)
})

export { mainWindow }
