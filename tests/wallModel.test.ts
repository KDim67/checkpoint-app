import { describe, it, expect } from 'vitest'
import {
  boundsOf,
  bringToFront,
  createWallItem,
  DEFAULT_SIZES,
  fitCamera,
  inPaintOrder,
  MAX_ZOOM,
  MIN_ZOOM,
  normalizeCamera,
  normalizeWallDoc,
  normalizeWallItem,
  sendToBack,
  topZ,
  toWallPoint,
  wallDocKey,
  zoomAt,
  type WallItem
} from '../src/shared/wallModel'

const item = (over: Partial<WallItem> = {}): WallItem => ({
  id: 'a',
  kind: 'note',
  x: 0,
  y: 0,
  width: 200,
  height: 200,
  z: 0,
  ...over
})

describe('normalizeWallItem', () => {
  it('keeps a well-formed item', () => {
    const raw = { id: 'a', kind: 'note', x: 10, y: 20, width: 100, height: 50, z: 3 }
    expect(normalizeWallItem(raw, 0)).toMatchObject({ id: 'a', kind: 'note', x: 10, y: 20, z: 3 })
  })

  it('refuses an unknown kind rather than guessing one', () => {
    expect(normalizeWallItem({ kind: 'hologram' }, 0)).toBeNull()
    expect(normalizeWallItem({}, 0)).toBeNull()
    expect(normalizeWallItem(null, 0)).toBeNull()
  })

  it('drops a card or image with nothing to point at', () => {
    // An empty box the user cannot identify is worse than a missing one.
    expect(normalizeWallItem({ kind: 'card' }, 0)).toBeNull()
    expect(normalizeWallItem({ kind: 'image', ref: '   ' }, 0)).toBeNull()
    expect(normalizeWallItem({ kind: 'card', ref: 'item-1' }, 0)).not.toBeNull()
  })

  it('allows text and frames with no ref, because they have none', () => {
    expect(normalizeWallItem({ kind: 'text' }, 0)).not.toBeNull()
    expect(normalizeWallItem({ kind: 'frame' }, 0)).not.toBeNull()
  })

  it('falls back to the size for its kind', () => {
    const got = normalizeWallItem({ kind: 'frame' }, 0)!
    expect(got.width).toBe(DEFAULT_SIZES.frame.width)
    expect(got.height).toBe(DEFAULT_SIZES.frame.height)
  })

  it('floors size, so nothing becomes unclickable', () => {
    // A zero-size item cannot be selected, and so cannot be fixed without
    // editing the database by hand.
    const got = normalizeWallItem({ kind: 'note', width: 0, height: -50 }, 0)!
    expect(got.width).toBeGreaterThanOrEqual(40)
    expect(got.height).toBeGreaterThanOrEqual(32)
  })

  it('invents an id when one is missing, rather than dropping the item', () => {
    const got = normalizeWallItem({ kind: 'note' }, 7)!
    expect(got.id).toBeTruthy()
  })

  it('survives junk in every numeric field', () => {
    const got = normalizeWallItem({ kind: 'note', x: 'left', y: null, z: {} }, 2)!
    expect(got.x).toBe(0)
    expect(got.y).toBe(0)
    expect(got.z).toBe(2)
  })

  it('keeps an empty text body, which is a legitimate empty sticky note', () => {
    expect(normalizeWallItem({ kind: 'note', text: '' }, 0)!.text).toBe('')
  })
})

describe('normalizeCamera', () => {
  it('clamps zoom to what the view can render', () => {
    expect(normalizeCamera({ zoom: 99 }).zoom).toBe(MAX_ZOOM)
    expect(normalizeCamera({ zoom: 0.001 }).zoom).toBe(MIN_ZOOM)
  })

  it('defaults a missing or broken camera', () => {
    expect(normalizeCamera(undefined)).toEqual({ x: 0, y: 0, zoom: 1 })
    expect(normalizeCamera({ x: 'nope' })).toEqual({ x: 0, y: 0, zoom: 1 })
  })
})

describe('normalizeWallDoc', () => {
  it('reads the stored JSON string form', () => {
    const doc = normalizeWallDoc(JSON.stringify({ items: [{ kind: 'note', id: 'a' }] }))
    expect(doc.items).toHaveLength(1)
  })

  it('returns an empty wall for anything unusable', () => {
    for (const bad of [null, undefined, '', '{broken', 42, []]) {
      const doc = normalizeWallDoc(bad)
      expect(doc.items).toEqual([])
      expect(doc.version).toBe(1)
    }
  })

  it('drops only the bad items, keeping the rest', () => {
    // One corrupt entry must not cost the user their whole wall.
    const doc = normalizeWallDoc({
      items: [{ kind: 'note', id: 'good' }, { kind: 'nonsense' }, null, { kind: 'card', ref: 'i1' }]
    })
    expect(doc.items.map(i => i.kind)).toEqual(['note', 'card'])
  })
})

describe('paint order', () => {
  it('sorts lowest z first, so the highest lands on top', () => {
    const items = [item({ id: 'a', z: 5 }), item({ id: 'b', z: 1 })]
    expect(inPaintOrder(items).map(i => i.id)).toEqual(['b', 'a'])
  })

  it('brings one item above everything without reordering the others', () => {
    const items = [item({ id: 'a', z: 1 }), item({ id: 'b', z: 2 }), item({ id: 'c', z: 3 })]
    const next = bringToFront(items, 'a')
    expect(next.find(i => i.id === 'a')!.z).toBeGreaterThan(3)
    expect(next.map(i => i.id)).toEqual(['a', 'b', 'c'])
  })

  it('sends one item below everything', () => {
    const items = [item({ id: 'a', z: 1 }), item({ id: 'b', z: 2 })]
    expect(sendToBack(items, 'b').find(i => i.id === 'b')!.z).toBeLessThan(1)
  })

  it('starts z at 1 for an empty wall', () => {
    expect(topZ([])).toBe(1)
  })
})

