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
type Given = Omit<Props, 'swatchOpen' | 'setSwatchOpen' | 'linkOpen' | 'setLinkOpen' | 'alignOpen' | 'setAlignOpen'>

const item = (id: string, over: Partial<WallItem> = {}): WallItem => ({ id, kind: 'note', z: 0, ...over } as WallItem)
const notes = [item('a', { z: 1 }), item('b', { z: 2 }), item('c', { z: 3 })]

/** the swatch and link field toggle on Wall state */
function Bar(props: Given) {
  const [swatchOpen, setSwatchOpen] = useState(false)
  const [linkOpen, setLinkOpen] = useState(false)
  const [alignOpen, setAlignOpen] = useState(false)
  return (
    <WallSelectionBar
      {...props}
      swatchOpen={swatchOpen}
      setSwatchOpen={setSwatchOpen}
      linkOpen={linkOpen}
      setLinkOpen={setLinkOpen}
      alignOpen={alignOpen}
      setAlignOpen={setAlignOpen}
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
    followLink: vi.fn<Props['followLink']>(),
    onAddTag: vi.fn<Props['onAddTag']>(),
    onRemoveTag: vi.fn<Props['onRemoveTag']>(),
    onGatherTags: vi.fn<Props['onGatherTags']>(),
    onCropImage: vi.fn<Props['onCropImage']>(),
    onTurn: vi.fn<Props['onTurn']>()
  }
  render(
    <Bar
      floatingPos={{ left: 0, top: 0 }}
      floatingRef={null}
      single={null}
      arrowsSelected={false}
      items={notes}
      selectedIds={new Set(['a', 'b'])}
      tagNames={['Bug', 'UI']}
      tagColors={new Map([['bug', '#f28b82']])}
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

  it('opens shape picker and updates outline of every selected shape, and shows button only for shapes', () => {
    renderBar()
    expect(screen.queryByLabelText('Shape')).toBeNull()
    cleanup()

    const shapes = [item('a', { kind: 'shape' }), item('b', { kind: 'shape', shape: 'oval' })]
    const both = new Set(['a', 'b'])
    const { setItems } = renderBar({ items: shapes, selectedIds: both })
    fireEvent.click(button('Shape'))

    fireEvent.click(screen.getByLabelText('Rounded Rectangle'))

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

  it('opens a font dropdown and picks a font for every selected item that holds words', () => {
    const { setItems } = renderBar()
    const fontBtn = button('Font: Sans')
    expect(fontBtn).toBeDefined()

    fireEvent.click(fontBtn)
    expect(screen.getByRole('menu', { name: 'Pick a font family' })).toBeDefined()
    expect(screen.getByRole('menuitem', { name: 'Serif' })).toBeDefined()
    expect(screen.getByRole('menuitem', { name: 'Mono' })).toBeDefined()
    expect(screen.getByRole('menuitem', { name: 'Handwritten' })).toBeDefined()
    expect(screen.getByRole('menuitem', { name: 'Rounded' })).toBeDefined()
    expect(screen.getByRole('menuitem', { name: 'Display' })).toBeDefined()
    expect(screen.getByRole('menuitem', { name: 'Typewriter' })).toBeDefined()
    expect(screen.getByRole('menuitem', { name: 'Comic' })).toBeDefined()

    fireEvent.click(screen.getByRole('menuitem', { name: 'Serif' }))
    expect(setItems).toHaveBeenCalledWith(patchItems(notes, new Set(['a', 'b']), { font: 'serif' }))
    expect(screen.queryByRole('menu', { name: 'Pick a font family' })).toBeNull()
    cleanup()

    const arrows = [item('a', { kind: 'arrow' }), item('b', { kind: 'arrow' })]
    renderBar({ items: arrows, selectedIds: new Set(['a', 'b']), arrowsSelected: true })
    expect(screen.queryByLabelText(/^Font:/)).toBeNull()
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

  it('tags stickies from the board\'s own names, takes a tag off, and gathers by tag', () => {
    const tagged = [item('a', { tags: ['Bug'] }), item('b')]
    const { onAddTag, onRemoveTag, onGatherTags } = renderBar({ items: tagged, selectedIds: new Set(['a', 'b']) })

    fireEvent.click(button('Tags'))
    // the board's other tag is offered, the one already on isn't
    fireEvent.click(screen.getByRole('button', { name: 'UI' }))
    expect(onAddTag).toHaveBeenCalledWith('UI')

    fireEvent.change(screen.getByLabelText('Add a tag'), { target: { value: 'bug' } })
    fireEvent.keyDown(screen.getByLabelText('Add a tag'), { key: 'Enter' })
    // typed in any case, the board's spelling is what goes on
    expect(onAddTag).toHaveBeenLastCalledWith('Bug')

    fireEvent.click(button('Remove the tag Bug'))
    expect(onRemoveTag).toHaveBeenCalledWith('Bug')

    fireEvent.click(screen.getByRole('button', { name: /Gather by tag/ }))
    expect(onGatherTags).toHaveBeenCalledTimes(1)
  })

  it('offers tags for stickies only, and a language for code blocks only', () => {
    renderBar({ items: [item('a', { kind: 'shape' })], selectedIds: new Set(['a']) })
    expect(screen.queryByLabelText('Tags')).toBeNull()
    expect(screen.queryByLabelText('Code language')).toBeNull()
    cleanup()

    const code = [item('a', { kind: 'code', language: 'python' })]
    const { setItems } = renderBar({ items: code, selectedIds: new Set(['a']), single: code[0] })
    expect(screen.queryByLabelText('Tags')).toBeNull()
    const picker = screen.getByLabelText('Code language') as HTMLSelectElement
    expect(picker.value).toBe('python')

    fireEvent.change(picker, { target: { value: 'rust' } })
    expect(setItems).toHaveBeenLastCalledWith(patchItems(code, new Set(['a']), { language: 'rust' }))

    fireEvent.change(picker, { target: { value: '' } })
    expect(setItems).toHaveBeenLastCalledWith(patchItems(code, new Set(['a']), { language: undefined }))
  })

  it('sets a text size on everything picked, from the list, typed or a point at a time, and goes back to fitting the box', () => {
    const { setItems } = renderBar()
    const size = screen.getByRole('combobox', { name: 'Size' }) as HTMLInputElement
    expect(size.placeholder).toBe('Fit')

    fireEvent.focus(size)
    fireEvent.click(button('24'))
    expect(setItems.mock.calls[0][0].filter(i => i.id !== 'c').every(i => i.fontSize === 24)).toBe(true)
    expect(setItems.mock.calls[0][0].find(i => i.id === 'c')?.fontSize).toBeUndefined()
    cleanup()

    const sized = [item('a', { fontSize: 24 })]
    const { setItems: again } = renderBar({ items: sized, selectedIds: new Set(['a']), single: sized[0] })
    const field = screen.getByRole('combobox', { name: 'Size' }) as HTMLInputElement
    expect(field.value).toBe('24')
    fireEvent.click(button('Bigger'))
    expect(again.mock.calls[0][0][0].fontSize).toBe(25)
    fireEvent.focus(field)
    fireEvent.change(field, { target: { value: '40' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(again.mock.calls[1][0][0].fontSize).toBe(40)
    fireEvent.focus(field)
    fireEvent.click(button('Fit to the box'))
    expect(again.mock.calls[2][0][0].fontSize).toBeUndefined()
  })

  it('shows the font by its name and sets it on every box, clearing fonts set on single words', () => {
    const boxes = [item('a', { kind: 'text', text: '[x]{font=mono}' })]
    const { setItems } = renderBar({ items: boxes, selectedIds: new Set(['a']), single: boxes[0] })
    fireEvent.click(button('Font: Sans'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Serif' }))
    expect(setItems.mock.calls[0][0][0]).toMatchObject({ font: 'serif', text: 'x' })
  })

  it('tells the wall the colour picked for stickies, so the next one takes it', () => {
    const onStickyColor = vi.fn()
    renderBar({ onStickyColor })
    fireEvent.click(button('Colour'))
    fireEvent.click(button('#f28b82'))
    expect(onStickyColor).toHaveBeenCalledWith('#f28b82')
    cleanup()

    const shapes = [item('a', { kind: 'shape' })]
    const shapeColor = vi.fn()
    renderBar({ items: shapes, selectedIds: new Set(['a']), onStickyColor: shapeColor })
    fireEvent.click(button('Colour'))
    fireEvent.click(button('#f28b82'))
    expect(shapeColor).not.toHaveBeenCalled()
  })

  it('offers cropping and a quarter turn on a single picture', () => {
    const picture = [item('a', { kind: 'image', ref: 'p.png' })]
    const { onCropImage, onTurn } = renderBar({ items: picture, selectedIds: new Set(['a']), single: picture[0] })

    fireEvent.click(button('Crop this picture'))
    expect(onCropImage).toHaveBeenCalledWith('a')

    fireEvent.click(button('Rotate a quarter turn'))
    expect(onTurn).toHaveBeenCalledWith(90)
    cleanup()

    renderBar({ items: picture, selectedIds: new Set(['a']), single: { ...picture[0], locked: true } })
    expect(screen.queryByLabelText('Crop this picture')).toBeNull()
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
