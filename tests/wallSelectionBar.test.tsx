// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import WallSelectionBar from '../src/renderer/src/components/wall/WallSelectionBar'
import { bringToFront, patchItems, sendToBack, type WallItem } from '../src/shared/wallModel'
import { alignItems, distributeItems } from '../src/shared/wallAlign'
import { ungroupItems } from '../src/shared/wallGroup'

afterEach(cleanup)

type Props = Parameters<typeof WallSelectionBar>[0]
type Given = Omit<Props, 'swatchOpen' | 'setSwatchOpen' | 'linkOpen' | 'setLinkOpen'>

const item = (id: string, over: Partial<WallItem> = {}): WallItem => ({ id, kind: 'note', z: 0, ...over } as WallItem)
const notes = [item('a', { z: 1 }), item('b', { z: 2 }), item('c', { z: 3 })]

/** the swatch and link field toggle on Wall state */
function Bar(props: Given) {
  const [swatchOpen, setSwatchOpen] = useState(false)
  const [linkOpen, setLinkOpen] = useState(false)
  return (
    <WallSelectionBar
      {...props}
      swatchOpen={swatchOpen}
      setSwatchOpen={setSwatchOpen}
      linkOpen={linkOpen}
      setLinkOpen={setLinkOpen}
    />
  )
}

const renderBar = (over: Partial<Given> = {}) => {
  const handlers = {
    setItems: vi.fn<Props['setItems']>(),
    setEditingId: vi.fn<Props['setEditingId']>(),
    duplicateSelected: vi.fn<Props['duplicateSelected']>(),
    toggleLock: vi.fn<Props['toggleLock']>(),
    removeSelected: vi.fn<Props['removeSelected']>(),
    setItemLink: vi.fn<Props['setItemLink']>(),
    startLinkPick: vi.fn<Props['startLinkPick']>(),
    followLink: vi.fn<Props['followLink']>()
  }
  render(
    <Bar
      floatingPos={{ left: 0, top: 0 }}
      floatingRef={null}
      single={null}
      arrowsSelected={false}
      items={notes}
      selectedIds={new Set(['a', 'b'])}
      {...handlers}
      {...over}
    />
  )
  return handlers
}

const button = (label: string) => screen.getByLabelText(label) as HTMLButtonElement

