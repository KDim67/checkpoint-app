import type React from 'react'
import type { ActiveView } from '../store/appStore'
import { getStringSetting, setStringSetting } from './settings'

/**
 * In-app keyboard shortcuts. Distinct from the global OS-level hotkeys in
 * customizer/HotkeyBinder: those need the customization engine running and are
 * registered with Electron, these only fire while the window has focus.
 */
export type ShortcutAction =
  | { kind: 'view'; view: ActiveView }
  | { kind: 'toggleAiPanel' }
  | { kind: 'openSettings' }

export interface AppShortcut {
  id: string
  label: string
  defaultCombo: string
  action: ShortcutAction
}

/**
 * The digits run down the sidebar: first view is Ctrl+1, tenth is Ctrl+0.
 *
 * That rule is the point. Wall used to be Ctrl+9 while sitting sixth, because
 * when it was added it took the next free digit rather than renumbering the
 * views below it, and every view added afterwards would have made the list
 * less predictable still. Following the order costs a remap once; not
 * following it costs a little more confusion with every release.
 *
 * There are eleven views and ten digits, so the last one gets a letter.
 *
 * A remap only reaches people who never changed their shortcuts: loadBindings
 * merges a saved binding over the default, so anything customised is kept.
 */
export const APP_SHORTCUTS: AppShortcut[] = [
  { id: 'view_log',         label: 'Go to Log',         defaultCombo: 'Ctrl+1', action: { kind: 'view', view: 'log' } },
  { id: 'view_kanban',      label: 'Go to Kanban',      defaultCombo: 'Ctrl+2', action: { kind: 'view', view: 'kanban' } },
  { id: 'view_backlog',     label: 'Go to Backlog',     defaultCombo: 'Ctrl+3', action: { kind: 'view', view: 'backlog' } },
  { id: 'view_focus',       label: 'Go to Focus',       defaultCombo: 'Ctrl+4', action: { kind: 'view', view: 'focus' } },
  { id: 'view_notes',       label: 'Go to Notes',       defaultCombo: 'Ctrl+5', action: { kind: 'view', view: 'notes' } },
  { id: 'view_wall',        label: 'Go to Wall',        defaultCombo: 'Ctrl+6', action: { kind: 'view', view: 'wall' } },
  { id: 'view_clipboard',   label: 'Go to Clipboard',   defaultCombo: 'Ctrl+7', action: { kind: 'view', view: 'clipboard' } },
  { id: 'view_cookbook',    label: 'Go to Cookbook',    defaultCombo: 'Ctrl+8', action: { kind: 'view', view: 'cookbook' } },
  { id: 'view_analytics',   label: 'Go to Analytics',   defaultCombo: 'Ctrl+9', action: { kind: 'view', view: 'analytics' } },
  { id: 'view_cheatsheets', label: 'Go to Cheatsheets', defaultCombo: 'Ctrl+0', action: { kind: 'view', view: 'cheatsheets' } },
  // The eleventh view, and the digits are gone. G for Game Dev.
  { id: 'view_gamedev',     label: 'Go to Game Dev',    defaultCombo: 'Ctrl+G', action: { kind: 'view', view: 'gamedev' } },
  { id: 'toggle_ai_panel',  label: 'Toggle AI panel',   defaultCombo: 'Ctrl+L', action: { kind: 'toggleAiPanel' } },
  { id: 'open_settings',    label: 'Open Settings',     defaultCombo: 'Ctrl+,', action: { kind: 'openSettings' } }
]

/**
 * Which view a command belongs to.
 *
 * The list above is global: those fire wherever you are. Everything below is
 * only meaningful while one view is on screen, and since two views are never
 * on screen together the same key can mean different things in each. D logs a
 * distraction in Focus and ticks a due date on a kanban card, and neither
 * shadows the other. Without scope those two would have to fight over a letter
 * that has an obvious meaning in both places.
 */
export type ShortcutScope = 'wall' | 'kanban' | 'focus'

export interface ViewShortcut {
  id: string
  label: string
  scope: ShortcutScope
  defaultCombo: string
}

