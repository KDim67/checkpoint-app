/**
 * customizer.ts, Phase 9 Customization Engine
 *
 * Watches ~/.config/checkpoint/ for:
 *   - theme.css       → hot-reloads CSS into all open renderer windows via THEME_UPDATE IPC
 *   - plugins/*.js    → validates path and require()s the file in a try/catch
 *
 * Call startCustomizer() after app.whenReady(). Store the returned FSWatcher
 * and call watcher.close() on app.quit() to avoid zombie processes.
 */

import { app, BrowserWindow } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync, readFileSync } from 'fs'
import { IpcChannels } from '../shared/ipcChannels'

// Resolve the user's ~/.config/checkpoint directory in a cross-platform way
function getConfigDir(): string {
  return join(app.getPath('home'), '.config', 'checkpoint')
}

function getPluginsDir(): string {
  return join(getConfigDir(), 'plugins')
}

/** Ensures the config and plugins directories exist. */
function ensureDirs(): void {
  const configDir  = getConfigDir()
  const pluginsDir = getPluginsDir()

  if (!existsSync(configDir))  mkdirSync(configDir,  { recursive: true })
  if (!existsSync(pluginsDir)) mkdirSync(pluginsDir, { recursive: true })
}

/** Broadcasts a CSS string to all open renderer windows. */
function broadcastTheme(css: string): void {
  BrowserWindow.getAllWindows().forEach(win => {
    if (!win.isDestroyed()) {
      win.webContents.send(IpcChannels.THEME_UPDATE, css)
    }
  })
}

/** Safely loads a plugin JS file via require(). */
function loadPlugin(filePath: string): void {
  const configDir = getConfigDir()

  // Guard against path traversal, the resolved path must stay inside configDir
  if (!filePath.startsWith(configDir)) {
    console.warn(`[customizer] Refused to load plugin outside config dir: ${filePath}`)
    return
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const result = require(filePath)
    console.log(`[customizer] Loaded plugin: ${filePath}`, result)
  } catch (err) {
    console.error(`[customizer] Failed to load plugin ${filePath}:`, err)
  }
}

/**
 * Starts the chokidar file watcher.
 * Returns the FSWatcher so the caller can .close() it on quit.
 */
export async function startCustomizer(): Promise<import('chokidar').FSWatcher> {
  ensureDirs()

  const configDir = getConfigDir()
  const themePath = join(configDir, 'theme.css')

  // Lazy import chokidar (it's a CJS module; dynamic import avoids bundler issues)
  const chokidar = await import('chokidar')

  const watcher = chokidar.watch(configDir, {
    persistent: true,
    ignoreInitial: false,     // process theme.css on startup if it already exists
    depth: 1,                 // only watch root and plugins/ subdirectory
    awaitWriteFinish: {
      stabilityThreshold: 100,
      pollInterval: 50
    }
  })

  watcher
    .on('add', (filePath: string) => handleFileChange(filePath, themePath))
    .on('change', (filePath: string) => handleFileChange(filePath, themePath))

  console.log(`[customizer] Watching ${configDir}`)
  return watcher
}

function handleFileChange(filePath: string, themePath: string): void {
  if (filePath === themePath) {
    // Theme hot-reload
    try {
      const css = readFileSync(filePath, 'utf8')
      console.log(`[customizer] theme.css changed, broadcasting ${css.length} bytes`)
      broadcastTheme(css)
    } catch (err) {
      console.error('[customizer] Failed to read theme.css:', err)
    }
    return
  }

  // Plugin loader, only pick up .js files inside plugins/
  const pluginsDir = getPluginsDir()
  if (filePath.startsWith(pluginsDir) && filePath.endsWith('.js')) {
    loadPlugin(filePath)
  }
}
