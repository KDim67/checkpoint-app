import { app, BrowserWindow, ipcMain, Menu, shell, globalShortcut, dialog } from 'electron'
import { join } from 'path'
import { writeFileSync } from 'fs'
import { IpcChannels } from '../shared/ipcChannels'
import type { FSWatcher } from 'chokidar'

// Disable background throttling BEFORE app.whenReady()
// Critical: allows the app to function fully alongside Unity/VS/JetBrains.
app.commandLine.appendSwitch('disable-background-timer-throttling')
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('wm-window-animations-disabled')

// Suppress default Electron menu bar entirely
Menu.setApplicationMenu(null)

let mainWindow: BrowserWindow | null = null
let customizerWatcher: FSWatcher | null = null

function createWindow(): void {
  const preloadPath = join(__dirname, '../preload/index.mjs')

  mainWindow = new BrowserWindow({
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
}

// App Lifecycle

app.whenReady().then(async () => {
  createWindow()
  registerIpcHandlers()

  // Lazy-load the database after window is created
  const { initDb } = await import('./db')
  const dataPath = app.getPath('userData')
  const db = initDb(dataPath)

  // Register DB IPC handlers (Phase 2, db.ts must be created first)
  const { registerDbHandlers } = await import('./db')
  registerDbHandlers(db)

  // Phase 9, Start file watcher for theme hot-reload + plugins
  const { startCustomizer } = await import('./customizer')
  customizerWatcher = await startCustomizer()

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
  // Phase 9, Close chokidar watcher to prevent zombie processes
  customizerWatcher?.close().catch(console.error)
})

export { mainWindow }
