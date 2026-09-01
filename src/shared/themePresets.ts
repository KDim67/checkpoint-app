/**
 * Named theme presets for the customization engine.
 *
 * The engine stored exactly one set of overrides, so trying a different look
 * meant destroying the one you had. A preset is that same variable map with a
 * name attached, which is why this file carries no persistence of its own, the
 * renderer writes presets to `customizer_theme_presets` the way it writes every
 * other setting, and applying one goes through the existing
 * `customizer.updateTheme` IPC.
 *
 * Pure on purpose: it sits in shared/ so the unit tests can reach it without an
 * Electron process, the same reason boardModel.ts lives here.
 */

import { lighten, readableForegroundOn } from './color'

export const THEME_VAR_NAMES = [
  '--color-background',
  '--color-surface-1',
  '--color-surface-2',
  '--color-surface-offset',
  '--color-surface-elevated',
  '--color-primary',
  '--color-secondary',
  '--color-balance',
  '--color-text-base',
  '--color-text-muted',
  '--color-text-faint',
  '--font-sans'
] as const

export type ThemeVarName = (typeof THEME_VAR_NAMES)[number]
export type ThemeVariables = Record<ThemeVarName, string>

/** The shipped brand values. Also what "Reset to Defaults" returns you to. */
export const DEFAULT_THEME: ThemeVariables = {
  '--color-background': '#0b0c10',
  '--color-surface-1': '#131622',
  '--color-surface-2': '#1b1f30',
  '--color-surface-offset': '#24293f',
  '--color-surface-elevated': '#2e3450',
  '--color-primary': '#1e45fc',
  '--color-secondary': '#cdf12b',
  '--color-balance': '#535e85',
  '--color-text-base': '#f1f5f9',
  '--color-text-muted': '#94a3b8',
  '--color-text-faint': '#475569',
  '--font-sans': "'Inter', sans-serif"
}

export interface ThemePreset {
  id: string
  name: string
  vars: ThemeVariables
  /** Built-ins ship with the app: they can be applied but not renamed or deleted. */
  builtIn?: boolean
}

/**
 * Opacity suffixes for the tints the picker derives rather than asking for.
 * 0x26/255 is about 15% and 0x1a/255 about 10%, the values the colour handler
 * already used inline. Named here so the preset path and the picker cannot
 * drift apart.
 */
const PRIMARY_TINT_ALPHA = '26'
const SECONDARY_TINT_ALPHA = '1a'

/** How far a hover state sits above its base, matched to the shipped pair. */
const HOVER_LIGHTEN = 0.1

/**
 * Expands a variable map with everything derived from primary and secondary.
 *
 * Callers must apply this before handing variables to the engine. A preset that
 * stored its own derivatives would be one more thing to keep in sync, and one
 * saved before the rule changed would quietly keep the old values.
 *
 * `--color-primary-hover` and `--color-text-inverted` are here because neither
 * was ever overridden: a custom primary kept the stock blue hover, and the text
 * on a secondary-coloured button stayed white however light that colour got.
 */
export function deriveThemeVars(vars: ThemeVariables): Record<string, string> {
  const primary = vars['--color-primary']
  const secondary = vars['--color-secondary']
  return {
    ...vars,
    '--color-primary-muted': primary + PRIMARY_TINT_ALPHA,
    '--color-primary-hover': lighten(primary, HOVER_LIGHTEN),
    '--color-secondary-muted': secondary + SECONDARY_TINT_ALPHA,
    // Buttons filled with the secondary colour put their label on top of it.
    '--color-text-inverted': readableForegroundOn(secondary),
    // Legacy alias still referenced by a few call sites.
    '--color-gold': secondary
  }
}

/**
 * Presets that ship with the app.
 *
 * Deliberately not a copy of DEFAULT_THEME, "Reset to Defaults" already covers
 * going back, so a preset that only restored the brand would be a second button
 * for a control that exists. These are three genuinely different looks, each
 * with its body text kept well clear of its own canvas so none ships unreadable.
 */
