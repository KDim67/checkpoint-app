import { app, ipcMain, BrowserWindow } from 'electron'
import { join } from 'path'
import { existsSync, readdirSync, readFileSync } from 'fs'
import { PluginInfo } from '../shared/types'
import { getPluginsDir, ensureDir } from './paths'
import { isSafePluginFilename, parsePluginMetadata } from '../shared/pluginMetadata'
import {
  onPluginEvent,
  type PluginEventHandler,
  type PluginEventName
} from './pluginEvents'
import { createItem, getDb, getItemById, getItemsPaginated, getSetting, setSetting, updateItem } from './db'
import { notify } from './notificationService'
import type { CreateItemPayload, Item } from '../shared/types'

/** so a failure can reach the user */
type PluginLoadResult = { ok: true } | { ok: false; error: string }

export function ensurePluginsDir(): void {
  ensureDir(getPluginsDir())
}

const loadedPlugins = new Map<string, {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  exports: any
  lifecycle: PluginLifecycle
}>()

/** teardown, not a sandbox: plugins are required into main and can reach everything */
class PluginLifecycle {
  private ipcHandlers: string[] = []
  private unsubscribers: (() => void)[] = []

  constructor(private filename: string) {}

  getAPI() {
    const filename = this.filename
    return {
      app,
      BrowserWindow,

      ipc: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        handle: (channel: string, listener: (...args: any[]) => any) => {
          // don't let plugins overwrite core handlers or collide
          if (ipcMain.listenerCount(channel) > 0) {
            console.warn(`[Plugin] Handler already registered for channel: ${channel}`)
            return
          }
          ipcMain.handle(channel, listener)
          this.ipcHandlers.push(channel)
        }
      },

      /** tracked either way, so a plugin that never unsubscribes still stops when disabled */
      events: {
        on: <K extends PluginEventName>(name: K, handler: PluginEventHandler<K>): (() => void) => {
          const off = onPluginEvent(name, handler)
          this.unsubscribers.push(off)
          return off
        }
      },

      /** through the app's own validated paths */
      items: {
        create: (payload: CreateItemPayload) => createItem(getDb(), payload),
        get: (id: string) => getItemById(id),
        query: (context: string, type: 'card' | 'task' | 'log', limit = 50) =>
          getItemsPaginated(context, type, 1, limit).items,
        update: (id: string, patch: Partial<Item>) => updateItem(getDb(), id, patch)
      },

      /** through the shared policy, so quiet hours apply */
      notify: (title: string, body: string) =>
        notify({ category: 'agent', title, body, dedupeKey: `plugin:${filename}:${title}` }),

      /** namespaced by filename, no clobbering each other or app settings */
      storage: {
        get: <T>(key: string, fallback: T): T =>
          getSetting<T>(`plugin:${filename}:${key}`, fallback),
        set: (key: string, value: unknown): void =>
          setSetting(`plugin:${filename}:${key}`, value)
      },

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      log: (...args: any[]) => {
        console.log(`[Plugin: ${this.filename}]`, ...args)
      }
    }
  }

  cleanup(): void {
    for (const channel of this.ipcHandlers) {
      try {
        ipcMain.removeHandler(channel)
      } catch (err) {
        console.error(`[Plugin] Failed to unregister handler ${channel}:`, err)
      }
    }
    this.ipcHandlers = []

    // don't trust onUnload, it may throw or not exist
    for (const off of this.unsubscribers) {
      try {
        off()
      } catch (err) {
        console.error(`[Plugin] Failed to unsubscribe a listener for ${this.filename}:`, err)
      }
    }
    this.unsubscribers = []
  }
}

export function scanPlugins(activeFilenames: string[]): PluginInfo[] {
  ensurePluginsDir()
  const dir = getPluginsDir()
  const files = readdirSync(dir).filter(f => f.endsWith('.js'))

  return files.map(filename => {
    let name = filename
    let description = 'No description provided.'
    let version = '1.0.0'

    try {
      // read, don't require: requiring ran disabled plugins just to read three strings
      const source = readFileSync(join(dir, filename), 'utf8')
      const metadata = parsePluginMetadata(source)
      name = metadata.name || name
      description = metadata.description || description
      version = metadata.version || version
    } catch (err) {
      console.error(`[PluginRegistry] Could not read ${filename}:`, err)
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

export function loadPlugin(filename: string): PluginLoadResult {
  if (loadedPlugins.has(filename)) return { ok: true }

  // name comes over IPC, a crafted value could run any file with main's privileges
  if (!isSafePluginFilename(filename)) {
    const error = `Refused to load "${filename}": not a plain .js filename inside the plugins folder.`
    console.error(`[PluginRegistry] ${error}`)
    return { ok: false, error }
  }

  ensurePluginsDir()
  const dir = getPluginsDir()
  const fullPath = join(dir, filename)

  if (!existsSync(fullPath)) {
    const error = `Plugin file not found: ${filename}`
    console.error(`[PluginRegistry] ${error}`)
    return { ok: false, error }
  }

  try {
    delete require.cache[require.resolve(fullPath)]
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const plugin = require(fullPath)
    const lifecycle = new PluginLifecycle(filename)

    if (typeof plugin.onLoad === 'function') {
      plugin.onLoad(lifecycle.getAPI())
    }

    loadedPlugins.set(filename, { exports: plugin, lifecycle })
    console.log(`[PluginRegistry] Successfully loaded extension: ${filename}`)
    return { ok: true }
  } catch (err) {
    // reported, not just logged; a throwing plugin used to look enabled
    const error = err instanceof Error ? err.message : String(err)
    console.error(`[PluginRegistry] Failed to load plugin ${filename}:`, err)
    // leave nothing half-registered
    try {
      delete require.cache[require.resolve(fullPath)]
    } catch {
      // may not have resolved, nothing to purge
    }
    return { ok: false, error }
  }
}

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

  active.lifecycle.cleanup()

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

export function unloadAllPlugins(): void {
  const filenames = Array.from(loadedPlugins.keys())
  for (const filename of filenames) {
    unloadPlugin(filename)
  }
}
