import { describe, expect, it } from 'vitest'
import { cropFrame, cropHeight, cropPixels, dragCrop, FULL_CROP, isFullCrop } from '../src/shared/wallCrop'
import { normalizeWallItem, type ImageCrop, type WallItem } from '../src/shared/wallModel'

const half: ImageCrop = { x: 0.25, y: 0.25, w: 0.5, h: 0.5 }

describe('dragging the crop window', () => {
  it('moves it whole, and stops at the edges of the picture', () => {
    expect(dragCrop(half, 'move', 0.1, -0.1)).toStrictEqual({ x: 0.35, y: 0.15, w: 0.5, h: 0.5 })
    expect(dragCrop(half, 'move', 5, 5)).toStrictEqual({ x: 0.5, y: 0.5, w: 0.5, h: 0.5 })
    expect(dragCrop(half, 'move', -5, -5)).toStrictEqual({ x: 0, y: 0, w: 0.5, h: 0.5 })
  })

  it('leaves the opposite side where it is when a corner is pulled', () => {
    const pulled = dragCrop(half, 'nw', -0.1, -0.2)
    expect(pulled.x).toBeCloseTo(0.15)
    expect(pulled.y).toBeCloseTo(0.05)
    // the right and bottom edges have not moved
    expect(pulled.x + pulled.w).toBeCloseTo(0.75)
    expect(pulled.y + pulled.h).toBeCloseTo(0.75)
  })

  it('pulls one edge only, and never past the other one', () => {
    expect(dragCrop(half, 'e', 0.1, 0.5)).toStrictEqual({ x: 0.25, y: 0.25, w: 0.6, h: 0.5 })
    expect(dragCrop(half, 'e', 5, 0)).toStrictEqual({ x: 0.25, y: 0.25, w: 0.75, h: 0.5 })
    expect(dragCrop(half, 'w', 5, 0).x).toBeCloseTo(0.7)
    expect(dragCrop(half, 'w', 5, 0).w).toBeCloseTo(0.05)
  })
})

describe('what the crop means to the item', () => {
  it('keeps the picture square-on by reshaping the item around its width', () => {
    // half as wide and half as tall of a square picture is still square
    expect(cropHeight(half, 300, { width: 400, height: 400 })).toBe(300)
    // a wide strip of a square picture makes a wide item
    expect(cropHeight({ x: 0, y: 0, w: 1, h: 0.25 }, 400, { width: 400, height: 400 })).toBe(100)
    // never below the item floor
    expect(cropHeight({ x: 0, y: 0, w: 1, h: 0.01 }, 100, { width: 400, height: 400 })).toBe(32)
  })

  it('lays the picture out behind the window as percentages, and as source pixels for export', () => {
    expect(cropFrame(half)).toStrictEqual({ left: '-50%', top: '-50%', width: '200%', height: '200%' })
    expect(cropPixels(half, { width: 800, height: 600 })).toStrictEqual({ sx: 200, sy: 150, sw: 400, sh: 300 })
  })

  it('knows the whole picture when it sees it', () => {
    expect(isFullCrop(FULL_CROP)).toBe(true)
    expect(isFullCrop(half)).toBe(false)
  })
})

describe('a stored crop', () => {
  const read = (crop: unknown): WallItem | null =>
    normalizeWallItem({ id: 'i', kind: 'image', ref: 'p.png', x: 0, y: 0, width: 100, height: 100, z: 0, crop }, 0)

  it('survives a reload, and the whole picture is stored as no crop at all', () => {
    expect(read(half)?.crop).toStrictEqual(half)
    expect(read(FULL_CROP)?.crop).toBeUndefined()
  })

  it('drops anything that could not be drawn', () => {
    expect(read({ x: 0.5, y: 0, w: 0.9, h: 0.5 })?.crop).toBeUndefined()
    expect(read({ x: -0.1, y: 0, w: 0.5, h: 0.5 })?.crop).toBeUndefined()
    expect(read({ x: 0, y: 0, w: 0, h: 0.5 })?.crop).toBeUndefined()
    expect(read('half of it')?.crop).toBeUndefined()
  })

  it('belongs to pictures only', () => {
    const sticky = normalizeWallItem({ id: 'n', kind: 'note', x: 0, y: 0, width: 100, height: 100, z: 0, crop: half }, 0)
    expect(sticky?.crop).toBeUndefined()
  })
})
