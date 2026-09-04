import { describe, it, expect } from 'vitest'
import {
  arrowEnds,
  distanceToSegment,
  inkFromPath,
  inkPath,
  normalizeWallItem,
  pruneArrows,
  STROKE_WIDTHS,
  SMOOTHING_STRENGTH,
  smoothPoints,
  boundsOf,
  itemsInRect,
  itemAtPoint,
  type WallItem
} from '../src/shared/wallModel'

const item = (over: Partial<WallItem> = {}): WallItem => ({
  id: 'a', kind: 'note', x: 0, y: 0, width: 100, height: 100, z: 0, ...over
})

describe('a drawn stroke', () => {
  const path = [{ x: 100, y: 100 }, { x: 140, y: 130 }, { x: 120, y: 160 }]

  it('boxes the path and rebases the points into it', () => {
    // Box coordinates, not wall ones, so moving and resizing a stroke are the
    // same operations as for every other item.
    const ink = inkFromPath(path, [])!
    expect(ink.kind).toBe('ink')
    expect(ink.x).toBeLessThan(100)
    expect(ink.y).toBeLessThan(100)
    expect(Math.min(...(ink.points ?? []))).toBeGreaterThanOrEqual(0)
  })

  it('leaves room for the cap, so a stroke is not clipped by its own box', () => {
    const ink = inkFromPath(path, [])!
    expect(ink.width).toBeGreaterThan(140 - 100)
    expect(ink.height).toBeGreaterThan(160 - 100)
  })

  it('keeps every point of the path', () => {
    expect(inkFromPath(path, [])!.points).toHaveLength(path.length * 2)
  })

  it('refuses a single point, which is a click and not a stroke', () => {
    expect(inkFromPath([{ x: 10, y: 10 }], [])).toBeNull()
    expect(inkFromPath([], [])).toBeNull()
  })

  it('sits above whatever is already on the wall', () => {
    const ink = inkFromPath(path, [item({ z: 9 })])!
    expect(ink.z).toBeGreaterThan(9)
  })

  it('takes a colour and width from the caller', () => {
    const ink = inkFromPath(path, [], { color: '#f28b82', strokeWidth: STROKE_WIDTHS[2] })!
    expect(ink.color).toBe('#f28b82')
    expect(ink.strokeWidth).toBe(STROKE_WIDTHS[2])
  })

  it('renders as a move followed by lines', () => {
    const d = inkPath(item({ kind: 'ink', points: [0, 0, 10, 5, 20, 0] }))
    expect(d.startsWith('M0.0,0.0')).toBe(true)
    expect(d.split('L')).toHaveLength(3)
  })

  it('renders nothing for a path too short to be one', () => {
    expect(inkPath(item({ kind: 'ink', points: [1, 2] }))).toBe('')
    expect(inkPath(item({ kind: 'ink' }))).toBe('')
  })
})

describe('reading a stroke back', () => {
  const ink = { kind: 'ink', id: 'i', x: 0, y: 0, width: 50, height: 50, z: 1, points: [0, 0, 10, 10] }

  it('keeps a well-formed one', () => {
    expect(normalizeWallItem(ink, 0)?.points).toEqual([0, 0, 10, 10])
  })

  it('drops one with no path, since it cannot be seen or selected', () => {
    expect(normalizeWallItem({ ...ink, points: undefined }, 0)).toBeNull()
    expect(normalizeWallItem({ ...ink, points: [] }, 0)).toBeNull()
    expect(normalizeWallItem({ ...ink, points: [1, 2] }, 0)).toBeNull()
  })

  it('drops one whose coordinates are not all numbers', () => {
    // A half-read path would render as a stroke veering to the origin.
    expect(normalizeWallItem({ ...ink, points: [0, 0, 'ten', 10] }, 0)).toBeNull()
    expect(normalizeWallItem({ ...ink, points: [0, 0, 10, 10, 20] }, 0)).toBeNull()
  })
})

