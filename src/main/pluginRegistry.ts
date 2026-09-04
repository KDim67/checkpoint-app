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

/** What a load attempt reports back, so a failure can reach the user. */
export type PluginLoadResult = { ok: true } | { ok: false; error: string }

export function ensurePluginsDir(): void {
  ensureDir(getPluginsDir())
}

// Keep track of loaded plugin runtimes and sandboxes
const loadedPlugins = new Map<string, {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  exports: any
  sandbox: PluginSandbox
}>()

/**
 * What a plugin is handed on load. Everything routes through the functions the
 * app itself uses, so a plugin inherits their validation, sync tombstones and
 * notification policy.
 *
 * It is named for what it tracks, not for isolation it does not provide: a
 * plugin runs in main and can ignore all of this. What it does guarantee is
 * teardown, which is what makes enable/disable and hot reload work.
 */
class PluginSandbox {
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
          // Prevent plugins from overwriting core system handlers or colliding
          if (ipcMain.listenerCount(channel) > 0) {
            console.warn(`[Plugin] Handler already registered for channel: ${channel}`)
            return
          }
          ipcMain.handle(channel, listener)
          this.ipcHandlers.push(channel)
        }
      },

      /**
       * React to things happening in the app.
       *
       * Returns an unsubscribe, and the subscription is tracked either way, so a
       * plugin that forgets to tidy up still stops firing when it is disabled.
       */
      events: {
        on: <K extends PluginEventName>(name: K, handler: PluginEventHandler<K>): (() => void) => {
          const off = onPluginEvent(name, handler)
          this.unsubscribers.push(off)
          return off
        }
      },

      /** Reading and writing work, through the app's own validated paths. */
      items: {
        create: (payload: CreateItemPayload) => createItem(getDb(), payload),
        get: (id: string) => getItemById(id),
        query: (context: string, type: 'card' | 'task' | 'log', limit = 50) =>
          getItemsPaginated(context, type, 1, limit).items,
        update: (id: string, patch: Partial<Item>) => updateItem(getDb(), id, patch)
      },

      /**
       * Raise a desktop notification.
       *
       * Goes through the shared policy, so a plugin obeys the user's quiet hours
       * and category switches instead of talking over them.
       */
      notify: (title: string, body: string) =>
        notify({ category: 'agent', title, body, dedupeKey: `plugin:${filename}:${title}` }),

      /**
       * Storage scoped to this plugin.
       *
       * Namespaced by filename so two plugins cannot quietly overwrite each
       * other, and so none of them can reach an app setting.
       */
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

    // Unsubscribed here rather than trusting onUnload: a plugin that throws on
    // the way out, or never implements onUnload, would otherwise keep receiving
    // events after being disabled.
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

/**
 * Scan all .js files in the plugins directory and read metadata.
 */
export function scanPlugins(activeFilenames: string[]): PluginInfo[] {
  ensurePluginsDir()
  const dir = getPluginsDir()
  const files = readdirSync(dir).filter(f => f.endsWith('.js'))

  return files.map(filename => {
    let name = filename
    let description = 'No description provided.'
    let version = '1.0.0'

    try {
      // Read, do not require. This previously executed every file in the folder
      // including plugins the user had switched off, just to read three
      // strings, which made the off switch meaningless.
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

/**
 * Hot-load a plugin JS entry point.
 */
export function loadPlugin(filename: string): PluginLoadResult {
  if (loadedPlugins.has(filename)) return { ok: true }

  // The name comes over IPC from the renderer. Without this a crafted value
  // could walk out of the plugins folder and execute any file on disk with the
  // main process's privileges.
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
    // Purge cache to load fresh file contents
    delete require.cache[require.resolve(fullPath)]
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const plugin = require(fullPath)
    const sandbox = new PluginSandbox(filename)

    if (typeof plugin.onLoad === 'function') {
      plugin.onLoad(sandbox.getAPI())
    }

    loadedPlugins.set(filename, { exports: plugin, sandbox })
    console.log(`[PluginRegistry] Successfully loaded extension: ${filename}`)
    return { ok: true }
  } catch (err) {
    // Reported rather than only logged: a plugin that throws on load used to
    // fail silently while the UI still showed it as enabled.
    const error = err instanceof Error ? err.message : String(err)
    console.error(`[PluginRegistry] Failed to load plugin ${filename}:`, err)
    // Leave nothing half-registered behind.
    try {
      delete require.cache[require.resolve(fullPath)]
    } catch {
      // The file may not have resolved at all; nothing to purge.
    }
    return { ok: false, error }
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
