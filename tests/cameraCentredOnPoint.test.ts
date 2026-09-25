import { describe, expect, it } from 'vitest'
import { cameraCentredOnPoint, cameraCentredOn } from '../src/shared/wallModel'

describe('cameraCentredOnPoint', () => {
  it('centres the camera on the specified point with 1x zoom', () => {
    const point = { x: 500, y: 300 }
    const viewport = { width: 1000, height: 600 }
    const cam = cameraCentredOnPoint(point, viewport, 1)

    expect(cam).toEqual({
      x: 0,
      y: 0,
      zoom: 1
    })
  })

  it('centres the camera on the specified point with scaled zoom', () => {
    const point = { x: 400, y: 200 }
    const viewport = { width: 800, height: 600 }
    const cam = cameraCentredOnPoint(point, viewport, 2)

    expect(cam).toEqual({
      x: 800 / 2 - 400 * 2, // 400 - 800 = -400
      y: 600 / 2 - 200 * 2, // 300 - 400 = -100
      zoom: 2
    })
  })

  it('matches cameraCentredOn when pointing at the center of a WallItem', () => {
    const item = {
      id: 'item-1',
      kind: 'note' as const,
      x: 100,
      y: 150,
      width: 200,
      height: 100,
      z: 0
    }
    const viewport = { width: 1200, height: 800 }
    const zoom = 1.5

    const fromItem = cameraCentredOn(item, viewport, zoom)
    const fromPoint = cameraCentredOnPoint(
      { x: item.x + item.width / 2, y: item.y + item.height / 2 },
      viewport,
      zoom
    )

    expect(fromPoint).toEqual(fromItem)
  })
})
