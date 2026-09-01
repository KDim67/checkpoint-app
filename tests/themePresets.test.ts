import { describe, it, expect } from 'vitest'
import {
  BUILT_IN_PRESETS,
  DEFAULT_THEME,
  THEME_VAR_NAMES,
  createPreset,
  deriveThemeVars,
  normalizePreset,
  normalizePresets,
  presetMatches,
  type ThemePreset,
  type ThemeVariables
} from '../src/shared/themePresets'

const vars = (over: Partial<ThemeVariables> = {}): ThemeVariables => ({ ...DEFAULT_THEME, ...over })
const preset = (over: Partial<ThemePreset> = {}): ThemePreset => ({
  id: 'p1',
  name: 'One',
  vars: vars(),
  ...over
})

describe('deriveThemeVars', () => {
  it('derives the tints the colour picker used to inline', () => {
    const out = deriveThemeVars(vars({ '--color-primary': '#112233', '--color-secondary': '#445566' }))
    expect(out['--color-primary-muted']).toBe('#11223326')
    expect(out['--color-secondary-muted']).toBe('#4455661a')
    expect(out['--color-gold']).toBe('#445566')
  })

  it('passes every declared variable through untouched', () => {
    const out = deriveThemeVars(vars())
    for (const key of THEME_VAR_NAMES) expect(out[key]).toBe(DEFAULT_THEME[key])
  })
})

describe('normalizePreset', () => {
  it('rejects entries with no usable identity', () => {
    expect(normalizePreset(null)).toBeNull()
    expect(normalizePreset('nope')).toBeNull()
    expect(normalizePreset({ name: 'No id' })).toBeNull()
    expect(normalizePreset({ id: 'x' })).toBeNull()
    expect(normalizePreset({ id: '   ', name: '   ' })).toBeNull()
  })

  it('falls back to the default for any variable that is not a hex colour', () => {
    const out = normalizePreset({
      id: 'x',
      name: 'X',
      vars: {
        '--color-background': '#abcdef',
        '--color-primary': 'rgb(1,2,3)',   // not hex
        '--color-secondary': '#GGGGGG',    // not hex
        '--color-text-base': 42            // not a string
      }
    })
    expect(out?.vars['--color-background']).toBe('#abcdef')
    expect(out?.vars['--color-primary']).toBe(DEFAULT_THEME['--color-primary'])
    expect(out?.vars['--color-secondary']).toBe(DEFAULT_THEME['--color-secondary'])
    expect(out?.vars['--color-text-base']).toBe(DEFAULT_THEME['--color-text-base'])
  })

  it('keeps a font as free text but requires it to be non-empty', () => {
    expect(normalizePreset({ id: 'x', name: 'X', vars: { '--font-sans': "  'Outfit', sans-serif  " } })?.vars['--font-sans'])
      .toBe("'Outfit', sans-serif")
    expect(normalizePreset({ id: 'x', name: 'X', vars: { '--font-sans': '   ' } })?.vars['--font-sans'])
      .toBe(DEFAULT_THEME['--font-sans'])
  })

  it('lowercases colours so a stored preset compares equal to a picked one', () => {
    expect(normalizePreset({ id: 'x', name: 'X', vars: { '--color-background': '#ABCDEF' } })?.vars['--color-background'])
      .toBe('#abcdef')
  })

  it('only honours builtIn when it is exactly true', () => {
    expect(normalizePreset({ id: 'x', name: 'X', builtIn: true })?.builtIn).toBe(true)
    expect(normalizePreset({ id: 'x', name: 'X', builtIn: 'yes' })?.builtIn).toBeUndefined()
    expect(normalizePreset({ id: 'x', name: 'X' })?.builtIn).toBeUndefined()
  })
})

describe('normalizePresets', () => {
  it('reads both a real array and a JSON string of one', () => {
    const list = [{ id: 'a', name: 'A' }]
    expect(normalizePresets(list)).toHaveLength(1)
    expect(normalizePresets(JSON.stringify(list))).toHaveLength(1)
  })

  it('yields an empty list rather than throwing on junk', () => {
    expect(normalizePresets(undefined)).toEqual([])
    expect(normalizePresets('{not json')).toEqual([])
    expect(normalizePresets({ id: 'a' })).toEqual([])
    expect(normalizePresets(7)).toEqual([])
  })

  it('drops malformed entries but keeps the good ones around them', () => {
    const out = normalizePresets([{ id: 'a', name: 'A' }, null, { name: 'no id' }, { id: 'b', name: 'B' }])
    expect(out.map(p => p.id)).toEqual(['a', 'b'])
  })

  it('drops duplicate ids, which would otherwise be undeletable', () => {
    const out = normalizePresets([{ id: 'a', name: 'First' }, { id: 'a', name: 'Second' }])
    expect(out).toHaveLength(1)
    expect(out[0].name).toBe('First')
  })
})

