import { describe, expect, it } from 'vitest'
import { eraseAlong, eraseParts, inkPoints, lassoPick } from '../src/shared/wallInk'
import { inkFromPath, type WallItem } from '../src/shared/wallModel'

const item = (id: string, over: Partial<WallItem> = {}): WallItem =>
  ({ id, kind: 'note', x: 0, y: 0, width: 100, height: 100, z: 0, ...over })

const stroke = (id: string, path: { x: number; y: number }[], over: Partial<WallItem> = {}): WallItem =>
  ({ ...(inkFromPath(path, [], { strokeWidth: 4 }) as WallItem), id, ...over })

describe('inkPoints', () => {
  it('puts a stroke\'s points back where they were drawn, and follows its box when resized', () => {
    const line = stroke('line', [{ x: 10, y: 10 }, { x: 110, y: 10 }])
    const [a, b] = inkPoints(line)
    expect(a.x).toBeCloseTo(10)
    expect(b.x).toBeCloseTo(110)

    const wider = inkPoints({ ...line, width: line.width * 2 })
    expect(wider[1].x - wider[0].x).toBeCloseTo(200)
  })
})

describe('eraseAlong', () => {
  const line = stroke('line', [{ x: 0, y: 50 }, { x: 200, y: 50 }])
  const far = stroke('far', [{ x: 0, y: 400 }, { x: 200, y: 400 }])

  it('erases a stroke the eraser crosses, even between two pointer samples', () => {
    expect(eraseAlong([line, far, item('note')], { x: 100, y: 0 }, { x: 100, y: 120 }, 6)).toStrictEqual(['line'])
  })

  it('leaves strokes out of reach, and locked ones', () => {
    expect(eraseAlong([line], { x: 100, y: 70 }, { x: 100, y: 70 }, 6)).toStrictEqual([])
    expect(eraseAlong([{ ...line, locked: true }], { x: 100, y: 0 }, { x: 100, y: 120 }, 6)).toStrictEqual([])
  })
})

describe('eraseParts', () => {
  it('cuts a stroke where the eraser crosses it, leaving the two ends as strokes of their own', () => {
    const line = stroke('line', [{ x: 0, y: 50 }, { x: 200, y: 50 }], { z: 3, color: '#f28b82' })
    let n = 0
    const { items, touched } = eraseParts([line], { x: 100, y: 0 }, { x: 100, y: 120 }, 6, () => `piece${++n}`)

    expect(touched).toBe(true)
    expect(items.map(i => i.id)).toStrictEqual(['piece1', 'piece2'])
    expect(items[0]).toMatchObject({ kind: 'ink', strokeWidth: 4, color: '#f28b82', z: 3 })

    const [left, right] = items.map(inkPoints)
    expect(left[0].x).toBeCloseTo(0)
    expect(left[left.length - 1].x).toBeLessThan(94)
    expect(right[0].x).toBeGreaterThan(106)
    expect(right[right.length - 1].x).toBeCloseTo(200)
  })

  it('takes away a stroke the eraser covers entirely, and leaves the rest as they were', () => {
    const dot = stroke('dot', [{ x: 100, y: 50 }, { x: 102, y: 50 }])
    const far = stroke('far', [{ x: 0, y: 400 }, { x: 200, y: 400 }])
    const { items, touched } = eraseParts([dot, far], { x: 100, y: 0 }, { x: 100, y: 120 }, 6)

    expect(touched).toBe(true)
    expect(items).toStrictEqual([far])
    expect(items[0]).toBe(far)
  })

  it('changes nothing when the eraser touches no stroke', () => {
    const far = stroke('far', [{ x: 0, y: 400 }, { x: 200, y: 400 }])
    const wall = [far]
    const result = eraseParts(wall, { x: 100, y: 0 }, { x: 100, y: 120 }, 6)
    expect(result.touched).toBe(false)
    expect(result.items).toBe(wall)
  })
})

describe('lassoPick', () => {
  const loop = [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 300 }, { x: 0, y: 300 }]

  it('picks items whose middle falls inside the loop, leaving arrows and locked items', () => {
    const wall = [
      item('in', { x: 50, y: 50 }),
      item('half', { x: 280 }),
      item('out', { x: 400 }),
      item('pinned', { x: 50, y: 50, locked: true }),
      item('line', { kind: 'arrow', from: 'in', to: 'out' })
    ]
    expect(lassoPick(wall, loop)).toStrictEqual(['in'])
  })

  it('picks nothing from a path too short to enclose anything', () => {
    expect(lassoPick([item('in', { x: 50, y: 50 })], loop.slice(0, 2))).toStrictEqual([])
  })
})
