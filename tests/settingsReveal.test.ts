// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { findSetting, revealWhenShown, showSetting } from '../src/renderer/src/lib/settingsReveal'
import { SETTING_FOUND_MS } from '../src/renderer/src/lib/timings'

let root: HTMLElement
const draw = (html: string): void => { root.innerHTML = html }

beforeEach(() => {
  root = document.createElement('div')
  document.body.appendChild(root)
  Element.prototype.scrollIntoView = vi.fn()
  if (!window.requestAnimationFrame) window.requestAnimationFrame = (cb: FrameRequestCallback) => window.setTimeout(() => cb(0), 0)
})

afterEach(() => {
  root.remove()
  vi.useRealTimers()
})

describe('finding a setting by its words', () => {
  it('takes a field by its label, focusing the field the label names', () => {
    draw('<div class="row"><label for="url">Base URL</label><button>Reset</button><input id="url"></div>')
    const found = findSetting(root, 'base url')
    expect(found?.target.className).toBe('row')
    expect(found?.control?.id).toBe('url')
  })

  it('takes a switch row by its text, focusing the switch', () => {
    draw('<div class="row"><div><div>Compact Mode</div><div>Denser rows.</div></div><button role="switch" aria-label="Compact Mode"></button></div>')
    const found = findSetting(root, 'Compact Mode')
    expect(found?.target.className).toBe('row')
    expect(found?.control?.getAttribute('role')).toBe('switch')
  })

  it('reads past a count or value after the name, but not past more words', () => {
    draw('<span id="a">Font Size Large</span><div id="b">AI Persistent Memory Vault (3)</div>')
    expect(findSetting(root, 'Font Size')).toBeNull()
    expect(findSetting(root, 'AI Persistent Memory Vault')?.target.id).toBe('b')
  })

  it('stands a card in for its title', () => {
    draw('<div data-settings-part="Kanban Columns" id="card"><h2>Kanban Columns</h2><input></div>')
    expect(findSetting(root, 'Kanban Columns')).toMatchObject({ target: root.querySelector('#card'), control: null })
  })

  it('lands on a button by its own text', () => {
    draw('<div><button id="go">Open the Workspaces page</button></div>')
    const button = root.querySelector('#go')
    expect(findSetting(root, 'Open the Workspaces page')).toMatchObject({ target: button, control: button })
  })

  it('looks under the given heading when the same words are on the page twice', () => {
    draw('<div><span>Wall</span><div class="row" id="wall"><span>Select</span><button>V</button></div></div>'
      + '<div><span>Kanban card</span><div class="row" id="card"><span>Select</span><button>S</button></div></div>')
    expect(findSetting(root, 'Select', 'Kanban card')?.target.id).toBe('card')
    expect(findSetting(root, 'Select', 'Wall')?.target.id).toBe('wall')
  })

  it('never takes a whole group of settings for one row', () => {
    draw('<div><span id="label">App Version</span><button>1</button><button>2</button><button>3</button><button>4</button></div>')
    expect(findSetting(root, 'App Version')).toMatchObject({ target: root.querySelector('#label'), control: null })
  })

  it('falls back to a control named only for screen readers, and ignores option text', () => {
    draw('<select><option>Port</option></select><input id="t" type="range" aria-label="Temperature">')
    expect(findSetting(root, 'Port')).toBeNull()
    expect(findSetting(root, 'Temperature')?.control?.id).toBe('t')
  })
})

describe('showing what was found', () => {
  it('scrolls it to the middle, focuses its control and lights it for a moment', () => {
    vi.useFakeTimers()
    draw('<div class="row"><label for="k">API Key</label><input id="k"></div>')
    const found = findSetting(root, 'API Key')
    if (!found) throw new Error('API Key not found')
    showSetting(found)
    expect(found.target.scrollIntoView).toHaveBeenCalledWith({ block: 'center' })
    expect(document.activeElement?.id).toBe('k')
    expect(found.target.classList.contains('settings-found')).toBe(true)
    vi.advanceTimersByTime(SETTING_FOUND_MS)
    expect(found.target.classList.contains('settings-found')).toBe(false)
  })

  it('makes a setting with no control focusable, so the keyboard carries on from there', () => {
    draw('<span id="v">App Version</span>')
    const found = findSetting(root, 'App Version')
    if (!found) throw new Error('App Version not found')
    showSetting(found)
    expect(document.activeElement?.id).toBe('v')
  })
})

describe('waiting for a section to load', () => {
  it('shows the setting once it is drawn', async () => {
    draw('<p>Loading…</p>')
    revealWhenShown(root, 'Quiet Hours', undefined, 3000)
    const later = document.createElement('div')
    later.innerHTML = '<div class="row"><span>Quiet Hours</span><button role="switch" id="q"></button></div>'
    root.appendChild(later)
    await vi.waitFor(() => expect(document.activeElement?.id).toBe('q'))
  })

  it('gives up after the wait, and once stopped never jumps later', async () => {
    vi.useFakeTimers()
    draw('<p>Loading…</p>')
    revealWhenShown(root, 'Quiet Hours', undefined, 3000)
    vi.advanceTimersByTime(3000)
    const stop = revealWhenShown(root, 'Mouse', undefined, 3000)
    stop()
    root.innerHTML = '<div><span>Quiet Hours</span><span>Mouse</span><button role="switch" id="q"></button></div>'
    await vi.advanceTimersByTimeAsync(100)
    expect(root.querySelector('.settings-found')).toBeNull()
  })
})
