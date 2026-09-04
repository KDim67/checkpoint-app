import { describe, it, expect } from 'vitest'
import {
  arrowGeometry,
  arrowDash,
  arrowHeadPoints,
  roundedPath,
  distanceToPolyline,
  normalizeWallItem,
  ARROW_SHAPES,
  ARROW_LINES,
  ARROW_HEAD_MODES,
  type WallItem
} from '../src/shared/wallModel'

const box = (over: Partial<WallItem> = {}): WallItem => ({
  id: 'a', kind: 'note', x: 0, y: 0, width: 100, height: 100, z: 0, ...over
})

/** Two boxes side by side, 200 apart centre to centre. */
const left = box({ id: 'l', x: 0, y: 0 })
const right = box({ id: 'r', x: 200, y: 0 })
/** One above the other. */
const top = box({ id: 't', x: 0, y: 0 })
const bottom = box({ id: 'b', x: 0, y: 200 })

const near = (a: number, b: number): void => expect(Math.abs(a - b)).toBeLessThan(0.001)

describe('a straight connector', () => {
  const g = arrowGeometry(left, right, 'straight')

  it('starts and ends on the two edges facing each other', () => {
    expect(g.start).toEqual({ x: 100, y: 50 })
    expect(g.end).toEqual({ x: 200, y: 50 })
  })

  it('points its head the way it is going', () => {
    near(g.endAngle, 0)
  })

  it('points a head at the other end back the way it came', () => {
    near(Math.cos(g.startAngle), -1)
  })

  it('is one segment for hit testing', () => {
    expect(g.polyline).toEqual([g.start, g.end])
  })

  it('is the default, so an unstyled arrow draws the same way', () => {
    expect(arrowGeometry(left, right)).toEqual(g)
    expect(ARROW_SHAPES[0]).toBe('straight')
  })
})

describe('a curved connector', () => {
  const g = arrowGeometry(left, right, 'curved')

  it('leaves from the same edges as a straight one', () => {
    expect(g.start).toEqual({ x: 100, y: 50 })
    expect(g.end).toEqual({ x: 200, y: 50 })
  })

  it('actually bows away from the straight line', () => {
    const middle = g.polyline[Math.floor(g.polyline.length / 2)]
    expect(Math.abs(middle.y - 50)).toBeGreaterThan(5)
  })

  it('starts and finishes exactly where it says it does', () => {
    expect(g.polyline[0]).toEqual(g.start)
    expect(g.polyline[g.polyline.length - 1]).toEqual(g.end)
  })

  it('follows the curve at the tip rather than the straight line', () => {
    // A head aimed along the chord would visibly miss the curve it sits on.
    expect(Math.abs(g.endAngle)).toBeGreaterThan(0.05)
  })

  it('stops bowing further once it is long enough', () => {
    const far = arrowGeometry(left, box({ id: 'far', x: 20000, y: 0 }), 'curved')
    const middle = far.polyline[Math.floor(far.polyline.length / 2)]
    expect(Math.abs(middle.y - 50)).toBeLessThanOrEqual(141)
  })

  it('is drawn as a quadratic, so the path matches the points', () => {
    expect(g.d.startsWith('M100,50Q')).toBe(true)
  })
})

describe('an elbow connector', () => {
  it('leaves sideways when the two are further apart across than down', () => {
    const g = arrowGeometry(left, right, 'elbow')
    expect(g.start).toEqual({ x: 100, y: 50 })
    expect(g.end).toEqual({ x: 200, y: 50 })
    near(g.endAngle, 0)
  })

  it('leaves downwards when they are stacked', () => {
    const g = arrowGeometry(top, bottom, 'elbow')
    expect(g.start).toEqual({ x: 50, y: 100 })
    expect(g.end).toEqual({ x: 50, y: 200 })
    near(g.endAngle, Math.PI / 2)
  })

  it('turns two corners, both square', () => {
    const g = arrowGeometry(left, box({ id: 'd', x: 300, y: 300 }), 'elbow')
    expect(g.polyline).toHaveLength(4)
    // Each leg runs along one axis only.
    for (let i = 1; i < g.polyline.length; i++) {
      const a = g.polyline[i - 1]
      const b = g.polyline[i]
      expect(a.x === b.x || a.y === b.y).toBe(true)
    }
  })

  it('goes the other way round when the target is behind it', () => {
    const g = arrowGeometry(right, left, 'elbow')
    expect(g.start).toEqual({ x: 200, y: 50 })
    near(Math.cos(g.endAngle), -1)
  })
})

