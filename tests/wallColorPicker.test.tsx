// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import WallColorPicker from '../src/renderer/src/components/wall/WallColorPicker'

afterEach(cleanup)

const COLORS = ['#f28b82', '#fbbc04']

const open = (over: Parameters<typeof WallColorPicker>[0] extends infer P ? Partial<P> : never = {}) => {
  const onChange = vi.fn()
  const onCommit = vi.fn()
  const onDone = vi.fn()
  render(<WallColorPicker colors={COLORS} onChange={onChange} onCommit={onCommit} onDone={onDone} {...over} />)
  return { onChange, onCommit, onDone }
}

describe('picking a colour on the wall', () => {
  it('paints, records and closes in one go when a swatch is clicked', () => {
    const { onChange, onCommit, onDone } = open()

    fireEvent.click(screen.getByLabelText('#f28b82'))

    expect(onChange).toHaveBeenCalledWith('#f28b82')
    expect(onCommit).toHaveBeenCalledWith('#f28b82')
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('keeps the custom picker open while a colour is dragged out, and records it on release', () => {
    const { onChange, onCommit, onDone } = open()

    fireEvent.click(screen.getByLabelText('Custom colour'))
    const square = screen.getByLabelText('Saturation and brightness')
    square.setPointerCapture = () => {}
    square.releasePointerCapture = () => {}

    fireEvent.pointerDown(square, { clientX: 10, clientY: 10, pointerId: 1 })
    fireEvent.pointerMove(square, { clientX: 40, clientY: 20, pointerId: 1 })
    fireEvent.pointerUp(square, { pointerId: 1 })

    expect(onChange).toHaveBeenCalled()
    expect(onCommit).toHaveBeenCalledTimes(1)
    // the gesture is still going, so whatever opened this must not close it
    expect(onDone).not.toHaveBeenCalled()
    expect(screen.queryByLabelText('Saturation and brightness')).not.toBeNull()
  })

  it('keeps a press inside the custom picker away from the outside-click closers above it', () => {
    const closed = vi.fn()
    document.addEventListener('pointerdown', closed)
    try {
      open()
      fireEvent.click(screen.getByLabelText('Custom colour'))
      const square = screen.getByLabelText('Saturation and brightness')
      square.setPointerCapture = () => {}

      fireEvent.pointerDown(square, { clientX: 10, clientY: 10, pointerId: 1 })

      expect(closed).not.toHaveBeenCalled()
    } finally {
      document.removeEventListener('pointerdown', closed)
    }
  })

  it('still lets a press outside it through, so those closers work', () => {
    const closed = vi.fn()
    document.addEventListener('pointerdown', closed)
    try {
      open()
      fireEvent.pointerDown(document.body)
      expect(closed).toHaveBeenCalled()
    } finally {
      document.removeEventListener('pointerdown', closed)
    }
  })

  it('previews colour on swatch hover without committing, and restores initial on mouse leave', () => {
    const { onChange, onCommit, onDone } = open({ value: '#f28b82' })
    const yellow = screen.getByLabelText('#fbbc04')
    const container = yellow.closest('.col-6px') as HTMLElement

    fireEvent.pointerEnter(yellow)
    expect(onChange).toHaveBeenCalledWith('#fbbc04')
    expect(onCommit).not.toHaveBeenCalled()
    expect(onDone).not.toHaveBeenCalled()

    fireEvent.pointerLeave(container)
    expect(onChange).toHaveBeenLastCalledWith('#f28b82')
    expect(onCommit).not.toHaveBeenCalled()
    expect(onDone).not.toHaveBeenCalled()
  })

  it('does not close or commit on default option hover, and only closes on click', () => {
    const onDefault = vi.fn()
    const { onDone } = open({ defaultLabel: 'Follow the theme', onDefault })
    const defBtn = screen.getByText('Follow the theme')

    fireEvent.mouseEnter(defBtn)
    expect(onDefault).toHaveBeenCalled()
    expect(onDone).not.toHaveBeenCalled()

    fireEvent.click(defBtn)
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('maintains the checkmark on the committed swatch while hovering another swatch', () => {
    open({ value: '#f28b82' })
    const red = screen.getByLabelText('#f28b82')
    const yellow = screen.getByLabelText('#fbbc04')

    expect(red.getAttribute('aria-pressed')).toBe('true')
    expect(red.querySelector('svg')).not.toBeNull()
    expect(yellow.getAttribute('aria-pressed')).toBe('false')
    expect(yellow.querySelector('svg')).toBeNull()

    // Hover over yellow swatch
    fireEvent.pointerEnter(yellow)

    // Red swatch must retain its checkmark and committed selected state
    expect(red.getAttribute('aria-pressed')).toBe('true')
    expect(red.querySelector('svg')).not.toBeNull()
    expect(yellow.getAttribute('aria-pressed')).toBe('false')
    expect(yellow.querySelector('svg')).toBeNull()

    // Clicking yellow swatch commits it
    fireEvent.click(yellow)
    expect(yellow.getAttribute('aria-pressed')).toBe('true')
    expect(yellow.querySelector('svg')).not.toBeNull()
    expect(red.getAttribute('aria-pressed')).toBe('false')
    expect(red.querySelector('svg')).toBeNull()
  })

  it('keeps checkmark on committed color when hovering default option', () => {
    const onDefault = vi.fn()
    open({ value: '#f28b82', defaultLabel: 'Follow the theme', onDefault })
    const red = screen.getByLabelText('#f28b82')
    const defBtn = screen.getByText('Follow the theme').closest('button') as HTMLElement

    expect(red.getAttribute('aria-pressed')).toBe('true')
    expect(defBtn.getAttribute('aria-pressed')).toBe('false')

    fireEvent.pointerEnter(defBtn)
    expect(onDefault).toHaveBeenCalled()
    // Red retains checkmark
    expect(red.getAttribute('aria-pressed')).toBe('true')
    expect(red.querySelector('svg')).not.toBeNull()
    expect(defBtn.getAttribute('aria-pressed')).toBe('false')
  })
})
