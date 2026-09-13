/** readers accept 'true'/'false' strings and real booleans from older dbs; writers use strings */

import { getSetting, setSetting } from '../data/settings'

export async function getBoolSetting(key: string, defaultValue: boolean): Promise<boolean> {
  try {
    const raw = await getSetting(key)
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
  await setSetting(key, String(value))
}

export async function getStringSetting(key: string, defaultValue: string): Promise<string> {
  try {
    const raw = await getSetting(key)
    return typeof raw === 'string' && raw !== '' ? raw : defaultValue
  } catch {
    return defaultValue
  }
}

/** falls back when the value drifts out of the set */
export async function getEnumSetting<T extends string>(
  key: string,
  allowed: readonly T[],
  defaultValue: T
): Promise<T> {
  const raw = await getStringSetting(key, defaultValue)
  return (allowed as readonly string[]).includes(raw) ? (raw as T) : defaultValue
}

export async function setStringSetting(key: string, value: string): Promise<void> {
  await setSetting(key, value)
}

export async function getNumberSetting(key: string, defaultValue: number): Promise<number> {
  try {
    const raw = await getSetting(key)
    const n = typeof raw === 'number' ? raw : parseFloat(String(raw))
    return Number.isFinite(n) ? n : defaultValue
  } catch {
    return defaultValue
  }
}

export async function setNumberSetting(key: string, value: number): Promise<void> {
  await setSetting(key, String(value))
}

/** falls back for missing, empty or unparseable rows; hand edits happen */
export async function getJsonSetting<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await getSetting(key)
    if (typeof raw !== 'string' || raw === '') return fallback
    const parsed = JSON.parse(raw)
    return parsed === null || parsed === undefined ? fallback : (parsed as T)
  } catch {
    return fallback
  }
}

export async function setJsonSetting(key: string, value: unknown): Promise<void> {
  await setSetting(key, JSON.stringify(value))
}
