import { app, ipcMain, BrowserWindow } from 'electron'
import { join } from 'path'
import { existsSync, readdirSync } from 'fs'
import { PluginInfo } from '../shared/types'
import { getPluginsDir, ensureDir } from './paths'

export function ensurePluginsDir(): void {
  ensureDir(getPluginsDir())
}

// Keep track of loaded plugin runtimes and sandboxes
const loadedPlugins = new Map<string, {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  exports: any
  sandbox: PluginSandbox
}>()

class PluginSandbox {
  private ipcHandlers: string[] = []

  constructor(private filename: string) {}

  getAPI() {
    return {
      app,
      BrowserWindow,
      ipc: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        handle: (channel: string, listener: (...args: any[]) => any) => {
          // Prevent plugins from overwriting core system handlers or colliding
          if (ipcMain.listenerCount(channel) > 0) {
            console.warn(`[Plugin Sandbox] Handler already registered for channel: ${channel}`)
            return
          }
          ipcMain.handle(channel, listener)
          this.ipcHandlers.push(channel)
        }
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      log: (...args: any[]) => {
        console.log(`[Plugin: ${this.filename}]`, ...args)
      }
    }
  }

  cleanup(): void {
    // Teardown all handlers registered by this sandbox
    for (const channel of this.ipcHandlers) {
      try {
        ipcMain.removeHandler(channel)
        console.log(`[Plugin Sandbox] Unregistered handler: ${channel}`)
      } catch (err) {
        console.error(`[Plugin Sandbox] Failed to unregister handler ${channel}:`, err)
      }
    }
    this.ipcHandlers = []
  }
}

/**
 * Scan all .js files in the plugins directory and read metadata.
 */
export function scanPlugins(activeFilenames: string[]): PluginInfo[] {
  ensurePluginsDir()
  const dir = getPluginsDir()
  const files = readdirSync(dir).filter(f => f.endsWith('.js'))

  return files.map(filename => {
    const fullPath = join(dir, filename)
    let name = filename
    let description = 'No description provided.'
    let version = '1.0.0'

    try {
      // Purge cache if not active so we read fresh metadata
      if (!loadedPlugins.has(filename)) {
        delete require.cache[require.resolve(fullPath)]
      }
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const plugin = require(fullPath)
      if (plugin.metadata) {
        name = plugin.metadata.name || name
        description = plugin.metadata.description || description
        version = plugin.metadata.version || version
      }
    } catch (err) {
      console.error(`[PluginRegistry] Error reading metadata for ${filename}:`, err)
      description = `Failed to parse: ${(err as Error).message}`
    }

    return {
      filename,
      name,
      description,
      version,
      active: activeFilenames.includes(filename)
    }
  })
}

/**
 * Hot-load a plugin JS entry point.
 */
export function loadPlugin(filename: string): void {
  if (loadedPlugins.has(filename)) return

  ensurePluginsDir()
  const dir = getPluginsDir()
  const fullPath = join(dir, filename)

  if (!existsSync(fullPath)) {
    console.error(`[PluginRegistry] Plugin file not found: ${fullPath}`)
    return
  }

  try {
    // Purge cache to load fresh file contents
    delete require.cache[require.resolve(fullPath)]
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const plugin = require(fullPath)
    const sandbox = new PluginSandbox(filename)
    const api = sandbox.getAPI()

    if (typeof plugin.onLoad === 'function') {
      plugin.onLoad(api)
    }

    loadedPlugins.set(filename, { exports: plugin, sandbox })
    console.log(`[PluginRegistry] Successfully loaded extension: ${filename}`)
  } catch (err) {
    console.error(`[PluginRegistry] Failed to load plugin ${filename}:`, err)
  }
}

/**
 * Hot-unload an active plugin instance and clean up listeners.
 */
export function unloadPlugin(filename: string): void {
  const active = loadedPlugins.get(filename)
  if (!active) return

  try {
    if (active.exports && typeof active.exports.onUnload === 'function') {
      active.exports.onUnload()
    }
  } catch (err) {
    console.error(`[PluginRegistry] Error calling onUnload for ${filename}:`, err)
  }

  // Clean up registered IPC handlers
  active.sandbox.cleanup()

  // Purge Node require cache
  try {
    const dir = getPluginsDir()
    const fullPath = join(dir, filename)
    delete require.cache[require.resolve(fullPath)]
  } catch (err) {
    console.error(`[PluginRegistry] Error purging require.cache for ${filename}:`, err)
  }

  loadedPlugins.delete(filename)
  console.log(`[PluginRegistry] Successfully unloaded extension: ${filename}`)
}

/**
 * Unload all active plugins (for deconstruction / disabling engine).
 */
export function unloadAllPlugins(): void {
  const filenames = Array.from(loadedPlugins.keys())
  for (const filename of filenames) {
    unloadPlugin(filename)
  }
}
