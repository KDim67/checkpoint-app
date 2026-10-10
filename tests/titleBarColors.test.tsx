// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useRef } from 'react'
import { act, cleanup, render } from '@testing-library/react'
import { readCssColor, titleBarColors, useTitleBarColors } from '../src/renderer/src/lib/titleBarColors'
import { DEFAULT_TITLE_BAR, paintTitleBar, readTitleBarColors } from '../src/main/titleBarSync'

afterEach(cleanup)

describe('a colour the page drew', () => {
  it('is read whichever way the browser writes it', () => {
    expect(readCssColor('rgb(11, 12, 16)')).toStrictEqual({ r: 11, g: 12, b: 16, a: 1 })
    expect(readCssColor('rgba(0, 0, 0, 0.5)')).toStrictEqual({ r: 0, g: 0, b: 0, a: 0.5 })
    expect(readCssColor('rgb(255 128 0 / 25%)')).toStrictEqual({ r: 255, g: 128, b: 0, a: 0.25 })
    expect(readCssColor('#0b0c10')).toStrictEqual({ r: 11, g: 12, b: 16, a: 1 })
    expect(readCssColor('#fff')).toStrictEqual({ r: 255, g: 255, b: 255, a: 1 })
    expect(readCssColor('color(srgb 1 0 0.5)')).toStrictEqual({ r: 255, g: 0, b: 128, a: 1 })
    expect(readCssColor('transparent')).toStrictEqual({ r: 0, g: 0, b: 0, a: 0 })
  })

  it('is left alone when it can\'t be read, so it counts as see-through', () => {
    expect(readCssColor('oklch(0.5 0.1 20)')).toBeNull()
    expect(readCssColor('rgb(nope)')).toBeNull()
  })
})

describe('the title bar\'s colours', () => {
  const bar = (barStyle: string, pageStyle = ''): HTMLElement => {
    const page = document.body.appendChild(document.createElement('div'))
    page.setAttribute('style', pageStyle)
    const el = page.appendChild(document.createElement('div'))
    el.setAttribute('style', barStyle)
    return el
  }
  afterEach(() => { document.body.replaceChildren() })

  it('are its background behind the buttons and its text for their marks', () => {
    expect(titleBarColors(bar('background-color: #301018; color: #f0e0e8'))).toStrictEqual({ color: '#301018', symbolColor: '#f0e0e8' })
  })

  it('see through a translucent bar, or one with no background, to what lies under it', () => {
    expect(titleBarColors(bar('background-color: rgba(0, 0, 0, 0.5); color: #000000', 'background-color: #ff0000')).color).toBe('#800000')
    expect(titleBarColors(bar('color: #000000', 'background-color: #2a1015')).color).toBe('#2a1015')
  })

  it('fall back to the page\'s own white when nothing under the bar is painted', () => {
    expect(titleBarColors(bar('color: #000000')).color).toBe('#ffffff')
  })
})

describe('keeping the window\'s buttons in step', () => {
  const sent = vi.fn()
  beforeEach(() => {
    sent.mockReset()
    ;(window as unknown as { electronAPI: unknown }).electronAPI = { app: { setTitleBarColors: sent } }
  })

  function Bar({ enabled = true }: { enabled?: boolean }): React.JSX.Element {
    const ref = useRef<HTMLDivElement>(null)
    useTitleBarColors(ref, enabled)
    return <div ref={ref} className="titlebar" style={{ backgroundColor: '#0b0c10', color: '#f1f5f9' }} />
  }

  it('tells the window on opening, again when the theme changes, and not when nothing changed', async () => {
    const { container } = render(<Bar />)
    expect(sent.mock.calls).toStrictEqual([[{ color: '#0b0c10', symbolColor: '#f1f5f9' }]])

    // the palette swaps the page's theme; here the bar's own colours stand in for what the theme would do
    const el = container.querySelector('.titlebar') as HTMLElement
    el.style.backgroundColor = '#f2f4f8'
    el.style.color = '#0f172a'
    await act(async () => { document.documentElement.setAttribute('data-theme', 'light') })
    expect(sent).toHaveBeenLastCalledWith({ color: '#f2f4f8', symbolColor: '#0f172a' })

    // a custom palette arrives as a stylesheet in the head
    el.style.backgroundColor = '#3a1420'
    await act(async () => {
      const style = document.head.appendChild(document.createElement('style'))
      style.textContent = ':root { --color-background: #3a1420 }'
    })
    expect(sent).toHaveBeenLastCalledWith({ color: '#3a1420', symbolColor: '#0f172a' })

    const calls = sent.mock.calls.length
    await act(async () => { window.dispatchEvent(new CustomEvent('theme-mode-changed')) })
    expect(sent.mock.calls.length).toBe(calls)
  })

  it('says nothing where the window draws no buttons of its own', () => {
    render(<Bar enabled={false} />)
    expect(sent).not.toHaveBeenCalled()
  })
})

describe('the window\'s side', () => {
  it('takes only two plain colours from the page', () => {
    expect(readTitleBarColors({ color: '#0B0C10', symbolColor: '#f1f5f9' })).toStrictEqual({ color: '#0b0c10', symbolColor: '#f1f5f9' })
    expect(readTitleBarColors({ color: 'red', symbolColor: '#f1f5f9' })).toBeNull()
    expect(readTitleBarColors({ color: '#0b0c10' })).toBeNull()
    expect(readTitleBarColors('#0b0c10')).toBeNull()
    expect(readTitleBarColors(null)).toBeNull()
  })

  it('paints the buttons and the window behind the page, and shrugs off a window with no buttons', () => {
    const win = { isDestroyed: () => false, setTitleBarOverlay: vi.fn(), setBackgroundColor: vi.fn() }
    paintTitleBar(win as never, DEFAULT_TITLE_BAR)
    expect(win.setTitleBarOverlay).toHaveBeenCalledWith(DEFAULT_TITLE_BAR)
    expect(win.setBackgroundColor).toHaveBeenCalledWith('#0b0c10')

    const bare = { isDestroyed: () => false, setTitleBarOverlay: vi.fn(() => { throw new Error('no overlay') }), setBackgroundColor: vi.fn() }
    expect(() => paintTitleBar(bare as never, DEFAULT_TITLE_BAR)).not.toThrow()
    expect(bare.setBackgroundColor).toHaveBeenCalled()
  })
})
