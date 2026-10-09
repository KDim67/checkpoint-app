/** fields a plugin asks you to fill in, such as a webhook address, so nothing secret has to live in its file */

export const SETTING_TYPES = ['text', 'secret', 'number', 'boolean'] as const
export type PluginSettingType = typeof SETTING_TYPES[number]
export type PluginSettingValue = string | number | boolean

export interface PluginSettingField {
  key: string
  label: string
  type: PluginSettingType
  description: string | null
  /** never for a secret: a default in the file would be the secret in the file */
  default: PluginSettingValue | null
}

/** what the settings screen gets: a secret only says whether it is set, its value never leaves main */
export interface PluginSettingState extends PluginSettingField {
  value: PluginSettingValue | null
  isSet: boolean
}

/** per plugin and per machine, and encrypted as a whole */
export const PLUGIN_SETTINGS_PREFIX = 'plugin_settings:'
export const pluginSettingsKey = (filename: string): string => `${PLUGIN_SETTINGS_PREFIX}${filename}`

export const MAX_SETTINGS = 20
const KEY = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/
const LIMITS: Record<PluginSettingType, number> = { text: 2000, secret: 4000, number: 0, boolean: 0 }

const isType = (value: unknown): value is PluginSettingType =>
  typeof value === 'string' && (SETTING_TYPES as readonly string[]).includes(value)

/** anything unusable is dropped, never guessed at; the first field with a key wins */
export function normalizeSettingFields(raw: Record<string, unknown>[] | null): PluginSettingField[] {
  const out: PluginSettingField[] = []
  for (const entry of raw ?? []) {
    if (out.length >= MAX_SETTINGS) break
    const key = typeof entry.key === 'string' ? entry.key.trim() : ''
    if (!KEY.test(key) || out.some(f => f.key === key)) continue
    const type = isType(entry.type) ? entry.type : 'text'
    const label = typeof entry.label === 'string' && entry.label.trim() ? entry.label.trim().slice(0, 80) : key
    const description = typeof entry.description === 'string' && entry.description.trim() ? entry.description.trim().slice(0, 300) : null
    const fallback = type === 'secret' ? null : checkValue(type, entry.default ?? null)
    out.push({ key, label, type, description, default: fallback && fallback.ok ? fallback.value : null })
  }
  return out
}

/** null clears a field; the message is shown beside it */
export function checkValue(type: PluginSettingType, value: unknown): { ok: true; value: PluginSettingValue | null } | { ok: false; error: string } {
  if (value === null || value === undefined || value === '') return { ok: true, value: null }
  if (type === 'number') {
    const n = typeof value === 'number' ? value : Number(value)
    return Number.isFinite(n) ? { ok: true, value: n } : { ok: false, error: 'has to be a number' }
  }
  if (type === 'boolean') return typeof value === 'boolean' ? { ok: true, value } : { ok: false, error: 'has to be on or off' }
  if (typeof value !== 'string') return { ok: false, error: 'has to be text' }
  return value.length <= LIMITS[type]
    ? { ok: true, value }
    : { ok: false, error: `can be at most ${LIMITS[type]} characters` }
}