export const BUILT_IN_PRESETS: ThemePreset[] = [
  {
    id: 'builtin-midnight',
    name: 'Midnight',
    builtIn: true,
    vars: {
      '--color-background': '#080b14',
      '--color-surface-1': '#111827',
      '--color-surface-2': '#1a2233',
      '--color-surface-offset': '#232d42',
      '--color-surface-elevated': '#2d3852',
      '--color-primary': '#60a5fa',
      '--color-secondary': '#38bdf8',
      '--color-balance': '#647291',
      '--color-text-base': '#e5e9f0',
      '--color-text-muted': '#97a3b6',
      '--color-text-faint': '#6b7688',
      '--font-sans': "'Inter', sans-serif"
    }
  },
  {
    id: 'builtin-paper',
    name: 'Paper',
    builtIn: true,
    vars: {
      '--color-background': '#f4f1ea',
      '--color-surface-1': '#fffdf8',
      '--color-surface-2': '#eee9df',
      '--color-surface-offset': '#ded7c9',
      '--color-surface-elevated': '#fffdf8',
      '--color-primary': '#2f5fd0',
      '--color-secondary': '#5e701b',
      '--color-balance': '#7e7669',
      '--color-text-base': '#22201b',
      '--color-text-muted': '#57524a',
      '--color-text-faint': '#6d675c',
      '--font-sans': "'Inter', sans-serif"
    }
  },
  {
    id: 'builtin-ember',
    name: 'Ember',
    builtIn: true,
    vars: {
      '--color-background': '#14100e',
      '--color-surface-1': '#1f1917',
      '--color-surface-2': '#2a2220',
      '--color-surface-offset': '#382d29',
      '--color-surface-elevated': '#463832',
      '--color-primary': '#f0955a',
      '--color-secondary': '#e8c468',
      '--color-balance': '#877368',
      '--color-text-base': '#f5ede6',
      '--color-text-muted': '#b5a396',
      '--color-text-faint': '#8a7a6e',
      '--font-sans': "'Inter', sans-serif"
    }
  }
]

const isHex = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v)

/**
 * Coerces one stored entry into a preset, or null if it cannot be trusted.
 *
 * Every field is checked rather than cast: these rows are read straight back out
 * of the settings table, where a hand-edited value or a half-written array would
 * otherwise reach the engine and paint the app with `undefined`.
 */
export function normalizePreset(raw: unknown): ThemePreset | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const id = typeof o.id === 'string' ? o.id.trim() : ''
  const name = typeof o.name === 'string' ? o.name.trim() : ''
  if (!id || !name) return null

  const rawVars = (o.vars && typeof o.vars === 'object' ? o.vars : {}) as Record<string, unknown>
  const vars = { ...DEFAULT_THEME }
  for (const key of THEME_VAR_NAMES) {
    const v = rawVars[key]
    // A font is free text; every other variable must be a hex colour, because
    // the derived tints are built from these by string concatenation.
    if (key === '--font-sans') {
      if (typeof v === 'string' && v.trim()) vars[key] = v.trim()
    } else if (isHex(v)) {
      vars[key] = v.toLowerCase()
    }
  }
  return { id, name, vars, ...(o.builtIn === true ? { builtIn: true as const } : {}) }
}

/** Parses the stored list, dropping anything malformed rather than throwing. */
export function normalizePresets(raw: unknown): ThemePreset[] {
  let parsed: unknown = raw
  // A JSON string is accepted alongside a real array, the same tolerance the
  // board config applies, because older writes stringified the value themselves.
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw)
    } catch {
      return []
    }
  }
  if (!Array.isArray(parsed)) return []

  const seen = new Set<string>()
  const out: ThemePreset[] = []
  for (const entry of parsed) {
    const preset = normalizePreset(entry)
    // Ids address a preset for delete and rename, so a duplicate would make the
    // second copy unreachable and the first undeletable.
    if (preset && !seen.has(preset.id)) {
      seen.add(preset.id)
      out.push(preset)
    }
  }
  return out
}

/** True when every variable in the preset equals the live value. */
export function presetMatches(preset: ThemePreset, vars: ThemeVariables): boolean {
  return THEME_VAR_NAMES.every(k => {
    const a = preset.vars[k]
    const b = vars[k]
    // Colours compare case-insensitively: the picker emits uppercase hex while
    // the shipped defaults are lowercase.
    return k === '--font-sans' ? a === b : a?.toLowerCase() === b?.toLowerCase()
  })
}

/**
 * Builds a preset from the current variables.
 *
 * `existing` is used both to reject a duplicate name and to settle the id, so
 * two presets saved in the same millisecond cannot collide, the timestamp alone
 * could, and the id is what delete and rename address.
 */
export function createPreset(
  name: string,
  vars: ThemeVariables,
  existing: ThemePreset[],
  now: number
): { preset: ThemePreset } | { error: string } {
  const trimmed = name.trim()
  if (!trimmed) return { error: 'Give the preset a name.' }
  if (trimmed.length > 40) return { error: 'Preset names are limited to 40 characters.' }
  if (existing.some(p => p.name.toLowerCase() === trimmed.toLowerCase())) {
    return { error: `A preset named "${trimmed}" already exists.` }
  }

  let id = `preset-${now}`
  let n = 2
  while (existing.some(p => p.id === id)) id = `preset-${now}-${n++}`

  return { preset: { id, name: trimmed, vars: { ...vars } } }
}
