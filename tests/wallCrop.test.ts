import { describe, expect, it } from 'vitest'
import { cropFrame, cropInPlace, cropPixels, dragCrop, fitRatio, FULL_CROP, isFullCrop, pixelRatio } from '../src/shared/wallCrop'
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
  it('shrinks the item to the part kept, where it was and at the same size, so nothing moves or zooms', () => {
    const photo = { id: 'p', kind: 'image', x: 100, y: 50, width: 400, height: 300, z: 0 } as WallItem
    expect(cropInPlace(photo, { x: 0.25, y: 0.5, w: 0.5, h: 0.5 })).toStrictEqual({ x: 200, y: 200, width: 200, height: 150 })
  })

  it('grows a cropped item back around itself when more of the picture is kept', () => {
    const cropped = { id: 'p', kind: 'image', x: 200, y: 200, width: 200, height: 150, z: 0, crop: half } as WallItem
    expect(cropInPlace(cropped, FULL_CROP)).toStrictEqual({ x: 100, y: 125, width: 400, height: 300 })
  })

  it('keeps a turned picture in place too, the kept part landing where it showed', () => {
    const turned = { id: 'p', kind: 'image', x: 0, y: 0, width: 400, height: 200, z: 0, rotation: 90 } as WallItem
    const kept = cropInPlace(turned, { x: 0.5, y: 0, w: 0.5, h: 1 })
    expect(kept.width).toBeCloseTo(200)
    expect(kept.height).toBeCloseTo(200)
    expect(kept.x).toBeCloseTo(100)
    expect(kept.y).toBeCloseTo(100)
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

describe('a crop that keeps its shape', () => {
  const picture = { width: 800, height: 400 }

  it('pulls a corner along the shape, the opposite corner staying put', () => {
    // square on an 800 by 400 picture is half as wide as it is tall in fractions
    const square = { x: 0.25, y: 0.25, w: 0.25, h: 0.5 }
    const pulled = dragCrop(square, 'se', 0.1, 0, { ratio: 1, picture })
    expect(pixelRatio(pulled, picture)).toBeCloseTo(1)
    expect(pulled.x).toBeCloseTo(0.25)
    expect(pulled.y).toBeCloseTo(0.25)
    expect(pulled.w).toBeCloseTo(0.35)
    const fromTopLeft = dragCrop(square, 'nw', -0.1, 0, { ratio: 1, picture })
    expect(fromTopLeft.x + fromTopLeft.w).toBeCloseTo(0.5)
    expect(fromTopLeft.y + fromTopLeft.h).toBeCloseTo(0.75)
    expect(pixelRatio(fromTopLeft, picture)).toBeCloseTo(1)
  })

  it('stops at the picture\'s edge without losing the shape', () => {
    const pulled = dragCrop({ x: 0.5, y: 0.5, w: 0.25, h: 0.5 }, 'se', 5, 5, { ratio: 1, picture })
    expect(pulled.x + pulled.w).toBeLessThanOrEqual(1.000001)
    expect(pulled.y + pulled.h).toBeLessThanOrEqual(1.000001)
    expect(pixelRatio(pulled, picture)).toBeCloseTo(1)
  })

  it('fits the largest window of a shape inside the current one, centred', () => {
    const fitted = fitRatio(FULL_CROP, 1, picture)
    expect(fitted).toStrictEqual({ x: 0.25, y: 0, w: 0.5, h: 1 })
    const tall = fitRatio(FULL_CROP, 16 / 9 * 4, picture)
    expect(tall.w).toBeCloseTo(1)
    expect(pixelRatio(tall, picture)).toBeCloseTo(16 / 9 * 4)
  })
})
