import { describe, it, expect } from 'vitest'
import { computePbrMaps } from '../src/renderer/src/lib/imageProcessing'

const PARAMS = {
  normalIntensity: 1,
  heightDepth: 1,
  roughnessContrast: 1,
  roughnessBase: 0.5,
  aoIntensity: 1,
  invertHeight: false
}

/** mid-grey square on a transparent field */
function spriteOnTransparent(size = 8, inset = 2): Uint8ClampedArray {
  const src = new Uint8ClampedArray(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      const opaque = x >= inset && x < size - inset && y >= inset && y < size - inset
      // transparent pixels carry black, which read as a cliff
      src[i] = opaque ? 128 : 0
      src[i + 1] = opaque ? 128 : 0
      src[i + 2] = opaque ? 128 : 0
      src[i + 3] = opaque ? 255 : 0
    }
  }
  return src
}

function flatOpaque(size = 8, value = 128): Uint8ClampedArray {
  const src = new Uint8ClampedArray(size * size * 4)
  for (let i = 0; i < src.length; i += 4) {
    src[i] = value; src[i + 1] = value; src[i + 2] = value; src[i + 3] = 255
  }
  return src
}

describe('computePbrMaps and the alpha channel', () => {
  it('carries the source alpha into every map', () => {
    const size = 8
    const src = spriteOnTransparent(size)
    const { hData, nData, rData, aData } = computePbrMaps(src, size, size, PARAMS)

    for (let i = 3; i < src.length; i += 4) {
      expect(hData[i]).toBe(src[i])
      expect(nData[i]).toBe(src[i])
      expect(rData[i]).toBe(src[i])
      expect(aData[i]).toBe(src[i])
    }
  })

  it('does not read a transparent pixel as a black one', () => {
    const size = 8
    const src = spriteOnTransparent(size)
    const { nData } = computePbrMaps(src, size, size, PARAMS)

    // just inside the silhouette, the normal should be near flat
    const edge = ((2 * size) + 2) * 4
    expect(nData[edge]).toBeGreaterThan(110)
    expect(nData[edge]).toBeLessThan(146)
    expect(nData[edge + 1]).toBeGreaterThan(110)
    expect(nData[edge + 1]).toBeLessThan(146)
  })

  it('leaves a fully opaque texture exactly as it was', () => {
    const size = 8
    const src = flatOpaque(size)
    const { hData, nData, rData, aData } = computePbrMaps(src, size, size, PARAMS)

    // flat grey stays flat and opaque, the ordinary case is unchanged
    for (let i = 0; i < src.length; i += 4) {
      expect(hData[i]).toBe(128)
      expect(nData[i]).toBe(128)
      expect(nData[i + 1]).toBe(128)
      expect(nData[i + 2]).toBe(255)
      expect(hData[i + 3]).toBe(255)
      expect(rData[i + 3]).toBe(255)
      expect(aData[i + 3]).toBe(255)
    }
  })
})
