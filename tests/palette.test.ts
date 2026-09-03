import { describe, it, expect } from 'vitest'
import { extractPalette } from '../src/renderer/src/lib/imageProcessing'

/** Builds an RGBA buffer from a list of [r,g,b,a] repeated `times` each. */
function pixels(...runs: [number, number, number, number, number][]): Uint8ClampedArray {
  const total = runs.reduce((n, r) => n + r[4], 0)
  const out = new Uint8ClampedArray(total * 4)
  let i = 0
  for (const [r, g, b, a, times] of runs) {
    for (let n = 0; n < times; n++) {
      out[i++] = r; out[i++] = g; out[i++] = b; out[i++] = a
    }
  }
  return out
}

describe('extractPalette', () => {
  it('returns the most common colour first', () => {
    const data = pixels(
      [255, 0, 0, 255, 10],
      [0, 0, 255, 255, 3]
    )
    const [first, second] = extractPalette(data)
    expect(first).toBe('#ff0000')
    expect(second).toBe('#0000ff')
  })

  it('groups shades that read as one colour', () => {
    // Sixteen imperceptibly different browns are not a palette.
    const data = pixels(
      [100, 60, 20, 255, 5],
      [102, 62, 22, 255, 5],
      [101, 61, 21, 255, 5]
    )
    expect(extractPalette(data)).toHaveLength(1)
  })

  it('reports a real colour from the image, not the corner of a bucket', () => {
    // Both sit inside the same bucket (96–111, 48–63, 16–31), so they merge and
    // the result is their average rather than a bucket boundary.
    const data = pixels([100, 60, 20, 255, 1], [102, 62, 22, 255, 1])
    expect(extractPalette(data)[0]).toBe('#653d15')
  })

  it('skips near-transparent pixels', () => {
    // The background of a cut-out sprite is not one of its colours.
    const data = pixels([0, 255, 0, 0, 50], [255, 0, 0, 255, 2])
    expect(extractPalette(data)).toEqual(['#ff0000'])
  })

  it('honours the requested size', () => {
    const data = pixels(
      [255, 0, 0, 255, 5], [0, 255, 0, 255, 4], [0, 0, 255, 255, 3], [255, 255, 0, 255, 2]
    )
    expect(extractPalette(data, 2)).toHaveLength(2)
  })

  it('returns fewer when the image has fewer colours than asked for', () => {
    expect(extractPalette(pixels([10, 10, 10, 255, 4]), 8)).toHaveLength(1)
  })

  it('returns nothing for an empty or fully transparent image', () => {
    expect(extractPalette(new Uint8ClampedArray(0))).toEqual([])
    expect(extractPalette(pixels([1, 2, 3, 0, 20]))).toEqual([])
  })

  it('always produces six-digit hex, including for dark colours', () => {
    for (const hex of extractPalette(pixels([1, 2, 3, 255, 4]))) {
      expect(hex).toMatch(/^#[0-9a-f]{6}$/)
    }
  })
})
