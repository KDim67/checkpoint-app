import { describe, it, expect } from 'vitest'
import { gridSpacing, MIN_GRID_PX, MIN_ZOOM, MAX_ZOOM, SNAP_GRID } from '../src/shared/wallModel'

describe('gridSpacing', () => {
  it('draws the plain grid at normal zoom', () => {
    expect(gridSpacing(1)).toBe(SNAP_GRID)
  })

  it('never returns dots too close together to read', () => {
    for (let z = MIN_ZOOM; z <= MAX_ZOOM; z += 0.01) {
      expect(gridSpacing(z)).toBeGreaterThanOrEqual(MIN_GRID_PX)
    }
  })

  it('doubles the snap grid rather than picking an arbitrary step', () => {
    for (let z = MIN_ZOOM; z <= MAX_ZOOM; z += 0.05) {
      // Checked against the exact value: dividing back out reintroduces the
      // float error the multiply just made.
      const doublings = Math.round(Math.log2(gridSpacing(z) / z / SNAP_GRID))
      expect(doublings).toBeGreaterThanOrEqual(0)
      expect(gridSpacing(z)).toBeCloseTo(SNAP_GRID * 2 ** doublings * z, 9)
    }
  })

  it('opens the grid up rather than letting it turn to mush zoomed out', () => {
    // What the screenshot showed: 24 * 0.2 is 4.8px apart.
    expect(gridSpacing(MIN_ZOOM)).toBeGreaterThan(SNAP_GRID * MIN_ZOOM)
  })

  it('survives a zoom of zero or nonsense rather than looping forever', () => {
    expect(gridSpacing(0)).toBe(SNAP_GRID)
    expect(gridSpacing(-1)).toBe(SNAP_GRID)
    expect(gridSpacing(NaN)).toBe(SNAP_GRID)
  })
})
