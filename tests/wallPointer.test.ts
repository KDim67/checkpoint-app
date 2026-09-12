import { describe, it, expect } from 'vitest'
import {
  arrowDropTarget,
  arrowEndTarget,
  arrowRelease,
  isStrokeJitter,
  LOOSE_END_SLOP,
  pressSelection,
  recordsHistory,
  resizedSize,
  rotationAngle,
  rotationStart,
  snapMoving
} from '../src/shared/wallPointer'
import type { WallItem } from '../src/shared/wallModel'

const box = (over: Partial<WallItem>): WallItem => ({
  id: 'x', kind: 'note', x: 0, y: 0, width: 100, height: 100, z: 1, ...over
})

describe('pressSelection', () => {
  it('selects only the item pressed', () => {
    expect([...pressSelection(new Set(['a', 'b']), 'c', false)]).toEqual(['c'])
  })

  it('keeps the very same selection when a member of it is pressed, so the group moves together', () => {
    const selected = new Set(['a', 'b'])
    expect(pressSelection(selected, 'b', false)).toBe(selected)
  })

  it('adds with shift, and takes away with shift', () => {
    expect([...pressSelection(new Set(['a']), 'b', true)]).toEqual(['a', 'b'])
    expect([...pressSelection(new Set(['a', 'b']), 'a', true)]).toEqual(['b'])
  })

  it('never changes the set it was given', () => {
    const selected = new Set(['a'])
    pressSelection(selected, 'b', true)
    pressSelection(selected, 'a', true)
    expect([...selected]).toEqual(['a'])
  })
})

describe('rotation', () => {
  const centre = { x: 0, y: 0 }

  it('starts from the pointer angle less the rotation the item already has', () => {
    expect(rotationStart({ x: 0, y: 10 }, centre, 30)).toBeCloseTo(60)
  })

  it('reaches the pointer angle less where the press started', () => {
    expect(rotationAngle({ x: 10, y: 0 }, centre, 0, false)).toBe(0)
    expect(rotationAngle({ x: 0, y: 10 }, centre, 30, false)).toBe(60)
  })

  it('rounds to a whole degree, or to 15 with shift', () => {
    expect(rotationAngle({ x: 0, y: 10 }, centre, 67.6, false)).toBe(22)
    expect(rotationAngle({ x: 0, y: 10 }, centre, 68, true)).toBe(15)
    expect(rotationAngle({ x: 0, y: 10 }, centre, 67, true)).toBe(30)
  })
})

describe('resizedSize', () => {
  it('follows the pointer', () => {
    expect(resizedSize(100, 80, 13, 5, false)).toEqual({ width: 113, height: 85 })
  })

  it('lands on the grid when snapping', () => {
    expect(resizedSize(100, 80, 13, 5, true)).toEqual({ width: 120, height: 96 })
  })

  it('stops at 40 by 32, snapping or not', () => {
    expect(resizedSize(100, 80, -90, -70, false)).toEqual({ width: 40, height: 32 })
    expect(resizedSize(100, 80, -90, -70, true)).toEqual({ width: 40, height: 32 })
  })
})

describe('snapMoving', () => {
  const items = [box({ id: 'a', x: 13, y: 37 }), box({ id: 'b', x: 13, y: 37 })]

  it('puts only the moving items on the grid', () => {
    const out = snapMoving(items, new Set(['a']), true)
    expect([out[0].x, out[0].y]).toEqual([24, 48])
    expect(out[1]).toBe(items[1])
  })

  it('hands back the same array when snapping is off', () => {
    expect(snapMoving(items, new Set(['a']), false)).toBe(items)
  })
})

describe('isStrokeJitter', () => {
  it('drops a sample within two screen pixels of the last one', () => {
    expect(isStrokeJitter({ x: 0, y: 0 }, { x: 1.9, y: 0 }, 1)).toBe(true)
    expect(isStrokeJitter({ x: 0, y: 0 }, { x: 2, y: 0 }, 1)).toBe(false)
  })

  it('measures in screen pixels, so a closer view keeps finer detail', () => {
    expect(isStrokeJitter({ x: 0, y: 0 }, { x: 1, y: 0 }, 2)).toBe(false)
    expect(isStrokeJitter({ x: 0, y: 0 }, { x: 0.9, y: 0 }, 2)).toBe(true)
  })
})

