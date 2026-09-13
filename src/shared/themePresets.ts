/** a named variable map, stored like any setting */

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

type ThemeVarName = (typeof THEME_VAR_NAMES)[number]
export type ThemeVariables = Record<ThemeVarName, string>

/** what Reset to Defaults returns to */
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
  /** applyable, not renamable or deletable */
  builtIn?: boolean
}

/** 0x26 ~15%, 0x1a ~10%; named so picker and presets agree */
const PRIMARY_TINT_ALPHA = '26'
const SECONDARY_TINT_ALPHA = '1a'

/** matched to the shipped pair */
const HOVER_LIGHTEN = 0.1

/** call before the engine; stored derivatives go stale */
export function deriveThemeVars(vars: ThemeVariables): Record<string, string> {
  const primary = vars['--color-primary']
  const secondary = vars['--color-secondary']
  return {
    ...vars,
    '--color-primary-muted': primary + PRIMARY_TINT_ALPHA,
    '--color-primary-hover': lighten(primary, HOVER_LIGHTEN),
    '--color-secondary-muted': secondary + SECONDARY_TINT_ALPHA,
    // secondary buttons put their label on it
    '--color-text-inverted': readableForegroundOn(secondary),
    // legacy alias some call sites still use
    '--color-gold': secondary
  }
}

