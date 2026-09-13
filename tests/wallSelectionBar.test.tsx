// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import WallSelectionBar from '../src/renderer/src/components/wall/WallSelectionBar'
import { bringToFront, patchItems, sendToBack, type WallItem } from '../src/shared/wallModel'

afterEach(cleanup)

type Props = Parameters<typeof WallSelectionBar>[0]
type Given = Omit<Props, 'swatchOpen' | 'setSwatchOpen'>

const item = (id: string, over: Partial<WallItem> = {}): WallItem => ({ id, kind: 'note', z: 0, ...over } as WallItem)
const notes = [item('a', { z: 1 }), item('b', { z: 2 }), item('c', { z: 3 })]

/** the swatch toggles on Wall state */
function Bar(props: Given) {
  const [swatchOpen, setSwatchOpen] = useState(false)
  return <WallSelectionBar {...props} swatchOpen={swatchOpen} setSwatchOpen={setSwatchOpen} />
}

const renderBar = (over: Partial<Given> = {}) => {
  const handlers = {
    setItems: vi.fn<Props['setItems']>(),
    setEditingId: vi.fn<Props['setEditingId']>(),
    duplicateSelected: vi.fn<Props['duplicateSelected']>(),
    toggleLock: vi.fn<Props['toggleLock']>(),
    removeSelected: vi.fn<Props['removeSelected']>()
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
})
