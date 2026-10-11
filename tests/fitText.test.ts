import { describe, expect, it, vi } from 'vitest'
import { fitTextSize, fitTextSizeSoon } from '../src/renderer/src/lib/fitText'

/** a box whose words take a height that follows the font size */
const box = (clientHeight: number, linesAt: (size: number) => number) => {
  const el = {
    style: { fontSize: '' },
    clientHeight,
    get scrollHeight(): number {
      return linesAt(parseFloat(el.style.fontSize))
    }
  }
  return el as unknown as HTMLElement
}

describe('words sized to their box', () => {
  it('leaves them at the size they were given when they already fit', () => {
    const el = box(100, () => 60)
    expect(fitTextSize(el, 13, 8)).toStrictEqual({ size: 13, over: 0 })
    expect(el.style.fontSize).toBe('13px')
  })

  it('takes a step off at a time until they fit, and sets the size it landed on', () => {
    // four lines, each 1.5 times the size
    const el = box(60, size => Math.round(size * 1.5 * 4))
    expect(fitTextSize(el, 13, 8)).toStrictEqual({ size: 10, over: 0 })
    expect(el.style.fontSize).toBe('10px')
  })

  it('stops at the floor and says how many pixels short the box is', () => {
    const el = box(40, size => size * 10)
    expect(fitTextSize(el, 13, 8)).toStrictEqual({ size: 8, over: 40 })
  })
})

/** boxes sharing one page: a read after any write lays the page out again, and that's counted */
function page() {
  let dirty = false
  const layouts = { count: 0 }
  const make = (clientHeight: number, linesAt: (size: number) => number): HTMLElement => {
    let fontSize = ''
    return {
      isConnected: true,
      clientHeight,
      style: {
        get fontSize() { return fontSize },
        set fontSize(v: string) { fontSize = v; dirty = true }
      },
      get scrollHeight(): number {
        if (dirty) { layouts.count++; dirty = false }
        return linesAt(parseFloat(fontSize))
      }
    } as unknown as HTMLElement
  }
  return { make, layouts }
}

const settle = (): Promise<void> => new Promise(resolve => queueMicrotask(resolve))

describe('many boxes sized together', () => {
  it('lands each on the size it would get alone', async () => {
    const { make } = page()
    const cases: [number, (size: number) => number, number, number][] = [
      [100, () => 60, 13, 8],
      [60, size => Math.round(size * 1.5 * 4), 13, 8],
      [40, size => size * 10, 13, 8],
      [90, size => size * 7, 16, 8],
      [50, size => size * 3, 12, 12]
    ]
    const alone = cases.map(([h, lines, base, min]) => fitTextSize(box(h, lines), base, min))
    const together: { size: number; over: number }[] = []
    cases.forEach(([h, lines, base, min], i) => fitTextSizeSoon(make(h, lines), base, min, fit => { together[i] = fit }))
    await settle()
    expect(together).toStrictEqual(alone)
  })

  it('lays the page out a handful of times for a whole wall, not once or more per box', async () => {
    const { make, layouts } = page()
    for (let i = 0; i < 300; i++) {
      // a third fit as they are, the rest need shrinking by different amounts
      fitTextSizeSoon(make(100, size => (i % 3 === 0 ? 50 : size * (6 + (i % 7)))), 16, 8, () => {})
    }
    await settle()
    expect(layouts.count).toBeLessThanOrEqual(6)

    // the same wall one box at a time, as it was
    const alone = page()
    for (let i = 0; i < 300; i++) fitTextSize(alone.make(100, size => (i % 3 === 0 ? 50 : size * (6 + (i % 7)))), 16, 8)
    expect(alone.layouts.count).toBeGreaterThan(300)
  })

  it('skips a box whose ask was taken back, as when it changed again before the frame', async () => {
    const { make } = page()
    const done = vi.fn()
    const cancel = fitTextSizeSoon(make(100, () => 60), 13, 8, done)
    cancel()
    await settle()
    expect(done).not.toHaveBeenCalled()
  })
})
