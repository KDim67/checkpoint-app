import { describe, it, expect } from 'vitest'
import { APP_SHORTCUTS, defaultBindings } from '../src/renderer/src/lib/shortcuts'

// digits run down the sidebar; it drifted once, so it's tested

const views = APP_SHORTCUTS.filter(s => s.action.kind === 'view')

describe('the default shortcut scheme', () => {
  it('gives every shortcut a binding', () => {
    // two views once shipped unbound
    for (const shortcut of APP_SHORTCUTS) {
      expect(shortcut.defaultCombo, `${shortcut.label} has no default`).not.toBe('')
    }
  })

  it('binds no two things to the same keys', () => {
    const combos = APP_SHORTCUTS.map(s => s.defaultCombo)
    expect(new Set(combos).size).toBe(combos.length)
  })

  it('numbers the views down the sidebar, 1 to 9 then 0', () => {
    // Wall once sat sixth holding Ctrl+9
    const expected = ['Ctrl+1', 'Ctrl+2', 'Ctrl+3', 'Ctrl+4', 'Ctrl+5',
                      'Ctrl+6', 'Ctrl+7', 'Ctrl+8', 'Ctrl+9', 'Ctrl+0']
    expect(views.slice(0, 10).map(v => v.defaultCombo)).toEqual(expected)
  })

  it('does not run out of digits silently', () => {
    // past the tenth view needs a letter
    for (const view of views.slice(10)) {
      expect(view.defaultCombo).not.toMatch(/^Ctrl\+\d$/)
      expect(view.defaultCombo).not.toBe('')
    }
  })

  it('keeps the two non-view shortcuts off the digit run', () => {
    const nonViews = APP_SHORTCUTS.filter(s => s.action.kind !== 'view')
    expect(nonViews.map(s => s.defaultCombo)).toEqual(['Ctrl+L', 'Ctrl+,'])
  })

  it('hands back a binding for every id', () => {
    const bindings = defaultBindings()
    for (const shortcut of APP_SHORTCUTS) {
      expect(bindings[shortcut.id]).toBe(shortcut.defaultCombo)
    }
  })

  it('has an id for every shortcut, used once', () => {
    const ids = APP_SHORTCUTS.map(s => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
