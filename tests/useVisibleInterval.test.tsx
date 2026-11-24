// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act } from '@testing-library/react'
import { useVisibleInterval } from '../src/renderer/src/lib/useVisibleInterval'

function Probe({ onTick, delayMs, enabled = true }: { onTick: () => void; delayMs: number; enabled?: boolean }) {
  useVisibleInterval(onTick, delayMs, enabled)
  return null
}

describe('useVisibleInterval', () => {
  let hiddenValue = false

  beforeEach(() => {
    vi.useFakeTimers()
    hiddenValue = false
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hiddenValue })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('ticks while visible, pauses when hidden, and refreshes immediately on return', () => {
    const onTick = vi.fn()
    render(<Probe onTick={onTick} delayMs={5000} />)

    vi.advanceTimersByTime(10000)
    expect(onTick).toHaveBeenCalledTimes(2)

    act(() => {
      hiddenValue = true
      document.dispatchEvent(new Event('visibilitychange'))
    })

    vi.advanceTimersByTime(15000)
    expect(onTick).toHaveBeenCalledTimes(2)

    act(() => {
      hiddenValue = false
      document.dispatchEvent(new Event('visibilitychange'))
    })
    // immediate catch-up tick on becoming visible, then normal cadence
    expect(onTick).toHaveBeenCalledTimes(3)
    vi.advanceTimersByTime(5000)
    expect(onTick).toHaveBeenCalledTimes(4)
  })

  it('does not start when enabled is false or initially hidden', () => {
    const disabledTick = vi.fn()
    render(<Probe onTick={disabledTick} delayMs={1000} enabled={false} />)
    vi.advanceTimersByTime(5000)
    expect(disabledTick).not.toHaveBeenCalled()

    hiddenValue = true
    const hiddenTick = vi.fn()
    render(<Probe onTick={hiddenTick} delayMs={1000} />)
    vi.advanceTimersByTime(5000)
    expect(hiddenTick).not.toHaveBeenCalled()
  })
})