/** eight light, eight dark; Ink for OLED; tests hold 7:1 body, 4.5:1 accents */
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
  },
  {
    id: 'builtin-forest',
    name: 'Forest',
    builtIn: true,
    vars: {
      '--color-background': '#0b1210',
      '--color-surface-1': '#121b18',
      '--color-surface-2': '#1a2521',
      '--color-surface-offset': '#24332d',
      '--color-surface-elevated': '#2d3f38',
      '--color-primary': '#5eead4',
      '--color-secondary': '#a3e635',
      '--color-balance': '#6b8a7d',
      '--color-text-base': '#e6f0ec',
      '--color-text-muted': '#9db5ab',
      '--color-text-faint': '#7a958a',
      '--font-sans': "'Inter', sans-serif"
    }
  },
  {
    id: 'builtin-amethyst',
    name: 'Amethyst',
    builtIn: true,
    vars: {
      '--color-background': '#0d0a14',
      '--color-surface-1': '#171223',
      '--color-surface-2': '#1f1830',
      '--color-surface-offset': '#2b2140',
      '--color-surface-elevated': '#372a52',
      '--color-primary': '#a78bfa',
      '--color-secondary': '#f0abfc',
      '--color-balance': '#7d6ea6',
      '--color-text-base': '#ece8f5',
      '--color-text-muted': '#aca0c8',
      '--color-text-faint': '#8a7cae',
      '--font-sans': "'Inter', sans-serif"
    }
  },
  {
    id: 'builtin-daylight',
    name: 'Daylight',
    builtIn: true,
    vars: {
      '--color-background': '#eef1f6',
      '--color-surface-1': '#ffffff',
      '--color-surface-2': '#e6ebf3',
      '--color-surface-offset': '#d3dbe8',
      '--color-surface-elevated': '#ffffff',
      '--color-primary': '#1d4ed8',
      '--color-secondary': '#0f766e',
      '--color-balance': '#7286a1',
      '--color-text-base': '#0f172a',
      '--color-text-muted': '#475569',
      '--color-text-faint': '#5d6b7d',
      '--font-sans': "'Inter', sans-serif"
    }
  },
  {
    id: 'builtin-ink',
    name: 'Ink',
    builtIn: true,
    vars: {
      '--color-background': '#000000',
      '--color-surface-1': '#0a0a0a',
      '--color-surface-2': '#141414',
      '--color-surface-offset': '#262626',
      '--color-surface-elevated': '#303030',
      '--color-primary': '#60a5fa',
      '--color-secondary': '#facc15',
      '--color-balance': '#6b6b6b',
      '--color-text-base': '#fafafa',
      '--color-text-muted': '#a8a8a8',
      '--color-text-faint': '#8a8a8a',
      '--font-sans': "'Inter', sans-serif"
    }
  },
  {
    id: 'builtin-clay',
    name: 'Clay',
    builtIn: true,
    vars: {
      '--color-background': '#f2ece6',
      '--color-surface-1': '#fdfaf7',
      '--color-surface-2': '#e9e1d8',
      '--color-surface-offset': '#d8cec2',
      '--color-surface-elevated': '#fdfaf7',
      '--color-primary': '#9a3412',
      '--color-secondary': '#45700e',
      '--color-balance': '#8a7a68',
      '--color-text-base': '#241d17',
      '--color-text-muted': '#5a4d40',
      '--color-text-faint': '#6d5f50',
      '--font-sans': "'Inter', sans-serif"
    }
  },
  {
    id: 'builtin-beige',
    name: 'Beige',
    builtIn: true,
    vars: {
      '--color-background': '#e6dcc8',
      '--color-surface-1': '#f5efe1',
      '--color-surface-2': '#dcd0b8',
      '--color-surface-offset': '#c9bb9e',
      '--color-surface-elevated': '#f5efe1',
      '--color-primary': '#6b4423',
      '--color-secondary': '#575d31',
      '--color-balance': '#7d735f',
      '--color-text-base': '#2b2318',
      '--color-text-muted': '#574c3a',
      '--color-text-faint': '#6a5e49',
      '--font-sans': "'Inter', sans-serif"
    }
  },
  {
    id: 'builtin-cherry',
    name: 'Cherry',
    builtIn: true,
    vars: {
      '--color-background': '#150a0d',
      '--color-surface-1': '#211116',
      '--color-surface-2': '#2d171d',
      '--color-surface-offset': '#3d2028',
      '--color-surface-elevated': '#4d2934',
      '--color-primary': '#ff6b81',
      '--color-secondary': '#f0a868',
      '--color-balance': '#8f5f6b',
      '--color-text-base': '#f8e9ec',
      '--color-text-muted': '#c9a5ad',
      '--color-text-faint': '#a4838b',
      '--font-sans': "'Inter', sans-serif"
    }
  },
  {
    id: 'builtin-ocean',
    name: 'Ocean',
    builtIn: true,
    vars: {
      '--color-background': '#06121a',
      '--color-surface-1': '#0d1e2a',
      '--color-surface-2': '#142a38',
      '--color-surface-offset': '#1e3a4c',
      '--color-surface-elevated': '#274b61',
      '--color-primary': '#2dd4bf',
      '--color-secondary': '#7dd3fc',
      '--color-balance': '#5f8497',
      '--color-text-base': '#e2f1f7',
      '--color-text-muted': '#a0bcc9',
      '--color-text-faint': '#7f9dab',
      '--font-sans': "'Inter', sans-serif"
    }
  },
  {
    id: 'builtin-fog',
    name: 'Fog',
    builtIn: true,
    vars: {
      '--color-background': '#e9eaec',
      '--color-surface-1': '#f8f9fa',
      '--color-surface-2': '#dfe1e4',
      '--color-surface-offset': '#cbced3',
      '--color-surface-elevated': '#f8f9fa',
      '--color-primary': '#2b4a9b',
      '--color-secondary': '#4f6347',
      '--color-balance': '#7a7f89',
      '--color-text-base': '#1b1d21',
      '--color-text-muted': '#4b5058',
      '--color-text-faint': '#5c626b',
      '--font-sans': "'Inter', sans-serif"
    }
  },
  {
    id: 'builtin-sakura',
    name: 'Sakura',
    builtIn: true,
    vars: {
      '--color-background': '#f7edf0',
      '--color-surface-1': '#fffafb',
      '--color-surface-2': '#f0e0e5',
      '--color-surface-offset': '#e2ccd4',
      '--color-surface-elevated': '#fffafb',
      '--color-primary': '#a8325c',
      '--color-secondary': '#4f6280',
      '--color-balance': '#8f7b84',
      '--color-text-base': '#2a1d22',
      '--color-text-muted': '#5c4a51',
      '--color-text-faint': '#6e5b63',
      '--font-sans': "'Inter', sans-serif"
    }
  },
  {
    id: 'builtin-cherry-cream',
    name: 'Cherry Cream',
    builtIn: true,
    vars: {
      '--color-background': '#ece0d2',
      '--color-surface-1': '#faf3e9',
      '--color-surface-2': '#e0d2c0',
      '--color-surface-offset': '#cdbca6',
      '--color-surface-elevated': '#faf3e9',
      '--color-primary': '#a3123a',
      '--color-secondary': '#6f5137',
      '--color-balance': '#867260',
      '--color-text-base': '#2c211a',
      '--color-text-muted': '#59473a',
      '--color-text-faint': '#6b5747',
      '--font-sans': "'Inter', sans-serif"
    }
  },
  {
    id: 'builtin-sage',
    name: 'Sage',
    builtIn: true,
    vars: {
      '--color-background': '#e8eee6',
      '--color-surface-1': '#f7faf5',
      '--color-surface-2': '#dde5da',
      '--color-surface-offset': '#c9d4c5',
      '--color-surface-elevated': '#f7faf5',
      '--color-primary': '#2f6b4f',
      '--color-secondary': '#7a5c1f',
      '--color-balance': '#75837a',
      '--color-text-base': '#1c231e',
      '--color-text-muted': '#4a5850',
      '--color-text-faint': '#5b6a61',
      '--font-sans': "'Inter', sans-serif"
    }
  },
  {
    id: 'builtin-neon',
    name: 'Neon',
    builtIn: true,
    vars: {
      '--color-background': '#0a0713',
      '--color-surface-1': '#140d24',
      '--color-surface-2': '#1d1333',
      '--color-surface-offset': '#2a1c48',
      '--color-surface-elevated': '#382660',
      '--color-primary': '#ff4ecd',
      '--color-secondary': '#4ee2ff',
      '--color-balance': '#7a68a6',
      '--color-text-base': '#f2e9ff',
      '--color-text-muted': '#b8a7d8',
      '--color-text-faint': '#9788bd',
      '--font-sans': "'Inter', sans-serif"
    }
  }
]

const isHex = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v)

/** every field checked, a bad row would paint undefined */
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
    // fonts are free text, the rest must be hex for tint concatenation
    if (key === '--font-sans') {
      if (typeof v === 'string' && v.trim()) vars[key] = v.trim()
    } else if (isHex(v)) {
      vars[key] = v.toLowerCase()
    }
  }
  return { id, name, vars, ...(o.builtIn === true ? { builtIn: true as const } : {}) }
}

/** drops malformed entries */
export function normalizePresets(raw: unknown): ThemePreset[] {
  let parsed: unknown = raw
  // JSON strings accepted, older writes stringified
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
    // duplicate ids make one copy unreachable
    if (preset && !seen.has(preset.id)) {
      seen.add(preset.id)
      out.push(preset)
    }
  }
  return out
}

/** equals the live values */
export function presetMatches(preset: ThemePreset, vars: ThemeVariables): boolean {
  return THEME_VAR_NAMES.every(k => {
    const a = preset.vars[k]
    const b = vars[k]
    // picker hex is uppercase, defaults lowercase
    return k === '--font-sans' ? a === b : a?.toLowerCase() === b?.toLowerCase()
  })
}

/** existing settles name clashes and ids for same-ms saves */
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
