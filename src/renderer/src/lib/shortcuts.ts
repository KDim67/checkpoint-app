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
 * Defaults match the bindings that were hardcoded in App: Ctrl+1..8 in this
 * order, plus Ctrl+L and Ctrl+comma. Changing the order would silently remap
 * every existing user's muscle memory.
 */
export const APP_SHORTCUTS: AppShortcut[] = [
  { id: 'view_log',         label: 'Go to Log',         defaultCombo: 'Ctrl+1', action: { kind: 'view', view: 'log' } },
  { id: 'view_kanban',      label: 'Go to Kanban',      defaultCombo: 'Ctrl+2', action: { kind: 'view', view: 'kanban' } },
  { id: 'view_backlog',     label: 'Go to Backlog',     defaultCombo: 'Ctrl+3', action: { kind: 'view', view: 'backlog' } },
  { id: 'view_focus',       label: 'Go to Focus',       defaultCombo: 'Ctrl+4', action: { kind: 'view', view: 'focus' } },
  { id: 'view_notes',       label: 'Go to Notes',       defaultCombo: 'Ctrl+5', action: { kind: 'view', view: 'notes' } },
  { id: 'view_clipboard',   label: 'Go to Clipboard',   defaultCombo: 'Ctrl+6', action: { kind: 'view', view: 'clipboard' } },
  { id: 'view_cookbook',    label: 'Go to Cookbook',    defaultCombo: 'Ctrl+7', action: { kind: 'view', view: 'cookbook' } },
  { id: 'view_analytics',   label: 'Go to Analytics',   defaultCombo: 'Ctrl+8', action: { kind: 'view', view: 'analytics' } },
  { id: 'view_cheatsheets', label: 'Go to Cheatsheets', defaultCombo: '',       action: { kind: 'view', view: 'cheatsheets' } },
  { id: 'view_gamedev',     label: 'Go to Game Dev',    defaultCombo: '',       action: { kind: 'view', view: 'gamedev' } },
  { id: 'toggle_ai_panel',  label: 'Toggle AI panel',   defaultCombo: 'Ctrl+L', action: { kind: 'toggleAiPanel' } },
  { id: 'open_settings',    label: 'Open Settings',     defaultCombo: 'Ctrl+,', action: { kind: 'openSettings' } }
]

export type ShortcutBindings = Record<string, string>

const SETTING_KEY = 'app_shortcuts'

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
