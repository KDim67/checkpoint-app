/**
 * Typed access to the settings table.
 *
 * Values are written through IPC as JSON, and historically some booleans were
 * stored as the strings 'true'/'false' via String(active) while others were
 * stored as real booleans. The readers here accept both so old databases keep
 * working; writers use the string form the settings UI already produces.
 */

export async function getBoolSetting(key: string, defaultValue: boolean): Promise<boolean> {
  try {
    const raw = await window.electronAPI.db.getSetting(key)
    if (raw === null || raw === undefined) return defaultValue
    if (typeof raw === 'boolean') return raw
    if (raw === 'true') return true
    if (raw === 'false') return false
    return defaultValue
  } catch {
    return defaultValue
  }
}

export async function setBoolSetting(key: string, value: boolean): Promise<void> {
  await window.electronAPI.db.setSetting(key, String(value))
}

export async function getStringSetting(key: string, defaultValue: string): Promise<string> {
  try {
    const raw = await window.electronAPI.db.getSetting(key)
    return typeof raw === 'string' && raw !== '' ? raw : defaultValue
  } catch {
    return defaultValue
  }
}

/** Reads a setting constrained to a known set, falling back when it drifts. */
export async function getEnumSetting<T extends string>(
  key: string,
  allowed: readonly T[],
  defaultValue: T
): Promise<T> {
  const raw = await getStringSetting(key, defaultValue)
  return (allowed as readonly string[]).includes(raw) ? (raw as T) : defaultValue
}

export async function setStringSetting(key: string, value: string): Promise<void> {
  await window.electronAPI.db.setSetting(key, value)
}

export async function getNumberSetting(key: string, defaultValue: number): Promise<number> {
  try {
    const raw = await window.electronAPI.db.getSetting(key)
    const n = typeof raw === 'number' ? raw : parseFloat(String(raw))
    return Number.isFinite(n) ? n : defaultValue
  } catch {
    return defaultValue
  }
}

export async function setNumberSetting(key: string, value: number): Promise<void> {
  await window.electronAPI.db.setSetting(key, String(value))
}
