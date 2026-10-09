/** your approvals, kept on this machine and never synced; the old synced on-list is read once, then left for older versions */

import { getSetting, setSetting } from '../db'
import { isSafePluginFilename } from '../../shared/pluginMetadata'
import { PLUGIN_GRANTS_KEY as GRANTS_KEY, readGrants, type PluginGrant } from '../../shared/pluginPermissions'

const LEGACY_KEY = 'customizer_active_plugins'

/** what was on before plugins ran sandboxed waits for you; nothing is granted on its behalf */
function migrateLegacy(): Record<string, PluginGrant> {
  let legacy: unknown = []
  try {
    legacy = JSON.parse(getSetting<string>(LEGACY_KEY, '[]'))
  } catch {
    legacy = []
  }
  const grants: Record<string, PluginGrant> = {}
  if (Array.isArray(legacy)) {
    for (const filename of legacy) {
      if (typeof filename === 'string' && isSafePluginFilename(filename)) {
        grants[filename] = { on: true, permissions: [], hosts: [], workspaces: [], grantedAt: 0, legacy: true }
      }
    }
  }
  setSetting(GRANTS_KEY, grants)
  return grants
}

export function loadGrants(): Record<string, PluginGrant> {
  const raw = getSetting<unknown>(GRANTS_KEY, null)
  return raw === null ? migrateLegacy() : readGrants(raw)
}

export function getGrant(filename: string): PluginGrant | null {
  return loadGrants()[filename] ?? null
}

export function saveGrant(filename: string, grant: PluginGrant): void {
  setSetting(GRANTS_KEY, { ...loadGrants(), [filename]: grant })
}
