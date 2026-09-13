import { describe, it, expect } from 'vitest'
import {
  boundsOf,
  duplicateItems,
  cameraCentredOn,
  itemAtPoint,
  searchItems,
  itemsInRect,
  moveItems,
  patchItems,
  rectFromPoints,
  snap,
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
  type WallItem,
  createWall,
  normalizeWallIndex,
  removeWall,
  renameWall,
  setActiveWall,
  wallIndexKey,
  itemsInFrame,
  withFrameContents,
  DEFAULT_WALL_ID
} from '../src/shared/wallModel'
import { defined } from './helpers/defined'

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
    // worse than missing
    expect(normalizeWallItem({ kind: 'card' }, 0)).toBeNull()
    expect(normalizeWallItem({ kind: 'image', ref: '   ' }, 0)).toBeNull()
    expect(normalizeWallItem({ kind: 'card', ref: 'item-1' }, 0)).not.toBeNull()
  })

  it('allows text and frames with no ref, because they have none', () => {
    expect(normalizeWallItem({ kind: 'text' }, 0)).not.toBeNull()
    expect(normalizeWallItem({ kind: 'frame' }, 0)).not.toBeNull()
  })

  it('falls back to the size for its kind', () => {
    const got = defined(normalizeWallItem({ kind: 'frame' }, 0))
    expect(got.width).toBe(DEFAULT_SIZES.frame.width)
    expect(got.height).toBe(DEFAULT_SIZES.frame.height)
  })

  it('floors size, so nothing becomes unclickable', () => {
    // unselectable, only fixable by editing the db
    const got = defined(normalizeWallItem({ kind: 'note', width: 0, height: -50 }, 0))
    expect(got.width).toBeGreaterThanOrEqual(40)
    expect(got.height).toBeGreaterThanOrEqual(32)
  })

  it('invents an id when one is missing, rather than dropping the item', () => {
    const got = defined(normalizeWallItem({ kind: 'note' }, 7))
    expect(got.id).toBeTruthy()
  })

  it('survives junk in every numeric field', () => {
    const got = defined(normalizeWallItem({ kind: 'note', x: 'left', y: null, z: {} }, 2))
    expect(got.x).toBe(0)
    expect(got.y).toBe(0)
    expect(got.z).toBe(2)
  })

  it('keeps an empty text body, which is a legitimate empty sticky note', () => {
    expect(defined(normalizeWallItem({ kind: 'note', text: '' }, 0)).text).toBe('')
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
    // one corrupt entry mustn't cost the wall
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
    expect(defined(next.find(i => i.id === 'a')).z).toBeGreaterThan(3)
    expect(next.map(i => i.id)).toEqual(['a', 'b', 'c'])
  })

  it('sends one item below everything', () => {
    const items = [item({ id: 'a', z: 1 }), item({ id: 'b', z: 2 })]
    expect(defined(sendToBack(items, 'b').find(i => i.id === 'b')).z).toBeLessThan(1)
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
    // what you point at mustn't slide while zooming
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
    // content centre (0,0) lands at the viewport centre
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

describe('rectFromPoints', () => {
  it('normalises a drag in any direction into a positive rectangle', () => {
    // marquees go up-left as often as down-right
    expect(rectFromPoints({ x: 100, y: 100 }, { x: 20, y: 40 }))
      .toEqual({ x: 20, y: 40, width: 80, height: 60 })
  })

  it('gives a zero rectangle for a click that never moved', () => {
    expect(rectFromPoints({ x: 5, y: 5 }, { x: 5, y: 5 }))
      .toEqual({ x: 5, y: 5, width: 0, height: 0 })
  })
})

describe('itemsInRect', () => {
  const items = [
    item({ id: 'a', x: 0, y: 0, width: 100, height: 100 }),
    item({ id: 'b', x: 300, y: 300, width: 100, height: 100 }),
    item({ id: 'c', x: 50, y: 50, width: 100, height: 100 })
  ]

  it('selects anything the marquee touches, not only what it encloses', () => {
    // full containment makes marquees feel broken
    const got = itemsInRect(items, { x: 90, y: 90, width: 20, height: 20 })
    expect(got.sort()).toEqual(['a', 'c'])
  })

  it('selects nothing when the marquee misses everything', () => {
    expect(itemsInRect(items, { x: 900, y: 900, width: 10, height: 10 })).toEqual([])
  })

  it('skips locked items, because unselectable is what locked means', () => {
    const withLock = [item({ id: 'x', x: 0, y: 0, width: 100, height: 100, locked: true })]
    expect(itemsInRect(withLock, { x: 0, y: 0, width: 200, height: 200 })).toEqual([])
  })
})

describe('moveItems', () => {
  it('moves the whole selection by the same delta', () => {
    const items = [item({ id: 'a', x: 0, y: 0 }), item({ id: 'b', x: 100, y: 100 })]
    const moved = moveItems(items, new Set(['a', 'b']), 10, -5)
    expect(moved.map(i => [i.x, i.y])).toEqual([[10, -5], [110, 95]])
  })

  it('leaves items outside the selection alone', () => {
    const items = [item({ id: 'a', x: 0 }), item({ id: 'b', x: 100 })]
    expect(moveItems(items, new Set(['a']), 10, 0)[1].x).toBe(100)
  })

  it('refuses to move a locked item even when it is selected', () => {
    const items = [item({ id: 'a', x: 0, locked: true })]
    expect(moveItems(items, new Set(['a']), 50, 50)[0].x).toBe(0)
  })
})

describe('patchItems', () => {
  it('applies one change across the selection', () => {
    const items = [item({ id: 'a' }), item({ id: 'b' }), item({ id: 'c' })]
    const painted = patchItems(items, new Set(['a', 'c']), { color: '#ff0000' })
    expect(painted.map(i => i.color)).toEqual(['#ff0000', undefined, '#ff0000'])
  })

  it('leaves locked items untouched', () => {
    const items = [item({ id: 'a', locked: true, color: '#111111' })]
    expect(patchItems(items, new Set(['a']), { color: '#ff0000' })[0].color).toBe('#111111')
  })
})

describe('duplicateItems', () => {
  const items = [item({ id: 'a', x: 10, y: 10, text: 'hello' }), item({ id: 'b' })]

  it('copies only the chosen items', () => {
    expect(duplicateItems(items, new Set(['a']))).toHaveLength(1)
  })

  it('offsets the copy so it is visibly not the original', () => {
    const [copy] = duplicateItems(items, new Set(['a']), 24)
    expect(copy.x).toBe(34)
    expect(copy.y).toBe(34)
  })

  it('gives the copy a new id and keeps the content', () => {
    const [copy] = duplicateItems(items, new Set(['a']))
    expect(copy.id).not.toBe('a')
    expect(copy.text).toBe('hello')
  })

  it('places copies above everything already there', () => {
    const stack = [item({ id: 'a', z: 5 }), item({ id: 'b', z: 9 })]
    for (const copy of duplicateItems(stack, new Set(['a', 'b']))) {
      expect(copy.z).toBeGreaterThan(9)
    }
  })

  it('unlocks the copy, so it can be moved into place', () => {
    // a duplicated locked background is meant to be moved
    const locked = [item({ id: 'a', locked: true })]
    expect(duplicateItems(locked, new Set(['a']))[0].locked).toBeUndefined()
  })

  it('gives every copy a distinct id in one pass', () => {
    const many = Array.from({ length: 20 }, (_, i) => item({ id: 'i' + i }))
    const copies = duplicateItems(many, new Set(many.map(i => i.id)))
    expect(new Set(copies.map(c => c.id)).size).toBe(20)
  })
})

describe('snap', () => {
  it('rounds to the nearest gridline', () => {
    expect(snap(23, 24)).toBe(24)
    expect(snap(11, 24)).toBe(0)
    expect(snap(-13, 24)).toBe(-24)
  })

  it('is a no-op when snapping is off', () => {
    expect(snap(37, 0)).toBe(37)
  })
})

describe('itemAtPoint', () => {
  const items = [
    item({ id: 'back', x: 0, y: 0, width: 200, height: 200, z: 1 }),
    item({ id: 'front', x: 50, y: 50, width: 100, height: 100, z: 5 })
  ]

  it('returns the topmost item under the point', () => {
    // both contain it, the last painted wins
    expect(itemAtPoint(items, { x: 100, y: 100 })?.id).toBe('front')
  })

  it('returns the lower item where the upper one does not reach', () => {
    expect(itemAtPoint(items, { x: 10, y: 10 })?.id).toBe('back')
  })

  it('returns null on empty canvas', () => {
    expect(itemAtPoint(items, { x: 900, y: 900 })).toBeNull()
    expect(itemAtPoint([], { x: 0, y: 0 })).toBeNull()
  })

  it('counts the edges as inside, so a click on the border still lands', () => {
    expect(itemAtPoint([item({ id: 'a', x: 0, y: 0, width: 100, height: 100 })], { x: 100, y: 100 })?.id).toBe('a')
  })

  it('finds locked items too, since they can still be right-clicked to unlock', () => {
    expect(itemAtPoint([item({ id: 'l', locked: true, width: 100, height: 100 })], { x: 10, y: 10 })?.id).toBe('l')
  })
})

describe('cameraCentredOn', () => {
  const viewport = { width: 1000, height: 800 }

  it('puts the item in the middle of the viewport', () => {
    const target = item({ x: 500, y: 500, width: 100, height: 100 })
    const cam = cameraCentredOn(target, viewport, 1)
    // the item centre lands at the viewport centre
    expect((target.x + 50) * cam.zoom + cam.x).toBeCloseTo(500, 6)
    expect((target.y + 50) * cam.zoom + cam.y).toBeCloseTo(400, 6)
  })

  it('keeps the zoom it was given, since jumping should not rescale', () => {
    expect(cameraCentredOn(item(), viewport, 2.5).zoom).toBe(2.5)
  })
})

describe('searchItems', () => {
  const items = [
    item({ id: 'a', kind: 'note', text: 'deadzone handling', z: 1 }),
    item({ id: 'b', kind: 'card', ref: 'card-1', z: 2 }),
    item({ id: 'c', kind: 'note', text: 'art direction', z: 3 })
  ]
  const titles = (i: typeof items[0]) => (i.ref === 'card-1' ? 'Fix the deadzone' : undefined)

  it('matches a sticky note by its own text', () => {
    expect(searchItems(items, 'handling', titles).map(i => i.id)).toEqual(['a'])
  })

  it('matches a card by the title of the card it references', () => {
    // titles aren't stored on the item
    expect(searchItems(items, 'fix', titles).map(i => i.id)).toEqual(['b'])
  })

  it('requires every word, so a second word narrows rather than widens', () => {
    expect(searchItems(items, 'deadzone handling', titles).map(i => i.id)).toEqual(['a'])
    expect(searchItems(items, 'deadzone missing', titles)).toEqual([])
  })

  it('ignores case', () => {
    expect(searchItems(items, 'ART', titles).map(i => i.id)).toEqual(['c'])
  })

  it('returns nothing for an empty query rather than everything', () => {
    expect(searchItems(items, '   ', titles)).toEqual([])
  })

  it('puts the topmost item first', () => {
    const stack = [item({ id: 'low', text: 'x', z: 1 }), item({ id: 'high', text: 'x', z: 9 })]
    expect(searchItems(stack, 'x', () => undefined).map(i => i.id)).toEqual(['high', 'low'])
  })
})

describe('several walls per workspace', () => {
  it('keys the first wall the way a single wall was always keyed', () => {
    // old walls live at the old key
    expect(wallDocKey('work')).toBe('wall_work')
    expect(wallDocKey('work', DEFAULT_WALL_ID)).toBe('wall_work')
  })

  it('keys later walls by id alone, so a workspace name cannot collide', () => {
    expect(wallDocKey('work', 'abc123')).toBe('wall_doc_abc123')
    // the naive scheme collides here
    expect(wallDocKey('work', 'side')).not.toBe(wallDocKey('work_side'))
  })

  it('scopes the index to the workspace', () => {
    expect(wallIndexKey('work')).toBe('wall_index_work')
  })

  it('gives a workspace with nothing stored the original wall', () => {
    const index = normalizeWallIndex(null)
    expect(index.walls).toEqual([{ id: DEFAULT_WALL_ID, name: 'Wall' }])
    expect(index.activeId).toBe(DEFAULT_WALL_ID)
  })

  it('reads a stored index back as it was written', () => {
    const stored = { version: 1, walls: [{ id: 'a', name: 'Ideas' }, { id: 'b', name: 'Ship' }], activeId: 'b' }
    expect(normalizeWallIndex(stored)).toEqual(stored)
    expect(normalizeWallIndex(JSON.stringify(stored))).toEqual(stored)
  })

  it('leaves a deleted original wall deleted', () => {
    // seeding only for an empty list, or a removed first wall returns
    const index = normalizeWallIndex({ walls: [{ id: 'a', name: 'Ideas' }], activeId: 'a' })
    expect(index.walls.map(w => w.id)).toEqual(['a'])
  })

  it('drops entries that are unusable, and duplicated ids', () => {
    const index = normalizeWallIndex({
      walls: [{ id: 'a', name: 'Ideas' }, { id: 'a', name: 'Copy' }, { name: 'No id' }, null, 7],
      activeId: 'a'
    })
    expect(index.walls).toEqual([{ id: 'a', name: 'Ideas' }])
  })

  it('names an unnamed wall rather than showing a blank row', () => {
    expect(normalizeWallIndex({ walls: [{ id: 'a', name: '  ' }] }).walls[0].name).toBe('Wall')
  })

  it('falls back to the first wall when the active one is gone', () => {
    const index = normalizeWallIndex({ walls: [{ id: 'a', name: 'Ideas' }], activeId: 'vanished' })
    expect(index.activeId).toBe('a')
  })

  it('opens a newly created wall, since making one is a request to use it', () => {
    const { index, wall } = createWall(normalizeWallIndex(null), 'Sprint 4')
    expect(wall.name).toBe('Sprint 4')
    expect(index.walls).toHaveLength(2)
    expect(index.activeId).toBe(wall.id)
  })

  it('numbers an unnamed new wall', () => {
    const { wall } = createWall(normalizeWallIndex(null))
    expect(wall.name).toBe('Wall 2')
  })

  it('gives new walls distinct ids', () => {
    const first = createWall(normalizeWallIndex(null))
    const second = createWall(first.index)
    expect(second.wall.id).not.toBe(first.wall.id)
    expect(second.index.walls).toHaveLength(3)
  })

  it('renames a wall, and ignores a name that is only whitespace', () => {
    const base = normalizeWallIndex(null)
    expect(renameWall(base, DEFAULT_WALL_ID, ' Moodboard ').walls[0].name).toBe('Moodboard')
    expect(renameWall(base, DEFAULT_WALL_ID, '   ')).toBe(base)
  })

  it('refuses to remove the last wall', () => {
    const base = normalizeWallIndex(null)
    expect(removeWall(base, DEFAULT_WALL_ID)).toBe(base)
  })

  it('moves off a removed wall onto one that still exists', () => {
    const { index } = createWall(normalizeWallIndex(null), 'Second')
    const after = removeWall(index, index.activeId)
    expect(after.walls).toHaveLength(1)
    expect(after.activeId).toBe(DEFAULT_WALL_ID)
  })

  it('leaves the open wall alone when a different one is removed', () => {
    const { index } = createWall(normalizeWallIndex(null), 'Second')
    const after = removeWall(index, DEFAULT_WALL_ID)
    expect(after.activeId).toBe(index.activeId)
  })

  it('only switches to a wall that exists', () => {
    const base = normalizeWallIndex({ walls: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], activeId: 'a' })
    expect(setActiveWall(base, 'b').activeId).toBe('b')
    expect(setActiveWall(base, 'nope')).toBe(base)
  })
})

describe('a frame carries what is inside it', () => {
  const frame = (over: Partial<WallItem> = {}): WallItem =>
    item({ id: 'f', kind: 'frame', x: 0, y: 0, width: 200, height: 200, ...over })

  it('holds an item whose centre is inside it', () => {
    const inside = item({ id: 'a', x: 50, y: 50, width: 20, height: 20 })
    expect(itemsInFrame([frame(), inside], frame())).toEqual(['a'])
  })

  it('holds one hanging over the edge, since that still reads as inside', () => {
    // centre inside at 195, edge hangs to 210; full enclosure would drop it
    const straddling = item({ id: 'a', x: 180, y: 50, width: 30, height: 20 })
    expect(itemsInFrame([frame(), straddling], frame())).toEqual(['a'])
  })

  it('leaves out one whose centre is beyond the edge', () => {
    const outside = item({ id: 'a', x: 195, y: 50, width: 40, height: 20 })
    expect(itemsInFrame([frame(), outside], frame())).toEqual([])
  })

  it('leaves out a locked item, which is pinned on purpose', () => {
    const pinned = item({ id: 'a', x: 50, y: 50, width: 20, height: 20, locked: true })
    expect(itemsInFrame([frame(), pinned], frame())).toEqual([])
  })

  it('never holds itself', () => {
    expect(itemsInFrame([frame()], frame())).toEqual([])
  })

  it('returns nothing for an item that is not a frame', () => {
    const note = item({ id: 'n', kind: 'note', x: 0, y: 0, width: 200, height: 200 })
    expect(itemsInFrame([note, item({ id: 'a', x: 50, y: 50 })], note)).toEqual([])
  })
})

describe('what actually moves when a frame is dragged', () => {
  it('adds the frame’s contents to the selection being moved', () => {
    const items = [
      item({ id: 'f', kind: 'frame', x: 0, y: 0, width: 200, height: 200 }),
      item({ id: 'a', x: 50, y: 50, width: 20, height: 20 })
    ]
    expect(withFrameContents(items, new Set(['f']))).toEqual(new Set(['f', 'a']))
  })

  it('leaves a plain selection alone', () => {
    const items = [item({ id: 'a' }), item({ id: 'b' })]
    expect(withFrameContents(items, new Set(['a']))).toEqual(new Set(['a']))
  })

  it('follows a frame inside a frame', () => {
    const items = [
      item({ id: 'outer', kind: 'frame', x: 0, y: 0, width: 400, height: 400 }),
      item({ id: 'inner', kind: 'frame', x: 20, y: 20, width: 100, height: 100 }),
      item({ id: 'leaf', x: 40, y: 40, width: 10, height: 10 })
    ]
    expect(withFrameContents(items, new Set(['outer']))).toEqual(new Set(['outer', 'inner', 'leaf']))
  })

  it('terminates when two frames sit inside each other', () => {
    // overlapping frames contain each other's centres; the set only grows
    const items = [
      item({ id: 'f1', kind: 'frame', x: 0, y: 0, width: 100, height: 100 }),
      item({ id: 'f2', kind: 'frame', x: 10, y: 10, width: 100, height: 100 })
    ]
    expect(withFrameContents(items, new Set(['f1']))).toEqual(new Set(['f1', 'f2']))
  })

  it('does not move an item that only a different frame holds', () => {
    const items = [
      item({ id: 'f1', kind: 'frame', x: 0, y: 0, width: 100, height: 100 }),
      item({ id: 'f2', kind: 'frame', x: 500, y: 500, width: 100, height: 100 }),
      item({ id: 'a', x: 520, y: 520, width: 10, height: 10 })
    ]
    expect(withFrameContents(items, new Set(['f1']))).toEqual(new Set(['f1']))
  })
})
