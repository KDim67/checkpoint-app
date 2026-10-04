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
    makeCards: vi.fn(async () => {}),
    frameSelection: vi.fn(),
    presentFrom: vi.fn(),
    exportFrame: vi.fn(),
    gatherTags: vi.fn(),
    addMindMap: vi.fn(),
    tidyMap: vi.fn(),
    startCrop: vi.fn(),
    turnSelection: vi.fn(),
    openAlign: vi.fn()
  }
  return wallMenuEntries(ctx).map(e => e.label)
}

describe('code blocks, mind maps and tags in the menus', () => {
  it('offers a code block, a mind map and gathering by tag on the canvas', () => {
    const labels = labelsFor([item('a', { tags: ['Bug'] })], [], null)
    expect(labels).toContain('Code block here')
    expect(labels).toContain('Mind map here')
    expect(labels).toContain('Gather stickies by tag')
  })

  it('offers tidying the map only on a topic', () => {
    expect(labelsFor([item('t', { kind: 'shape', map: 'm' })], ['t'])).toContain('Tidy up the mind map')
    expect(labelsFor([item('a')], ['a'])).not.toContain('Tidy up the mind map')
  })

  it('offers gathering from a tagged sticky, and not from an untagged one', () => {
    expect(labelsFor([item('a', { tags: ['Bug'] })], ['a'])).toContain('Gather stickies by tag')
    expect(labelsFor([item('a')], ['a'])).not.toContain('Gather stickies by tag')
  })
})

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

  it('frames a selection, and presents or exports a frame', () => {
    expect(labelsFor([item('a'), item('b', { x: 300 })], ['a', 'b'])).toContain('Frame this selection')

    const frameLabels = labelsFor([item('f', { kind: 'frame', width: 400, height: 400 })], ['f'])
    expect(frameLabels).toContain('Present from this frame')
    expect(frameLabels).toContain('Export frame as PNG')
    expect(frameLabels).not.toContain('Frame this selection')

    expect(labelsFor([item('a')], ['a'])).not.toContain('Present from this frame')
  })

  it('crops a single unlocked picture, and nothing else', () => {
    const picture = item('p', { kind: 'image', ref: 'p.png' })
    expect(labelsFor([picture], ['p'])).toContain('Crop this picture')
    expect(labelsFor([{ ...picture, locked: true }], ['p'])).not.toContain('Crop this picture')
    expect(labelsFor([picture, item('a', { x: 400 })], ['p', 'a'])).not.toContain('Crop this picture')
    expect(labelsFor([item('a')], ['a'])).not.toContain('Crop this picture')
  })

  it('turns what can be turned, and offers to straighten only what is crooked', () => {
    const labels = labelsFor([item('a')], ['a'])
    expect(labels).toContain('Rotate left')
    expect(labels).toContain('Rotate right')
    expect(labels).not.toContain('Straighten')

    expect(labelsFor([item('a', { rotation: 30 })], ['a'])).toContain('Straighten')
    expect(labelsFor([item('a', { locked: true })], ['a'])).not.toContain('Rotate left')
  })

  it('opens the align panel from the menu once two pieces are picked', () => {
    expect(labelsFor([item('a'), item('b', { x: 300 })], ['a', 'b'])).toContain('Line up and space out')
    expect(labelsFor([item('a')], ['a'])).not.toContain('Line up and space out')
  })

  it('groups loose items and ungroups a group', () => {
    expect(labelsFor([item('a'), item('b', { x: 300 })], ['a', 'b'])).toContain('Group')

    const labels = labelsFor([item('a', { group: 'g' }), item('b', { group: 'g' })], ['a', 'b'])
    expect(labels).toContain('Ungroup')
    expect(labels).not.toContain('Group')
  })
})