describe('an arrow', () => {
  const left = item({ id: 'l', x: 0, y: 0, width: 100, height: 100 })
  const right = item({ id: 'r', x: 300, y: 0, width: 100, height: 100 })

  it('starts and stops on the edges, not the centres', () => {
    // A head drawn to the centre would sit inside the item it points at.
    const { start, end } = arrowEnds(left, right)
    expect(start.x).toBe(100)
    expect(end.x).toBe(300)
    expect(start.y).toBe(50)
    expect(end.y).toBe(50)
  })

  it('leaves through the top or bottom when the items are stacked', () => {
    const below = item({ id: 'b', x: 0, y: 300, width: 100, height: 100 })
    const { start, end } = arrowEnds(left, below)
    expect(start.y).toBe(100)
    expect(end.y).toBe(300)
  })

  it('does not blow up when two items sit exactly on top of each other', () => {
    const { start, end } = arrowEnds(left, item({ id: 'x' }))
    expect(Number.isFinite(start.x) && Number.isFinite(end.y)).toBe(true)
  })

  it('needs both ends to survive being read back', () => {
    const base = { kind: 'arrow', id: 'a1', x: 0, y: 0, width: 1, height: 1, z: 1 }
    expect(normalizeWallItem({ ...base, from: 'l', to: 'r' }, 0)).not.toBeNull()
    expect(normalizeWallItem({ ...base, from: 'l' }, 0)).toBeNull()
    expect(normalizeWallItem(base, 0)).toBeNull()
  })
})

describe('arrows whose ends have gone', () => {
  const arrow = item({ id: 'a1', kind: 'arrow', from: 'l', to: 'r' })
  const left = item({ id: 'l' })
  const right = item({ id: 'r' })

  it('keeps an arrow while both ends exist', () => {
    expect(pruneArrows([left, right, arrow])).toHaveLength(3)
  })

  it('drops one whose target was deleted', () => {
    // An arrow to nothing cannot be drawn, and would sit invisible and
    // undeletable in the document.
    expect(pruneArrows([left, arrow]).map(i => i.id)).toEqual(['l'])
  })

  it('leaves everything that is not an arrow alone', () => {
    expect(pruneArrows([left, right]).map(i => i.id)).toEqual(['l', 'r'])
  })

  it('does not let one arrow anchor another', () => {
    const chained = item({ id: 'a2', kind: 'arrow', from: 'a1', to: 'l' })
    expect(pruneArrows([left, right, arrow, chained]).map(i => i.id)).not.toContain('a2')
  })
})

describe('clicking a line that has no box', () => {
  const a = { x: 0, y: 0 }
  const b = { x: 100, y: 0 }

  it('measures zero on the line', () => {
    expect(distanceToSegment({ x: 50, y: 0 }, a, b)).toBe(0)
  })

  it('measures the perpendicular distance beside it', () => {
    expect(distanceToSegment({ x: 50, y: 10 }, a, b)).toBe(10)
  })

  it('measures to the nearer end past it, not to the infinite line', () => {
    expect(distanceToSegment({ x: 150, y: 0 }, a, b)).toBe(50)
    expect(distanceToSegment({ x: -30, y: 0 }, a, b)).toBe(30)
  })

  it('handles a segment of zero length', () => {
    expect(distanceToSegment({ x: 3, y: 4 }, a, a)).toBe(5)
  })
})

describe('an arrow has no box, and nothing should pretend it does', () => {
  // Arrows are created with a placeholder box wherever the view happened to be,
  // so counting it drags the camera and the marquee towards empty space.
  const note = item({ id: 'n', x: 500, y: 500, width: 100, height: 100 })
  const arrow = item({ id: 'a1', kind: 'arrow', from: 'n', to: 'n', x: 0, y: 0, width: 1, height: 1 })

  it('is left out of the content bounds', () => {
    expect(boundsOf([note, arrow])).toEqual({ minX: 500, minY: 500, maxX: 600, maxY: 600 })
  })

  it('leaves bounds null when there is nothing else', () => {
    expect(boundsOf([arrow])).toBeNull()
  })

  it('is not caught by a marquee', () => {
    expect(itemsInRect([note, arrow], { x: -50, y: -50, width: 200, height: 200 })).toEqual([])
  })

  it('is not returned by a point hit test', () => {
    // Clicking one goes through the line test instead, since the box is a lie.
    expect(itemAtPoint([arrow], { x: 0, y: 0 })).toBeNull()
  })
})

