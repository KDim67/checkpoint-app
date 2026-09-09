import { describe, it, expect } from 'vitest'
import {
  APP_SHORTCUTS,
  VIEW_SHORTCUTS,
  RESERVED_COMBOS,
  SCOPE_LABELS,
  commandForEvent,
  defaultViewBindings,
  isReservedCombo,
  shortcutClash,
  type ShortcutScope
} from '../src/renderer/src/lib/shortcuts'

// View commands are the ones that only mean anything while you are looking at
// a particular view: V for the wall's select tool, R to reset the focus timer.
// They were hard-coded in each component, so nobody could change them and the
// same letter quietly meant two different things in two different places.
//
// Scope is what makes that safe rather than a collision: two views are never
// on screen at once, so D can log a distraction in Focus and tick a due date
// on a kanban card without either shadowing the other.

const scopes = (): ShortcutScope[] => [...new Set(VIEW_SHORTCUTS.map(s => s.scope))]

const keyEvent = (init: Partial<KeyboardEvent> & { key: string }): KeyboardEvent =>
  ({ ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...init }) as KeyboardEvent

describe('the view shortcut list', () => {
  it('gives every command a binding', () => {
    for (const shortcut of VIEW_SHORTCUTS) {
      expect(shortcut.defaultCombo, `${shortcut.label} has no default`).not.toBe('')
    }
  })

  it('has an id for every command, used once', () => {
    const ids = VIEW_SHORTCUTS.map(s => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('shares no id with the global list, which shares one binding store', () => {
    const global = new Set(APP_SHORTCUTS.map(s => s.id))
    for (const shortcut of VIEW_SHORTCUTS) {
      expect(global.has(shortcut.id), `${shortcut.id} is in both lists`).toBe(false)
    }
  })

  it('names every scope it uses', () => {
    for (const scope of scopes()) {
      expect(SCOPE_LABELS[scope], `${scope} has no label`).toBeTruthy()
    }
  })

  it('binds no two commands in one scope to the same keys', () => {
    for (const scope of scopes()) {
      const combos = VIEW_SHORTCUTS.filter(s => s.scope === scope).map(s => s.defaultCombo)
      expect(new Set(combos).size, `${scope} has a duplicate default`).toBe(combos.length)
    }
  })

  it('does let two scopes reuse a key, which is the point of scoping', () => {
    // If this ever stops being true the scoping has quietly become pointless,
    // and the flat clash check it replaced would have done just as well.
    const combos = VIEW_SHORTCUTS.map(s => s.defaultCombo)
    expect(new Set(combos).size).toBeLessThan(combos.length)
  })

  it('never takes a key the global shortcuts already own', () => {
    // A global fires whatever is on screen, so it would win or double-fire.
    const global = new Set(APP_SHORTCUTS.map(s => s.defaultCombo))
    for (const shortcut of VIEW_SHORTCUTS) {
      expect(global.has(shortcut.defaultCombo), `${shortcut.label} takes a global key`).toBe(false)
    }
  })

  it('defaults to nothing the binder would refuse to accept back', () => {
    // A default that cannot be re-entered is a one-way door: change it once
    // and you can never get it back without wiping every binding.
    for (const shortcut of VIEW_SHORTCUTS) {
      expect(isReservedCombo(shortcut.defaultCombo), `${shortcut.label} defaults to a reserved combo`).toBe(false)
    }
  })

  it('hands back a binding for every id', () => {
    const bindings = defaultViewBindings()
    for (const shortcut of VIEW_SHORTCUTS) {
      expect(bindings[shortcut.id]).toBe(shortcut.defaultCombo)
    }
  })
})

describe('isReservedCombo', () => {
  it('keeps the editing keys the operating system owns', () => {
    for (const combo of ['Ctrl+C', 'Ctrl+V', 'Ctrl+Z', 'Ctrl+S', 'Alt+F4']) {
      expect(isReservedCombo(combo)).toBe(true)
    }
  })

  it('leaves a bare letter alone', () => {
    for (const combo of ['C', 'V', 'Z', 'S']) expect(isReservedCombo(combo)).toBe(false)
  })

  it('is the same list the binder shows', () => {
    expect(RESERVED_COMBOS.length).toBeGreaterThan(0)
    for (const combo of RESERVED_COMBOS) expect(isReservedCombo(combo)).toBe(true)
  })
})

describe('commandForEvent', () => {
  const bindings = defaultViewBindings()

  it('finds the command a key is bound to in that scope', () => {
    expect(commandForEvent(keyEvent({ key: 'v' }), 'wall', bindings)).toBe('wall_tool_select')
    expect(commandForEvent(keyEvent({ key: 'r' }), 'focus', bindings)).toBe('focus_reset')
  })

  it('reads the same letter as a different command in a different scope', () => {
    expect(commandForEvent(keyEvent({ key: 'd' }), 'focus', bindings)).toBe('focus_log_distraction')
    expect(commandForEvent(keyEvent({ key: 'd' }), 'kanban', bindings)).toBe('kanban_toggle_due')
  })

  it('is null for a key this scope does not bind', () => {
    expect(commandForEvent(keyEvent({ key: 'r' }), 'wall', bindings)).toBeNull()
    expect(commandForEvent(keyEvent({ key: 'q' }), 'kanban', bindings)).toBeNull()
  })

  it('does not answer a bare letter for a modified press', () => {
    // Ctrl+V is paste. It must not arm the wall's select tool on the way past.
    expect(commandForEvent(keyEvent({ key: 'v', ctrlKey: true }), 'wall', bindings)).toBeNull()
  })

  it('follows a changed binding rather than the default', () => {
    const changed = { ...bindings, wall_tool_select: 'S' }
    expect(commandForEvent(keyEvent({ key: 's' }), 'wall', changed)).toBe('wall_tool_select')
    expect(commandForEvent(keyEvent({ key: 'v' }), 'wall', changed)).toBeNull()
  })

  it('ignores a command left unbound', () => {
    const unbound = { ...bindings, wall_tool_draw: '' }
    expect(commandForEvent(keyEvent({ key: 'p' }), 'wall', unbound)).toBeNull()
  })
})

describe('shortcutClash', () => {
  const app = Object.fromEntries(APP_SHORTCUTS.map(s => [s.id, s.defaultCombo]))
  const view = defaultViewBindings()

  it('names the command a combo is already taken by in the same scope', () => {
    expect(shortcutClash('P', { id: 'wall_tool_select', scope: 'wall' }, app, view)).toBe('Draw')
  })

  it('says nothing about the command being rebound to what it already has', () => {
    expect(shortcutClash('V', { id: 'wall_tool_select', scope: 'wall' }, app, view)).toBeNull()
  })

  it('lets a scope take a key another scope uses', () => {
    // R resets the focus timer. The wall may still have it for something else.
    expect(shortcutClash('R', { id: 'wall_tool_select', scope: 'wall' }, app, view)).toBeNull()
  })

  it('still refuses a key the global shortcuts own, since those fire anywhere', () => {
    expect(shortcutClash('Ctrl+6', { id: 'wall_tool_select', scope: 'wall' }, app, view))
      .toBe('Go to Wall')
  })

  it('checks a global against every scope, for the same reason', () => {
    expect(shortcutClash('V', { id: 'view_wall', scope: 'global' }, app, view)).toBe('Select')
  })

  it('lets a global keep its own binding', () => {
    expect(shortcutClash('Ctrl+6', { id: 'view_wall', scope: 'global' }, app, view)).toBeNull()
  })
})
