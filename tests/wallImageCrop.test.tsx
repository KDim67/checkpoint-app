// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import WallImageCrop from '../src/renderer/src/components/wall/WallImageCrop'
import WallItemLayer from '../src/renderer/src/components/wall/WallItemLayer'
import type { ImageCrop, WallItem } from '../src/shared/wallModel'

afterEach(cleanup)

beforeAll(() => {
  HTMLElement.prototype.setPointerCapture = () => {}
  HTMLElement.prototype.releasePointerCapture = () => {}
})

const picture = (over: Partial<WallItem> = {}): WallItem =>
  ({ id: 'p', kind: 'image', ref: 'p.png', x: 0, y: 0, width: 400, height: 200, z: 0, ...over } as WallItem)

const open = (over: Partial<WallItem> = {}, zoom = 1) => {
  const onApply = vi.fn()
  const onCancel = vi.fn()
  const view = render(<WallImageCrop item={picture(over)} zoom={zoom} onApply={onApply} onCancel={onCancel} />)
  const frame = () => view.container.querySelector('.wall-crop-window') as HTMLElement
  const percent = (side: 'left' | 'top' | 'width' | 'height') => parseFloat(frame().style[side])
  return { ...view, onApply, onCancel, percent }
}

/** a grip pulled across the screen by this much */
const pull = (label: string, dx: number, dy: number, extra: { shiftKey?: boolean; release?: boolean } = {}) => {
  const grip = screen.getByLabelText(label)
  fireEvent.pointerDown(grip, { clientX: 100, clientY: 100, button: 0, pointerId: 1 })
  fireEvent.pointerMove(grip, { clientX: 100 + dx, clientY: 100 + dy, pointerId: 1, shiftKey: extra.shiftKey })
  if (extra.release !== false) fireEvent.pointerUp(grip, { pointerId: 1 })
}

describe('the crop window', () => {
  it('lays the whole picture out around the item where it lies, so nothing moves on opening', () => {
    const { container } = open({ width: 200, height: 150, crop: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 } })
    const whole = container.querySelector('.wall-crop') as HTMLElement
    expect([whole.style.left, whole.style.top, whole.style.width, whole.style.height]).toStrictEqual(['-100px', '-75px', '400px', '300px'])
  })

  it('follows the pointer in a turned picture\'s own directions, at the wall\'s zoom', () => {
    // turned a quarter, so moving down the screen pulls the right-hand edge outward; at zoom 2 by half as much
    const { percent } = open({ width: 200, height: 200, rotation: 90, crop: { x: 0, y: 0, w: 0.5, h: 1 } }, 2)
    pull('Crop edge e', 0, 40)
    expect(percent('width')).toBeCloseTo(55)
    expect(percent('height')).toBeCloseTo(100)
  })

  it('keeps the window\'s shape while Shift is held on a corner', () => {
    const free = open()
    pull('Crop edge se', -100, 0)
    expect([free.percent('width'), free.percent('height')]).toStrictEqual([75, 100])
    cleanup()

    const held = open()
    pull('Crop edge se', -100, 0, { shiftKey: true })
    expect(held.percent('width')).toBeCloseTo(75)
    expect(held.percent('height')).toBeCloseTo(75)
  })

  it('fits a chosen shape inside the window, and offers only corners while it holds', () => {
    const { percent } = open()
    fireEvent.click(screen.getByRole('button', { name: '1:1' }))
    expect([percent('left'), percent('width'), percent('height')]).toStrictEqual([25, 50, 100])
    expect(screen.queryByLabelText('Crop edge n')).toBeNull()
    expect(screen.getByLabelText('Crop edge ne')).not.toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Free' }))
    expect(screen.getByLabelText('Crop edge n')).not.toBeNull()
  })

  it('offers the upright shapes for an upright picture', () => {
    open({ width: 200, height: 400 })
    expect(screen.getByRole('button', { name: '3:4' })).not.toBeNull()
    expect(screen.getByRole('button', { name: '9:16' })).not.toBeNull()
  })

  it('shows the size kept in the picture\'s own pixels, and the thirds, only while dragging', () => {
    const { container } = open()
    const measuring = container.querySelector('img.is-hidden') as HTMLImageElement
    Object.defineProperty(measuring, 'naturalWidth', { value: 1600 })
    Object.defineProperty(measuring, 'naturalHeight', { value: 800 })
    fireEvent.load(measuring)

    pull('Crop edge se', -100, -50, { release: false })
    expect(container.querySelector('.wall-crop-size')?.textContent).toBe('1200 × 600 px')
    expect(container.querySelector('.wall-crop-grid')).not.toBeNull()

    fireEvent.pointerUp(screen.getByLabelText('Crop edge se'), { pointerId: 1 })
    expect(container.querySelector('.wall-crop-size')).toBeNull()
    expect(container.querySelector('.wall-crop-grid')).toBeNull()
  })
})

