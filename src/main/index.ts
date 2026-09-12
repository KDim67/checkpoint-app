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

// Pure constants with no dependencies of their own, so importing them
// statically does not defeat the dynamic `import('./mcpServer')` calls below.
// Those exist to keep the MCP SDK, which drags in express and hono, out of the
// startup chunk on the majority of launches where the server is switched off.
import { MCP_DEFAULT_PORT, WEBHOOK_DEFAULT_PORT } from '../shared/ports'


/**
 * Set once the app is genuinely on its way out.
 *
 * Close-to-tray works by cancelling the window's close, so without a way to say
 * "this time we mean it" Quit would be cancelled too and the app could never
 * exit.
 */

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

// Windows notification identity, BEFORE app.whenReady()
// Windows takes the name and icon shown on a toast from the AppUserModelID, not
// from the app. Without this, every notification is headed "electron.app.Electron".
// The value must match electron-builder's appId, because the installer registers
// the Start Menu shortcut under it and that shortcut is what Windows reads the
// display name and icon from.
if (process.platform === 'win32') {
  app.setAppUserModelId('com.checkpoint.app')
}

// Disable background throttling BEFORE app.whenReady()
// Critical: allows the app to function fully alongside Unity/VS/JetBrains.
app.commandLine.appendSwitch('disable-background-timer-throttling')
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('wm-window-animations-disabled')
app.commandLine.appendSwitch('log-level', '3')

// Suppress default Electron menu bar entirely
Menu.setApplicationMenu(null)


