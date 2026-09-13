import { describe, expect, it } from 'vitest'
import { findItems, SEARCH_KINDS } from '../src/shared/wallFind'
import type { WallItem } from '../src/shared/wallModel'

const item = (id: string, over: Partial<WallItem> = {}): WallItem =>
  ({ id, kind: 'note', x: 0, y: 0, width: 100, height: 100, z: 0, ...over })

describe('findItems', () => {
  const wall = [
    item('s', { text: 'launch plan' }),
    item('t', { kind: 'text', text: 'launch notes', z: 1 }),
    item('i', { kind: 'image', ref: 'a.png', text: 'launch.png', z: 2 }),
    item('f', { kind: 'frame', text: 'Q3', z: 3 })
  ]
  const titleOf = (i: WallItem): string | undefined => i.text

  it('matches words across every kind by default, topmost first', () => {
    expect(findItems(wall, 'launch', 'all', titleOf).map(i => i.id)).toStrictEqual(['i', 't', 's'])
  })

  it('narrows to one kind, and lists every item of it when nothing is typed', () => {
    expect(findItems(wall, 'launch', 'text', titleOf).map(i => i.id)).toStrictEqual(['t'])
    expect(findItems(wall, '', 'frame', titleOf).map(i => i.id)).toStrictEqual(['f'])
    expect(findItems(wall, '  ', 'all', titleOf)).toStrictEqual([])
  })

  it('offers All first, then the kinds people put words or pictures on', () => {
    expect(SEARCH_KINDS[0]).toStrictEqual({ kind: 'all', label: 'All' })
    expect(SEARCH_KINDS.map(k => k.kind)).not.toContain('arrow')
  })
})
