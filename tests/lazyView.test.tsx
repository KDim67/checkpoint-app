// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Suspense } from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { lazyView } from '../src/renderer/src/lib/lazyView'

// a screen's code fetched ahead opens without its loading screen, which React would otherwise keep up for 300 ms

afterEach(cleanup)

const Screen = (): React.JSX.Element => <p>the screen</p>
const loader = () => vi.fn(async () => ({ default: Screen }))

function show(View: React.ComponentType): { fallbacks: () => number } {
  let fallbacks = 0
  const Fallback = (): React.JSX.Element => { fallbacks++; return <p>loading</p> }
  render(<Suspense fallback={<Fallback />}><View /></Suspense>)
  return { fallbacks: () => fallbacks }
}

describe('a screen loaded on first use', () => {
  it('opens straight away, with no loading screen, once its code was fetched ahead', async () => {
    const load = loader()
    const View = lazyView(load)
    await View.preload()
    const { fallbacks } = show(View)
    expect(screen.getByText('the screen')).toBeTruthy()
    expect(fallbacks()).toBe(0)
    expect(load).toHaveBeenCalledOnce()
  })

  it('shows its loading screen while its code is still on the way', async () => {
    const View = lazyView(loader())
    const { fallbacks } = show(View)
    expect(screen.getByText('loading')).toBeTruthy()
    expect(fallbacks()).toBeGreaterThan(0)
    expect(await screen.findByText('the screen')).toBeTruthy()
  })

  it('fetches once however often it is asked for ahead', async () => {
    const load = loader()
    const View = lazyView(load)
    await Promise.all([View.preload(), View.preload(), View.preload()])
    expect(load).toHaveBeenCalledOnce()
  })

  it('shrugs off a failed fetch ahead, and tries again when the screen is opened', async () => {
    const load = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue({ default: Screen })
    const View = lazyView(load)
    await expect(View.preload()).resolves.toBeUndefined()
    show(View)
    expect(await screen.findByText('the screen')).toBeTruthy()
    expect(load).toHaveBeenCalledTimes(2)
  })
})

describe('fetching screens ahead after starting', () => {
  it('waits for starting up to finish, then fetches the switched-on screens in the sidebar order, one idle moment each', async () => {
    vi.useFakeTimers()
    vi.resetModules()
    const order: string[] = []
    vi.doMock('../src/renderer/src/lib/lazyView', () => ({
      lazyView: (load: () => Promise<unknown>) => ({
        // the screen's name, from the path its loader imports
        preload: async () => { order.push(String(load).match(/([A-Za-z]+(?:View|Panel))/)?.[1] ?? '?') }
      })
    }))
    vi.doMock('../src/renderer/src/lib/features', async importOriginal => ({
      ...(await importOriginal<typeof import('../src/renderer/src/lib/features')>()),
      readViewFeatures: async () => ({ kanban: true, log: false, backlog: true, calendar: false, renewals: false, focus: false, notes: false, wall: true, clipboard: false, analytics: false, cookbook: false, cheatsheets: false, gamedev: false })
    }))
    try {
      const { preloadScreensWhenIdle } = await import('../src/renderer/src/components/screens')
      const { SCREEN_PRELOAD_DELAY_MS } = await import('../src/renderer/src/lib/timings')
      preloadScreensWhenIdle()
      await act(async () => { await vi.advanceTimersByTimeAsync(SCREEN_PRELOAD_DELAY_MS - 1) })
      expect(order).toEqual([])
      await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
      expect(order).toEqual(['KanbanView', 'BacklogView', 'WallView', 'SettingsView', 'WorkspacesView', 'ItemDetailPanel'])
    } finally {
      vi.useRealTimers()
      vi.doUnmock('../src/renderer/src/lib/lazyView')
      vi.doUnmock('../src/renderer/src/lib/features')
    }
  })
})
