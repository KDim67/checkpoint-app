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
import { updateNativeTitleBarFromSettings, paintTitleBarOverlay } from './titleBarSync'

let watcher: import('chokidar').FSWatcher | null = null
let isEngineRunning = false

function getThemePath(): string {
  return join(getConfigDir(), 'theme.css')
}

/** split from enableCustomizer: at startup no window is there for a broadcast, renderers pull on mount */
export function resolveThemeCss(): string {
  try {
    const rawVars = getSetting<string>('customizer_theme_vars', '{}')
    const vars = JSON.parse(rawVars)
    const css = buildCssVariablesString(vars)
    if (css) return css

    // no stored vars, fall back to a hand-written theme.css
    const themePath = getThemePath()
    if (existsSync(themePath)) return readFileSync(themePath, 'utf8')
  } catch (err) {
    console.error('[customizer] Could not resolve the current theme:', err)
  }
  return ''
}

export function broadcastTheme(css: string): void {
  BrowserWindow.getAllWindows().forEach(win => {
    if (!win.isDestroyed()) {
      win.webContents.send(IpcChannels.THEME_UPDATE, css)
    }
  })
}

function parseVarsFromCss(css: string): Record<string, string> {
  const vars: Record<string, string> = {}
  const regex = /(--[\w-]+)\s*:\s*([^;}\n]+)/g
  let match
  while ((match = regex.exec(css)) !== null) {
    vars[match[1]] = match[2].trim()
  }
  return vars
}

/** windows title bar overlay only */
export function updateTitleBarOverlay(vars: Record<string, string>): void {
  paintTitleBarOverlay(
    vars['--color-background'] || '#0b0c10',
    vars['--color-text-base'] || '#f1f5f9'
  )
}

export function buildCssVariablesString(vars: Record<string, string>): string {
  const entries = Object.entries(vars)
  if (entries.length === 0) return ''
  const declarations = entries.map(([k, v]) => `  ${k}: ${v};`).join('\n')
  return `:root {\n${declarations}\n}`
}

export async function enableCustomizer(): Promise<void> {
  if (isEngineRunning) return

  ensurePluginsDir()
  const configDir = getConfigDir()

  // broadcast covers open windows, later ones fetch on mount
  try {
    const css = resolveThemeCss()
    if (css) {
      broadcastTheme(css)
      updateTitleBarOverlay(parseVarsFromCss(css))
    }
  } catch (err) {
    console.error('[customizer] Failed to load initial custom theme variables:', err)
  }

  try {
    const rawPlugins = getSetting<string>('customizer_active_plugins', '[]')
    const activePlugins: string[] = JSON.parse(rawPlugins)
    console.log(`[customizer] Loading active plugins:`, activePlugins)
    for (const pluginFile of activePlugins) {
      const result = loadPlugin(pluginFile)
      // logged not thrown, one bad plugin mustn't stop the rest
      if (!result.ok) {
        console.error(`[customizer] Plugin "${pluginFile}" failed to load: ${result.error}`)
      }
    }
  } catch (err) {
    console.error('[customizer] Failed to load active plugins:', err)
  }

  try {
    const chokidar = await import('chokidar')
    watcher = chokidar.watch(configDir, {
      persistent: true,
      ignoreInitial: true,      // skip files already there at start
      depth: 1,                 // root and plugins/ only
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

export async function disableCustomizer(): Promise<void> {
  if (!isEngineRunning) return

  if (watcher) {
    await watcher.close()
    watcher = null
    console.log('[customizer] Chokidar watcher stopped.')
  }

  unloadAllPlugins()

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

function handleFileChange(filePath: string): void {
  const themePath = getThemePath()
  if (filePath === themePath) {
    try {
      const css = readFileSync(filePath, 'utf8')
      console.log(`[customizer] theme.css file changed: broadcasting ${css.length} bytes`)
      broadcastTheme(css)
      updateTitleBarOverlay(parseVarsFromCss(css))
    } catch (err) {
      console.error('[customizer] Failed to read theme.css file:', err)
    }
    return
  }

  const pluginsDir = getPluginsDir()
  if (filePath.startsWith(pluginsDir) && filePath.endsWith('.js')) {
    const filename = filePath.slice(pluginsDir.length + 1)
    try {
      const rawPlugins = getSetting<string>('customizer_active_plugins', '[]')
      const activePlugins: string[] = JSON.parse(rawPlugins)
      if (activePlugins.includes(filename)) {
        console.log(`[customizer] Active plugin file changed: reloading: ${filename}`)
        unloadPlugin(filename)
        loadPlugin(filename)
      }
    } catch (err) {
      console.error('[customizer] Error handling plugin file change:', err)
    }
  }
}
