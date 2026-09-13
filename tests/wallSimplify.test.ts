import { describe, it, expect } from 'vitest'
import { simplifyPath, inkFromPath, SIMPLIFY_TOLERANCE } from '../src/shared/wallModel'
import { defined } from './helpers/defined'

// hundreds of near-identical samples get stored, synced and exported

const line = (n: number): { x: number; y: number }[] =>
  Array.from({ length: n }, (_, i) => ({ x: i, y: 0 }))

describe('thinning a stroke', () => {
  it('reduces a straight line to its two ends', () => {
    expect(simplifyPath(line(200))).toEqual([{ x: 0, y: 0 }, { x: 199, y: 0 }])
  })

  it('keeps the corner of an L, which is the whole shape', () => {
    const path = [...line(50), ...Array.from({ length: 50 }, (_, i) => ({ x: 49, y: i }))]
    const simplified = simplifyPath(path)
    expect(simplified).toContainEqual({ x: 49, y: 0 })
    expect(simplified.length).toBeLessThan(10)
  })

  it('never moves where a stroke starts or ends', () => {
    // must keep touching
    const path = [{ x: 3, y: 7 }, { x: 10, y: 40 }, { x: 60, y: 2 }, { x: 91, y: 33 }]
    const simplified = simplifyPath(path)
    expect(simplified[0]).toEqual(path[0])
    expect(simplified[simplified.length - 1]).toEqual(path[path.length - 1])
  })

  it('keeps a wobble bigger than the tolerance', () => {
    const path = [{ x: 0, y: 0 }, { x: 50, y: SIMPLIFY_TOLERANCE * 10 }, { x: 100, y: 0 }]
    expect(simplifyPath(path)).toHaveLength(3)
  })

  it('drops a wobble smaller than it', () => {
    const path = [{ x: 0, y: 0 }, { x: 50, y: SIMPLIFY_TOLERANCE / 10 }, { x: 100, y: 0 }]
    expect(simplifyPath(path)).toHaveLength(2)
  })

  it('leaves a path too short to thin alone', () => {
    const two = [{ x: 0, y: 0 }, { x: 1, y: 1 }]
    expect(simplifyPath(two)).toEqual(two)
    expect(simplifyPath([])).toEqual([])
  })

  it('handles a stroke that never moved', () => {
    // a tap, or a stuck coordinate
    const stuck = Array.from({ length: 40 }, () => ({ x: 5, y: 5 }))
    expect(simplifyPath(stuck)).toEqual([{ x: 5, y: 5 }, { x: 5, y: 5 }])
  })

  it('does not blow the stack on a very long stroke', () => {
    // iterative, depth would follow the data
    const long = Array.from({ length: 20000 }, (_, i) => ({ x: i, y: Math.sin(i / 50) * 30 }))
    expect(() => simplifyPath(long)).not.toThrow()
    expect(simplifyPath(long).length).toBeLessThan(long.length)
  })
})

describe('what actually gets stored', () => {
  it('stores the thinned stroke, not every sample', () => {
    const ink = defined(inkFromPath(line(500), []))
    expect(defined(ink.points).length / 2).toBeLessThan(20)
  })

  it('still spans what was drawn', () => {
    const ink = defined(inkFromPath(line(500), []))
    const xs = defined(ink.points).filter((_, i) => i % 2 === 0)
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(499, 0)
  })

  it('keeps a box that fits the points it kept', () => {
    // thin before measuring so the box isn't bigger than the stroke
    const ink = defined(inkFromPath([{ x: 0, y: 0 }, { x: 40, y: 3 }, { x: 80, y: 0 }], []))
    const xs = defined(ink.points).filter((_, i) => i % 2 === 0)
    const ys = defined(ink.points).filter((_, i) => i % 2 === 1)
    expect(Math.max(...xs)).toBeLessThanOrEqual(ink.width)
    expect(Math.max(...ys)).toBeLessThanOrEqual(ink.height)
  })

  it('still refuses a path with nothing in it', () => {
    expect(inkFromPath([{ x: 1, y: 1 }], [])).toBeNull()
  })
})
