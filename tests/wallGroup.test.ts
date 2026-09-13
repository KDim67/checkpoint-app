import { describe, expect, it } from 'vitest'
import { groupItems, groupOf, groupState, regroupCopies, ungroupItems, withGroups } from '../src/shared/wallGroup'
import { placeClip } from '../src/shared/wallClipboard'
import { normalizeWallDoc, type WallItem } from '../src/shared/wallModel'

const item = (id: string, over: Partial<WallItem> = {}): WallItem =>
  ({ id, kind: 'note', x: 0, y: 0, width: 100, height: 100, z: 0, ...over })

const groupsOf = (items: WallItem[]): Record<string, string | undefined> =>
  Object.fromEntries(items.map(i => [i.id, i.group]))

describe('groupItems', () => {
  it('puts every picked item under one id, leaving arrows and locked items out', () => {
    const items = [item('a'), item('b'), item('c'), item('line', { kind: 'arrow', from: 'a', to: 'b' }), item('pinned', { locked: true })]
    const grouped = groupItems(items, new Set(['a', 'b', 'line', 'pinned']), 'g1')
    expect(groupsOf(grouped)).toStrictEqual({ a: 'g1', b: 'g1', c: undefined, line: undefined, pinned: undefined })
  })

  it('leaves the wall alone with fewer than two to group', () => {
    const items = [item('a'), item('line', { kind: 'arrow', from: 'a', toPoint: { x: 0, y: 0 } })]
    expect(groupItems(items, new Set(['a', 'line']), 'g1')).toBe(items)
  })

  it('takes a picked item out of its old group, and drops that group once one member is left', () => {
    const items = [item('a', { group: 'old' }), item('b', { group: 'old' }), item('c')]
    const grouped = groupItems(items, new Set(['b', 'c']), 'new')
    expect(groupsOf(grouped)).toStrictEqual({ a: undefined, b: 'new', c: 'new' })
    expect(grouped[0]).not.toHaveProperty('group')
  })
})

describe('ungroupItems', () => {
  it('breaks up every group a picked item belongs to, members picked or not', () => {
    const items = [item('a', { group: 'g' }), item('b', { group: 'g' }), item('c', { group: 'h' }), item('d', { group: 'h' })]
    const ungrouped = ungroupItems(items, new Set(['a']))
    expect(groupsOf(ungrouped)).toStrictEqual({ a: undefined, b: undefined, c: 'h', d: 'h' })
    expect(ungrouped[0]).not.toHaveProperty('group')
  })

  it('leaves the wall alone when nothing picked is grouped', () => {
    const items = [item('a')]
    expect(ungroupItems(items, new Set(['a']))).toBe(items)
  })
})

describe('withGroups', () => {
  it('widens a selection to whole groups, without their locked members', () => {
    const items = [item('a', { group: 'g' }), item('b', { group: 'g' }), item('c', { group: 'g', locked: true }), item('d')]
    expect([...withGroups(items, new Set(['a', 'd']))].sort()).toStrictEqual(['a', 'b', 'd'])
  })

  it('hands back the same set when nothing picked is grouped', () => {
    const ids = new Set(['d'])
    expect(withGroups([item('d')], ids)).toBe(ids)
  })
})

describe('groupOf', () => {
  it('lists the pressed item and the rest of its group, or the item alone', () => {
    const items = [item('a', { group: 'g' }), item('b', { group: 'g' }), item('c')]
    expect(groupOf(items, 'b').sort()).toStrictEqual(['a', 'b'])
    expect(groupOf(items, 'c')).toStrictEqual(['c'])
  })
})

describe('groupState', () => {
  it('offers Group for loose items and Ungroup for a group', () => {
    const items = [item('a'), item('b'), item('c', { group: 'g' }), item('d', { group: 'g' })]
    expect(groupState(items, new Set(['a', 'b']))).toStrictEqual({ canGroup: true, canUngroup: false })
    expect(groupState(items, new Set(['c', 'd']))).toStrictEqual({ canGroup: false, canUngroup: true })
    expect(groupState(items, new Set(['a', 'c', 'd']))).toStrictEqual({ canGroup: true, canUngroup: true })
    expect(groupState(items, new Set(['a']))).toStrictEqual({ canGroup: false, canUngroup: false })
  })

  it('does not count a group left with one member', () => {
    expect(groupState([item('a', { group: 'g' }), item('b')], new Set(['a']))).toStrictEqual({ canGroup: false, canUngroup: false })
  })
})

describe('copies of a group', () => {
  it('get a group of their own, one fresh id a group', () => {
    let n = 0
    const copies = regroupCopies([item('a', { group: 'g' }), item('b', { group: 'g' }), item('c', { group: 'h' }), item('d')], () => `fresh${++n}`)
    expect(groupsOf(copies)).toStrictEqual({ a: 'fresh1', b: 'fresh1', c: 'fresh2', d: undefined })
  })

  it('never join the original group when pasted', () => {
    const originals = [item('a', { group: 'g' }), item('b', { group: 'g', x: 200 })]
    const placed = placeClip({ version: 1, items: originals }, originals, { x: 0, y: 0 })
    expect(placed.every(i => i.group && i.group !== 'g')).toBe(true)
    expect(new Set(placed.map(i => i.group)).size).toBe(1)
  })
})

describe('a stored wall', () => {
  it('forgets a group that has only one member left', () => {
    const doc = normalizeWallDoc({
      items: [{ id: 'a', kind: 'note', group: 'g' }, { id: 'b', kind: 'note', group: 'g' }, { id: 'c', kind: 'note', group: 'h' }]
    })
    expect(doc.items.map(i => i.group)).toStrictEqual(['g', 'g', undefined])
  })
})
