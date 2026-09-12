import { VIEW_SHORTCUTS, type ShortcutBindings } from '../../lib/shortcuts'
import { panButtonLabel, type PanButtons, type MenuButton } from '../../lib/wallInput'

export const NUDGE = 4

/**
 * Everything the wall binds, written down somewhere it can be read.
 *
 * V, P and A have switched tools since the tools existed and the first person
 * to use the wall never found them. A tooltip only reaches someone already
 * pointing at the button, which is the one moment they do not need telling;
 * this is the list you open when you do not know what to point at yet.
 */
export const wallShortcutSections = (
  bindings: ShortcutBindings,
  panButtons: PanButtons,
  menuButton: MenuButton
): { group: string; rows: [string, string][] }[] => [
  {
    group: 'Tools',
    // Read from the bindings rather than written out, so the sheet cannot
    // disagree with what the keys actually do once someone changes one.
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
      // One row, because two rows both reading "Pan the wall" look like a
      // mistake rather than a choice. Both of these follow the settings, so
      // the sheet cannot end up describing buttons that do something else.
      [panButtonLabel(panButtons), 'Pan the wall'],
      ['Space + drag', 'Pan without putting the tool down'],
      ...(menuButton === 'none'
        ? []
        : [[menuButton === 'right' ? 'Right-click' : 'Middle-click',
            'Menu for what is under the pointer'] as [string, string]]),
      ['Wheel', 'Zoom where the pointer is'],
      ['Double-click', 'New sticky note, or open what was clicked'],
      ['Shift-click', 'Add to or take from the selection']
    ]
  },
  {
    group: 'Editing',
    rows: [
      ['Ctrl+Z', 'Undo'],
      ['Ctrl+Shift+Z', 'Redo'],
      [bindings.wall_duplicate || 'Unbound', 'Duplicate the selection'],
      ['Ctrl+A', 'Select everything unlocked'],
      // Both, because the bound one is a preference and Delete is a fact.
      [bindings.wall_delete ? `${bindings.wall_delete} or Delete` : 'Delete', 'Remove the selection'],
      ['Arrows', `Nudge by ${NUDGE}px`],
      ['Shift+Arrows', `Nudge by ${NUDGE * 5}px`]
    ]
  }
]
