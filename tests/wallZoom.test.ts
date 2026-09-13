import { describe, expect, it } from 'vitest'
import { nextZoom, zoomToward, ZOOM_STEPS } from '../src/shared/wallZoom'
import { MAX_ZOOM, MIN_ZOOM } from '../src/shared/wallModel'

describe('nextZoom', () => {
  it('steps through the levels, and from between two levels to the next one either way', () => {
    expect(nextZoom(1, 1)).toBe(1.25)
    expect(nextZoom(1, -1)).toBe(0.8)
    expect(nextZoom(0.9, 1)).toBe(1)
    expect(nextZoom(0.9, -1)).toBe(0.8)
  })

  it('stops at the ends of the range the wall allows', () => {
    expect(ZOOM_STEPS[0]).toBe(MIN_ZOOM)
    expect(ZOOM_STEPS[ZOOM_STEPS.length - 1]).toBe(MAX_ZOOM)
    expect(nextZoom(MAX_ZOOM, 1)).toBe(MAX_ZOOM)
    expect(nextZoom(MIN_ZOOM, -1)).toBe(MIN_ZOOM)
  })
})

describe('zoomToward', () => {
  it('keeps what is in the middle of the view where it is', () => {
    expect(zoomToward({ x: 100, y: 50, zoom: 1 }, { width: 800, height: 600 }, 2)).toStrictEqual({ x: -200, y: -200, zoom: 2 })
  })

  it('hands back the same camera when the zoom does not change', () => {
    const camera = { x: 10, y: 10, zoom: MAX_ZOOM }
    expect(zoomToward(camera, { width: 800, height: 600 }, 99)).toBe(camera)
  })
})
