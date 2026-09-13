// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { wallMenuEntries, type WallMenuContext } from '../src/renderer/src/components/wall/wallMenuEntries'
import type { WallItem } from '../src/shared/wallModel'

const item = (id: string, over: Partial<WallItem> = {}): WallItem =>
  ({ id, kind: 'note', x: 0, y: 0, width: 200, height: 200, z: 0, ...over } as WallItem)

const labelsFor = (items: WallItem[], selected: string[], itemId: string | null = selected[0] ?? null) => {
  const doc = { items, camera: { x: 0, y: 0, zoom: 1 } } as WallMenuContext['doc']
  const ctx: WallMenuContext = {
    menu: { itemId, at: { x: 0, y: 0 } },
    doc,
    docRef: { current: doc },
    selectedIds: new Set(selected),
    setSelectedIds: vi.fn(),
    setItems: vi.fn(),
    addItem: vi.fn(),
    openCard: vi.fn(),
    duplicateSelected: vi.fn(),
    toggleLock: vi.fn(),
    removeSelected: vi.fn(),
    fitToContent: vi.fn(),
    runImageOp: vi.fn(),
    placeDerived: vi.fn(),
    toast: vi.fn(),
    followLink: vi.fn(),
    copyItemLink: vi.fn(),
    setItemLink: vi.fn(),
    refreshPreview: vi.fn(),
    openLinkEditor: vi.fn(),
    copyItems: vi.fn(),
    cutItems: vi.fn(),
    copyStyle: vi.fn(),
    pasteStyle: vi.fn(),
    canPasteStyle: false,
    pasteHere: vi.fn(),
    canPaste: false,
    makeCards: vi.fn(async () => {})
  }
  return wallMenuEntries(ctx).map(e => e.label)
}

describe('wall item menu', () => {
  it('offers a sticky its other kinds and a card', () => {
    const labels = labelsFor([item('a')], ['a'])
    expect(labels).toContain('Make a card')
    expect(labels).toContain('Turn into text')
    expect(labels).toContain('Turn into a shape')
    expect(labels).not.toContain('Turn into a sticky note')
  })

  it('counts the cards for a mixed pick of words', () => {
    const labels = labelsFor([item('a'), item('b', { kind: 'shape' })], ['a', 'b'])
    expect(labels).toContain('Make 2 cards')
    expect(labels).toContain('Turn into a sticky note')
  })

  it('leaves them out once a locked item or an image is in the pick', () => {
    expect(labelsFor([item('a', { locked: true })], ['a'])).not.toContain('Make a card')
    expect(labelsFor([item('a'), item('b', { kind: 'image' })], ['a', 'b'])).not.toContain('Make 2 cards')
  })

  it('groups loose items and ungroups a group', () => {
    expect(labelsFor([item('a'), item('b', { x: 300 })], ['a', 'b'])).toContain('Group')

    const labels = labelsFor([item('a', { group: 'g' }), item('b', { group: 'g' })], ['a', 'b'])
    expect(labels).toContain('Ungroup')
    expect(labels).not.toContain('Group')
  })
})
