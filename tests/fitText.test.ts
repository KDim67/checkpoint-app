import { describe, expect, it } from 'vitest'
import { fitTextSize } from '../src/renderer/src/lib/fitText'

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
