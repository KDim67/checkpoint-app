import { describe, it, expect } from 'vitest'
import { NUDGE, wallShortcutSections } from '../src/renderer/src/components/wall/wallShortcutSheet'
import type { MenuButton, PanButtons } from '../src/renderer/src/lib/wallInput'

const bindings = { wall_tool_select: 'V', wall_tool_draw: 'P', wall_tool_connect: '', wall_duplicate: '', wall_delete: 'Ctrl+D' }

const rowsOf = (group: string, panButtons: PanButtons = 'both', menuButton: MenuButton = 'right'): [string, string][] =>
  wallShortcutSections(bindings, panButtons, menuButton).find(s => s.group === group)?.rows ?? []

describe('wallShortcutSections', () => {
  it('lists the tools that are bound, under the keys they are bound to', () => {
    expect(rowsOf('Tools')).toContainEqual(['V', 'Select'])
    expect(rowsOf('Tools')).toContainEqual(['P', 'Draw'])
    expect(rowsOf('Tools').some(([, what]) => what === 'Connect two items')).toBe(false)
  })

  it('names the pan buttons the settings chose', () => {
    expect(rowsOf('Mouse', 'middle')).toContainEqual(['Middle-drag', 'Pan the wall'])
  })

  it('leaves the menu row out when no button opens the menu', () => {
    expect(rowsOf('Mouse', 'both', 'none').some(([, what]) => what === 'Menu for what is under the pointer')).toBe(false)
    expect(rowsOf('Mouse', 'both', 'middle')).toContainEqual(['Middle-click', 'Menu for what is under the pointer'])
  })

  it('lists following a link with Ctrl+click and the link key, unbound when it is', () => {
    expect(rowsOf('Mouse')).toContainEqual(['Ctrl+click', 'Follow an item\'s link, or an address in its text'])
    expect(rowsOf('Editing')).toContainEqual(['Unbound', 'Link the selected item'])
    expect(
      wallShortcutSections({ ...bindings, wall_link: 'Ctrl+K' }, 'both', 'right')
        .find(s => s.group === 'Editing')?.rows
    ).toContainEqual(['Ctrl+K', 'Link the selected item'])
  })

  it('lists the formatting keys for writing in a sticky or text box', () => {
    expect(rowsOf('Text')).toContainEqual(['Ctrl+B', 'Bold'])
    expect(rowsOf('Text')).toContainEqual(['Ctrl+I', 'Italic'])
    expect(rowsOf('Text')).toContainEqual(['Esc or Ctrl+Enter', 'Finish writing'])
  })

  it('calls an unbound duplicate unbound, and keeps Delete beside a bound delete', () => {
    expect(rowsOf('Editing')).toContainEqual(['Unbound', 'Duplicate the selection'])
    expect(rowsOf('Editing')).toContainEqual(['Ctrl+D or Delete', 'Remove the selection'])
    expect(rowsOf('Editing')).toContainEqual(['Arrows', `Nudge by ${NUDGE}px`])
  })
})
