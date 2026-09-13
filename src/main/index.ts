import { app, BrowserWindow, nativeImage, Menu, shell, globalShortcut, dialog, protocol, net, screen } from 'electron'
import { join, relative, isAbsolute } from 'path'
import { existsSync } from 'fs'
import { pathToFileURL } from 'url'
import { IpcChannels } from '../shared/ipcChannels'
import { getSetting, setSetting, closeDb } from './db'
import { initTitleBarSync, updateNativeTitleBarFromSettings } from './titleBarSync'
import { initCheatsheets, getCheatsheetsDir } from './cheatsheetService'
import { beginQuit, getMainWindow, isQuitting, sendToWindow, setMainWindow } from './windows'
import { registerAppShortcuts } from './appShortcuts'
import { getStartupSettings, launchedMinimised } from './tray'

// pure constants, so this static import doesn't drag the MCP SDK (express, hono) into startup
import { MCP_DEFAULT_PORT, WEBHOOK_DEFAULT_PORT } from '../shared/ports'


// must happen before app.whenReady()
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

// windows heads toasts from the AppUserModelID; must match electron-builder's appId, set before whenReady
if (process.platform === 'win32') {
  app.setAppUserModelId('com.checkpoint.app')
}

// before whenReady; keeps timers running alongside Unity/VS/JetBrains
app.commandLine.appendSwitch('disable-background-timer-throttling')
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('wm-window-animations-disabled')
app.commandLine.appendSwitch('log-level', '3')

Menu.setApplicationMenu(null)


/** last resort: electron's default kills the process and loses in-flight work, so log and survive */
process.on('uncaughtException', err => {
  console.error('[main] uncaught exception:', err)
})
process.on('unhandledRejection', reason => {
  console.error('[main] unhandled rejection:', reason)
})

const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = getMainWindow()
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })
}

/** openExternal will run file:// or protocol handlers; links come from notes, cheatsheets and AI */
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

/** only if it lands on a connected display, an unplugged monitor would strand it (custom titlebar) */
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
  const win = getMainWindow()
  if (!win || win.isDestroyed()) return
  try {
    const maximized = win.isMaximized()
    // persist the restore size, getBounds() reports the maximized frame
    const { width, height, x, y } = maximized ? win.getNormalBounds() : win.getBounds()
    setSetting('window_bounds', JSON.stringify({ width, height, x, y, maximized }))
  } catch (err) {
    console.error('[index.ts] Failed to save window bounds:', err)
  }
}

/** resize and move fire continuously while dragging */
function scheduleSaveWindowBounds(): void {
  if (saveBoundsTimer) clearTimeout(saveBoundsTimer)
  saveBoundsTimer = setTimeout(saveWindowBoundsNow, 400)
}

