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
      ['Click a grouped item again', 'Pick just that item out of its group'],
      ['Ctrl while dragging', 'Move without lining up on other items'],
      ['Click a connect dot', 'Add the next item on that side, joined by an arrow'],
      ['Ctrl+click', 'Follow an item\'s link, or an address in its text']
    ]
  },
  {
    group: 'View',
    rows: [
      [bindings.wall_zoom_in || 'Unbound', 'Zoom in'],
      [bindings.wall_zoom_out || 'Unbound', 'Zoom out'],
      [bindings.wall_zoom_reset || 'Unbound', 'Zoom to 100%'],
      [bindings.wall_zoom_fit || 'Unbound', 'Fit everything in view'],
      [bindings.wall_zoom_selection || 'Unbound', 'Zoom to the selection']
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
      ['Ctrl+V', 'Paste spreadsheet cells, a sticky each'],
      [bindings.wall_copy_style || 'Unbound', 'Copy style'],
      [bindings.wall_paste_style || 'Unbound', 'Paste style'],
      [bindings.wall_group || 'Unbound', 'Group, or ungroup a group'],
      [bindings.wall_ungroup || 'Unbound', 'Ungroup'],
      ['Ctrl+A', 'Select everything unlocked'],
      // the bound key is a preference, Delete is a fact
      [bindings.wall_delete ? `${bindings.wall_delete} or Delete` : 'Delete', 'Remove the selection'],
      ['Arrows', `Nudge by ${NUDGE}px`],
      ['Shift+Arrows', `Nudge by ${NUDGE * 5}px`],
      ['Alt+Arrows', 'Duplicate beside the selection']
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
      ['Ctrl+U', 'Underline'],
      ['- or 1. then Space', 'Start a list'],
      ['Tab or Shift+Tab', 'Indent or outdent a list item'],
      ['Tab or Shift+Tab', 'Next item beside or below, outside a list'],
      ['Esc or Ctrl+Enter', 'Finish writing']
    ]
  },
  {
    // started from the Frames menu or a frame's right-click menu
    group: 'Presenting',
    rows: [
      ['Right, Down or Space', 'Next frame'],
      ['Left or Up', 'Previous frame'],
      ['Home or End', 'First or last frame'],
      ['Esc', 'Stop presenting']
    ]
  }
]
