import type React from 'react'
import type { ActiveView } from '../store/appStore'
import { getStringSetting, setStringSetting } from './settings'

/** in-app only, fire while focused; OS-level hotkeys live in customizer/HotkeyBinder */
type ShortcutAction =
  | { kind: 'view'; view: ActiveView }
  | { kind: 'toggleAiPanel' }
  | { kind: 'openSettings' }

interface AppShortcut {
  id: string
  label: string
  defaultCombo: string
  action: ShortcutAction
}

/** digits follow sidebar order; loadBindings keeps customised keys over remapped defaults */
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
  // eleventh view, out of digits: G for Game Dev
  { id: 'view_gamedev',     label: 'Go to Game Dev',    defaultCombo: 'Ctrl+G', action: { kind: 'view', view: 'gamedev' } },
  { id: 'toggle_ai_panel',  label: 'Toggle AI panel',   defaultCombo: 'Ctrl+L', action: { kind: 'toggleAiPanel' } },
  { id: 'open_settings',    label: 'Open Settings',     defaultCombo: 'Ctrl+,', action: { kind: 'openSettings' } }
]

/** views never share the screen, so D can mean different things per view */
export type ShortcutScope = 'wall' | 'kanban' | 'focus'

interface ViewShortcut {
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

/** conventions like undo, Escape and arrows aren't offered; reserved ones couldn't be given back */
export const VIEW_SHORTCUTS: ViewShortcut[] = [
  { id: 'wall_tool_select',      label: 'Select',                  scope: 'wall',   defaultCombo: 'V' },
  { id: 'wall_tool_draw',        label: 'Draw',                    scope: 'wall',   defaultCombo: 'P' },
  { id: 'wall_tool_connect',     label: 'Connect two items',       scope: 'wall',   defaultCombo: 'A' },
  // Delete took Ctrl+D, duplicate shifts one modifier; either slip is one undo away
  { id: 'wall_duplicate',        label: 'Duplicate the selection', scope: 'wall',   defaultCombo: 'Ctrl+Shift+D' },
  // Delete and Backspace still work, this is for people who'd rather not reach
  { id: 'wall_delete',           label: 'Delete the selection',    scope: 'wall',   defaultCombo: 'Ctrl+D' },
  // K for link, as in most editors
  { id: 'wall_link',             label: 'Link the selected item',  scope: 'wall',   defaultCombo: 'Ctrl+K' },
  // Alt beside copy and paste, their styled cousins
  { id: 'wall_copy_style',       label: 'Copy style',              scope: 'wall',   defaultCombo: 'Ctrl+Alt+C' },
  { id: 'wall_paste_style',      label: 'Paste style',             scope: 'wall',   defaultCombo: 'Ctrl+Alt+V' },

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

/** the OS or web platform owns these; kept here so defaults can be tested */
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
    // merged so newer shortcuts arrive on their default
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
    // merged, same as the global list
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

/** one call per keydown; views used to compare e.key to hard-coded letters */
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
    // empty means deliberately unbound
    if (bound && bound === combo) return shortcut.id
  }
  return null
}

/** view commands check their scope and the globals, never other views */
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

/** same "Ctrl+Shift+V" format as the global binder */
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

/** or Ctrl+L in a textarea fires mid-sentence */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el || !el.tagName) return false
  const tag = el.tagName.toLowerCase()
  return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable
}
