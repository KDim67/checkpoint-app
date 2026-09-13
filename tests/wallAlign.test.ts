import { describe, expect, it } from 'vitest'
import { alignableUnits, alignGuides, alignItems, distributeItems } from '../src/shared/wallAlign'
import type { WallItem } from '../src/shared/wallModel'

const item = (id: string, over: Partial<WallItem> = {}): WallItem =>
  ({ id, kind: 'note', x: 0, y: 0, width: 100, height: 100, z: 0, ...over })

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

describe('alignGuides', () => {
  const still = item('still')

  it('snaps an edge within reach onto another item\'s and draws the line across both', () => {
    const snap = alignGuides([still, item('m', { x: 4, y: 300 })], new Set(['m']), 6)
    expect(snap).toMatchObject({ dx: -4, dy: 0 })
    expect(snap.guides).toContainEqual({ axis: 'x', at: 0, from: 0, to: 400 })
  })

  it('lines centres up too, with one line for the one match', () => {
    const snap = alignGuides([still, item('m', { x: 300, y: 32, width: 60, height: 40 })], new Set(['m']), 6)
    expect(snap).toMatchObject({ dx: 0, dy: -2 })
    expect(snap.guides).toStrictEqual([{ axis: 'y', at: 50, from: 0, to: 360 }])
  })

  it('leaves a drag alone out of reach, and ignores what is moving, arrows and anything out of view', () => {
    const none = { dx: 0, dy: 0, guides: [] }
    expect(alignGuides([still, item('m', { x: 20, y: 300 })], new Set(['m']), 6)).toStrictEqual(none)
    expect(alignGuides([item('m', { x: 4 }), item('n', { y: 300 })], new Set(['m', 'n']), 6)).toStrictEqual(none)
    const line = item('line', { kind: 'arrow', width: 1, height: 1, from: 'm', toPoint: { x: 0, y: 0 } })
    expect(alignGuides([line, item('m', { x: 4, y: 300 })], new Set(['m']), 6)).toStrictEqual(none)
    expect(alignGuides([still, item('m', { x: 4, y: 300 })], new Set(['m']), 6, { x: 500, y: 0, width: 800, height: 600 })).toStrictEqual(none)
  })
})
