import { describe, expect, it } from 'vitest'
import { frameAround, frameContents, frameLabel, framesInOrder, moveFrame, presentKey } from '../src/shared/wallFrames'
import type { WallItem } from '../src/shared/wallModel'

const item = (id: string, over: Partial<WallItem> = {}): WallItem =>
  ({ id, kind: 'note', x: 0, y: 0, width: 100, height: 100, z: 0, ...over })

describe('framesInOrder', () => {
  it('reads frames row by row, left to right', () => {
    const wall = [
      item('b', { kind: 'frame', x: 600, y: 20, width: 400, height: 300 }),
      item('c', { kind: 'frame', x: 0, y: 500, width: 400, height: 300 }),
      item('a', { kind: 'frame', x: 0, y: 0, width: 400, height: 300 }),
      item('note')
    ]
    expect(framesInOrder(wall).map(f => f.id)).toStrictEqual(['a', 'b', 'c'])
  })

  it('follows a chosen order first, then the rest in reading order, skipping frames that are gone', () => {
    const wall = [
      item('b', { kind: 'frame', x: 600, y: 20, width: 400, height: 300 }),
      item('c', { kind: 'frame', x: 0, y: 500, width: 400, height: 300 }),
      item('a', { kind: 'frame', x: 0, y: 0, width: 400, height: 300 })
    ]
    expect(framesInOrder(wall, ['c', 'gone', 'a']).map(f => f.id)).toStrictEqual(['c', 'a', 'b'])
  })
})

describe('moveFrame', () => {
  it('moves one frame to another place and hands back every id in the new order', () => {
    const frames = ['a', 'b', 'c'].map(id => item(id, { kind: 'frame' }))
    expect(moveFrame(frames, 2, 0)).toStrictEqual(['c', 'a', 'b'])
    expect(moveFrame(frames, 0, 2)).toStrictEqual(['b', 'c', 'a'])
    expect(moveFrame(frames, 1, 1)).toStrictEqual(['a', 'b', 'c'])
  })
})

describe('frameLabel', () => {
  it('uses the frame\'s own name, or its place in the order', () => {
    expect(frameLabel(item('f', { kind: 'frame', text: ' Launch ' }), 0)).toBe('Launch')
    expect(frameLabel(item('f', { kind: 'frame' }), 2)).toBe('Frame 3')
  })
})

describe('frameAround', () => {
  it('draws a frame around the selection with room to spare, behind what it holds', () => {
    const wall = [item('a', { x: 100, y: 100, z: 5 }), item('b', { x: 400, y: 300, z: 2 }), item('line', { kind: 'arrow', from: 'a', to: 'b', z: 9 })]
    expect(frameAround(wall, new Set(['a', 'b', 'line']))).toMatchObject({ kind: 'frame', x: 60, y: 60, width: 480, height: 380, z: 1 })
  })

  it('makes nothing for a selection of arrows alone', () => {
    const line = item('line', { kind: 'arrow', from: 'a', toPoint: { x: 0, y: 0 } })
    expect(frameAround([line], new Set(['line']))).toBeNull()
  })
})

describe('presentKey', () => {
  it('reads the keys a slideshow listens to', () => {
    expect(['ArrowRight', 'ArrowDown', 'PageDown', ' '].map(key => presentKey(key))).toStrictEqual(['next', 'next', 'next', 'next'])
    expect(['ArrowLeft', 'ArrowUp', 'PageUp'].map(key => presentKey(key))).toStrictEqual(['previous', 'previous', 'previous'])
    expect([presentKey('Home'), presentKey('End'), presentKey('Escape'), presentKey('a')]).toStrictEqual(['first', 'last', 'exit', null])
  })
})

describe('frameContents', () => {
  it('takes the frame, what sits inside it, and the arrows running between those', () => {
    const wall = [
      item('f', { kind: 'frame', width: 500, height: 500 }),
      item('in', { x: 50, y: 50 }),
      item('in2', { x: 300, y: 300 }),
      item('out', { x: 900 }),
      item('inner', { kind: 'arrow', from: 'in', to: 'in2' }),
      item('outer', { kind: 'arrow', from: 'in', to: 'out' })
    ]
    expect(frameContents(wall, wall[0]).map(i => i.id)).toStrictEqual(['f', 'in', 'in2', 'inner'])
  })
})
