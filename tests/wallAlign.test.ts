import { describe, expect, it } from 'vitest'
import { alignableUnits, alignGuides, alignItems, distributeItems, resizeGuides } from '../src/shared/wallAlign'
import { turnedBox } from '../src/shared/wallTurn'
import type { WallItem } from '../src/shared/wallModel'

const item = (id: string, over: Partial<WallItem> = {}): WallItem =>
  ({ id, kind: 'note', x: 0, y: 0, width: 100, height: 100, z: 0, ...over })

/** guides as they work at 100%: 8 pixels to snap, half a pixel to count as lined up */
const atOne = { zoom: 1 }

const at = (items: WallItem[]): Record<string, [number, number]> =>
  Object.fromEntries(items.map(i => [i.id, [i.x, i.y]]))

describe('alignItems', () => {
  const items = [item('a', { x: 0, y: 50 }), item('b', { x: 300, y: 0, width: 50, height: 200 })]
  const both = new Set(['a', 'b'])

  it('lines edges up on the selection\'s own', () => {
    expect(at(alignItems(items, both, 'left'))).toStrictEqual({ a: [0, 50], b: [0, 0] })
    expect(at(alignItems(items, both, 'right'))).toStrictEqual({ a: [250, 50], b: [300, 0] })
    expect(at(alignItems(items, both, 'top'))).toStrictEqual({ a: [0, 0], b: [300, 0] })
    expect(at(alignItems(items, both, 'bottom'))).toStrictEqual({ a: [0, 100], b: [300, 0] })
  })

  it('centres on the middle of the selection', () => {
    expect(at(alignItems(items, both, 'centre'))).toStrictEqual({ a: [125, 50], b: [150, 0] })
    expect(at(alignItems(items, both, 'middle'))).toStrictEqual({ a: [0, 50], b: [300, 0] })
  })

  it('moves a group as one piece, and a frame with what is inside it', () => {
    const wall = [
      item('g1', { x: 100, group: 'g' }), item('g2', { x: 300, group: 'g' }),
      item('f', { kind: 'frame', x: 0, y: 400, width: 200, height: 200 }), item('in', { x: 50, y: 450 }),
      item('loose', { x: 600 })
    ]
    const moved = at(alignItems(wall, new Set(['g1', 'g2', 'f', 'in', 'loose']), 'right'))
    expect(moved).toStrictEqual({ g1: [400, 0], g2: [600, 0], f: [500, 400], in: [550, 450], loose: [600, 0] })
  })

  it('leaves arrows and locked items where they are, and needs two pieces to line up', () => {
    const wall = [item('a'), item('b', { x: 300, locked: true }), item('line', { kind: 'arrow', x: 900, from: 'a', to: 'b' })]
    expect(alignItems(wall, new Set(['a', 'b', 'line']), 'right')).toBe(wall)
    expect(alignableUnits(wall, new Set(['a', 'b', 'line']))).toBe(1)
  })
})

describe('distributeItems', () => {
  it('spaces the pieces evenly between the outermost two', () => {
    const row = [item('a', { x: 0 }), item('b', { x: 130, width: 50 }), item('c', { x: 500 })]
    expect(at(distributeItems(row, new Set(['a', 'b', 'c']), 'horizontal'))).toStrictEqual({ a: [0, 0], b: [275, 0], c: [500, 0] })

    const column = [item('a', { y: 0 }), item('b', { y: 900 }), item('c', { y: 100 })]
    expect(at(distributeItems(column, new Set(['a', 'b', 'c']), 'vertical'))).toStrictEqual({ a: [0, 0], b: [0, 900], c: [0, 450] })
  })

  it('needs three pieces', () => {
    const wall = [item('a'), item('b', { x: 500 })]
    expect(distributeItems(wall, new Set(['a', 'b']), 'horizontal')).toBe(wall)
  })
})

describe('spacing guides', () => {
  it('snaps into the gap a row already uses, and marks both equal gaps', () => {
    const snap = alignGuides([item('a'), item('b', { x: 150 }), item('m', { x: 303, y: 10 })], new Set(['m']), atOne)
    expect(snap.dx).toBe(-3)
    expect(snap.gaps).toStrictEqual([
      { axis: 'x', from: 250, to: 300, at: 55 },
      { axis: 'x', from: 100, to: 150, at: 50 }
    ])
  })

  it('centres between two neighbours, and spaces a column the same way', () => {
    const row = alignGuides([item('l'), item('r', { x: 400 }), item('m', { x: 197 })], new Set(['m']), atOne)
    expect(row.dx).toBe(3)
    expect(row.gaps).toStrictEqual([
      { axis: 'x', from: 100, to: 200, at: 50 },
      { axis: 'x', from: 300, to: 400, at: 50 }
    ])

    const column = alignGuides([item('t'), item('u', { y: 150 }), item('m', { x: 20, y: 304 })], new Set(['m']), atOne)
    expect(column.dy).toBe(-4)
    expect(column.gaps).toStrictEqual([
      { axis: 'y', from: 250, to: 300, at: 60 },
      { axis: 'y', from: 100, to: 150, at: 50 }
    ])
  })
})