export const SCOPE_LABELS: Record<ShortcutScope, string> = {
  wall: 'Wall',
  kanban: 'Kanban card',
  focus: 'Focus timer'
}

/**
 * The view commands that are a preference rather than a convention.
 *
 * Deliberately absent: undo, redo, select all, save, delete-closes, Escape,
 * Enter to activate whatever has focus, and the arrow keys. Those are things
 * the whole desktop agrees on, and several of them are in RESERVED_COMBOS, so
 * offering them here would be a one-way door: change one and the binder would
 * refuse to give it back.
 */
export const VIEW_SHORTCUTS: ViewShortcut[] = [
  { id: 'wall_tool_select',      label: 'Select',                  scope: 'wall',   defaultCombo: 'V' },
  { id: 'wall_tool_draw',        label: 'Draw',                    scope: 'wall',   defaultCombo: 'P' },
  { id: 'wall_tool_connect',     label: 'Connect two items',       scope: 'wall',   defaultCombo: 'A' },
  { id: 'wall_duplicate',        label: 'Duplicate the selection', scope: 'wall',   defaultCombo: 'Ctrl+D' },

  { id: 'kanban_focus_session',  label: 'Start a focus session',   scope: 'kanban', defaultCombo: 'Space' },
  { id: 'kanban_open_details',   label: 'Open the card',           scope: 'kanban', defaultCombo: 'E' },
  { id: 'kanban_toggle_due',     label: 'Tick off the due date',   scope: 'kanban', defaultCombo: 'D' },
  { id: 'kanban_toggle_template', label: 'Mark as a template',     scope: 'kanban', defaultCombo: 'T' },
  { id: 'kanban_archive',        label: 'Archive the card',        scope: 'kanban', defaultCombo: 'C' },
  { id: 'kanban_toggle_done',    label: 'Mark done',               scope: 'kanban', defaultCombo: 'X' },

  { id: 'focus_toggle_timer',    label: 'Start or pause',          scope: 'focus',  defaultCombo: 'Space' },
  { id: 'focus_log_distraction', label: 'Log a distraction',       scope: 'focus',  defaultCombo: 'D' },
  { id: 'focus_reset',           label: 'Reset the timer',         scope: 'focus',  defaultCombo: 'R' }
]

/**
 * Combos the binder will not accept, because the OS or the web platform has
 * already spoken for them. Kept here rather than in the settings panel so the
 * defaults above can be tested against it.
 */
export const RESERVED_COMBOS = [
  'Ctrl+C', 'Ctrl+V', 'Ctrl+X', 'Ctrl+A', 'Ctrl+Z', 'Ctrl+Y', 'Ctrl+S',
  'Cmd+C', 'Cmd+V', 'Cmd+X', 'Cmd+A', 'Cmd+Z', 'Cmd+Y', 'Cmd+S',
  'Alt+F4', 'Ctrl+Alt+Delete'
]

export function isReservedCombo(combo: string): boolean {
  return RESERVED_COMBOS.includes(combo)
}

export type ShortcutBindings = Record<string, string>

const SETTING_KEY = 'app_shortcuts'
const VIEW_SETTING_KEY = 'view_shortcuts'

export function defaultBindings(): ShortcutBindings {
  return Object.fromEntries(APP_SHORTCUTS.map(s => [s.id, s.defaultCombo]))
}

export async function loadBindings(): Promise<ShortcutBindings> {
  const bindings = defaultBindings()
  try {
    const raw = await getStringSetting(SETTING_KEY, '')
    if (!raw) return bindings
    const saved = JSON.parse(raw) as ShortcutBindings
    // Merged rather than replaced, so shortcuts added in a later version pick
    // up their default instead of being unbound for existing users.
    for (const shortcut of APP_SHORTCUTS) {
      if (typeof saved[shortcut.id] === 'string') bindings[shortcut.id] = saved[shortcut.id]
    }
  } catch (err) {
    console.error('Failed to parse saved shortcuts:', err)
  }
  return bindings
}