describe('presetMatches', () => {
  it('matches an identical variable set', () => {
    expect(presetMatches(preset(), vars())).toBe(true)
  })

  it('ignores hex case, since the picker emits uppercase', () => {
    const p = preset({ vars: vars({ '--color-primary': '#1E45FC' }) })
    expect(presetMatches(p, vars({ '--color-primary': '#1e45fc' }))).toBe(true)
  })

  it('fails on any single differing variable', () => {
    expect(presetMatches(preset(), vars({ '--color-text-faint': '#000000' }))).toBe(false)
  })

  it('compares the font exactly', () => {
    expect(presetMatches(preset(), vars({ '--font-sans': "'Outfit', sans-serif" }))).toBe(false)
  })
})

describe('createPreset', () => {
  it('rejects an empty or whitespace name', () => {
    expect(createPreset('   ', vars(), [], 1)).toEqual({ error: 'Give the preset a name.' })
  })

  it('rejects a name over 40 characters', () => {
    const r = createPreset('x'.repeat(41), vars(), [], 1)
    expect('error' in r).toBe(true)
  })

  it('rejects a duplicate name regardless of case', () => {
    const r = createPreset('midnight', vars(), [preset({ name: 'Midnight' })], 1)
    expect(r).toEqual({ error: 'A preset named "midnight" already exists.' })
  })

  it('trims the stored name', () => {
    const r = createPreset('  Dusk  ', vars(), [], 1)
    expect('preset' in r && r.preset.name).toBe('Dusk')
  })

  it('copies the variables so later edits do not mutate the saved preset', () => {
    const live = vars()
    const r = createPreset('Dusk', live, [], 1)
    if (!('preset' in r)) throw new Error('expected a preset')
    live['--color-primary'] = '#000000'
    expect(r.preset.vars['--color-primary']).toBe(DEFAULT_THEME['--color-primary'])
  })

  it('does not reuse an id when two presets are saved in the same millisecond', () => {
    const first = createPreset('A', vars(), [], 1000)
    if (!('preset' in first)) throw new Error('expected a preset')
    const second = createPreset('B', vars(), [first.preset], 1000)
    if (!('preset' in second)) throw new Error('expected a preset')
    expect(second.preset.id).not.toBe(first.preset.id)
  })
})

describe('the shipped presets', () => {
  it('survive a round trip through the normalizer unchanged', () => {
    const round = normalizePresets(JSON.parse(JSON.stringify(BUILT_IN_PRESETS)))
    expect(round).toEqual(BUILT_IN_PRESETS)
  })

  it('each define every variable, so applying one never leaves a stale value behind', () => {
    for (const p of BUILT_IN_PRESETS) {
      for (const key of THEME_VAR_NAMES) expect(p.vars[key], `${p.name} is missing ${key}`).toBeTruthy()
    }
  })

  it('have unique ids and names', () => {
    expect(new Set(BUILT_IN_PRESETS.map(p => p.id)).size).toBe(BUILT_IN_PRESETS.length)
    expect(new Set(BUILT_IN_PRESETS.map(p => p.name)).size).toBe(BUILT_IN_PRESETS.length)
  })

  it('are all marked builtIn, which is what makes them undeletable in the UI', () => {
    for (const p of BUILT_IN_PRESETS) expect(p.builtIn).toBe(true)
  })

  it('keep body text readable on every surface they define', () => {
    const hex = (h: string) => [
      parseInt(h.slice(1, 3), 16),
      parseInt(h.slice(3, 5), 16),
      parseInt(h.slice(5, 7), 16)
    ]
    const lin = (c: number) => {
      const v = c / 255
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
    }
    const lum = (h: string) => {
      const [r, g, b] = hex(h).map(lin)
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
    const ratio = (a: string, b: string) => {
      const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
      return (hi + 0.05) / (lo + 0.05)
    }

    for (const p of BUILT_IN_PRESETS) {
      const surfaces = [p.vars['--color-background'], p.vars['--color-surface-1'], p.vars['--color-surface-2']]
      const worst = (key: (typeof THEME_VAR_NAMES)[number]) =>
        Math.min(...surfaces.map(s => ratio(p.vars[key], s)))

      expect(worst('--color-text-base'), `${p.name} body text`).toBeGreaterThanOrEqual(7)
      expect(worst('--color-text-muted'), `${p.name} muted text`).toBeGreaterThanOrEqual(4.5)
      expect(worst('--color-primary'), `${p.name} primary`).toBeGreaterThanOrEqual(4.5)
      expect(worst('--color-secondary'), `${p.name} secondary`).toBeGreaterThanOrEqual(4.5)
    }
  })
})