describe('alignGuides', () => {
  const still = item('still')

  it('snaps an edge within reach onto another item\'s and draws the line across both', () => {
    const snap = alignGuides([still, item('m', { x: 4, y: 300 })], new Set(['m']), atOne)
    expect(snap).toMatchObject({ dx: -4, dy: 0 })
    expect(snap.guides).toContainEqual({ axis: 'x', at: 0, from: 0, to: 400 })
  })

  it('lines centres up too, with one line for the one match', () => {
    const snap = alignGuides([still, item('m', { x: 300, y: 32, width: 60, height: 40 })], new Set(['m']), atOne)
    expect(snap).toMatchObject({ dx: 0, dy: -2 })
    expect(snap.guides).toStrictEqual([{ axis: 'y', at: 50, from: 0, to: 360 }])
  })

  it('leaves a drag alone out of reach, and ignores what is moving, arrows and anything out of view', () => {
    const none = { dx: 0, dy: 0, guides: [], gaps: [] }
    expect(alignGuides([still, item('m', { x: 20, y: 300 })], new Set(['m']), atOne)).toStrictEqual(none)
    expect(alignGuides([item('m', { x: 4 }), item('n', { y: 300 })], new Set(['m', 'n']), atOne)).toStrictEqual(none)
    const line = item('line', { kind: 'arrow', width: 1, height: 1, from: 'm', toPoint: { x: 0, y: 0 } })
    expect(alignGuides([line, item('m', { x: 4, y: 300 })], new Set(['m']), atOne)).toStrictEqual(none)
    expect(alignGuides([still, item('m', { x: 4, y: 300 })], new Set(['m']), { zoom: 1, view: { x: 500, y: 0, width: 800, height: 600 } })).toStrictEqual(none)
  })
})

describe('a turned item', () => {
  // 400 by 200 turned a quarter shows 200 wide and 400 tall about the same middle
  const turned = (id: string, x: number, y: number): WallItem => item(id, { kind: 'image', x, y, width: 400, height: 200, rotation: 90 })

  it('snaps by the edges you can see, and draws the line there', () => {
    // its own left is at -96, but what shows starts at 4
    const snap = alignGuides([item('a', { width: 100 }), turned('p', -96, 300)], new Set(['p']), atOne)
    expect(snap.dx).toBe(-4)
    expect(snap.guides).toContainEqual({ axis: 'x', at: 0, from: 0, to: 600 })
  })

  it('is lined up with by what shows when it is the one standing still', () => {
    // what shows of it runs from 4 to 204; its own box runs from -96 to 304
    const snap = alignGuides([turned('p', -96, 300), item('m', { x: 8, y: 700, width: 60, height: 60 })], new Set(['m']), atOne)
    expect(snap.dx).toBe(-4)
    expect(snap.guides).toContainEqual({ axis: 'x', at: 4, from: 200, to: 760 })
  })

  it('lines up and spaces out by what shows too', () => {
    expect(at(alignItems([item('a'), turned('p', -96, 300)], new Set(['a', 'p']), 'left'))).toStrictEqual({ a: [0, 0], p: [-100, 300] })

    // the turned one on the left shows 0 to 200, so the gaps are 300 each and not 250
    const row = [turned('p', -100, 0), item('b', { x: 300 }), item('c', { x: 900 })]
    expect(at(distributeItems(row, new Set(['p', 'b', 'c']), 'horizontal')).b).toStrictEqual([500, 0])
  })
})

