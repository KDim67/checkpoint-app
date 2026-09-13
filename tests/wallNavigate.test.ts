import { describe, expect, it } from 'vitest'
import { nearestToward, stepThrough } from '../src/shared/wallNavigate'
import type { WallItem } from '../src/shared/wallModel'

const box = (id: string, x: number, y: number, over: Partial<WallItem> = {}): WallItem =>
  ({ id, kind: 'note', x, y, width: 100, height: 100, z: 0, ...over })

describe('stepThrough', () => {
  it('goes row by row like a page and wraps round, skipping arrows and locked items', () => {
    const items = [
      box('c', 0, 300), box('b', 300, 30), box('a', 0, 0),
      box('arrow', 0, 0, { kind: 'arrow' }), box('locked', 600, 0, { locked: true })
    ]

    expect(stepThrough(items, null, false)?.id).toBe('a')
    expect(stepThrough(items, null, true)?.id).toBe('c')
    expect(stepThrough(items, 'a', false)?.id).toBe('b')
    expect(stepThrough(items, 'c', false)?.id).toBe('a')
    expect(stepThrough(items, 'a', true)?.id).toBe('c')
    expect(stepThrough([], null, false)).toBeNull()
  })
})

describe('nearestToward', () => {
  it('picks the closest item that way, straight ahead beating a nearer one off to the side', () => {
    const items = [box('here', 0, 0), box('ahead', 300, 0), box('aside', 150, 200), box('behind', -300, 0)]

    expect(nearestToward(items, 'here', 'right')?.id).toBe('ahead')
    expect(nearestToward(items, 'here', 'left')?.id).toBe('behind')
    expect(nearestToward(items, 'here', 'down')?.id).toBe('aside')
    expect(nearestToward(items, 'here', 'up')).toBeNull()
    expect(nearestToward(items, 'missing', 'up')).toBeNull()
  })
})
