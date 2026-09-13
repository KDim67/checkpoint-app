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
    const { buildCssVariablesString, broadcastTheme, updateTitleBarOverlay } = await import('../customizer')
    setSetting('customizer_theme_vars', JSON.stringify(vars))
    const css = buildCssVariablesString(vars)
    broadcastTheme(css)
    updateTitleBarOverlay(vars)
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
    const { getSetting } = await import('../db')
    const rawPlugins = getSetting('customizer_active_plugins', '[]')
    let activePlugins: string[] = []
    try {
      activePlugins = JSON.parse(rawPlugins as string)
    } catch {
      // ignore
    }
    return scanPlugins(activePlugins)
  })

  ipcMain.handle(IpcChannels.CUSTOMIZER_TOGGLE_PLUGIN, async (_event, filename: string, active: boolean) => {
    const { getSetting, setSetting } = await import('../db')
    const { loadPlugin, unloadPlugin } = await import('../pluginRegistry')
    
    const rawPlugins = getSetting('customizer_active_plugins', '[]')
    let activePlugins: string[] = []
    try {
      activePlugins = JSON.parse(rawPlugins as string)
    } catch {
      // ignore
    }

    if (active) {
      // load before recording; a throwing plugin used to stay stored as enabled
      const result = loadPlugin(filename)
      if (!result.ok) return result
      if (!activePlugins.includes(filename)) {
        activePlugins.push(filename)
      }
    } else {
      activePlugins = activePlugins.filter(name => name !== filename)
      unloadPlugin(filename)
    }

    setSetting('customizer_active_plugins', JSON.stringify(activePlugins))
    return { ok: true as const }
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
