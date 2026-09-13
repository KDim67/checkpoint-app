import { describe, expect, it } from 'vitest'
import { DEFAULT_PEN_PRESETS, normalizePenPresets, presetFor, withPresetChange } from '../src/renderer/src/components/wall/wallPenPresets'

describe('pen presets', () => {
  it('starts with three presets for each tool, the first one picked', () => {
    expect(DEFAULT_PEN_PRESETS.pen).toHaveLength(3)
    expect(DEFAULT_PEN_PRESETS.highlighter).toHaveLength(3)
    expect(DEFAULT_PEN_PRESETS.active).toStrictEqual({ pen: 0, highlighter: 0 })
  })

  it('reads stored presets, falling back slot by slot on anything malformed', () => {
    const read = normalizePenPresets({
      pen: [{ color: '#111111', width: 8 }, { color: 5 }, { color: '#222222', width: 3 }],
      highlighter: 'x',
      active: { pen: 1, highlighter: 9 }
    })
    expect(read.pen).toStrictEqual([{ color: '#111111', width: 8 }, DEFAULT_PEN_PRESETS.pen[1], DEFAULT_PEN_PRESETS.pen[2]])
    expect(read.highlighter).toStrictEqual(DEFAULT_PEN_PRESETS.highlighter)
    expect(read.active).toStrictEqual({ pen: 1, highlighter: 0 })
    expect(normalizePenPresets(null)).toStrictEqual(DEFAULT_PEN_PRESETS)
  })

  it('changes only the picked preset of the tool in use', () => {
    const next = withPresetChange(DEFAULT_PEN_PRESETS, 'highlighter', { color: '#f28b82' })
    expect(presetFor(next, 'highlighter')).toStrictEqual({ ...DEFAULT_PEN_PRESETS.highlighter[0], color: '#f28b82' })
    expect(next.pen).toBe(DEFAULT_PEN_PRESETS.pen)
    expect(next.highlighter[1]).toBe(DEFAULT_PEN_PRESETS.highlighter[1])
  })
})
