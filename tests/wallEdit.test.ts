import { describe, expect, it } from 'vitest'
import { addedIds, changedItems, connectWallItems, editWallItem, removeWallItems, restoreWallSnapshot } from '../src/shared/wallEdit'
import type { WallItem } from '../src/shared/wallModel'

const item = (id: string, over: Partial<WallItem> = {}): WallItem =>
  ({ id, kind: 'note', x: 0, y: 0, width: 100, height: 100, z: 0, ...over })

/** the success branch, or the error as a failure */
const ok = <T extends object>(result: T | { error: string }): T => {
  if ('error' in result) throw new Error(result.error)
  return result
}

describe('editWallItem with tags and code', () => {
  it('sets a sticky\'s tags and a code block\'s source and language, refusing them on other kinds', () => {
    const items = [item('n', { tags: ['Old'] }), item('c', { kind: 'code', language: 'python' }), item('s', { kind: 'shape' })]

    expect(ok(editWallItem(items, 'n', { tags: [' Bug', 'bug', 'UI'] })).item.tags).toStrictEqual(['Bug', 'UI'])
    expect(ok(editWallItem(items, 'n', { tags: [] })).item).not.toHaveProperty('tags')
    expect(ok(editWallItem(items, 'c', { text: 'fn main() {}', language: 'rust' })).item).toMatchObject({ text: 'fn main() {}', language: 'rust' })
    expect(ok(editWallItem(items, 'c', { language: null })).item).not.toHaveProperty('language')

    expect(editWallItem(items, 's', { tags: ['Bug'] })).toStrictEqual({ error: 'Only sticky notes carry tags.' })
    expect(editWallItem(items, 'n', { language: 'rust' })).toStrictEqual({ error: 'Only a code block has a language.' })
    expect(editWallItem(items, 'c', { language: 'klingon' })).toMatchObject({ error: expect.stringContaining("language 'klingon' isn't one of typescript, python") })
  })
})

describe('editWallItem', () => {
  it('moves by centre, resizes around the centre, and changes only what is given', () => {
    const items = [item('a', { text: 'hi', color: '#f6c453' })]
    expect(ok(editWallItem(items, 'a', { x: 500, y: 250 })).item).toMatchObject({ x: 450, y: 200, width: 100, text: 'hi', color: '#f6c453' })
    expect(ok(editWallItem(items, 'a', { width: 300 })).item).toMatchObject({ x: -100, y: 0, width: 300, height: 100 })
  })

  it('rewrites text, clears a colour, sets a link, changes an outline and locks', () => {
    const items = [item('a', { color: '#f6c453' }), item('s', { kind: 'shape' })]
    const note = ok(editWallItem(items, 'a', { text: 'new', color: null, link: 'example.com', locked: true })).item
    expect(note).toMatchObject({ text: 'new', link: 'https://example.com/', locked: true })
    expect(note).not.toHaveProperty('color')

    expect(ok(editWallItem(items, 's', { shape: 'oval' })).item.shape).toBe('oval')
    expect(ok(editWallItem([item('s', { kind: 'shape', shape: 'oval' })], 's', { shape: 'rectangle' })).item).not.toHaveProperty('shape')
  })

  it('brings a frame\'s contents along when the frame moves', () => {
    const items = [item('f', { kind: 'frame', width: 400, height: 400 }), item('in', { x: 50, y: 50 }), item('out', { x: 900 })]
    const next = ok(editWallItem(items, 'f', { x: 700, y: 200 })).items
    expect(next.map(i => [i.id, i.x, i.y])).toStrictEqual([['f', 500, 0], ['in', 550, 50], ['out', 900, 0]])
  })

  it('sets a side for words, and a shape\'s border, corners and fill opacity', () => {
    const items = [item('n'), item('s', { kind: 'shape' })]
    expect(ok(editWallItem(items, 'n', { align: 'right' })).item.align).toBe('right')
    expect(ok(editWallItem(items, 's', { borderColor: '#f28b82', radius: 12, opacity: 0.5 })).item)
      .toMatchObject({ borderColor: '#f28b82', radius: 12, opacity: 0.5 })
    expect(ok(editWallItem([item('s', { kind: 'shape', borderColor: '#000000' })], 's', { borderColor: null })).item).not.toHaveProperty('borderColor')

    expect(editWallItem(items, 'n', { radius: 12 })).toHaveProperty('error')
    expect(editWallItem([item('f', { kind: 'frame' })], 'f', { align: 'center' })).toHaveProperty('error')
  })

  it('refuses what the item cannot take', () => {
    const items = [item('c', { kind: 'card', ref: 'x' }), item('n'), item('l', { locked: true }), item('line', { kind: 'arrow', from: 'n', to: 'c' })]
    expect(editWallItem(items, 'missing', { x: 0 })).toHaveProperty('error')
    expect(editWallItem(items, 'c', { text: 'rename' })).toHaveProperty('error')
    expect(editWallItem(items, 'n', { shape: 'oval' })).toHaveProperty('error')
    expect(editWallItem(items, 'n', { link: 'not a link' })).toHaveProperty('error')
    expect(editWallItem(items, 'l', { x: 10 })).toHaveProperty('error')
    expect(editWallItem(items, 'line', { x: 10 })).toHaveProperty('error')
    expect(ok(editWallItem(items, 'l', { x: 10, locked: false })).item).not.toHaveProperty('locked')
  })
})