describe('boundsOf', () => {
  it('covers every item', () => {
    const items = [item({ x: 0, y: 0, width: 100, height: 100 }), item({ x: 300, y: 200, width: 50, height: 50 })]
    expect(boundsOf(items)).toEqual({ minX: 0, minY: 0, maxX: 350, maxY: 250 })
  })

  it('handles negative coordinates, since the canvas has no origin corner', () => {
    const items = [item({ x: -400, y: -200, width: 100, height: 100 })]
    expect(boundsOf(items)).toEqual({ minX: -400, minY: -200, maxX: -300, maxY: -100 })
  })

  it('is null for an empty wall', () => {
    expect(boundsOf([])).toBeNull()
  })
})

describe('toWallPoint', () => {
  it('inverts the camera', () => {
    expect(toWallPoint({ x: 100, y: 100 }, { x: 50, y: 50, zoom: 1 })).toEqual({ x: 50, y: 50 })
  })

  it('accounts for zoom', () => {
    expect(toWallPoint({ x: 100, y: 100 }, { x: 0, y: 0, zoom: 2 })).toEqual({ x: 50, y: 50 })
  })
})

describe('zoomAt', () => {
  it('keeps the point under the cursor fixed', () => {
    // The whole feel of zooming depends on this: the thing you are pointing at
    // must not slide away while you scroll.
    const camera = { x: 0, y: 0, zoom: 1 }
    const cursor = { x: 400, y: 300 }
    const before = toWallPoint(cursor, camera)
    const after = toWallPoint(cursor, zoomAt(camera, cursor, 1.5))
    expect(after.x).toBeCloseTo(before.x, 6)
    expect(after.y).toBeCloseTo(before.y, 6)
  })

  it('holds at the clamps', () => {
    const camera = { x: 0, y: 0, zoom: MAX_ZOOM }
    expect(zoomAt(camera, { x: 0, y: 0 }, 2).zoom).toBe(MAX_ZOOM)
    const min = { x: 0, y: 0, zoom: MIN_ZOOM }
    expect(zoomAt(min, { x: 0, y: 0 }, 0.1).zoom).toBe(MIN_ZOOM)
  })

  it('does not drift the camera when the clamp swallows the change', () => {
    const camera = { x: 120, y: 80, zoom: MAX_ZOOM }
    expect(zoomAt(camera, { x: 400, y: 300 }, 2)).toEqual(camera)
  })
})

describe('fitCamera', () => {
  const viewport = { width: 1000, height: 800 }

  it('frames the content within the viewport', () => {
    const items = [item({ x: 0, y: 0, width: 400, height: 300 })]
    const cam = fitCamera(items, viewport)
    const topLeft = { x: 0 * cam.zoom + cam.x, y: 0 * cam.zoom + cam.y }
    expect(topLeft.x).toBeGreaterThanOrEqual(0)
    expect(topLeft.y).toBeGreaterThanOrEqual(0)
  })

  it('centres what it frames', () => {
    const items = [item({ x: -100, y: -100, width: 200, height: 200 })]
    const cam = fitCamera(items, viewport)
    // The content centre is (0,0), so it should land at the viewport centre.
    expect(cam.x).toBeCloseTo(viewport.width / 2, 6)
    expect(cam.y).toBeCloseTo(viewport.height / 2, 6)
  })

  it('never zooms past the limits, however small or vast the content', () => {
    expect(fitCamera([item({ width: 40, height: 32 })], viewport).zoom).toBeLessThanOrEqual(MAX_ZOOM)
    expect(fitCamera([item({ width: 90000, height: 90000 })], viewport).zoom).toBeGreaterThanOrEqual(MIN_ZOOM)
  })

  it('returns the default camera for an empty wall or a collapsed viewport', () => {
    expect(fitCamera([], viewport)).toEqual({ x: 0, y: 0, zoom: 1 })
    expect(fitCamera([item()], { width: 0, height: 0 })).toEqual({ x: 0, y: 0, zoom: 1 })
  })
})

describe('createWallItem', () => {
  it('centres the new item on the point, which is what dropping feels like', () => {
    const created = createWallItem('note', { x: 500, y: 400 }, [])
    expect(created.x).toBe(500 - DEFAULT_SIZES.note.width / 2)
    expect(created.y).toBe(400 - DEFAULT_SIZES.note.height / 2)
  })

  it('places it above everything already there', () => {
    const existing = [item({ z: 9 })]
    expect(createWallItem('note', { x: 0, y: 0 }, existing).z).toBeGreaterThan(9)
  })

  it('carries extra fields through', () => {
    const created = createWallItem('card', { x: 0, y: 0 }, [], { ref: 'item-7' })
    expect(created.ref).toBe('item-7')
  })

  it('gives every item a distinct id', () => {
    const ids = new Set(Array.from({ length: 50 }, () => createWallItem('note', { x: 0, y: 0 }, []).id))
    expect(ids.size).toBe(50)
  })
})

describe('wallDocKey', () => {
  it('is one document per workspace', () => {
    expect(wallDocKey('my-game')).toBe('wall_my-game')
    expect(wallDocKey('other')).not.toBe(wallDocKey('my-game'))
  })
})
