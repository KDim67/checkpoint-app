import { describe, expect, it } from 'vitest'
import { outlineOf, toLocal, turnedBox } from '../src/shared/wallTurn'

const photo = { x: 0, y: 0, width: 400, height: 200 }

describe('what a turned item covers', () => {
  it('is its own box when it is not turned, or turned right round', () => {
    expect(turnedBox(photo)).toStrictEqual({ minX: 0, minY: 0, maxX: 400, maxY: 200 })
    expect(turnedBox({ ...photo, rotation: 180 })).toStrictEqual({ minX: 0, minY: 0, maxX: 400, maxY: 200 })
  })

  it('swaps its sides about the middle, exactly, on a quarter turn either way', () => {
    const upright = { minX: 100, minY: -100, maxX: 300, maxY: 300 }
    expect(turnedBox({ ...photo, rotation: 90 })).toStrictEqual(upright)
    expect(turnedBox({ ...photo, rotation: -90 })).toStrictEqual(upright)
    expect(turnedBox({ ...photo, rotation: 270 })).toStrictEqual(upright)
  })

  it('reaches its corners at any other angle', () => {
    const square = turnedBox({ x: 0, y: 0, width: 100, height: 100, rotation: 45 })
    expect(square.minX).toBeCloseTo(50 - 50 * Math.SQRT2)
    expect(square.maxY).toBeCloseTo(50 + 50 * Math.SQRT2)
  })

  it('gathers several as they show', () => {
    expect(outlineOf([{ ...photo, rotation: 90 }, { x: 500, y: 0, width: 100, height: 100 }])).toStrictEqual({ minX: 100, minY: -100, maxX: 600, maxY: 300 })
    expect(outlineOf([])).toBeNull()
  })
})

describe('a pointer on a turned item', () => {
  it('is read in the item\'s own directions, exactly on quarter turns', () => {
    expect(toLocal(0, 10, 90)).toStrictEqual([10, 0])
    expect(toLocal(10, 0, 90)).toStrictEqual([0, -10])
    expect(toLocal(3, 4, 180)).toStrictEqual([-3, -4])
    expect(toLocal(0, 10, 270)).toStrictEqual([-10, 0])
    expect(toLocal(10, 0, 0)).toStrictEqual([10, 0])
    const [x, y] = toLocal(10, 0, 30)
    expect(x).toBeCloseTo(10 * Math.cos(Math.PI / 6))
    expect(y).toBeCloseTo(-10 * Math.sin(Math.PI / 6))
  })
})