describe('arrowEndTarget', () => {
  const a = box({ id: 'a', x: 0, y: 0, z: 1 })
  const b = box({ id: 'b', x: 200, y: 0, z: 2 })
  const c = box({ id: 'c', x: 0, y: 200, z: 3 })
  const arrow = box({ id: 'arr', kind: 'arrow', from: 'a', to: 'b', z: 4 })
  const items = [a, b, c, arrow]

  it('attaches the end to the item it is dropped on, clearing the spot it had', () => {
    expect(arrowEndTarget(items, { x: 50, y: 250 }, arrow, 'start')).toStrictEqual({
      targetId: 'c',
      patch: { from: 'c', fromPoint: undefined }
    })
  })

  it('leaves the end on the spot rather than looping it onto the other end', () => {
    expect(arrowEndTarget(items, { x: 250, y: 50 }, arrow, 'start')).toStrictEqual({
      targetId: null,
      patch: { from: undefined, fromPoint: { x: 250, y: 50 } }
    })
  })

  it('leaves the end on the spot over empty canvas', () => {
    expect(arrowEndTarget(items, { x: 900, y: 900 }, arrow, 'end')).toStrictEqual({
      targetId: null,
      patch: { to: undefined, toPoint: { x: 900, y: 900 } }
    })
  })

  it('moves the far end the same way', () => {
    expect(arrowEndTarget(items, { x: 50, y: 250 }, arrow, 'end').patch).toStrictEqual({ to: 'c', toPoint: undefined })
  })
})

describe('arrowDropTarget', () => {
  const items = [box({ id: 'a', x: 0, y: 0 }), box({ id: 'b', x: 200, y: 0 })]

  it('ends on the item under the pointer', () => {
    expect(arrowDropTarget(items, { x: 250, y: 50 }, 'a')).toBe('b')
  })

  it('does not end on the item it started from, or on nothing', () => {
    expect(arrowDropTarget(items, { x: 50, y: 50 }, 'a')).toBeNull()
    expect(arrowDropTarget(items, { x: 900, y: 900 }, 'a')).toBeNull()
  })
})

describe('arrowRelease', () => {
  const base = { fromId: 'a', moved: false, overId: null as string | null, travelled: 0, armed: null as string | null }

  it('connects a drag that ends on an item, and hands the pointer back', () => {
    expect(arrowRelease({ ...base, moved: true, overId: 'b', travelled: 10 })).toStrictEqual({
      draw: { from: 'a', to: 'b' },
      armed: null,
      handBack: true
    })
  })

  it('leaves a long drag over empty canvas pointing at the spot', () => {
    expect(arrowRelease({ ...base, moved: true, travelled: LOOSE_END_SLOP + 1 })).toStrictEqual({
      draw: { from: 'a', to: null },
      armed: null,
      handBack: true
    })
  })

  it('draws nothing for a slip no longer than the loose-end distance, and keeps the tool', () => {
    expect(arrowRelease({ ...base, moved: true, travelled: LOOSE_END_SLOP })).toStrictEqual({
      draw: null,
      armed: null,
      handBack: false
    })
  })

  it('changes nothing for a handle press that never moved', () => {
    expect(arrowRelease({ ...base, viaHandle: true, armed: 'z' })).toStrictEqual({
      draw: null,
      armed: undefined,
      handBack: false
    })
  })

  it('picks a source with one click and connects it with a click on another item', () => {
    expect(arrowRelease(base)).toStrictEqual({ draw: null, armed: 'a', handBack: false })
    expect(arrowRelease({ ...base, fromId: 'b', armed: 'a' })).toStrictEqual({
      draw: { from: 'a', to: 'b' },
      armed: null,
      handBack: true
    })
  })

  it('puts the source down when it is clicked again', () => {
    expect(arrowRelease({ ...base, armed: 'a' })).toStrictEqual({ draw: null, armed: null, handBack: false })
  })
})

describe('recordsHistory', () => {
  it('takes a step for a move, resize, rotation or re-aimed end', () => {
    expect(recordsHistory({ mode: 'move', startX: 0, startY: 0, origin: [], moved: true })).toBe(true)
    expect(recordsHistory({ mode: 'resize', id: 'a', startX: 0, startY: 0, w: 1, h: 1 })).toBe(true)
    expect(recordsHistory({ mode: 'rotate', id: 'a', cx: 0, cy: 0, start: 0 })).toBe(true)
    expect(recordsHistory({ mode: 'arrowEnd', id: 'a', end: 'end' })).toBe(true)
  })

  it('takes none for a move that never left the click threshold', () => {
    expect(recordsHistory({ mode: 'move', startX: 0, startY: 0, origin: [], moved: false })).toBe(false)
  })

  it('takes none for gestures that record themselves, or change nothing', () => {
    expect(recordsHistory({ mode: 'pan', startX: 0, startY: 0, camX: 0, camY: 0 })).toBe(false)
    expect(recordsHistory({ mode: 'marquee', startX: 0, startY: 0, base: new Set() })).toBe(false)
    expect(recordsHistory({ mode: 'draw' })).toBe(false)
    expect(recordsHistory({ mode: 'arrow', fromId: 'a', startX: 0, startY: 0, moved: true, overId: 'b' })).toBe(false)
    expect(recordsHistory(null)).toBe(false)
  })
})