export function defaultViewBindings(): ShortcutBindings {
  return Object.fromEntries(VIEW_SHORTCUTS.map(s => [s.id, s.defaultCombo]))
}

export async function loadViewBindings(): Promise<ShortcutBindings> {
  const bindings = defaultViewBindings()
  try {
    const raw = await getStringSetting(VIEW_SETTING_KEY, '')
    if (!raw) return bindings
    const saved = JSON.parse(raw) as ShortcutBindings
    // Merged, not replaced, for the same reason as the global list: a command
    // added in a later version arrives on its default rather than unbound.
    for (const shortcut of VIEW_SHORTCUTS) {
      if (typeof saved[shortcut.id] === 'string') bindings[shortcut.id] = saved[shortcut.id]
    }
  } catch (err) {
    console.error('Failed to parse saved view shortcuts:', err)
  }
  return bindings
}

export async function saveViewBindings(bindings: ShortcutBindings): Promise<void> {
  await setStringSetting(VIEW_SETTING_KEY, JSON.stringify(bindings))
  window.dispatchEvent(new CustomEvent('settings-update-shortcuts'))
}

/**
 * Which command in this scope the press is bound to, or null.
 *
 * One call per keydown, so a view never has to know what a binding currently
 * is. It used to compare `e.key` against a letter written into the handler,
 * which is exactly what made these unchangeable.
 */
export function commandForEvent(
  e: KeyboardEvent | React.KeyboardEvent,
  scope: ShortcutScope,
  bindings: ShortcutBindings
): string | null {
  const combo = comboFromEvent(e)
  if (!combo) return null
  for (const shortcut of VIEW_SHORTCUTS) {
    if (shortcut.scope !== scope) continue
    const bound = bindings[shortcut.id]
    // An empty binding is a command someone has deliberately unbound.
    if (bound && bound === combo) return shortcut.id
  }
  return null
}

/**
 * The label of whatever already owns this combo, or null when it is free.
 *
 * A view command is checked against its own scope and against the global list,
 * never against another view. The globals fire wherever you are, so sharing
 * with one would double-fire; two views are never on screen together, so
 * sharing between them costs nothing.
 */
export function shortcutClash(
  combo: string,
  target: { id: string; scope: ShortcutScope | 'global' },
  appBindings: ShortcutBindings,
  viewBindings: ShortcutBindings
): string | null {
  const global = APP_SHORTCUTS.find(s => s.id !== target.id && appBindings[s.id] === combo)
  if (global) return global.label

  const view = VIEW_SHORTCUTS.find(s =>
    s.id !== target.id &&
    (target.scope === 'global' || s.scope === target.scope) &&
    viewBindings[s.id] === combo)
  return view ? view.label : null
}

export async function saveBindings(bindings: ShortcutBindings): Promise<void> {
  await setStringSetting(SETTING_KEY, JSON.stringify(bindings))
  window.dispatchEvent(new CustomEvent('settings-update-shortcuts'))
}

/**
 * Renders a keyboard event as the same "Ctrl+Shift+V" string the global hotkey
 * binder produces, so one format covers both and a combo reads the same
 * wherever it is displayed.
 */
export function comboFromEvent(e: KeyboardEvent | React.KeyboardEvent): string | null {
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return null

  const modifiers: string[] = []
  if (e.ctrlKey) modifiers.push('Ctrl')
  if (e.altKey) modifiers.push('Alt')
  if (e.shiftKey) modifiers.push('Shift')
  if (e.metaKey) modifiers.push('Cmd')

  let key = e.key
  if (key === ' ') {
    key = 'Space'
  } else if (key.length === 1) {
    key = key.toUpperCase()
  } else if (key.startsWith('Arrow')) {
    key = key.replace('Arrow', '')
  }

  return [...modifiers, key].join('+')
}

/**
 * True while the caret is somewhere the user is typing. Without this a plain
 * shortcut, or Ctrl+L in a textarea, fires mid-sentence.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el || !el.tagName) return false
  const tag = el.tagName.toLowerCase()
  return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable
}
