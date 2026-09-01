import { BrowserWindow } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync } from 'fs'
import { IpcChannels } from '../shared/ipcChannels'
import {
  unloadAllPlugins,
  unloadPlugin,
  loadPlugin,
  ensurePluginsDir
} from './pluginRegistry'
import { getConfigDir, getPluginsDir } from './paths'
import { getSetting } from './db'
import { updateNativeTitleBarFromSettings } from './titleBarSync'

let watcher: import('chokidar').FSWatcher | null = null
let isEngineRunning = false

function getThemePath(): string {
  return join(getConfigDir(), 'theme.css')
}

/**
 * The CSS the engine should currently be applying, or '' when it should apply
 * none.
 *
 * Pulled out of enableCustomizer because a broadcast is only heard by windows
 * that already exist and have already subscribed. At startup neither is true, 
 * the engine initialises before React mounts, so the stored theme was being
 * sent to nobody and the app painted its defaults. Renderers now ask for this on
 * mount, which works no matter the ordering.
 */
export function resolveThemeCss(): string {
  try {
    const rawVars = getSetting<string>('customizer_theme_vars', '{}')
    const vars = JSON.parse(rawVars)
    const css = buildCssVariablesString(vars)
    if (css) return css

    // No stored variables: fall back to a hand-written theme.css if present.
    const themePath = getThemePath()
    if (existsSync(themePath)) return readFileSync(themePath, 'utf8')
  } catch (err) {
    console.error('[customizer] Could not resolve the current theme:', err)
  }
  return ''
}

/** Broadcasts a CSS string to all open renderer windows. */
export function broadcastTheme(css: string): void {
  BrowserWindow.getAllWindows().forEach(win => {
    if (!win.isDestroyed()) {
      win.webContents.send(IpcChannels.THEME_UPDATE, css)
    }
  })
}

/**
 * Parses CSS variable declarations from a CSS variables string.
 */
export function parseVarsFromCss(css: string): Record<string, string> {
  const vars: Record<string, string> = {}
  const regex = /(--[\w-]+)\s*:\s*([^;}\n]+)/g
  let match
  while ((match = regex.exec(css)) !== null) {
    vars[match[1]] = match[2].trim()
  }
  return vars
}

/**
 * Updates the native title bar controls overlay colors dynamically on Windows.
 */
export function updateTitleBarOverlay(vars: Record<string, string>): void {
  const color = vars['--color-background'] || '#0b0c10'
  const symbolColor = vars['--color-text-base'] || '#f1f5f9'
  BrowserWindow.getAllWindows().forEach(win => {
    if (!win.isDestroyed() && typeof win.setTitleBarOverlay === 'function') {
      try {
        win.setTitleBarOverlay({ color, symbolColor })
      } catch (err) {
        console.error('[customizer] Failed to update title bar overlay:', err)
      }
    }
  })
}

/**
 * Builds a CSS variables override block from key-value mappings.
 */
export function buildCssVariablesString(vars: Record<string, string>): string {
  const entries = Object.entries(vars)
  if (entries.length === 0) return ''
  const declarations = entries.map(([k, v]) => `  ${k}: ${v};`).join('\n')
  return `:root {\n${declarations}\n}`
}

/**
 * Starts the customization engine, watcher, plugins, and custom themes.
 */
export async function enableCustomizer(): Promise<void> {
  if (isEngineRunning) return

  ensurePluginsDir()
  const configDir = getConfigDir()

  // 1. Apply the stored theme. The broadcast is kept for windows that are
  //    already open; a window opening later fetches the same CSS on mount.
  try {
    const css = resolveThemeCss()
    if (css) {
      broadcastTheme(css)
      updateTitleBarOverlay(parseVarsFromCss(css))
    }
  } catch (err) {
    console.error('[customizer] Failed to load initial custom theme variables:', err)
  }

  // 2. Load active plugins
  try {
    const rawPlugins = getSetting<string>('customizer_active_plugins', '[]')
    const activePlugins: string[] = JSON.parse(rawPlugins)
    console.log(`[customizer] Loading active plugins:`, activePlugins)
    for (const pluginFile of activePlugins) {
      loadPlugin(pluginFile)
    }
  } catch (err) {
    console.error('[customizer] Failed to load active plugins:', err)
  }

  // 3. Start Chokidar watcher for plugins/theme changes
  try {
    const chokidar = await import('chokidar')
    watcher = chokidar.watch(configDir, {
      persistent: true,
      ignoreInitial: true,      // do not re-run on startup files
      depth: 1,                 // only watch root and plugins/ subdirectory
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 50
      }
    })

    watcher
      .on('add', (filePath: string) => handleFileChange(filePath))
      .on('change', (filePath: string) => handleFileChange(filePath))

    console.log(`[customizer] Started file watcher on ${configDir}`)
  } catch (err) {
    console.error('[customizer] Failed to start customizer watcher:', err)
  }

  isEngineRunning = true
}

/**
 * Halts the customization engine, unloads watchers/plugins, and reverts style variables.
 */
export async function disableCustomizer(): Promise<void> {
  if (!isEngineRunning) return

  // 1. Close chokidar file watcher
  if (watcher) {
    await watcher.close()
    watcher = null
    console.log('[customizer] Chokidar watcher stopped.')
  }

  // 2. Unload all plugins
  unloadAllPlugins()

  // 3. Reset injected theme variables
  broadcastTheme('')
  try {
    const appTheme = getSetting<string>('app_theme', 'dark')
    updateNativeTitleBarFromSettings(appTheme)
  } catch (err) {
    console.error('[customizer] Failed to reset titlebar colors:', err)
  }

  isEngineRunning = false
  console.log('[customizer] Customization engine deactivated cleanly.')
}

export function isCustomizerRunning(): boolean {
  return isEngineRunning
}

function handleFileChange(filePath: string): void {
  const themePath = getThemePath()
  if (filePath === themePath) {
    try {
      const css = readFileSync(filePath, 'utf8')
      console.log(`[customizer] theme.css file changed, broadcasting ${css.length} bytes`)
      broadcastTheme(css)
      updateTitleBarOverlay(parseVarsFromCss(css))
    } catch (err) {
      console.error('[customizer] Failed to read theme.css file:', err)
    }
    return
  }

  // Hot reload plugins if they are active
  const pluginsDir = getPluginsDir()
  if (filePath.startsWith(pluginsDir) && filePath.endsWith('.js')) {
    const filename = filePath.slice(pluginsDir.length + 1)
    try {
      const rawPlugins = getSetting<string>('customizer_active_plugins', '[]')
      const activePlugins: string[] = JSON.parse(rawPlugins)
      if (activePlugins.includes(filename)) {
        console.log(`[customizer] Active plugin file changed, reloading: ${filename}`)
        unloadPlugin(filename)
        loadPlugin(filename)
      }
    } catch (err) {
      console.error('[customizer] Error handling plugin file change:', err)
    }
  }
}
