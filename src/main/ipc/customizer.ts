/** user themes, plugins, custom shortcuts */

import { ipcMain } from 'electron'
import { IpcChannels } from '../../shared/ipcChannels'
import { registerAppShortcuts } from '../appShortcuts'
import { shell } from 'electron'
import type { ShortcutMap } from '../../shared/types'

export function registerCustomizerHandlers(): void {
  ipcMain.handle(IpcChannels.CUSTOMIZER_GET_CSS, async () => {
    const { getSetting } = await import('../db')
    // silent while the engine is off, stored vars wait until it's back on
    if (getSetting<string>('customizer_enabled', 'false') !== 'true') return ''
    const { resolveThemeCss } = await import('../customizer')
    return resolveThemeCss()
  })

  ipcMain.handle(IpcChannels.CUSTOMIZER_TOGGLE_ENGINE, async (_event, active: boolean) => {
    const { enableCustomizer, disableCustomizer } = await import('../customizer')
    const { setSetting } = await import('../db')
    setSetting('customizer_enabled', String(active))
    if (active) {
      await enableCustomizer()
    } else {
      await disableCustomizer()
    }
    // re-register either way to apply new or default mappings
    registerAppShortcuts()
  })

  ipcMain.handle(IpcChannels.CUSTOMIZER_GET_ENGINE_STATE, async () => {
    const { getSetting } = await import('../db')
    return getSetting<string>('customizer_enabled', 'false') === 'true'
  })

  ipcMain.handle(IpcChannels.CUSTOMIZER_UPDATE_THEME, async (_event, vars: Record<string, string>) => {
    const { setSetting } = await import('../db')
    const { buildCssVariablesString, broadcastTheme } = await import('../customizer')
    setSetting('customizer_theme_vars', JSON.stringify(vars))
    const css = buildCssVariablesString(vars)
    broadcastTheme(css)
  })

  ipcMain.handle(IpcChannels.CUSTOMIZER_GET_THEME, async () => {
    const { getSetting } = await import('../db')
    const rawVars = getSetting('customizer_theme_vars', '{}')
    try {
      return JSON.parse(rawVars as string)
    } catch {
      return {}
    }
  })

  ipcMain.handle(IpcChannels.CUSTOMIZER_GET_PLUGINS, async () => {
    const { scanPlugins } = await import('../pluginRegistry')
    return scanPlugins()
  })

  ipcMain.handle(IpcChannels.CUSTOMIZER_APPROVE_PLUGIN, async (_event, filename: unknown, approval: unknown) => {
    const { approvePlugin } = await import('../pluginRegistry')
    if (typeof filename !== 'string' || !approval || typeof approval !== 'object') {
      return { ok: false as const, error: 'That plugin approval was malformed.' }
    }
    const { permissions, hosts, workspaces } = approval as Record<string, unknown>
    return approvePlugin(filename, { permissions, hosts, workspaces })
  })

  ipcMain.handle(IpcChannels.CUSTOMIZER_GET_PLUGIN_LOG, async (_event, filename: unknown) => {
    const { pluginLog } = await import('../pluginRegistry')
    return typeof filename === 'string' ? pluginLog(filename) : []
  })

  ipcMain.handle(IpcChannels.CUSTOMIZER_GET_PLUGIN_SETTINGS, async (_event, filename: unknown) => {
    const { getPluginSettings } = await import('../pluginRegistry')
    return typeof filename === 'string' ? getPluginSettings(filename) : { ok: false as const, error: 'No plugin named.' }
  })

  ipcMain.handle(IpcChannels.CUSTOMIZER_SAVE_PLUGIN_SETTINGS, async (_event, filename: unknown, changes: unknown) => {
    const { savePluginSettings } = await import('../pluginRegistry')
    return typeof filename === 'string' ? savePluginSettings(filename, changes) : { ok: false as const, error: 'No plugin named.' }
  })

  ipcMain.handle(IpcChannels.CUSTOMIZER_DISABLE_PLUGIN, async (_event, filename: unknown) => {
    const { disablePlugin } = await import('../pluginRegistry')
    if (typeof filename === 'string') await disablePlugin(filename)
  })

  ipcMain.handle(IpcChannels.CUSTOMIZER_INSTALL_EXAMPLE, async (_event, filename: string) => {
    const { findExamplePlugin } = await import('../../shared/examplePlugins')
    const { getPluginsDir, ensureDir } = await import('../paths')
    const { writeFileSync, existsSync } = await import('fs')
    const { join } = await import('path')

    const example = findExamplePlugin(filename)
    if (!example) return { ok: false as const, error: 'Unknown example.' }

    try {
      const dir = getPluginsDir()
      ensureDir(dir)
      const target = join(dir, example.filename)
      // never overwrite, the disk copy may have been edited
      if (existsSync(target)) {
        return { ok: false as const, error: `${example.filename} already exists in the plugins folder.` }
      }
      writeFileSync(target, example.source, 'utf8')
      return { ok: true as const }
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : 'Could not write the file.' }
    }
  })

  ipcMain.handle(IpcChannels.CUSTOMIZER_OPEN_PLUGINS_FOLDER, async () => {
    const { getPluginsDir } = await import('../paths')
    const dir = getPluginsDir()
    await shell.openPath(dir)
  })

  ipcMain.handle(IpcChannels.CUSTOMIZER_REGISTER_SHORTCUTS, async (_event, shortcuts: ShortcutMap) => {
    const { setSetting } = await import('../db')
    setSetting('customizer_shortcuts', JSON.stringify(shortcuts))
    registerAppShortcuts()
  })

  ipcMain.handle(IpcChannels.CUSTOMIZER_GET_SHORTCUTS, async () => {
    const { getSetting } = await import('../db')
    const rawShortcuts = getSetting('customizer_shortcuts', '{}')
    try {
      return JSON.parse(rawShortcuts as string)
    } catch {
      return {}
    }
  })
}
