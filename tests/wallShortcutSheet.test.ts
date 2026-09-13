import { describe, it, expect } from 'vitest'
import { NUDGE, wallShortcutSections } from '../src/renderer/src/components/wall/wallShortcutSheet'
import type { MenuButton, PanButtons } from '../src/renderer/src/lib/wallInput'

const bindings = { wall_tool_select: 'V', wall_tool_draw: 'P', wall_tool_connect: '', wall_duplicate: '', wall_delete: 'Ctrl+D' }

const rowsOf = (group: string, panButtons: PanButtons = 'both', menuButton: MenuButton = 'right'): [string, string][] =>
  wallShortcutSections(bindings, panButtons, menuButton).find(s => s.group === group)?.rows ?? []

describe('keyboard rows', () => {
  it('lists moving round the wall by keyboard, and building a mind map', () => {
    expect(rowsOf('Keyboard')).toContainEqual(['Tab or Shift+Tab', 'Select the next or previous item'])
    expect(rowsOf('Keyboard')).toContainEqual(['Ctrl+Arrows', 'Select the nearest item that way'])
    expect(rowsOf('Keyboard')).toContainEqual(['Enter', 'Write in or open the selected item'])
    expect(rowsOf('Mind map')).toContainEqual(['Tab', 'Add a topic under this one'])
    expect(rowsOf('Mind map')).toContainEqual(['Enter', 'Add a topic beside this one'])
  })
})

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

  it('lists copying: the clipboard keys, alt-drag, and the style keys unbound when they are', () => {
    expect(rowsOf('Editing')).toContainEqual(['Ctrl+C, Ctrl+X, Ctrl+V', 'Copy, cut and paste under the pointer'])
    expect(rowsOf('Editing')).toContainEqual(['Unbound', 'Copy style'])
    expect(rowsOf('Mouse')).toContainEqual(['Alt+drag', 'Drag out a copy'])
    expect(
      wallShortcutSections({ ...bindings, wall_paste_style: 'Ctrl+Alt+V' }, 'both', 'right')
        .find(s => s.group === 'Editing')?.rows
    ).toContainEqual(['Ctrl+Alt+V', 'Paste style'])
  })

  it('lists grouping, picking one item out of a group, and moving past the guides', () => {
    expect(rowsOf('Editing')).toContainEqual(['Unbound', 'Group, or ungroup a group'])
    expect(rowsOf('Mouse')).toContainEqual(['Click a grouped item again', 'Pick just that item out of its group'])
    expect(rowsOf('Mouse')).toContainEqual(['Ctrl while dragging', 'Move without lining up on other items'])
    expect(
      wallShortcutSections({ ...bindings, wall_ungroup: 'Ctrl+Shift+G' }, 'both', 'right')
        .find(s => s.group === 'Editing')?.rows
    ).toContainEqual(['Ctrl+Shift+G', 'Ungroup'])
  })

  it('lists zooming, the new drawing tools, and the keys for presenting', () => {
    expect(rowsOf('View')).toContainEqual(['Unbound', 'Zoom in'])
    const sections = wallShortcutSections({ ...bindings, wall_zoom_selection: 'Alt+2', wall_tool_erase: 'E' }, 'both', 'right')
    expect(sections.find(s => s.group === 'View')?.rows).toContainEqual(['Alt+2', 'Zoom to the selection'])
    expect(sections.find(s => s.group === 'Tools')?.rows).toContainEqual(['E', 'Eraser'])
    expect(rowsOf('Presenting')).toContainEqual(['Esc', 'Stop presenting'])
  })

  it('lists underlining and duplicating with Alt and the arrows', () => {
    expect(rowsOf('Text')).toContainEqual(['Ctrl+U', 'Underline'])
    expect(rowsOf('Editing')).toContainEqual(['Alt+Arrows', 'Duplicate beside the selection'])
  })

  it('lists the quick ways to add the next item', () => {
    expect(rowsOf('Mouse')).toContainEqual(['Click a connect dot', 'Add the next item on that side, joined by an arrow'])
    expect(rowsOf('Text')).toContainEqual(['Tab or Shift+Tab', 'Next item beside or below, outside a list'])
    expect(rowsOf('Editing')).toContainEqual(['Ctrl+V', 'Paste spreadsheet cells, a sticky each'])
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