function createWindow(): void {
  const preloadPath = join(__dirname, '../preload/index.mjs')
  const iconPath = join(__dirname, '../../resources/icon.ico')
  const appIcon = nativeImage.createFromPath(iconPath)

  const bounds = loadWindowBounds()

  const win = new BrowserWindow({
    icon: appIcon,
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    minWidth: 800,
    minHeight: 600,
    show: false,                    // hidden until ready, avoids a white flash
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
      // required for better-sqlite3 over IPC; renderer still isolated via contextIsolation
      sandbox: false
    }
  })
  setMainWindow(win)

  // did-finish-load and a timeout back up ready-to-show, which a racy dev server may never fire
  let hasShown = false
  const revealWindow = (): void => {
    if (hasShown || win.isDestroyed()) return
    hasShown = true
    clearTimeout(revealTimeout)    // cancel safety fallback if an event fires first

    // loaded but hidden, the tray is the way in
    if (launchedMinimised()) {
      // maximising a hidden window shows it, so wait for the tray
      if (bounds.maximized) win.once('show', () => win.maximize())
      return
    }

    if (bounds.maximized) win.maximize()
    win.show()
    win.focus()
  }
  // neither event fired (load-failure loop), show anyway
  const revealTimeout = setTimeout(revealWindow, 8000)
  win.on('ready-to-show', revealWindow)
  win.webContents.on('did-finish-load', revealWindow)

  win.on('resize', scheduleSaveWindowBounds)
  win.on('move', scheduleSaveWindowBounds)
  win.on('maximize', scheduleSaveWindowBounds)
  win.on('unmaximize', scheduleSaveWindowBounds)
  // flush, or a resize inside the debounce is lost
  win.on('close', saveWindowBoundsNow)

  // off by default, closing has always quit
  win.on('close', event => {
    if (isQuitting() || process.platform === 'darwin') return
    let closeToTray = false
    try {
      // read live so the toggle needs no restart; static import since require() throws in ESM and gets swallowed
      const settings = getStartupSettings()
      closeToTray = settings.closeToTray && settings.showTrayIcon
    } catch (err) {
      console.error('[tray] Could not read the close behaviour:', err)
    }
    if (closeToTray) {
      event.preventDefault()
      win.hide()
    }
  })

  win.on('closed', () => {
    setMainWindow(null)
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })

  /** app only, or a set location could swap in a remote page behind the same preload bridge */
  win.webContents.on('will-navigate', (event, url) => {
    const here = win.webContents.getURL()
    // dev server reloads through here, same-origin stays allowed
    if (here && new URL(url).origin === new URL(here).origin) return
    event.preventDefault()
    openExternalSafely(url)
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternalSafely(url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    const devUrl = process.env['ELECTRON_RENDERER_URL']
    win.loadURL(devUrl)

    // only after load, so a failed load never leaves a lone DevTools window
    win.webContents.once('did-finish-load', () => {
      if (!win.isDestroyed() && !win.webContents.isDevToolsOpened()) {
        win.webContents.openDevTools()
      }
    })

    // dev server may not be warm yet; handle cancels on success
    let failRetryTimeout: NodeJS.Timeout | null = null
    win.webContents.on('did-finish-load', () => {
      if (failRetryTimeout) { clearTimeout(failRetryTimeout); failRetryTimeout = null }
    })
    win.webContents.on('did-fail-load', (_event, errorCode, _errorDescription, validatedURL) => {
      if (validatedURL.startsWith(devUrl)) {
        console.log(`[Dev Server] Port not ready yet (error code: ${errorCode}). Retrying load in 1s...`)
        failRetryTimeout = setTimeout(() => {
          failRetryTimeout = null
          if (!win.isDestroyed()) {
            win.loadURL(devUrl)
          }
        }, 1000)
      }
    })
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}


import { registerAppHandlers } from './ipc/app'
import { registerAiHandlers } from './ipc/ai'
import { registerCookbookHandlers } from './ipc/cookbook'
import { registerWidgetHandlers } from './ipc/widget'
import { registerNotesHandlers } from './ipc/notes'
import { registerGitHandlers } from './ipc/git'
import { registerClipboardHandlers } from './ipc/clipboard'
import { registerAnalyticsHandlers } from './ipc/analytics'
import { registerWebhookHandlers } from './ipc/webhook'
import { registerStartupHandlers } from './ipc/startup'
import { registerTrayHandlers } from './ipc/tray'
import { registerSubtasksHandlers } from './ipc/subtasks'
import { registerExportsHandlers } from './ipc/exports'
import { registerNotificationsHandlers } from './ipc/notifications'
import { registerRecurrenceHandlers } from './ipc/recurrence'
import { registerMcpHandlers } from './ipc/mcp'
import { registerHudHandlers } from './ipc/hud'
import { registerBackupHandlers } from './ipc/backup'
import { registerCustomizerHandlers } from './ipc/customizer'
import { registerCheatsheetsHandlers } from './ipc/cheatsheets'
import { registerSyncHandlers, stopSyncHost } from './ipc/sync'
import { registerContextHandlers } from './ipc/context'
import { registerGamedevHandlers } from './ipc/gamedev'
import { registerMediaHandlers } from './ipc/media'

/** one call per module; this was a single 1,086-line function every branch conflicted in */
function registerIpcHandlers(): void {
  registerAppHandlers()
  registerAiHandlers()
  registerCookbookHandlers()
  registerWidgetHandlers()
  registerNotesHandlers()
  registerGitHandlers()
  registerClipboardHandlers()
  registerAnalyticsHandlers()
  registerWebhookHandlers()
  registerStartupHandlers()
  registerTrayHandlers()
  registerSubtasksHandlers()
  registerExportsHandlers()
  registerNotificationsHandlers()
  registerRecurrenceHandlers()
  registerMcpHandlers()
  registerHudHandlers()
  registerBackupHandlers()
  registerCustomizerHandlers()
  registerCheatsheetsHandlers()
  registerSyncHandlers()
  registerGamedevHandlers()
  registerMediaHandlers()
}

app.whenReady().then(async () => {
  // db before window: createWindow reads saved bounds via getSetting; opening SQLite is cheap next to the bundle
  const { initDb } = await import('./db')
  const { registerDbHandlers } = await import('./ipc/db')
  const { registerClipboardVaultHandlers } = await import('./ipc/clipboardVault')

  /** a bad db used to take the window down; now it's moved aside, kept and reported */
  let db: Awaited<ReturnType<typeof initDb>>
  const userData = app.getPath('userData')
  try {
    db = initDb(userData)
  } catch (err) {
    console.error('[main] The database would not open:', err)
    const { quarantineDatabase, recoveryMessage, stampFor } = await import('./dbRecovery')
    const { getBackupDir } = await import('./backupVault')
    const { discardDb } = await import('./db')

    // handle is live after the failed read, and windows won't rename a file still held
    discardDb()

    try {
      const { movedTo } = quarantineDatabase(join(userData, 'checkpoint.db'), stampFor(Date.now()))
      db = initDb(userData)
      // after the window, so the dialog has something to sit in front of
      createWindow()
      dialog.showMessageBox({
        type: 'warning',
        title: 'Checkpoint started with an empty database',
        message: 'Your database could not be opened',
        detail: recoveryMessage(movedTo, getBackupDir()),
        buttons: ['OK']
      }).catch(() => {})
      registerIpcHandlers()
      registerDbHandlers(db)
  registerClipboardVaultHandlers()

  // last, packaged only; nothing waits on it
  void import('./updater').then(({ initializeUpdater }) => initializeUpdater())
      return
    } catch (fatal) {
      // second failure isn't the file, a third try would fail too
      console.error('[main] Could not start even with a fresh database:', fatal)
      dialog.showErrorBox(
        'Checkpoint cannot start',
        'The database could not be opened or recreated. Check that the disk is writable and not full, then try again.'
      )
      app.quit()
      return
    }
  }

  createWindow()
  registerIpcHandlers()

  try {
    await initCheatsheets()
    protocol.handle('cheatsheet', async (request) => {
      try {
        const url = new URL(request.url)
        let rawPath = url.host ? (url.host + url.pathname) : url.pathname
        // strip the dummy show/ host
        if (rawPath.toLowerCase().startsWith('show/')) {
          rawPath = rawPath.substring(5)
        }
        const filename = decodeURIComponent(rawPath.replace(/^\//, '')).replace(/\/$/, '')
        const dir = getCheatsheetsDir()
        const filePath = join(dir, filename)

        // no directory traversal
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

  try {
    const { ensureMediaDir } = await import('./mediaService')
    const { ensurePreview, previewWidthFor } = await import('./mediaPreview')
    const { getMediaDir } = await import('./paths')
    ensureMediaDir()
    protocol.handle('checkpoint-media', async (request) => {
      try {
        const url = new URL(request.url)
        const rawPath = url.host ? (url.host + url.pathname) : url.pathname
        const filename = decodeURIComponent(rawPath.replace(/^\//, '')).replace(/\/$/, '')
        const dir = getMediaDir()
        const filePath = join(dir, filename)

        // no directory traversal
        const relativePath = relative(dir, filePath)
        if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
          return new Response('Access Denied', { status: 403 })
        }

        if (!existsSync(filePath)) {
          return new Response('File Not Found', { status: 404 })
        }

        // ?w= wants a display-sized copy; without it callers get the original bytes
        const wanted = Number(url.searchParams.get('w'))
        if (Number.isFinite(wanted) && wanted > 0) {
          const preview = ensurePreview(filePath, previewWidthFor(wanted))
          if (preview) return net.fetch(pathToFileURL(preview).toString())
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

  // last, packaged only; updater starts at most once however often this runs
  void import('./updater').then(({ initializeUpdater }) => initializeUpdater())

  registerContextHandlers(db)

  try {
    const { initMemoryIpc } = await import('./memoryService')
    const { initWorkspaceIpc } = await import('./workspaceService')
    initMemoryIpc()
    initWorkspaceIpc()
  } catch (err) {
    console.error('Failed to initialize AI Memory or Workspace IPC:', err)
  }

  try {
    initTitleBarSync(() => getSetting<string>('app_theme', 'dark'))
    const appTheme = getSetting<string>('app_theme', 'dark')
    updateNativeTitleBarFromSettings(appTheme)
  } catch (err) {
    console.error('Failed to initialize titlebar synchronization:', err)
  }

  try {
    const { initializeBackupScheduler } = await import('./backupVault')
    initializeBackupScheduler()
  } catch (err) {
    console.error('Failed to initialize Backup Vaulting:', err)
  }

  // push a change event so the renderer refreshes now, not on the slow poll
  const { configureClipboardWatcher, setClipboardCaptureEnabled } = await import('./clipboardWatcher')
  const { recordClipboardCopy } = await import('./db')
  configureClipboardWatcher((text) => {
    recordClipboardCopy(text)
    sendToWindow(IpcChannels.CLIPBOARD_HISTORY_CHANGED)
  })
  // off unless chosen; an existing 'true' row keeps it, nothing captured is deleted
  setClipboardCaptureEnabled(getSetting<string>('feature_view_clipboard', 'false') === 'true')

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

  registerAppShortcuts()

  // before the window shows, so a minimised login launch has somewhere to go
  try {
    const { initializeTray } = await import('./tray')
    initializeTray()
  } catch (err) {
    console.error('Failed to create the tray icon:', err)
  }

  // in main: the renderer's Notification only fires while a window exists
  try {
    const { initializeDueReminders } = await import('./dueReminders')
    initializeDueReminders()
  } catch (err) {
    console.error('Failed to start due-date reminders:', err)
  }

  // startup sweep then hourly; completing an instance advances its rule right away
  try {
    const { initializeRecurrenceScheduler, setRecurrenceSpawnHandler, onInstanceClosed } =
      await import('./recurrenceService')
    const { setRecurrenceInstanceClosedHandler } = await import('./db')
    setRecurrenceSpawnHandler(() => {
      sendToWindow(IpcChannels.MCP_DATA_CHANGED)
    })
    setRecurrenceInstanceClosedHandler(onInstanceClosed)
    initializeRecurrenceScheduler()
  } catch (err) {
    console.error('Failed to start the recurrence scheduler:', err)
  }

  // widget can't outlive the process; a stale widget_enabled flag inverted the switch
  try {
    const { restoreWidget } = await import('./widget')
    restoreWidget()
  } catch (err) {
    console.error('Failed to restore desktop widget:', err)
  }

  try {
    const { getSetting } = await import('./db')
    const featureWebhook = getSetting<string>('feature_webhook', 'true')
    if (featureWebhook !== 'false') {
      const portSetting = getSetting<string>('webhook_port', String(WEBHOOK_DEFAULT_PORT))
      const port = parseInt(portSetting, 10) || WEBHOOK_DEFAULT_PORT
      const { toggleWebhookGateway } = await import('./webhookGateway')
      await toggleWebhookGateway(true, port)
    }
  } catch (err) {
    console.error('Failed to auto-start Webhook Gateway:', err)
  }

  // off unless enabled, it exposes read/write to every workspace
  try {
    const { getSetting } = await import('./db')
    if (getSetting<string>('feature_mcp', 'false') === 'true') {
      const port = parseInt(getSetting<string>('mcp_port', String(MCP_DEFAULT_PORT)), 10) || MCP_DEFAULT_PORT
      const { toggleMcpServer, setMcpDataChangedHandler } = await import('./mcpServer')
      // MCP writes bypass renderer IPC, so nudge the window or it shows a stale board
      setMcpDataChangedHandler(() => {
        sendToWindow(IpcChannels.MCP_DATA_CHANGED)
      })
      await toggleMcpServer(true, port)
    }
  } catch (err) {
    console.error('Failed to auto-start MCP server:', err)
  }

  try {
    const { initializeActivityTracker } = await import('./tracker')
    initializeActivityTracker()
  } catch (err) {
    console.error('Failed to auto-start Passive Activity Tracker:', err)
  }

  app.on('activate', () => {
    // macOS dock click re-creates a missing window
    const win = getMainWindow()
    if (!win || win.isDestroyed()) {
      createWindow()
    }
  })
})

app.on('before-quit', () => {
  beginQuit()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('will-quit', (e) => {
  // hold the quit for async cleanup
  e.preventDefault()

  globalShortcut.unregisterAll()

  Promise.all([
    import('./clipboardWatcher').then(({ stopClipboardWatcher }) => stopClipboardWatcher()).catch(() => {}),
    import('./customizer').then(({ disableCustomizer }) => disableCustomizer()).catch(() => {}),
    import('./webhookGateway').then(({ stopWebhookServer }) => stopWebhookServer()).catch(() => {}),
    import('./mcpServer').then(({ stopMcpServer }) => stopMcpServer()).catch(() => {}),
    import('./hud').then(({ disableHud }) => disableHud()).catch(() => {}),
    import('./backupVault').then(({ shutdownBackupScheduler }) => shutdownBackupScheduler()).catch(() => {}),
    import('./tracker').then(({ shutdownActivityTracker }) => shutdownActivityTracker()).catch(() => {}),
    Promise.resolve().then(() => { try { stopSyncHost() } catch {} })
  ]).catch(() => {}).finally(() => {
    closeDb()  // checkpoint WAL and close SQLite cleanly before exit
    app.exit(0)
  })

  // force exit if cleanup passes 800ms
  setTimeout(() => {
    app.exit(0)
  }, 800)
})

