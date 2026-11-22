import { describe, expect, it } from 'vitest'
import { fitImageBox, GIF_PAUSE_ZOOM_THRESHOLD, IMAGE_LONGEST_SIDE, isAnimatedGif, rowCentres } from '../src/shared/wallImage'

describe('the box a dropped picture gets', () => {
  it('keeps a portrait photo tall and a landscape one wide', () => {
    expect(fitImageBox({ width: 3000, height: 4000 })).toStrictEqual({ width: 240, height: IMAGE_LONGEST_SIDE })
    expect(fitImageBox({ width: 1920, height: 1080 })).toStrictEqual({ width: IMAGE_LONGEST_SIDE, height: 180 })
  })

  it('leaves a small picture at its own size, never below the item floor', () => {
    expect(fitImageBox({ width: 200, height: 100 })).toStrictEqual({ width: 200, height: 100 })
    expect(fitImageBox({ width: 16, height: 16 })).toStrictEqual({ width: 40, height: 32 })
  })

  it('gives up on a size it cannot read', () => {
    expect(fitImageBox(null)).toBeNull()
    expect(fitImageBox({ width: 0, height: 100 })).toBeNull()
  })
})

describe('laying several pictures out', () => {
  it('puts them side by side around the drop point instead of in one pile', () => {
    const centres = rowCentres([{ width: 100, height: 80 }, { width: 200, height: 80 }], { x: 0, y: 50 }, 20)
    // 100 + 20 + 200 wide, centred on 0
    expect(centres).toStrictEqual([{ x: -110, y: 50 }, { x: 60, y: 50 }])
  })

  it('centres a single picture on the point itself', () => {
    expect(rowCentres([{ width: 120, height: 90 }], { x: 10, y: 20 })).toStrictEqual([{ x: 10, y: 20 }])
  })
})

describe('animated GIF detection', () => {
  it('detects .gif extensions across case and query parameters', () => {
    expect(isAnimatedGif({ ref: 'animation.gif' })).toBe(true)
    expect(isAnimatedGif({ ref: 'dance.GIF' })).toBe(true)
    expect(isAnimatedGif({ ref: 'checkpoint-media://clip.gif?w=500' })).toBe(true)
    expect(isAnimatedGif({ ref: 'clip.gif#frame' })).toBe(true)
    expect(isAnimatedGif({ text: 'meme.gif' })).toBe(true)
  })

  it('ignores non-gif images and partial name matches', () => {
    expect(isAnimatedGif({ ref: 'photo.png' })).toBe(false)
    expect(isAnimatedGif({ ref: 'photo.jpg' })).toBe(false)
    expect(isAnimatedGif({ ref: 'vector.svg' })).toBe(false)
    expect(isAnimatedGif({ ref: 'gift-shop.png' })).toBe(false)
    expect(isAnimatedGif({ ref: 'cat.gif.png' })).toBe(false)
    expect(isAnimatedGif({})).toBe(false)
  })

  it('defines a zoom pause threshold at 35%', () => {
    expect(GIF_PAUSE_ZOOM_THRESHOLD).toBe(0.35)
  })
})