describe('stroke smoothing', () => {
  const many = (n: number): number[] =>
    Array.from({ length: n * 2 }, (_, i) => (i % 2 === 0 ? i * 3 : (i % 4 === 0 ? 0 : 6)))

  it('draws straight segments when it is off', () => {
    const d = inkPath(item({ kind: 'ink', points: many(6) }))
    expect(d).toContain('L')
    expect(d).not.toContain('Q')
  })

  it('draws curves when it is on', () => {
    const d = inkPath(item({ kind: 'ink', points: many(6), smooth: 0.6 }))
    expect(d).toContain('Q')
  })

  it('starts at the first sample and ends at the last, either way', () => {
    // Smoothing must not move where the stroke begins or ends, or a line drawn
    // to touch something would stop short of it.
    const points = many(8)
    const smooth = inkPath(item({ kind: 'ink', points, smooth: 0.6 }))
    const last = `${points[points.length - 2].toFixed(1)},${points[points.length - 1].toFixed(1)}`
    expect(smooth.startsWith(`M${points[0].toFixed(1)},${points[1].toFixed(1)}`)).toBe(true)
    expect(smooth.endsWith(`L${last}`)).toBe(true)
  })

  it('leaves a very short stroke straight, having nothing to smooth', () => {
    const d = inkPath(item({ kind: 'ink', points: [0, 0, 5, 5, 10, 0], smooth: 0.6 }))
    expect(d).not.toContain('Q')
  })

  it('is remembered per stroke, not read from a live setting', () => {
    // Otherwise switching the toggle would redraw every line already on the wall.
    const raw = { kind: 'ink', id: 'i', x: 0, y: 0, width: 9, height: 9, z: 1, points: [0, 0, 1, 1], smooth: 0.6 }
    expect(normalizeWallItem(raw, 0)?.smooth).toBe(0.6)
    expect(normalizeWallItem({ ...raw, smooth: 0 }, 0)?.smooth).toBeUndefined()
  })

  it('carries the flag from the pen that drew it', () => {
    const ink = inkFromPath([{ x: 0, y: 0 }, { x: 5, y: 5 }], [], { smooth: 0.6 })!
    expect(ink.smooth).toBe(0.6)
  })
})

describe('smoothing strength', () => {
  const shaky = [0, 0, 10, 40, 20, 0, 30, 40, 40, 0, 50, 40]

  it('leaves the raw samples alone at zero', () => {
    expect(smoothPoints(shaky, 0)).toEqual(shaky)
  })

  it('pulls interior points further as it rises', () => {
    // The second sample sits at y=40 between two neighbours at y=0, so both
    // strengths pull it towards 0 and the stronger one gets closer.
    const light = smoothPoints(shaky, 0.3)
    const strong = smoothPoints(shaky, 0.9)
    expect(light[3]).toBeLessThan(shaky[3])
    expect(strong[3]).toBeLessThan(light[3])
  })

  it('never moves the first or last point, at any strength', () => {
    // A line drawn to touch something has to keep touching it.
    for (const strength of [0.3, 0.6, 0.9, 1]) {
      const out = smoothPoints(shaky, strength)
      expect(out.slice(0, 2)).toEqual(shaky.slice(0, 2))
      expect(out.slice(-2)).toEqual(shaky.slice(-2))
    }
  })

  it('returns the same count it was given', () => {
    expect(smoothPoints(shaky, 0.6)).toHaveLength(shaky.length)
  })

  it('has nothing to do with too few points', () => {
    expect(smoothPoints([0, 0, 5, 5], 0.9)).toEqual([0, 0, 5, 5])
  })

  it('reads a stroke saved by the first version, which stored true', () => {
    const raw = { kind: 'ink', id: 'i', x: 0, y: 0, width: 9, height: 9, z: 1, points: [0, 0, 1, 1], smooth: true }
    expect(normalizeWallItem(raw, 0)?.smooth).toBe(SMOOTHING_STRENGTH)
  })

  it('keeps a strength written by the build that had a dial', () => {
    // The pen writes one strength now, but a stroke drawn on Light should still
    // look like Light instead of jumping to the full amount.
    const raw = { kind: 'ink', id: 'i', x: 0, y: 0, width: 9, height: 9, z: 1, points: [0, 0, 1, 1], smooth: 0.3 }
    expect(normalizeWallItem(raw, 0)?.smooth).toBe(0.3)
  })

  it('clamps a strength from outside the range rather than exaggerating it', () => {
    const raw = { kind: 'ink', id: 'i', x: 0, y: 0, width: 9, height: 9, z: 1, points: [0, 0, 1, 1] }
    expect(normalizeWallItem({ ...raw, smooth: 5 }, 0)?.smooth).toBe(1)
    expect(normalizeWallItem({ ...raw, smooth: -2 }, 0)?.smooth).toBeUndefined()
  })
})
