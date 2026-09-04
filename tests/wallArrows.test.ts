import { describe, it, expect } from 'vitest'
import {
  arrowGeometry,
  arrowDash,
  arrowHeadPoints,
  roundedPath,
  distanceToPolyline,
  arrowAnchors,
  arrowHeadInset,
  pruneArrows,
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

describe('stopping the line behind its head', () => {
  it('leaves the real endpoints alone, so the head still lands on the box', () => {
    const g = arrowGeometry(left, right, 'straight', { end: 20 })
    expect(g.end).toEqual({ x: 200, y: 50 })
  })

  it('draws short of the endpoint by the amount asked for', () => {
    const g = arrowGeometry(left, right, 'straight', { end: 20 })
    expect(g.polyline[1]).toEqual({ x: 180, y: 50 })
    expect(g.d).toBe('M100,50L180,50')
  })

  it('trims the near end too, for a connector with a head at both', () => {
    const g = arrowGeometry(left, right, 'straight', { start: 10, end: 10 })
    expect(g.polyline[0].x).toBeCloseTo(110)
    expect(g.polyline[1].x).toBeCloseTo(190)
  })

  it('refuses to eat more of the line than there is', () => {
    // Two items nearly touching leave a few pixels. Taking a whole head off
    // each end of that would draw the line backwards.
    const g = arrowGeometry(left, box({ id: 'close', x: 104, y: 0 }), 'straight', { start: 500, end: 500 })
    expect(g.polyline[0].x).toBeLessThanOrEqual(g.polyline[1].x)
  })

  it('follows the tangent on a curve, not the chord', () => {
    const g = arrowGeometry(left, right, 'curved', { end: 20 })
    const drawnEnd = g.polyline[g.polyline.length - 1]
    // Pulled back along the curve's own direction, so it leaves the tip at an
    // angle rather than sliding straight back along the chord.
    expect(Math.abs(drawnEnd.y - g.end.y)).toBeGreaterThan(0.5)
  })

  it('shortens only the last leg of an elbow', () => {
    const plain = arrowGeometry(left, box({ id: 'd', x: 300, y: 300 }), 'elbow')
    const trimmed = arrowGeometry(left, box({ id: 'd', x: 300, y: 300 }), 'elbow', { end: 15 })
    expect(trimmed.polyline).toHaveLength(plain.polyline.length)
    expect(trimmed.polyline[0]).toEqual(plain.polyline[0])
    expect(trimmed.polyline[2]).toEqual(plain.polyline[2])
    expect(trimmed.polyline[3]).not.toEqual(plain.polyline[3])
  })

  it('changes nothing when nothing is asked for', () => {
    expect(arrowGeometry(left, right, 'curved', {})).toEqual(arrowGeometry(left, right, 'curved'))
  })
})

describe('the arrowhead itself', () => {
  it('has a notched back rather than being a flat triangle', () => {
    // Four points: tip, barb, notch, barb. A flat back reads as a triangle
    // balanced on the line rather than as a head.
    expect(arrowHeadPoints({ x: 0, y: 0 }, 0, 4).split(' ')).toHaveLength(4)
  })

  it('keeps the notch between the tip and the barbs', () => {
    const [tip, barb, notch] = arrowHeadPoints({ x: 0, y: 0 }, 0, 4)
      .split(' ')
      .map(p => p.split(',').map(Number))
    expect(tip[0]).toBe(0)
    expect(notch[0]).toBeGreaterThan(barb[0])
    expect(notch[0]).toBeLessThan(tip[0])
  })

  it('insets the line by less than the head is long, so no gap opens up', () => {
    const points = arrowHeadPoints({ x: 0, y: 0 }, 0, 4).split(' ').map(p => Number(p.split(',')[0]))
    const length = Math.abs(Math.min(...points))
    expect(arrowHeadInset(4)).toBeLessThan(length)
    expect(arrowHeadInset(4)).toBeGreaterThan(0)
  })

  it('grows its inset with the stroke, like the head does', () => {
    expect(arrowHeadInset(8)).toBeGreaterThan(arrowHeadInset(2))
  })
})

describe('an end attached to nothing', () => {
  const anchored = box({ id: 'anchored', x: 0, y: 0 })
  const byId = new Map([[anchored.id, anchored]])

  it('resolves a loose end to the point it was left at', () => {
    const arrow = box({ id: 'arrow', kind: 'arrow', from: 'anchored', toPoint: { x: 400, y: 300 } })
    const ends = arrowAnchors(arrow, byId)!
    expect(ends.to.x).toBe(400)
    expect(ends.to.y).toBe(300)
  })

  it('draws to the point exactly, since a point has no edge to stop at', () => {
    const arrow = box({ id: 'arrow', kind: 'arrow', from: 'anchored', toPoint: { x: 400, y: 300 } })
    const ends = arrowAnchors(arrow, byId)!
    expect(arrowGeometry(ends.from, ends.to).end).toEqual({ x: 400, y: 300 })
  })

  it('gives up when an end names an item that has gone', () => {
    const arrow = box({ id: 'arrow', kind: 'arrow', from: 'anchored', to: 'deleted' })
    expect(arrowAnchors(arrow, byId)).toBeNull()
  })

  it('survives the prune on its own', () => {
    const items: WallItem[] = [
      anchored,
      box({ id: 'loose', kind: 'arrow', from: 'anchored', toPoint: { x: 9, y: 9 } })
    ]
    expect(pruneArrows(items).map(i => i.id)).toEqual(['anchored', 'loose'])
  })

  it('still goes when the item at its other end does', () => {
    const items: WallItem[] = [
      box({ id: 'loose', kind: 'arrow', from: 'anchored', toPoint: { x: 9, y: 9 } })
    ]
    expect(pruneArrows(items)).toEqual([])
  })

  it('is read back off a document', () => {
    const item = normalizeWallItem({
      kind: 'arrow', id: 'x', from: 'a', toPoint: { x: 5, y: 6 },
      x: 0, y: 0, width: 10, height: 10, z: 1
    }, 0)
    expect(item?.toPoint).toEqual({ x: 5, y: 6 })
  })

  it('is refused when an end has neither an item nor a point', () => {
    const item = normalizeWallItem({
      kind: 'arrow', id: 'x', from: 'a', x: 0, y: 0, width: 10, height: 10, z: 1
    }, 0)
    expect(item).toBeNull()
  })

  it('ignores a point with a coordinate that is not a number', () => {
    const item = normalizeWallItem({
      kind: 'arrow', id: 'x', from: 'a', to: 'b', toPoint: { x: 'over there', y: 6 },
      x: 0, y: 0, width: 10, height: 10, z: 1
    }, 0)
    expect(item?.toPoint).toBeUndefined()
  })

  it('lets the item win when a stale point is left behind', () => {
    // Reattaching writes the item id; a point that survived alongside it must
    // not quietly override what the end is now tied to.
    const item = normalizeWallItem({
      kind: 'arrow', id: 'x', from: 'a', to: 'b', toPoint: { x: 5, y: 6 },
      x: 0, y: 0, width: 10, height: 10, z: 1
    }, 0)
    expect(item?.to).toBe('b')
    expect(item?.toPoint).toBeUndefined()
  })
})
