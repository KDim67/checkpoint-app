// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { OVERLAY_WINDOWS, markOverlayWindow } from '../src/renderer/src/lib/overlayWindow'

afterEach(() => { delete document.documentElement.dataset.overlay })

describe('the windows that float over the desktop', () => {
  it('mark their page see-through, and the main window never', () => {
    for (const hash of ['#hud', '#tray', '#widget']) {
      delete document.documentElement.dataset.overlay
      markOverlayWindow(hash)
      expect(document.documentElement.dataset.overlay).toBe('true')
    }
    delete document.documentElement.dataset.overlay
    markOverlayWindow('')
    expect(document.documentElement.dataset.overlay).toBeUndefined()
  })

  it('are the same three App routes to', () => {
    const app = readFileSync('src/renderer/src/App.tsx', 'utf8')
    const routed = Array.from(app.matchAll(/hash === '(#\w+)'\)\s+return/g), match => match[1])
    expect(routed.sort()).toEqual([...OVERLAY_WINDOWS].sort())
  })

  it('are marked before the first render, so they never flash black', () => {
    const entry = readFileSync('src/renderer/src/main.tsx', 'utf8')
    const marked = entry.indexOf('markOverlayWindow()')
    expect(marked).toBeGreaterThan(-1)
    expect(marked).toBeLessThan(entry.indexOf('.render('))
  })

  it('get a see-through page from the stylesheet, over the dark one every other window has', () => {
    const css = readFileSync('src/renderer/src/index.css', 'utf8')
    expect(css).toMatch(/html\[data-overlay\],\s*html\[data-overlay\] body \{\s*background: transparent;/)
  })
})