describe('connectWallItems', () => {
  it('draws a styled, labelled arrow between two items', () => {
    const items = [item('a'), item('b', { x: 300 })]
    const { item: arrow, items: next } = ok(connectWallItems(items, 'a', 'b', { route: 'curved', line: 'dashed', heads: 'both', label: 'then', color: '#f28b82' }))
    expect(arrow).toMatchObject({ kind: 'arrow', from: 'a', to: 'b', arrowShape: 'curved', arrowLine: 'dashed', arrowHeads: 'both', text: 'then', color: '#f28b82' })
    expect(next).toHaveLength(3)
    expect(ok(connectWallItems(items, 'a', 'b')).item).not.toHaveProperty('arrowShape')
  })

  it('refuses a missing end, the same item twice, or an arrow as an end', () => {
    const items = [item('a'), item('line', { kind: 'arrow', from: 'a', toPoint: { x: 0, y: 0 } })]
    expect(connectWallItems(items, 'a', 'nope')).toHaveProperty('error')
    expect(connectWallItems(items, 'a', 'a')).toHaveProperty('error')
    expect(connectWallItems(items, 'a', 'line')).toHaveProperty('error')
  })
})

describe('removeWallItems', () => {
  it('takes the items and the arrows left without an end', () => {
    const items = [item('a'), item('b'), item('line', { kind: 'arrow', from: 'a', to: 'b' })]
    const result = ok(removeWallItems(items, ['a']))
    expect(result.items.map(i => i.id)).toStrictEqual(['b'])
    expect(result.removed.map(i => i.id)).toStrictEqual(['a', 'line'])
  })

  it('refuses ids that are not there and locked items, taking nothing', () => {
    const items = [item('a'), item('l', { locked: true })]
    expect(removeWallItems(items, ['a', 'nope'])).toHaveProperty('error')
    expect(removeWallItems(items, ['l'])).toHaveProperty('error')
  })
})

describe('undoing a change', () => {
  it('lists what changed or went, and what was added', () => {
    const before = [item('a'), item('b')]
    const after = [{ ...before[0], x: 50 }, item('c')]
    expect(changedItems(before, after)).toStrictEqual(before)
    expect(addedIds(before, after)).toStrictEqual(['c'])
  })

  it('puts changed and removed items back and takes added ones away, keeping later additions', () => {
    const wall = [item('a', { x: 50 }), item('c'), item('later')]
    const restored = restoreWallSnapshot(wall, [item('a'), item('b')], ['c'])
    expect(restored.map(i => [i.id, i.x])).toStrictEqual([['a', 0], ['later', 0], ['b', 0]])
  })
})
