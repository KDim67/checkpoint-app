// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { useWallKeys } from '../src/renderer/src/components/wall/useWallKeys'
import type { WallDocument } from '../src/renderer/src/components/wall/useWallDocument'
import type { WallPointer } from '../src/renderer/src/components/wall/useWallPointer'

afterEach(cleanup)

function createMockPointer(): WallPointer {
  return {
    fitToContent: vi.fn(),
    zoomBy: vi.fn(),
    zoomReset: vi.fn(),
    zoomToSelection: vi.fn(),
    exportWall: vi.fn(),
    screenPoint: vi.fn(() => ({ x: 0, y: 0 })),
    onWheel: vi.fn(),
    jumpTo: vi.fn(),
    arrowAt: vi.fn(() => null),
    onPointerDown: vi.fn(),
    onPointerMove: vi.fn(),
    onPointerLeave: vi.fn(),
    endDrag: vi.fn()
  } as unknown as WallPointer
}

function createMockDocument(overrides?: Partial<WallDocument>): WallDocument {
  const switchWall = vi.fn()
  const docRef = { current: { version: 1, camera: { x: 0, y: 0, zoom: 1 }, items: [] } }
  const selectedRef = { current: new Set<string>() }
  const historyRef = { current: { past: [], present: docRef.current, future: [] } }
  const panCameraRef = { current: null }
  const labelRef = { current: vi.fn(() => '') }

  return {
    toast: vi.fn(),
    doc: docRef.current,
    cards: [],
    notes: [],
    selectedIds: new Set<string>(),
    setSelectedIds: vi.fn(),
    editingId: null,
    setEditingId: vi.fn(),
    picker: null,
    setPicker: vi.fn(),
    menu: null,
    setMenu: vi.fn(),
    setTool: vi.fn(),
    setArrowFrom: vi.fn(),
    setArrowDrag: vi.fn(),
    query: '',
    historyTick: 0,
    setWallMenuOpen: vi.fn(),
    setRenaming: vi.fn(),
    setBgOpen: vi.fn(),
    setShortcutsOpen: vi.fn(),
    setSpaceHeld: vi.fn(),
    setSwatchOpen: vi.fn(),
    matchKey: vi.fn(() => null),
    viewportRef: { current: null },
    panCameraRef,
    labelRef,
    docRef,
    selectedRef,
    historyRef,
    cardsById: new Map(),
    selectedItems: [],
    single: undefined,
    arrowsSelected: false,
    setItems: vi.fn(),
    applyHistory: vi.fn(),
    addItem: vi.fn(),
    removeSelected: vi.fn(),
    duplicateSelected: vi.fn(),
    toggleLock: vi.fn(),
    placeDerived: vi.fn(),
    runImageOp: vi.fn(),
    openCard: vi.fn(),
    placeImageFiles: vi.fn(),
    setLinkPickFor: vi.fn(),
    setLinkOpen: vi.fn(),
    setItemLink: vi.fn(),
    addBookmark: vi.fn(),
    refreshPreview: vi.fn(),
    followLink: vi.fn(),
    copyItemLink: vi.fn(),
    pasteClip: vi.fn(),
    cutSelected: vi.fn(),
    copyStyle: vi.fn(),
    pasteStyle: vi.fn(),
    makeCards: vi.fn(),
    pasteCells: vi.fn(),
    searchKind: 'all',
    presenting: null,
    stepPresenting: vi.fn(),
    frameSelection: vi.fn(),
    startPresenting: vi.fn(),
    setFramesOpen: vi.fn(),
    setExportOpen: vi.fn(),
    setBinOpen: vi.fn(),
    openItem: vi.fn(),
    showItem: vi.fn(),
    gatherTags: vi.fn(),
    addMindMap: vi.fn(),
    tidyMap: vi.fn(),
    cropping: null,
    setCropping: vi.fn(),
    turnSelection: vi.fn(),
    setAlignOpen: vi.fn(),
    switchWall,
    ...overrides
  } as unknown as WallDocument
}

function TestComponent({ wallDoc, wallPtr }: { wallDoc: WallDocument; wallPtr: WallPointer }) {
  useWallKeys(wallDoc, wallPtr)
  return (
    <div>
      <input data-testid="test-input" />
      <textarea data-testid="test-textarea" />
      <div data-testid="test-editable" contentEditable />
    </div>
  )
}

