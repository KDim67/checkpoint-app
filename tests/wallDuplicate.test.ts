import { describe, expect, it } from 'vitest'
import { duplicateToward } from '../src/shared/wallClipboard'
import type { WallItem } from '../src/shared/wallModel'

const item = (id: string, over: Partial<WallItem> = {}): WallItem =>
  ({ id, kind: 'note', x: 0, y: 0, width: 100, height: 100, z: 0, ...over })

const counter = (): (() => string) => {
  let n = 0
  return () => `new${++n}`
}

describe('duplicateToward', () => {
  const items = [item('a'), item('b', { x: 150, y: 50 }), item('line', { kind: 'arrow', width: 1, height: 1, from: 'a', to: 'b' })]

  it('lays a copy of the selection beside it, a gap away, connectors and all', () => {
    const right = duplicateToward(items, new Set(['a', 'b']), 'right', 24, counter())
    expect(right.filter(i => i.kind !== 'arrow').map(i => [i.x, i.y])).toStrictEqual([[274, 0], [424, 50]])
    expect(right.find(i => i.kind === 'arrow')).toMatchObject({ from: 'new1', to: 'new2' })
  })

  it('goes whichever way it is asked, by the selection\'s own size', () => {
    expect(duplicateToward(items, new Set(['a']), 'down', 24, counter()).map(i => [i.x, i.y])).toStrictEqual([[0, 124]])
    expect(duplicateToward(items, new Set(['a']), 'left', 24, counter()).map(i => [i.x, i.y])).toStrictEqual([[-124, 0]])
  })

  it('makes nothing from an empty selection', () => {
    expect(duplicateToward(items, new Set(), 'up')).toStrictEqual([])
  })
})