// Single Instance Lock
/**
 * Last resort, armed before anything else runs.
 *
 * Electron's default for an uncaught exception is to tear the process down,
 * which for a local-first app means whatever was in flight is gone with no
 * message at all. Logged and survived instead: one broken feature beats a
 * window that vanishes.
 */
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
 * connected display. Otherwise unplugging a second monitor strands the app
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
  const win = getMainWindow()
  if (!win || win.isDestroyed()) return
  try {
    const maximized = win.isMaximized()
    // getBounds() reports the maximized frame; persist the restore size so
    // un-maximizing returns to the size the user actually chose.
    const { width, height, x, y } = maximized ? win.getNormalBounds() : win.getBounds()
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

  const win = new BrowserWindow({
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
  setMainWindow(win)

  // Reveal the window once it can paint. Eliminates the white flash. This is
  // guarded and backed by `did-finish-load` plus a safety timeout so a slow or
  // racy dev server (where `ready-to-show` may never fire after a failed initial
  // load) can never leave us with only a detached DevTools window and no app.
  let hasShown = false
  const revealWindow = (): void => {
    if (hasShown || win.isDestroyed()) return
    hasShown = true
    clearTimeout(revealTimeout)    // cancel safety fallback if an event fires first

    // Loaded but never shown. The tray is the way in.
    if (launchedMinimised()) {
      // Maximising a hidden window shows it, so wait for the tray to.
      if (bounds.maximized) win.once('show', () => win.maximize())
      return
    }

    if (bounds.maximized) win.maximize()
    win.show()
    win.focus()
  }
  // Absolute fallback: if neither event fires (hard load-failure loop), show anyway.
  const revealTimeout = setTimeout(revealWindow, 8000)
  win.on('ready-to-show', revealWindow)
  win.webContents.on('did-finish-load', revealWindow)

  win.on('resize', scheduleSaveWindowBounds)
  win.on('move', scheduleSaveWindowBounds)
  win.on('maximize', scheduleSaveWindowBounds)
  win.on('unmaximize', scheduleSaveWindowBounds)
  // Flush before teardown, or a resize inside the debounce window is lost.
  win.on('close', saveWindowBoundsNow)

  // Close-to-tray. Off by default: closing has always quit this app, and the
  // setting exists so nobody discovers the change by accident.
  win.on('close', event => {
    if (isQuitting() || process.platform === 'darwin') return
    let closeToTray = false
    try {
      // Read at the moment of closing rather than cached, so toggling the
      // setting takes effect without a restart. Statically imported because the
      // main bundle is ESM. A require() here would throw, and this catch would
      // swallow it, leaving close-to-tray silently dead.
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

  // Null reference on close. Allows V8 garbage collection of the window
  win.on('closed', () => {
    setMainWindow(null)
    // Quit the app when the main window is closed on non-macOS platforms
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })

  // Open external links in the system browser, not a new Electron window
  /**
   * The window shows the app and nothing else. Without this, anything that
   * managed to set `location` in the renderer could replace the whole app with
   * a remote page that still sits behind the same preload bridge.
   */
  win.webContents.on('will-navigate', (event, url) => {
    const here = win.webContents.getURL()
    // The dev server reloads through this path, so same-origin stays allowed.
    if (here && new URL(url).origin === new URL(here).origin) return
    event.preventDefault()
    openExternalSafely(url)
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternalSafely(url)
    return { action: 'deny' }
  })

  // Load the renderer
  if (process.env['ELECTRON_RENDERER_URL']) {
    const devUrl = process.env['ELECTRON_RENDERER_URL']
    win.loadURL(devUrl)

    // Open DevTools only AFTER the app has actually loaded, so a failed initial
    // load can never leave a lone DevTools window floating over a hidden app.
    win.webContents.once('did-finish-load', () => {
      if (!win.isDestroyed() && !win.webContents.isDevToolsOpened()) {
        win.webContents.openDevTools()
      }
    })

    // Retry loading if the dev server is not warm yet. Stored handle cancels on success.
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

// IPC Handlers


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

/**
 * Every IPC handler the app answers, registered by domain.
 *
 * One call per module rather than one function holding all of them: this was
 * a single 1,086-line function, which meant every feature touching main landed
 * in the same scope and every branch conflicted there.
 */
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

// App Lifecycle

app.whenReady().then(async () => {
  // The database opens before the window because createWindow restores the
  // saved bounds through getSetting. initDb is synchronous, and the window is
  // created hidden regardless. It is not revealed until ready-to-show, which
  // waits on the renderer bundle and dwarfs the cost of opening SQLite.
  const { initDb } = await import('./db')
  const { registerDbHandlers } = await import('./ipc/db')
  const { registerClipboardVaultHandlers } = await import('./ipc/clipboardVault')

  /**
   * A database that will not open used to take the window with it: the throw
   * landed before createWindow, so the app started and drew nothing at all.
   * Now the unreadable file is moved aside, kept, and said out loud.
   */
  let db: Awaited<ReturnType<typeof initDb>>
  const userData = app.getPath('userData')
  try {
    db = initDb(userData)
  } catch (err) {
    console.error('[main] The database would not open:', err)
    const { quarantineDatabase, recoveryMessage, stampFor } = await import('./dbRecovery')
    const { getBackupDir } = await import('./backupVault')
    const { discardDb } = await import('./db')

    // SQLite opens a file lazily, so the handle is live even though the first
    // read threw. Windows will not rename a file this process still holds, and
    // without the rename there is nowhere for a fresh database to go.
    discardDb()

    try {
      const { movedTo } = quarantineDatabase(join(userData, 'checkpoint.db'), stampFor(Date.now()))
      db = initDb(userData)
      // After the window, so the dialog has something to sit in front of and
      // the app is usable the moment the message is dismissed.
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

  // Last, and only when packaged. Nothing else waits on it.
  void import('./updater').then(({ initializeUpdater }) => initializeUpdater())
      return
    } catch (fatal) {
      // The second failure is not the file, so a third attempt would fail too.
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

        // Prevent directory traversal
        const relativePath = relative(dir, filePath)
        if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
          return new Response('Access Denied', { status: 403 })
        }

        if (!existsSync(filePath)) {
          return new Response('File Not Found', { status: 404 })
        }

        // `?w=` asks for a display-sized copy. Callers that leave it off, such
        // as an export or a note, still get the original bytes.
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

  // Last, and only when packaged. Nothing else waits on it, and the updater
  // starts at most once however many times this is reached.
  void import('./updater').then(({ initializeUpdater }) => initializeUpdater())

  registerContextHandlers(db)

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

  // Clipboard Watcher. Record the capture, then push a change event so the
  // renderer refreshes instantly instead of waiting on a slow poll. Only starts
  // when the Clipboard feature is on; setSetting flips it live after that.
  const { configureClipboardWatcher, setClipboardCaptureEnabled } = await import('./clipboardWatcher')
  const { recordClipboardCopy } = await import('./db')
  configureClipboardWatcher((text) => {
    recordClipboardCopy(text)
    sendToWindow(IpcChannels.CLIPBOARD_HISTORY_CHANGED)
  })
  // Off until switched on. Recording every copy is not something to start
  // doing to someone who has not asked for it.
  //
  // Anyone who turned it on keeps it: their row says 'true'. Anyone who never
  // touched the switch stops recording, which is the point, since they never
  // chose to start. Nothing already captured is deleted either way.
  setClipboardCaptureEnabled(getSetting<string>('feature_view_clipboard', 'false') === 'true')

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

  // Tray icon. Created before the window is shown so a login launch that starts
  // minimised still has somewhere to go.
  try {
    const { initializeTray } = await import('./tray')
    initializeTray()
  } catch (err) {
    console.error('Failed to create the tray icon:', err)
  }

  // Due-date reminders. In main because the renderer's Notification API only
  // fires while a window exists, and a reminder that needs the app focused is
  // not a reminder.
  try {
    const { initializeDueReminders } = await import('./dueReminders')
    initializeDueReminders()
  } catch (err) {
    console.error('Failed to start due-date reminders:', err)
  }

  // Recurring work: sweep at startup, then hourly. Completing an instance also
  // advances its rule immediately, wired through the db handler below.
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

  // The widget is a BrowserWindow, so it cannot outlive the process. Without
  // this the stored widget_enabled flag described a window that no longer
  // existed, and the settings switch inverted on the next click.
  try {
    const { restoreWidget } = await import('./widget')
    restoreWidget()
  } catch (err) {
    console.error('Failed to restore desktop widget:', err)
  }

  // Phase 17. Start Webhook Gateway if enabled
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

  // MCP server. Off unless explicitly enabled, since it exposes read/write
  // access to every workspace.
  try {
    const { getSetting } = await import('./db')
    if (getSetting<string>('feature_mcp', 'false') === 'true') {
      const port = parseInt(getSetting<string>('mcp_port', String(MCP_DEFAULT_PORT)), 10) || MCP_DEFAULT_PORT
      const { toggleMcpServer, setMcpDataChangedHandler } = await import('./mcpServer')
      // Writes arriving over MCP bypass renderer IPC entirely, so the open
      // window would otherwise show a stale board until the user navigated.
      setMcpDataChangedHandler(() => {
        sendToWindow(IpcChannels.MCP_DATA_CHANGED)
      })
      await toggleMcpServer(true, port)
    }
  } catch (err) {
    console.error('Failed to auto-start MCP server:', err)
  }

  // Phase 21. Start Passive Activity Tracker if enabled
  try {
    const { initializeActivityTracker } = await import('./tracker')
    initializeActivityTracker()
  } catch (err) {
    console.error('Failed to auto-start Passive Activity Tracker:', err)
  }

  app.on('activate', () => {
    // macOS: re-create window on dock click if no main window exists
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
    import('./mcpServer').then(({ stopMcpServer }) => stopMcpServer()).catch(() => {}),
    import('./hud').then(({ disableHud }) => disableHud()).catch(() => {}),
    import('./backupVault').then(({ shutdownBackupScheduler }) => shutdownBackupScheduler()).catch(() => {}),
    import('./tracker').then(({ shutdownActivityTracker }) => shutdownActivityTracker()).catch(() => {}),
    Promise.resolve().then(() => { try { stopSyncHost() } catch {} })
  ]).catch(() => {}).finally(() => {
    closeDb()  // checkpoint WAL and close SQLite cleanly before exit
    app.exit(0)
  })

  // Safety timeout: force exit if cleanup takes longer than 800ms
  setTimeout(() => {
    app.exit(0)
  }, 800)
})

