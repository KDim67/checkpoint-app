// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import RowMenu from '../src/renderer/src/components/ui/RowMenu'

// a row's ⋯ menu from the keyboard and the mouse, and the row underneath never hearing it

afterEach(cleanup)

function setup() {
  const edit = vi.fn()
  const remove = vi.fn()
  const row = { click: vi.fn(), key: vi.fn() }
  render(
    <div onClick={row.click} onKeyDown={row.key}>
      <RowMenu
        label="More for Work"
        trigger="⋯"
        entries={[
          { label: 'Rename', onSelect: edit },
          { label: 'Export', onSelect: vi.fn() },
          { label: 'Remove', onSelect: remove, danger: true }
        ]}
      />
    </div>
  )
  return { edit, remove, row, trigger: screen.getByRole('button', { name: 'More for Work' }) }
}

const items = (): HTMLElement[] => screen.getAllByRole('menuitem')

describe('the row menu', () => {
  it('opens onto its first item, and the arrows go round', () => {
    const { trigger } = setup()
    fireEvent.click(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(document.activeElement).toBe(items()[0])
    fireEvent.keyDown(items()[0], { key: 'ArrowUp' })
    expect(document.activeElement).toBe(items()[2])
    fireEvent.keyDown(items()[2], { key: 'ArrowDown' })
    expect(document.activeElement).toBe(items()[0])
    fireEvent.keyDown(items()[0], { key: 'End' })
    expect(document.activeElement).toBe(items()[2])
  })

  it('opens onto the last item from the keyboard with the up arrow', () => {
    const { trigger } = setup()
    fireEvent.keyDown(trigger, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(items()[2])
  })

  it('closes on Escape and hands the focus back to its button', () => {
    const { trigger } = setup()
    fireEvent.click(trigger)
    fireEvent.keyDown(items()[0], { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('runs a choice, closes, and the row underneath hears neither the click nor the keys', () => {
    const { trigger, edit, row } = setup()
    fireEvent.click(trigger)
    fireEvent.keyDown(items()[0], { key: 'ArrowDown' })
    fireEvent.click(items()[0])
    expect(edit).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('menu')).toBeNull()
    expect(row.click).not.toHaveBeenCalled()
    expect(row.key).not.toHaveBeenCalled()
  })

  it('sets a dangerous choice apart', () => {
    const { trigger } = setup()
    fireEvent.click(trigger)
    expect(screen.getByRole('separator')).toBeTruthy()
    expect(items()[2].className).toContain('row-menu-item-danger')
  })

  it('closes on a click outside it', () => {
    const { trigger } = setup()
    fireEvent.click(trigger)
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('menu')).toBeNull()
  })
})