describe('WallSelectionBar', () => {
  it('recolours every selected item from one swatch, then closes it', () => {
    const { setItems } = renderBar()
    expect(screen.queryByLabelText('#f28b82')).toBeNull()

    fireEvent.click(button('Colour'))
    fireEvent.click(button('#f28b82'))

    expect(setItems).toHaveBeenCalledWith(patchItems(notes, new Set(['a', 'b']), { color: '#f28b82' }))
    expect(screen.queryByLabelText('#f28b82')).toBeNull()
  })

  it('reorders a single item, and not a selection of several', () => {
    renderBar()
    expect(button('Bring to front').disabled).toBe(true)
    expect(button('Send to back').disabled).toBe(true)
    cleanup()

    const { setItems } = renderBar({ single: notes[0], selectedIds: new Set(['a']) })
    fireEvent.click(button('Bring to front'))
    fireEvent.click(button('Send to back'))

    expect(setItems).toHaveBeenNthCalledWith(1, bringToFront(notes, 'a'))
    expect(setItems).toHaveBeenNthCalledWith(2, sendToBack(notes, 'a'))
  })

  it('shows the arrow styles only for arrows, and restyles the whole selection', () => {
    renderBar()
    expect(screen.queryByLabelText('Route: Straight')).toBeNull()
    cleanup()

    const arrows = [item('a', { kind: 'arrow' }), item('b', { kind: 'arrow' })]
    const both = new Set(['a', 'b'])
    const { setItems } = renderBar({ items: arrows, selectedIds: both, arrowsSelected: true })
    fireEvent.click(button('Route: Straight'))
    fireEvent.click(button('Line: Solid'))
    fireEvent.click(button('Heads: End'))

    expect(setItems).toHaveBeenNthCalledWith(1, patchItems(arrows, both, { arrowShape: 'curved' }))
    expect(setItems).toHaveBeenNthCalledWith(2, patchItems(arrows, both, { arrowLine: 'dashed' }))
    expect(setItems).toHaveBeenNthCalledWith(3, patchItems(arrows, both, { arrowHeads: 'both' }))
  })

  it('labels a single arrow, or edits the label it already has', () => {
    const arrow = item('a', { kind: 'arrow' })
    const { setEditingId } = renderBar({ items: [arrow], selectedIds: new Set(['a']), single: arrow, arrowsSelected: true })

    fireEvent.click(button('Add a label'))
    expect(setEditingId).toHaveBeenCalledWith('a')
    cleanup()

    const labelled = item('a', { kind: 'arrow', text: 'depends on' })
    renderBar({ items: [labelled], selectedIds: new Set(['a']), single: labelled, arrowsSelected: true })
    expect(button('Edit label')).toBeTruthy()
  })

  it('offers Unlock for a locked item, and leaves duplicating, locking and deleting to the Wall', () => {
    const locked = item('a', { locked: true })
    const handlers = renderBar({ items: [locked], selectedIds: new Set(['a']), single: locked })
    expect(screen.queryByLabelText('Lock')).toBeNull()

    fireEvent.click(button('Unlock'))
    fireEvent.click(button('Duplicate'))
    fireEvent.click(button('Delete'))

    expect(handlers.toggleLock).toHaveBeenCalledTimes(1)
    expect(handlers.duplicateSelected).toHaveBeenCalledTimes(1)
    expect(handlers.removeSelected).toHaveBeenCalledTimes(1)
  })

  it('links a single item from its link field, then closes the field', () => {
    const note = item('a')
    const { setItemLink } = renderBar({ items: [note], selectedIds: new Set(['a']), single: note })

    fireEvent.click(button('Add a link'))
    fireEvent.change(screen.getByLabelText('Link address'), { target: { value: 'example.com' } })
    fireEvent.click(screen.getByText('Save'))

    expect(setItemLink).toHaveBeenCalledWith('a', 'https://example.com/')
    expect(screen.queryByLabelText('Link address')).toBeNull()
  })

  it('hands Pick an item to the Wall for the selected item', () => {
    const note = item('a')
    const { startLinkPick } = renderBar({ items: [note], selectedIds: new Set(['a']), single: note })

    fireEvent.click(button('Add a link'))
    fireEvent.click(screen.getByText('Pick an item on this wall'))

    expect(startLinkPick).toHaveBeenCalledWith('a')
  })

  it('cycles the outline of every selected shape, and shows the button only for shapes', () => {
    renderBar()
    expect(screen.queryByLabelText('Shape: Rectangle')).toBeNull()
    cleanup()

    const shapes = [item('a', { kind: 'shape' }), item('b', { kind: 'shape', shape: 'oval' })]
    const both = new Set(['a', 'b'])
    const { setItems } = renderBar({ items: shapes, selectedIds: both })
    fireEvent.click(button('Shape: Rectangle'))

    expect(setItems).toHaveBeenCalledWith(patchItems(shapes, both, { shape: 'rounded' }))
  })

  it('keeps a locked item\'s link as it is, and offers none for several items or an arrow', () => {
    const locked = item('a', { locked: true, link: 'https://example.com/' })
    renderBar({ items: [locked], selectedIds: new Set(['a']), single: locked })
    expect(button('Edit link').disabled).toBe(true)
    cleanup()

    renderBar()
    expect(screen.queryByLabelText('Add a link')).toBeNull()
    cleanup()

    const arrow = item('a', { kind: 'arrow' })
    renderBar({ items: [arrow], selectedIds: new Set(['a']), single: arrow, arrowsSelected: true })
    expect(screen.queryByLabelText('Add a link')).toBeNull()
  })

  it('lines up and spaces out several items from the Align menu', () => {
    const wall = [
      item('a', { x: 0, y: 0, width: 100, height: 100 }),
      item('b', { x: 300, y: 40, width: 100, height: 100 }),
      item('c', { x: 900, y: 10, width: 100, height: 100 })
    ]
    const all = new Set(['a', 'b', 'c'])
    const { setItems } = renderBar({ items: wall, selectedIds: all })

    fireEvent.click(button('Align'))
    fireEvent.click(button('Align top edges'))
    fireEvent.click(button('Distribute horizontally'))

    expect(setItems).toHaveBeenNthCalledWith(1, alignItems(wall, all, 'top'))
    expect(setItems).toHaveBeenNthCalledWith(2, distributeItems(wall, all, 'horizontal'))
  })

  it('offers Align for two pieces or more, and spacing out for three', () => {
    const note = item('a', { x: 0, y: 0, width: 100, height: 100 })
    renderBar({ items: [note], selectedIds: new Set(['a']), single: note })
    expect(screen.queryByLabelText('Align')).toBeNull()
    cleanup()

    const pair = [note, item('b', { x: 300, y: 0, width: 100, height: 100 })]
    renderBar({ items: pair, selectedIds: new Set(['a', 'b']) })
    fireEvent.click(button('Align'))
    expect(button('Distribute horizontally').disabled).toBe(true)
  })

  it('cycles the text side of every selected item that holds words', () => {
    const { setItems } = renderBar()
    fireEvent.click(button('Text alignment: Left'))
    expect(setItems).toHaveBeenCalledWith(patchItems(notes, new Set(['a', 'b']), { align: 'center' }))
    cleanup()

    const arrows = [item('a', { kind: 'arrow' }), item('b', { kind: 'arrow' })]
    renderBar({ items: arrows, selectedIds: new Set(['a', 'b']), arrowsSelected: true })
    expect(screen.queryByLabelText(/^Text alignment/)).toBeNull()
  })

  it('styles a shape\'s border, corners and fill from the shape style panel', () => {
    const shapes = [item('a', { kind: 'shape', shape: 'rounded' })]
    const one = new Set(['a'])
    const { setItems } = renderBar({ items: shapes, selectedIds: one, single: shapes[0] })

    fireEvent.click(button('Shape style'))
    fireEvent.click(button('#f28b82'))
    expect(setItems).toHaveBeenLastCalledWith(patchItems(shapes, one, { borderColor: '#f28b82' }))

    fireEvent.change(screen.getByLabelText('Corner radius'), { target: { value: '20' } })
    expect(setItems).toHaveBeenLastCalledWith(patchItems(shapes, one, { radius: 20 }), { record: false })

    fireEvent.change(screen.getByLabelText('Fill opacity'), { target: { value: '40' } })
    expect(setItems).toHaveBeenLastCalledWith(patchItems(shapes, one, { opacity: 0.4 }), { record: false })
  })

  it('groups loose items, and ungroups a group', () => {
    const { setItems } = renderBar()
    fireEvent.click(button('Group'))
    const grouped = setItems.mock.calls[0][0]
    expect(new Set(grouped.filter(i => i.id !== 'c').map(i => i.group)).size).toBe(1)
    expect(grouped.find(i => i.id === 'a')?.group).toBeDefined()
    expect(grouped.find(i => i.id === 'c')?.group).toBeUndefined()
    cleanup()

    const pair = [item('a', { group: 'g' }), item('b', { group: 'g' })]
    const { setItems: again } = renderBar({ items: pair, selectedIds: new Set(['a', 'b']) })
    expect(screen.queryByLabelText('Group')).toBeNull()
    fireEvent.click(button('Ungroup'))
    expect(again).toHaveBeenCalledWith(ungroupItems(pair, new Set(['a', 'b'])))
  })
})
