import { describe, expect, it } from 'vitest'
import { cameraShowing, grownItem, GROW_GAP } from '../src/shared/wallGrow'
import type { WallItem } from '../src/shared/wallModel'

const item = (id: string, over: Partial<WallItem> = {}): WallItem =>
  ({ id, kind: 'note', x: 0, y: 0, width: 200, height: 200, z: 1, ...over })

describe('grownItem', () => {
  it('puts the same kind, size and look a gap away on the side asked for, centred on the source', () => {
    const source = item('a', { kind: 'shape', shape: 'diamond', color: '#f28b82', width: 160, height: 100, rotation: 12, text: 'Start', link: 'https://example.com' })
    const right = grownItem([source], source, 'right')

    expect(right).toMatchObject({ kind: 'shape', shape: 'diamond', color: '#f28b82', width: 160, height: 100, x: 160 + GROW_GAP, y: 0 })
    expect(right.id).not.toBe('a')
    expect(right.rotation).toBeUndefined()
    expect(right.text).toBeUndefined()
    expect(right.link).toBeUndefined()

    expect(grownItem([source], source, 'bottom')).toMatchObject({ x: 0, y: 100 + GROW_GAP })
    expect(grownItem([source], source, 'left')).toMatchObject({ x: -GROW_GAP - 160, y: 0 })
    expect(grownItem([source], source, 'top')).toMatchObject({ x: 0, y: -GROW_GAP - 100 })
  })

  it('starts a sticky beside anything that holds no words of its own', () => {
    const source = item('a', { kind: 'image', width: 280, height: 200, ref: 'photo.png' })
    const grown = grownItem([source], source, 'right')

    expect(grown).toMatchObject({ kind: 'note', width: 200, height: 200 })
    expect(grown.ref).toBeUndefined()
    expect(grown.color).toBeDefined()
  })

  it('keeps a text box one line tall, it grows with its words', () => {
    const source = item('a', { kind: 'text', width: 320, height: 140 })
    expect(grownItem([source], source, 'bottom')).toMatchObject({ kind: 'text', width: 320, height: 48 })
  })

  it('fans out along the side when the spot is taken, rather than stacking', () => {
    const source = item('a')
    const first = grownItem([source], source, 'right')
    const second = grownItem([source, first], source, 'right')
    const third = grownItem([source, first, second], source, 'right')

    expect(second).toMatchObject({ x: first.x, y: 200 + GROW_GAP / 2 })
    expect(third).toMatchObject({ x: first.x, y: -(200 + GROW_GAP / 2) })
  })

  it('is not blocked by the frame it sits in', () => {
    const source = item('a', { x: 100, y: 100 })
    const frame = item('f', { kind: 'frame', x: 0, y: 0, width: 1000, height: 1000 })
    expect(grownItem([frame, source], source, 'right')).toMatchObject({ x: 300 + GROW_GAP, y: 100 })
  })
})

describe('cameraShowing', () => {
  const view = { width: 800, height: 600 }

  it('leaves the camera alone when the item is already in view', () => {
    const camera = { x: 0, y: 0, zoom: 1 }
    expect(cameraShowing(camera, view, item('a', { x: 100, y: 100 }))).toBe(camera)
  })

  it('moves only as far as it takes to bring the item in past the margin', () => {
    expect(cameraShowing({ x: 0, y: 0, zoom: 1 }, view, item('a', { x: 700, y: 100 }), 48)).toStrictEqual({ x: -148, y: 0, zoom: 1 })
    expect(cameraShowing({ x: 0, y: 0, zoom: 2 }, view, item('a', { x: -50, y: 40 }), 48)).toStrictEqual({ x: 148, y: 0, zoom: 2 })
  })

  it('lines a wider item up on its start edge', () => {
    expect(cameraShowing({ x: 0, y: 0, zoom: 1 }, view, item('a', { x: 200, y: 100, width: 1000 }), 48)).toStrictEqual({ x: -152, y: 0, zoom: 1 })
  })
})