describe('exact lines', () => {
  // a is lined up exactly; b sits 0.3 of a wall pixel off
  const wall = [item('a'), item('b', { x: 0.3, y: 500 }), item('m', { x: -0.8, y: 200 })]

  it('counts an item as lined up only within half a screen pixel at the zoom it is seen at', () => {
    const near = alignGuides(wall, new Set(['m']), atOne)
    expect(near.dx).toBeCloseTo(0.8)
    // 99.2 and 0.8 aren't exact in binary, so the line sits at 0 give or take a hair
    expect(near.guides.find(g => g.axis === 'x' && Math.abs(g.at) < 1e-9)).toMatchObject({ from: 0, to: 600 })

    // at 800% that 0.3 is more than two screen pixels, so b gets no line
    const close = alignGuides(wall, new Set(['m']), { zoom: 8 })
    expect(close.dx).toBeCloseTo(0.8)
    expect(close.guides.length).toBeGreaterThan(0)
    expect(close.guides.every(g => g.to <= 300)).toBe(true)
  })

  it('shows the gaps beside what is dragged first, and never lets a long row crowd out the column', () => {
    const row = [0, 150, 300, 450, 600, 750].map((x, i) => item(`r${i}`, { x }))
    const column = [item('t', { x: 900, y: -300 }), item('u', { x: 900, y: -150 })]
    const snap = alignGuides([...row, ...column, item('m', { x: 903 })], new Set(['m']), atOne)
    expect(snap.dx).toBe(-3)
    expect(snap.gaps).toStrictEqual([
      { axis: 'x', from: 850, to: 900, at: 50 },
      { axis: 'x', from: 700, to: 750, at: 50 },
      { axis: 'x', from: 550, to: 600, at: 50 },
      { axis: 'x', from: 400, to: 450, at: 50 },
      { axis: 'y', from: -50, to: 0, at: 950 },
      { axis: 'y', from: -200, to: -150, at: 950 }
    ])
  })
})

describe('resizeGuides', () => {
  const free = { keepShape: false }

  it('snaps a pulled edge onto another item\'s and draws the line across both', () => {
    const wall = [item('a', { x: 50, width: 200, height: 80 }), item('b', { y: 200 })]
    const pulled = resizeGuides(wall, wall[1], 'se', 147, 0, free, atOne)
    expect(pulled.box).toStrictEqual({ x: 0, y: 200, width: 250, height: 100 })
    expect(pulled.guides).toStrictEqual([{ axis: 'x', at: 250, from: 0, to: 300 }])
    expect(pulled.gaps).toStrictEqual([])
  })

  it('leaves the edge where the pointer is out of reach', () => {
    const wall = [item('a', { x: 50, width: 200, height: 80 }), item('b', { y: 200 })]
    const pulled = resizeGuides(wall, wall[1], 'se', 130, 0, free, atOne)
    expect(pulled.box).toStrictEqual({ x: 0, y: 200, width: 230, height: 100 })
    expect(pulled.guides).toStrictEqual([])
  })

  it('snaps to a neighbour\'s width and marks both widths as the same', () => {
    const wall = [item('a', { width: 200, height: 80 }), item('b', { x: 300, y: 200 })]
    const pulled = resizeGuides(wall, wall[1], 'se', 97, 0, free, atOne)
    expect(pulled.box.width).toBe(200)
    expect(pulled.gaps).toStrictEqual([
      { axis: 'x', from: 300, to: 500, at: 192 },
      { axis: 'x', from: 0, to: 200, at: -8 }
    ])
  })

  it('keeps a picture\'s shape while its edge snaps', () => {
    const wall = [item('a', { width: 300, height: 80 }), item('p', { kind: 'image', y: 200, width: 200, height: 100 })]
    const pulled = resizeGuides(wall, wall[1], 'se', 97, 0, { keepShape: true }, atOne)
    expect(pulled.box).toStrictEqual({ x: 0, y: 200, width: 300, height: 150 })
  })

  it('snaps the edge you can see on a quarter-turned picture', () => {
    // turned a quarter, its own bottom right corner shows at the bottom left
    const photo = item('p', { kind: 'image', x: 250, y: 250, width: 200, height: 100, rotation: 90 })
    const wall = [item('a', { width: 296, height: 80 }), photo]
    const pulled = resizeGuides(wall, photo, 'se', -2, 0, free, atOne)
    expect(turnedBox({ ...pulled.box, rotation: 90 })).toStrictEqual({ minX: 296, minY: 200, maxX: 400, maxY: 400 })
    expect(pulled.guides).toStrictEqual([{ axis: 'x', at: 296, from: 0, to: 400 }])
  })

  it('resizes an item at any other angle without snapping, its edges not being straight on the wall', () => {
    const photo = item('p', { x: 300, y: 0, rotation: 30 })
    const pulled = resizeGuides([item('a'), photo], photo, 'se', 3, 3, free, atOne)
    expect(pulled.guides).toStrictEqual([])
    expect(pulled.gaps).toStrictEqual([])
  })

  it('snaps only the width of a text box, whose height follows its words', () => {
    const wall = [item('a', { width: 200, height: 103 }), item('t', { kind: 'text', x: 300, y: 200 })]
    const pulled = resizeGuides(wall, wall[1], 'se', 97, 0, { keepShape: false, keepHeight: true }, atOne)
    expect(pulled.box).toStrictEqual({ x: 300, y: 200, width: 200, height: 100 })
  })
})
