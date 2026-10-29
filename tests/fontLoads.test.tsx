// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { useFontLoads } from '../src/renderer/src/lib/fitText'

// words fitted in a stand-in face are fitted again once the page's own fonts arrive

/** jsdom has no document.fonts, so a target to stand in for it */
function fakeFonts(): EventTarget {
  const fonts = new EventTarget()
  Object.defineProperty(document, 'fonts', { value: fonts, configurable: true })
  return fonts
}

afterEach(() => {
  cleanup()
  Reflect.deleteProperty(document, 'fonts')
})

describe('finished font loads', () => {
  it('reach every box that asks, through one listener on the page', () => {
    const fonts = fakeFonts()
    const listen = vi.spyOn(fonts, 'addEventListener')
    const a = renderHook(() => useFontLoads())
    const b = renderHook(() => useFontLoads())
    expect(listen).toHaveBeenCalledTimes(1)
    const before = a.result.current

    act(() => { fonts.dispatchEvent(new Event('loadingdone')) })

    expect(a.result.current).toBe(before + 1)
    expect(b.result.current).toBe(before + 1)
  })

  it('stop being listened for once no box is left', () => {
    const fonts = fakeFonts()
    const stop = vi.spyOn(fonts, 'removeEventListener')
    const a = renderHook(() => useFontLoads())
    const b = renderHook(() => useFontLoads())
    a.unmount()
    expect(stop).not.toHaveBeenCalled()
    b.unmount()
    expect(stop).toHaveBeenCalledOnce()
  })

  it('leave a page without font loading alone', () => {
    const { result } = renderHook(() => useFontLoads())
    expect(typeof result.current).toBe('number')
  })
})
