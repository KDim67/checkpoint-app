// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockReducedMotion = vi.fn(() => false)
vi.mock('../src/renderer/src/lib/presence', () => ({
  prefersReducedMotion: () => mockReducedMotion()
}))

import { animateDiceRoll, animateCoinFlip } from '../src/renderer/src/lib/funAnimations'

describe('funAnimations', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockReducedMotion.mockReturnValue(false)
    document.body.innerHTML = ''
  })

  afterEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  describe('reduced motion mode', () => {
    it('returns dice roll immediately without DOM animation elements when reduced motion is preferred', async () => {
      mockReducedMotion.mockReturnValue(true)

      const promise = animateDiceRoll()
      const result = await promise

      expect(result.d6).toBeGreaterThanOrEqual(1)
      expect(result.d6).toBeLessThanOrEqual(6)
      expect(result.d20).toBeGreaterThanOrEqual(1)
      expect(result.d20).toBeLessThanOrEqual(20)
      expect(document.getElementById('checkpoint-fun-overlay')).toBeNull()
    })

    it('returns coin flip immediately without DOM animation elements when reduced motion is preferred', async () => {
      mockReducedMotion.mockReturnValue(true)

      const promise = animateCoinFlip()
      const outcome = await promise

      expect(['Heads', 'Tails']).toContain(outcome)
      expect(document.getElementById('checkpoint-fun-overlay')).toBeNull()
    })
  })

  describe('animated mode', () => {
    it('runs dice roll animation and cleans up DOM elements', async () => {
      const rollPromise = animateDiceRoll()

      // Tumble phase starts
      expect(document.getElementById('checkpoint-fun-overlay')).not.toBeNull()
      expect(document.querySelector('.fun-anim-dice')).not.toBeNull()

      // Advance through tumble and resolve steps
      await vi.advanceTimersByTimeAsync(850 + 200 + 600 + 350 + 50)

      const result = await rollPromise
      expect(result.d6).toBeGreaterThanOrEqual(1)
      expect(result.d6).toBeLessThanOrEqual(6)
      expect(result.d20).toBeGreaterThanOrEqual(1)
      expect(result.d20).toBeLessThanOrEqual(20)

      // Elements cleaned up
      expect(document.querySelector('.fun-anim-dice')).toBeNull()
      expect(document.querySelector('.fun-anim-result')).toBeNull()
    })

    it('runs coin flip animation and cleans up DOM elements', async () => {
      const flipPromise = animateCoinFlip()

      expect(document.getElementById('checkpoint-fun-overlay')).not.toBeNull()
      expect(document.querySelector('.fun-anim-coin')).not.toBeNull()

      // Advance through spin and resolve steps
      await vi.advanceTimersByTimeAsync(900 + 700 + 350 + 50)

      const outcome = await flipPromise
      expect(['Heads', 'Tails']).toContain(outcome)

      expect(document.querySelector('.fun-anim-coin')).toBeNull()
      expect(document.querySelector('.fun-anim-result')).toBeNull()
    })
  })
})