describe('Wall Navigation Shortcuts & Mouse Side Buttons', () => {
  it('switches to next wall on PageDown key', () => {
    const wallDoc = createMockDocument()
    const wallPtr = createMockPointer()
    render(<TestComponent wallDoc={wallDoc} wallPtr={wallPtr} />)

    fireEvent.keyDown(window, { key: 'PageDown' })
    expect(wallDoc.switchWall).toHaveBeenCalledTimes(1)
    expect(wallDoc.switchWall).toHaveBeenCalledWith('next')
  })

  it('switches to prev wall on PageUp key', () => {
    const wallDoc = createMockDocument()
    const wallPtr = createMockPointer()
    render(<TestComponent wallDoc={wallDoc} wallPtr={wallPtr} />)

    fireEvent.keyDown(window, { key: 'PageUp' })
    expect(wallDoc.switchWall).toHaveBeenCalledTimes(1)
    expect(wallDoc.switchWall).toHaveBeenCalledWith('prev')
  })

  it('switches when matchKey resolves wall_next_wall or wall_prev_wall', () => {
    const wallDoc = createMockDocument({
      matchKey: vi.fn((e: KeyboardEvent | React.KeyboardEvent<Element>) => (e.key === 'n' ? 'wall_next_wall' : e.key === 'p' ? 'wall_prev_wall' : null))
    })
    const wallPtr = createMockPointer()
    render(<TestComponent wallDoc={wallDoc} wallPtr={wallPtr} />)

    fireEvent.keyDown(window, { key: 'n' })
    expect(wallDoc.switchWall).toHaveBeenCalledWith('next')

    fireEvent.keyDown(window, { key: 'p' })
    expect(wallDoc.switchWall).toHaveBeenCalledWith('prev')
  })

  it('does not switch wall when focus is inside an input, textarea, or contentEditable', () => {
    const wallDoc = createMockDocument()
    const wallPtr = createMockPointer()
    const { getByTestId } = render(<TestComponent wallDoc={wallDoc} wallPtr={wallPtr} />)

    const input = getByTestId('test-input')
    input.focus()
    fireEvent.keyDown(input, { key: 'PageDown' })
    expect(wallDoc.switchWall).not.toHaveBeenCalled()

    const textarea = getByTestId('test-textarea')
    textarea.focus()
    fireEvent.keyDown(textarea, { key: 'PageUp' })
    expect(wallDoc.switchWall).not.toHaveBeenCalled()

    const editable = getByTestId('test-editable')
    editable.focus()
    fireEvent.keyDown(editable, { key: 'PageDown' })
    expect(wallDoc.switchWall).not.toHaveBeenCalled()
  })

  it('does not switch wall on PageDown/PageUp while presenting frames', () => {
    const wallDoc = createMockDocument({ presenting: 0 })
    const wallPtr = createMockPointer()
    render(<TestComponent wallDoc={wallDoc} wallPtr={wallPtr} />)

    fireEvent.keyDown(window, { key: 'PageDown' })
    expect(wallDoc.switchWall).not.toHaveBeenCalled()
    expect(wallDoc.stepPresenting).toHaveBeenCalled()
  })

  it('switches to prev wall on mouse button 3 (Back) and next on button 4 (Forward)', () => {
    const wallDoc = createMockDocument()
    const wallPtr = createMockPointer()
    render(<TestComponent wallDoc={wallDoc} wallPtr={wallPtr} />)

    fireEvent.mouseUp(window, { button: 3 })
    expect(wallDoc.switchWall).toHaveBeenCalledWith('prev')

    fireEvent.mouseUp(window, { button: 4 })
    expect(wallDoc.switchWall).toHaveBeenCalledWith('next')
  })

  it('prevents default on pointerdown and auxclick for mouse buttons 3 and 4', () => {
    const wallDoc = createMockDocument()
    const wallPtr = createMockPointer()
    render(<TestComponent wallDoc={wallDoc} wallPtr={wallPtr} />)

    const pdEvent = new MouseEvent('pointerdown', { button: 3, cancelable: true })
    window.dispatchEvent(pdEvent)
    expect(pdEvent.defaultPrevented).toBe(true)

    const auxEvent = new MouseEvent('auxclick', { button: 4, cancelable: true })
    window.dispatchEvent(auxEvent)
    expect(auxEvent.defaultPrevented).toBe(true)
  })

  it('does not switch wall on mouse button 3/4 when a dialog is open', () => {
    const wallDoc = createMockDocument()
    const wallPtr = createMockPointer()
    render(
      <div>
        <TestComponent wallDoc={wallDoc} wallPtr={wallPtr} />
        <div role="dialog">Dialog content</div>
      </div>
    )

    fireEvent.mouseUp(window, { button: 3 })
    fireEvent.mouseUp(window, { button: 4 })
    expect(wallDoc.switchWall).not.toHaveBeenCalled()
  })
})
