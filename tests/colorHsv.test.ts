import { describe, it, expect } from 'vitest'
import { hexToHsv, hsvToHex, isHex } from '../src/shared/color'
import { defined } from './helpers/defined'

// The picker converts on every pointer move, so a round trip that drifts would
// walk the colour away from itself while the user just holds still.

describe('hex to HSV and back', () => {
  const cases: [string, string][] = [
    ['#ff0000', 'red'],
    ['#00ff00', 'green'],
    ['#0000ff', 'blue'],
    ['#ffffff', 'white'],
    ['#000000', 'black'],
    ['#808080', 'mid grey'],
    ['#f6c453', 'a wall yellow'],
    ['#a7c7e7', 'a wall blue']
  ]

  for (const [hex, name] of cases) {
    it(`survives a round trip: ${name}`, () => {
      expect(hsvToHex(defined(hexToHsv(hex)))).toBe(hex)
    })
  }

  it('reads the primaries as the hues they are', () => {
    expect(defined(hexToHsv('#ff0000')).h).toBe(0)
    expect(defined(hexToHsv('#00ff00')).h).toBe(120)
    expect(defined(hexToHsv('#0000ff')).h).toBe(240)
  })

  it('reads white and black as the extremes of value and saturation', () => {
    expect(hexToHsv('#ffffff')).toMatchObject({ s: 0, v: 1 })
    expect(hexToHsv('#000000')).toMatchObject({ s: 0, v: 0 })
  })

  it('refuses what it cannot parse rather than guessing a colour', () => {
    for (const bad of ['', 'red', '#ggg', '#12345', 'rgb(1,2,3)']) {
      expect(hexToHsv(bad)).toBeNull()
    }
  })

  it('wraps a hue past the end instead of producing black', () => {
    expect(hsvToHex({ h: 360, s: 1, v: 1 })).toBe('#ff0000')
    expect(hsvToHex({ h: 720, s: 1, v: 1 })).toBe('#ff0000')
    expect(hsvToHex({ h: -60, s: 1, v: 1 })).toBe('#ff00ff')
  })

  it('always emits six digits, so a dark colour is not left short', () => {
    expect(hsvToHex({ h: 0, s: 0, v: 0.01 })).toMatch(/^#[0-9a-f]{6}$/)
    expect(hsvToHex({ h: 200, s: 1, v: 0.04 })).toHaveLength(7)
  })
})

describe('isHex', () => {
  it('accepts the form the pickers emit, in either case', () => {
    expect(isHex('#f6c453')).toBe(true)
    expect(isHex('#F6C453')).toBe(true)
    expect(isHex('  #f6c453 ')).toBe(true)
  })

  it('rejects a half-typed value, so it is not applied mid-keystroke', () => {
    for (const bad of ['#f6c45', '#f6c4533', 'f6c453', '#fff', '']) {
      expect(isHex(bad)).toBe(false)
    }
  })
})
