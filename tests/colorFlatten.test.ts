import { describe, it, expect } from 'vitest'
import { parseColor, flattenToHex } from '../src/shared/color'

// mermaid's classDef grammar has no rgba, a translucent token broke the whole graph

describe('parseColor', () => {
  it('reads a six digit hex as opaque', () => {
    expect(parseColor('#cdf12b')).toEqual([205, 241, 43, 1])
  })

  it('expands a three digit hex', () => {
    expect(parseColor('#fa0')).toEqual([255, 170, 0, 1])
  })

  it('reads rgb() as opaque', () => {
    expect(parseColor('rgb(205, 241, 43)')).toEqual([205, 241, 43, 1])
  })

  it('reads the alpha out of rgba()', () => {
    expect(parseColor('rgba(205, 241, 43, 0.1)')).toEqual([205, 241, 43, 0.1])
  })

  it('reads the space separated form', () => {
    expect(parseColor('rgb(205 241 43 / 0.5)')).toEqual([205, 241, 43, 0.5])
  })

  it('tolerates surrounding whitespace, which is how a token arrives', () => {
    expect(parseColor('  #cdf12b  ')).toEqual([205, 241, 43, 1])
  })

  it('is null for anything it cannot read, so a caller can fall back', () => {
    for (const junk of ['', 'rebeccapurple', 'var(--x)', '#12', 'hsl(90, 50%, 50%)']) {
      expect(parseColor(junk)).toBeNull()
    }
  })
})

describe('flattenToHex', () => {
  it('leaves an opaque colour alone', () => {
    expect(flattenToHex('#cdf12b', '#131622')).toBe('#cdf12b')
  })

  it('returns the backdrop when the colour is fully transparent', () => {
    expect(flattenToHex('rgba(205, 241, 43, 0)', '#131622')).toBe('#131622')
  })

  it('composites a half transparent colour halfway', () => {
    expect(flattenToHex('rgba(255, 255, 255, 0.5)', '#000000')).toBe('#808080')
  })

  it('flattens the token that broke the Dialogue graph', () => {
    // secondary-muted over surface-2, the chart background
    expect(flattenToHex('rgba(205, 241, 43, 0.1)', '#131622')).toBe('#262c23')
  })

  it('emits nothing Mermaid would choke on', () => {
    const out = flattenToHex('rgba(205, 241, 43, 0.1)', '#131622')
    expect(out).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('is null when either side is unreadable', () => {
    expect(flattenToHex('nonsense', '#131622')).toBeNull()
    expect(flattenToHex('#cdf12b', 'nonsense')).toBeNull()
  })
})