describe('taking the corners off a path', () => {
  it('leaves a two-point line alone', () => {
    expect(roundedPath([{ x: 0, y: 0 }, { x: 10, y: 0 }], 5)).toBe('M0,0L10,0')
  })

  it('still starts and ends exactly on its endpoints', () => {
    const d = roundedPath([{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 50 }], 10)
    expect(d.startsWith('M0,0')).toBe(true)
    expect(d.endsWith('L50,50')).toBe(true)
  })

  it('shrinks the radius rather than overshooting a short leg', () => {
    // A 4-long leg cannot give up 10 at each end, and a corner that ate more
    // than its own segment would double back.
    const d = roundedPath([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }], 10)
    const numbers = d.match(/-?\d+(\.\d+)?/g)!.map(Number)
    expect(Math.min(...numbers)).toBeGreaterThanOrEqual(0)
    expect(Math.max(...numbers)).toBeLessThanOrEqual(4)
  })

  it('survives a zero-length leg without dividing by it', () => {
    const d = roundedPath([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 }], 5)
    expect(d).not.toContain('NaN')
  })
})

describe('hit testing a connector', () => {
  it('measures to the nearest leg, not just the first', () => {
    const g = arrowGeometry(left, box({ id: 'd', x: 300, y: 300 }), 'elbow')
    // A point sitting on the last leg is on the line, however far it is from
    // the first one.
    const last = g.polyline[g.polyline.length - 1]
    expect(distanceToPolyline(last, g.polyline)).toBeLessThan(0.001)
  })

  it('follows a curve rather than the chord under it', () => {
    const g = arrowGeometry(left, right, 'curved')
    const middle = g.polyline[Math.floor(g.polyline.length / 2)]
    expect(distanceToPolyline(middle, g.polyline)).toBeLessThan(0.001)
    // The straight line between the ends is no longer where the arrow is.
    expect(distanceToPolyline({ x: 150, y: 50 }, g.polyline)).toBeGreaterThan(5)
  })

  it('says nothing is near an empty path', () => {
    expect(distanceToPolyline({ x: 0, y: 0 }, [])).toBe(Infinity)
  })
})

describe('line styles', () => {
  it('leaves a solid line with no dash pattern at all', () => {
    expect(arrowDash('solid', 4)).toBeUndefined()
  })

  it('scales the dashes to the stroke, so a thick line still reads as dashed', () => {
    expect(arrowDash('dashed', 2)).toBe('6 4')
    expect(arrowDash('dashed', 8)).toBe('24 16')
  })

  it('makes dots short enough to be dots', () => {
    const [on, off] = arrowDash('dotted', 4)!.split(' ').map(Number)
    expect(on).toBeLessThan(off)
  })

  it('does not divide by a zero stroke width', () => {
    expect(arrowDash('dashed', 0)).toBe('3 2')
  })
})

describe('arrowheads', () => {
  it('puts the tip exactly on the point it was given', () => {
    expect(arrowHeadPoints({ x: 10, y: 20 }, 0, 2).startsWith('10,20 ')).toBe(true)
  })

  it('grows with the stroke, so a thick line does not outgrow its head', () => {
    const thin = arrowHeadPoints({ x: 0, y: 0 }, 0, 2).split(' ')[1]
    const thick = arrowHeadPoints({ x: 0, y: 0 }, 0, 8).split(' ')[1]
    expect(Math.abs(Number(thick.split(',')[0]))).toBeGreaterThan(Math.abs(Number(thin.split(',')[0])))
  })
})

describe('reading a styled arrow back', () => {
  const raw = {
    kind: 'arrow', id: 'x', from: 'a', to: 'b',
    x: 0, y: 0, width: 10, height: 10, z: 1
  }

  it('keeps a style it recognises', () => {
    const item = normalizeWallItem({ ...raw, arrowShape: 'elbow', arrowLine: 'dashed', arrowHeads: 'both' }, 0)
    expect(item?.arrowShape).toBe('elbow')
    expect(item?.arrowLine).toBe('dashed')
    expect(item?.arrowHeads).toBe('both')
  })

  it('falls back to the default for a style it does not, rather than drawing nothing', () => {
    const item = normalizeWallItem({ ...raw, arrowShape: 'spiral', arrowLine: 42 }, 0)
    expect(item?.arrowShape).toBeUndefined()
    expect(item?.arrowLine).toBeUndefined()
  })

  it('does not write the default out, so an old arrow stays byte for byte an old arrow', () => {
    const item = normalizeWallItem({ ...raw, arrowShape: 'straight', arrowLine: 'solid', arrowHeads: 'end' }, 0)
    expect(item?.arrowShape).toBeUndefined()
    expect(item?.arrowLine).toBeUndefined()
    expect(item?.arrowHeads).toBeUndefined()
  })

  it('reads an arrow saved before styles existed', () => {
    const item = normalizeWallItem(raw, 0)
    expect(item?.kind).toBe('arrow')
    expect(item?.arrowShape).toBeUndefined()
  })

  it('offers each option exactly once', () => {
    for (const list of [ARROW_SHAPES, ARROW_LINES, ARROW_HEAD_MODES]) {
      expect(new Set(list).size).toBe(list.length)
    }
  })
})
