import { VIEW_SHORTCUTS, type ShortcutBindings } from '../../lib/shortcuts'
import { panButtonLabel, type PanButtons, type MenuButton } from '../../lib/wallInput'

export const NUDGE = 4

/** the list you open before you know what to point at; tooltips only reach people already there */
export const wallShortcutSections = (
  bindings: ShortcutBindings,
  panButtons: PanButtons,
  menuButton: MenuButton
): { group: string; rows: [string, string][] }[] => [
  {
    group: 'Tools',
    // read from the bindings so the sheet can't disagree
    rows: [
      ...VIEW_SHORTCUTS
        .filter(s => s.scope === 'wall' && s.id.startsWith('wall_tool_') && bindings[s.id])
        .map(s => [bindings[s.id], s.label] as [string, string]),
      ['Esc', 'Back to select, and close whatever is open']
    ]
  },
  {
    group: 'Mouse',
    rows: [
      // one row, two "Pan the wall" rows look like a mistake; both follow settings
      [panButtonLabel(panButtons), 'Pan the wall'],
      ['Space + drag', 'Pan without putting the tool down'],
      ...(menuButton === 'none'
        ? []
        : [[menuButton === 'right' ? 'Right-click' : 'Middle-click',
            'Menu for what is under the pointer'] as [string, string]]),
      ['Wheel', 'Zoom where the pointer is'],
      ['Double-click', 'New sticky note, or open what was clicked'],
      ['Shift-click', 'Add to or take from the selection'],
      ['Alt+drag', 'Drag out a copy'],
      ['Ctrl+click', 'Follow an item\'s link, or an address in its text']
    ]
  },
  {
    group: 'Editing',
    rows: [
      ['Ctrl+Z', 'Undo'],
      ['Ctrl+Shift+Z', 'Redo'],
      [bindings.wall_duplicate || 'Unbound', 'Duplicate the selection'],
      [bindings.wall_link || 'Unbound', 'Link the selected item'],
      ['Ctrl+C, Ctrl+X, Ctrl+V', 'Copy, cut and paste under the pointer'],
      [bindings.wall_copy_style || 'Unbound', 'Copy style'],
      [bindings.wall_paste_style || 'Unbound', 'Paste style'],
      ['Ctrl+A', 'Select everything unlocked'],
      // the bound key is a preference, Delete is a fact
      [bindings.wall_delete ? `${bindings.wall_delete} or Delete` : 'Delete', 'Remove the selection'],
      ['Arrows', `Nudge by ${NUDGE}px`],
      ['Shift+Arrows', `Nudge by ${NUDGE * 5}px`]
    ]
  },
  {
    // while writing in a sticky or text box
    group: 'Text',
    rows: [
      ['Ctrl+B', 'Bold'],
      ['Ctrl+I', 'Italic'],
      ['Ctrl+Shift+X', 'Strikethrough'],
      ['Ctrl+E', 'Code'],
      ['- or 1. then Space', 'Start a list'],
      ['Tab or Shift+Tab', 'Indent or outdent a list item'],
      ['Esc or Ctrl+Enter', 'Finish writing']
    ]
  }
]
