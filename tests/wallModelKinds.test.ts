import { describe, expect, it } from 'vitest'
import { cleanTags, normalizeWallItem, searchItems, type WallItem } from '../src/shared/wallModel'
import { regroupCopies } from '../src/shared/wallGroup'

const item = (id: string, over: Partial<WallItem> = {}): WallItem =>
  ({ id, kind: 'shape', x: 0, y: 0, width: 100, height: 100, z: 0, ...over })

describe('code blocks, tags and mind map topics on a stored wall', () => {
  it('keeps a code block with a language it knows, and drops one it doesn\'t', () => {
    expect(normalizeWallItem({ id: 'c', kind: 'code', text: 'x = 1', language: 'python' }, 0))
      .toMatchObject({ kind: 'code', text: 'x = 1', language: 'python', width: 420, height: 200 })
    expect(normalizeWallItem({ id: 'c', kind: 'code', language: 'klingon' }, 0)).not.toHaveProperty('language')
    expect(normalizeWallItem({ id: 'n', kind: 'note', language: 'python' }, 0)).not.toHaveProperty('language')
  })

  it('keeps a sticky\'s tags trimmed and once each, ten at most, and no tags on other kinds', () => {
    const tags = ['  Bug ', 'bug', '', 42, 'UI', ...Array.from({ length: 12 }, (_, i) => `t${i}`)]
    expect(normalizeWallItem({ id: 'n', kind: 'note', tags }, 0)?.tags)
      .toStrictEqual(['Bug', 'UI', 't0', 't1', 't2', 't3', 't4', 't5', 't6', 't7'])
    expect(normalizeWallItem({ id: 's', kind: 'shape', tags: ['Bug'] }, 0)).not.toHaveProperty('tags')
    expect(cleanTags('Bug')).toStrictEqual([])
  })

  it('keeps a topic\'s map only on the kinds that hold words', () => {
    expect(normalizeWallItem({ id: 's', kind: 'shape', map: ' m1 ' }, 0)?.map).toBe('m1')
    expect(normalizeWallItem({ id: 'i', kind: 'image', ref: 'x.png', map: 'm1' }, 0)).not.toHaveProperty('map')
  })

  it('finds a sticky by its tags', () => {
    const items = [normalizeWallItem({ id: 'n', kind: 'note', text: 'Login', tags: ['Urgent'] }, 0) as WallItem]
    expect(searchItems(items, 'urgent', () => undefined).map(i => i.id)).toStrictEqual(['n'])
  })

  it('gives pasted topics a map of their own, shared among the copies and apart from their group', () => {
    let n = 0
    const copies = regroupCopies(
      [item('a', { map: 'm' }), item('b', { map: 'm', group: 'g' }), item('c', { map: 'other' })],
      () => `fresh${++n}`
    )
    expect(copies.map(i => [i.map, i.group])).toStrictEqual([['fresh1', undefined], ['fresh1', 'fresh2'], ['fresh3', undefined]])
  })
})