describe('leaving the crop window', () => {
  const square: ImageCrop = { x: 0.25, y: 0, w: 0.5, h: 1 }

  it('keeps the crop on a press anywhere else, before the wall acts on that press', () => {
    const { onApply } = open()
    fireEvent.click(screen.getByRole('button', { name: '1:1' }))

    // the wall listens below the document, as React does on its root
    const elsewhere = document.body.appendChild(document.createElement('div'))
    const keptFirst: boolean[] = []
    const wall = (): void => { keptFirst.push(onApply.mock.calls.length === 1) }
    document.body.addEventListener('pointerdown', wall)
    fireEvent.pointerDown(elsewhere, { button: 0 })
    document.body.removeEventListener('pointerdown', wall)
    elsewhere.remove()

    expect(keptFirst).toStrictEqual([true])
    expect(onApply).toHaveBeenCalledWith(square)
  })

  it('stays open for presses on itself and for a middle-button pan', () => {
    const { container, onApply, onCancel } = open()
    fireEvent.click(screen.getByRole('button', { name: '1:1' }))
    fireEvent.pointerDown(container.querySelector('.wall-crop-stage') as HTMLElement, { button: 0 })
    fireEvent.pointerDown(document.body, { button: 1 })
    expect(onApply).not.toHaveBeenCalled()
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('just closes when nothing was changed, so no undo step is spent', () => {
    const { onApply, onCancel } = open()
    fireEvent.keyDown(document.body, { key: 'Enter' })
    expect(onApply).not.toHaveBeenCalled()
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('keeps it on Enter, on Done and on a double-click, once', () => {
    const { container, onApply } = open()
    fireEvent.click(screen.getByRole('button', { name: '1:1' }))
    fireEvent.keyDown(document.body, { key: 'Enter' })
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    fireEvent.doubleClick(container.querySelector('.wall-crop-move') as HTMLElement)
    expect(onApply).toHaveBeenCalledTimes(1)
    expect(onApply).toHaveBeenCalledWith(square)
  })

  it('throws the change away on Esc, and the wall never sees that Esc', () => {
    const wallKeys = vi.fn()
    window.addEventListener('keydown', wallKeys)
    const { onApply, onCancel, unmount } = open()
    fireEvent.click(screen.getByRole('button', { name: '1:1' }))
    fireEvent.keyDown(document.body, { key: 'Escape' })
    unmount()
    window.removeEventListener('keydown', wallKeys)

    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onApply).not.toHaveBeenCalled()
    expect(wallKeys).not.toHaveBeenCalled()
  })

  it('keeps a changed window when it is closed some other way, and leaves an unchanged one alone', () => {
    const changed = open()
    fireEvent.click(screen.getByRole('button', { name: '1:1' }))
    changed.unmount()
    expect(changed.onApply).toHaveBeenCalledWith(square)

    const untouched = open()
    untouched.unmount()
    expect(untouched.onApply).not.toHaveBeenCalled()
    expect(untouched.onCancel).not.toHaveBeenCalled()
  })

  it('nudges the window with the arrows instead of moving the picture', () => {
    const wallKeys = vi.fn()
    window.addEventListener('keydown', wallKeys)
    const { percent } = open()
    fireEvent.click(screen.getByRole('button', { name: '1:1' }))
    fireEvent.keyDown(document.body, { key: 'ArrowRight', shiftKey: true })
    window.removeEventListener('keydown', wallKeys)

    // ten screen pixels of a 400 pixel picture
    expect(percent('left')).toBeCloseTo(27.5)
    expect(wallKeys).not.toHaveBeenCalled()
  })
})

describe('a picture being cropped', () => {
  it('hides its resize and turn handles, which sat on the crop\'s corners and resized it instead', () => {
    const photo = picture()
    const props = { item: photo, editing: false, connectable: false, showHandles: true, arrowTarget: false, arrowFrom: false, onTextChange: vi.fn(), onFinishEditing: vi.fn(), onFollowLink: vi.fn() }
    const selected = render(<WallItemLayer {...props} />)
    expect(selected.container.querySelectorAll('[data-wall-handle]').length).toBe(5)
    cleanup()

    const cropping = render(<WallItemLayer {...props} cropping zoom={1} onCrop={vi.fn()} />)
    expect(cropping.container.querySelector('.wall-crop')).not.toBeNull()
    expect(cropping.container.querySelectorAll('[data-wall-handle]').length).toBe(0)
  })
})
