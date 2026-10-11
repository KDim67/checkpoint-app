// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { readFileSync } from 'fs'
import { useState } from 'react'
import Presence from '../src/renderer/src/components/ui/Presence'
import ModalShell from '../src/renderer/src/components/ui/ModalShell'
import ConfirmDialog from '../src/renderer/src/components/ui/ConfirmDialog'
import { ToastProvider, useToast } from '../src/renderer/src/components/ui/Toast'
import Skeleton, { LoadingRegion, SkeletonLines } from '../src/renderer/src/components/ui/Skeleton'
import { EXIT_MS } from '../src/renderer/src/lib/timings'
import { withViewTransition } from '../src/renderer/src/lib/viewTransition'

const css = readFileSync('src/renderer/src/index.css', 'utf8')

function reduceMotion(on: boolean): void {
  window.matchMedia = ((query: string) => ({ matches: on && query.includes('reduce'), media: query })) as unknown as typeof window.matchMedia
}

beforeEach(() => {
  vi.useFakeTimers()
  reduceMotion(false)
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function DialogHost({ initial = true }: { initial?: boolean }) {
  const [open, setOpen] = useState(initial)
  return (
    <>
      <button type="button" onClick={() => setOpen(o => !o)}>toggle</button>
      <Presence show={open}>
        {open && (
          <ModalShell label="Rename" onClose={() => setOpen(false)}>
            <p>Pick a name</p>
          </ModalShell>
        )}
      </Presence>
    </>
  )
}

describe('a dialog that closes', () => {
  it('plays its exit as it last looked, then goes once the exit is over', () => {
    render(<DialogHost />)
    fireEvent.click(screen.getByText('toggle'))

    const leaving = screen.getByRole('dialog', { hidden: true })
    expect(leaving.getAttribute('data-state')).toBe('closing')
    expect(screen.getByText('Pick a name')).toBeTruthy()

    act(() => { vi.advanceTimersByTime(EXIT_MS - 1) })
    expect(screen.queryByRole('dialog', { hidden: true })).not.toBeNull()
    act(() => { vi.advanceTimersByTime(1) })
    expect(screen.queryByRole('dialog', { hidden: true })).toBeNull()
  })

  it('stops answering Escape the moment it starts to leave', () => {
    const onClose = vi.fn()
    function Host() {
      const [open, setOpen] = useState(true)
      return (
        <Presence show={open}>
          {open && <ModalShell label="Rename" onClose={() => { onClose(); setOpen(false) }}><p>Pick a name</p></ModalShell>}
        </Presence>
      )
    }
    render(<Host />)
    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('reopens straight away if asked while still leaving', () => {
    render(<DialogHost />)
    fireEvent.click(screen.getByText('toggle'))
    fireEvent.click(screen.getByText('toggle'))
    act(() => { vi.advanceTimersByTime(EXIT_MS * 2) })
    expect(screen.getByRole('dialog').getAttribute('data-state')).toBe('open')
  })

  it('goes at once with motion reduced, since there is no exit to wait for', () => {
    reduceMotion(true)
    render(<DialogHost />)
    fireEvent.click(screen.getByText('toggle'))
    act(() => { vi.advanceTimersByTime(0) })
    expect(screen.queryByRole('dialog', { hidden: true })).toBeNull()
  })
})

describe('the confirm dialog', () => {
  it('keeps the words it was opened with while it leaves, though its caller has cleared them', () => {
    const props = { onConfirm: () => {}, onCancel: () => {} }
    const { rerender } = render(<ConfirmDialog isOpen title="Delete this backup?" message="It can't be brought back." {...props} />)
    rerender(<ConfirmDialog isOpen={false} title="" message="" {...props} />)
    expect(screen.getByText('Delete this backup?')).toBeTruthy()
    act(() => { vi.advanceTimersByTime(EXIT_MS) })
    expect(screen.queryByText('Delete this backup?')).toBeNull()
  })
})

describe('a toast', () => {
  it('fades out before it goes, rather than vanishing', () => {
    function Sender() {
      const { toast } = useToast()
      return <button type="button" onClick={() => toast('Saved', { duration: 1000 })}>send</button>
    }
    render(<ToastProvider><Sender /></ToastProvider>)
    fireEvent.click(screen.getByText('send'))
    act(() => { vi.advanceTimersByTime(1000) })
    expect(screen.getByText('Saved').closest('.toast-item')?.getAttribute('data-state')).toBe('closing')
    act(() => { vi.advanceTimersByTime(EXIT_MS) })
    expect(screen.queryByText('Saved')).toBeNull()
  })
})

describe('changing view', () => {
  const visibility = (state: DocumentVisibilityState): void => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
  }
  /** a transition the way the browser hands one back, whose ready rejects when it's dropped */
  const transition = (ready: Promise<void> = Promise.resolve()) => ({ ready, finished: Promise.resolve(), updateCallbackDone: Promise.resolve() })

  beforeEach(() => visibility('visible'))

  afterEach(() => {
    delete (document as { startViewTransition?: unknown }).startViewTransition
  })

  it('draws the new view inside the transition, so the browser captures it rather than the old one twice', () => {
    let drawnInside = false
    let updated = false
    ;(document as { startViewTransition?: unknown }).startViewTransition = (callback: () => void) => {
      callback()
      drawnInside = updated
      return transition()
    }
    withViewTransition(() => { updated = true })
    expect(drawnInside).toBe(true)
  })

  it('just changes it where the browser has no transitions, or motion is reduced', () => {
    const update = vi.fn()
    withViewTransition(update)
    expect(update).toHaveBeenCalledTimes(1)

    const start = vi.fn()
    ;(document as { startViewTransition?: unknown }).startViewTransition = start
    reduceMotion(true)
    withViewTransition(update)
    expect(start).not.toHaveBeenCalled()
    expect(update).toHaveBeenCalledTimes(2)
  })

  it('just changes it in a hidden window, where the browser would refuse the transition and report it as an error', () => {
    visibility('hidden')
    const start = vi.fn()
    const update = vi.fn()
    ;(document as { startViewTransition?: unknown }).startViewTransition = start
    withViewTransition(update)
    expect(start).not.toHaveBeenCalled()
    expect(update).toHaveBeenCalledTimes(1)
  })

  it('takes a dropped transition in its stride, so it never reaches the app log as an unhandled error', () => {
    const ready = { catch: vi.fn() }
    ;(document as { startViewTransition?: unknown }).startViewTransition = (callback: () => void) => {
      callback()
      return { ...transition(), ready }
    }
    withViewTransition(() => {})
    expect(ready.catch).toHaveBeenCalledTimes(1)
  })
})

describe('a skeleton', () => {
  it('is hidden from screen readers, which hear what is loading instead', () => {
    render(<LoadingRegion label="Loading the card"><Skeleton height="1rem" /></LoadingRegion>)
    const region = screen.getByRole('status')
    expect(region.getAttribute('aria-busy')).toBe('true')
    expect(region.textContent).toBe('Loading the card')
    expect(region.querySelector('.skeleton')?.getAttribute('aria-hidden')).toBe('true')
  })

  it('draws lines of text with a ragged edge, not one bar repeated', () => {
    const { container } = render(<SkeletonLines label="Loading" lines={3} />)
    const widths = Array.from(container.querySelectorAll<HTMLElement>('.skeleton'), line => line.style.width)
    expect(new Set(widths).size).toBe(3)
  })
})

describe('the motion in the stylesheet', () => {
  const rule = (selector: string): string => {
    const start = css.indexOf(`${selector} {`)
    expect(start, selector).toBeGreaterThan(-1)
    return css.slice(start, css.indexOf('}', start))
  }

  it('leaves in the same time the code waits before taking the element away', () => {
    expect(css).toMatch(new RegExp(`--duration-exit:\\s*${EXIT_MS}ms;`))
  })

  it('never holds an arrival transform afterwards, which would trap fixed popovers inside a dialog or drawer', () => {
    for (const selector of ['.motion-backdrop', '.motion-pop', '.motion-drawer', '.motion-drop', '.motion-content', '.toast-item']) {
      expect(rule(selector)).toMatch(/backwards;/)
      expect(rule(selector)).not.toMatch(/\b(forwards|both);/)
    }
  })

  it('gives every arrival a way out', () => {
    expect(css).toMatch(/\.motion-backdrop\[data-state="closing"\],\s*\.motion-drop\[data-state="closing"\] \{/)
    for (const selector of ['.motion-pop', '.motion-drawer', '.toast-item']) {
      expect(css).toContain(`${selector}[data-state="closing"] {`)
    }
  })

  it('shows a skeleton only once a load has taken a moment, and stills looping motion when motion is reduced', () => {
    expect(rule('.skeleton')).toMatch(/skeleton-appear var\(--duration-normal\) var\(--ease-enter\) var\(--skeleton-delay\) backwards/)
    expect(css).toMatch(/animation-iteration-count: 1 !important;/)
  })
})
