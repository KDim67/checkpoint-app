/**
 * The Wall: a freeform canvas per workspace.
 *
 * Everything else in Checkpoint imposes a shape, columns, a list, a timeline.
 * The Wall imposes none. Nothing snaps, nothing sorts, nothing has a status,
 * and an item is wherever you put it. That is the whole point, so this model
 * stays deliberately dumb: coordinates, sizes, colours, and paint order.
 *
 * One decision matters more than the rest. **A card on the Wall is a reference,
 * never a copy.** It stores the item's id and nothing else, so the card renders
 * with its real title, status, tags and due date, and editing it anywhere
 * changes it everywhere. A canvas full of stale duplicates would be worse than
 * no canvas at all, which is what every sticky-note tool ends up being.
 *
 * Pure, and hand-normalised in the same style as `boardModel.ts`: this document
 * is user data that survives across versions, so every field has to survive
 * being absent, wrong, or written by an older build.
 */

/**
 * `note` is a sticky note, paper, written on the wall itself. `doc` is a real
 * note from the Notes view, referenced by title.
 *
 * They are not named the other way round, however much `sticky`/`note` would
 * read better: walls already exist that store sticky notes as `note`, and no
 * migration could tell an old sticky from a new document after a rename.
 */
export type WallItemKind = 'card' | 'note' | 'doc' | 'image' | 'text' | 'frame'

export interface WallItem {
  /** Wall-local id. Two placements of the same card are two items. */
  id: string
  kind: WallItemKind
  x: number
  y: number
  width: number
  height: number
  /**
   * What this points at: an item id for 'card', a note title for 'doc', a media
   * filename for 'image'. Unused by 'note', 'text' and 'frame'.
   */
  ref?: string
  /** Body for 'note' and 'text'; the label for 'frame'. */
  text?: string
  /** Hex, or absent to use the kind's default. */
  color?: string
  /** Degrees. Freedom includes the freedom to put something on a slant. */
  rotation?: number
  /** Paint order. Explicit because it has to survive a reload. */
  z: number
  /**
   * Pinned in place: not draggable, not resizable, not selectable by marquee.
   * What a background reference image needs so that reaching past it to pan
   * does not drag it instead.
   */
  locked?: boolean
}

export interface WallCamera {
  x: number
  y: number
  zoom: number
}

export interface WallDoc {
  version: 1
  items: WallItem[]
  /** Persisted so reopening a wall lands where you left it, not at the origin. */
  camera: WallCamera
  /** Hex, or a preset name the view understands. */
  background: string
}

// Defaults

export const MIN_ZOOM = 0.2
export const MAX_ZOOM = 3

/** Sizes chosen so a freshly dropped item is legible without being resized. */
export const DEFAULT_SIZES: Record<WallItemKind, { width: number; height: number }> = {
  card: { width: 260, height: 120 },
  note: { width: 200, height: 200 },
  doc: { width: 240, height: 150 },
  image: { width: 280, height: 200 },
  text: { width: 240, height: 48 },
  frame: { width: 480, height: 360 }
}

/** Sticky-note colours. Muted on purpose: a wall of saturated squares is noise. */
export const WALL_COLORS = [
  '#f6c453', '#f28b82', '#a7c7e7', '#b5e6b5',
  '#d7b3e8', '#f5b78c', '#9fdfd5', '#cfd3da'
]

export const DEFAULT_CAMERA: WallCamera = { x: 0, y: 0, zoom: 1 }

/** One document per workspace, keyed like the board's. */
export const wallDocKey = (context: string): string => `wall_${context}`

// Normalisation

function num(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v))
  return Number.isFinite(n) ? n : fallback
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

const KINDS: WallItemKind[] = ['card', 'note', 'doc', 'image', 'text', 'frame']

export function normalizeWallItem(raw: unknown, index: number): WallItem | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>

  const kind = KINDS.includes(o.kind as WallItemKind) ? (o.kind as WallItemKind) : null
  if (!kind) return null

  // A card, doc or image with nothing to point at cannot render, and an empty
  // box the user cannot identify is worse than a missing one.
  const ref = str(o.ref).trim()
  if ((kind === 'card' || kind === 'doc' || kind === 'image') && !ref) return null

  const size = DEFAULT_SIZES[kind]
  return {
    id: str(o.id).trim() || `w${index}-${Math.random().toString(36).slice(2, 8)}`,
    kind,
    x: num(o.x, 0),
    y: num(o.y, 0),
    // Floors rather than defaults: a zero-size item is unclickable and so
    // unrecoverable without editing the database by hand.
    width: Math.max(40, num(o.width, size.width)),
    height: Math.max(32, num(o.height, size.height)),
    ...(ref ? { ref } : {}),
    ...(typeof o.text === 'string' ? { text: o.text } : {}),
    ...(str(o.color) ? { color: str(o.color) } : {}),
    ...(Number.isFinite(num(o.rotation, NaN)) ? { rotation: num(o.rotation, 0) } : {}),
    ...(o.locked === true ? { locked: true } : {}),
    z: num(o.z, index)
  }
}

export function normalizeCamera(raw: unknown): WallCamera {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_CAMERA }
  const o = raw as Record<string, unknown>
  return {
    x: num(o.x, 0),
    y: num(o.y, 0),
    zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, num(o.zoom, 1)))
  }
}

/**
 * Accepts anything, a parsed document, a JSON string, undefined, an older
 * shape, and returns a wall that will render.
 */
export function normalizeWallDoc(raw: unknown): WallDoc {
  let source = raw
  if (typeof raw === 'string') {
    try { source = JSON.parse(raw) } catch { source = null }
  }

  const o = source && typeof source === 'object' && !Array.isArray(source)
    ? (source as Record<string, unknown>)
    : {}

  const items = (Array.isArray(o.items) ? o.items : [])
    .map((item, i) => normalizeWallItem(item, i))
    .filter((item): item is WallItem => item !== null)

  return {
    version: 1,
    items,
    camera: normalizeCamera(o.camera),
    background: str(o.background) || 'default'
  }
}

// Operations

/** The next paint order above everything present. */
export function topZ(items: WallItem[]): number {
  return items.reduce((max, i) => Math.max(max, i.z), 0) + 1
}

/** Moves one item to the front without disturbing the order of the rest. */
export function bringToFront(items: WallItem[], id: string): WallItem[] {
  const top = topZ(items)
  return items.map(i => (i.id === id ? { ...i, z: top } : i))
}

export function sendToBack(items: WallItem[], id: string): WallItem[] {
  const min = items.reduce((m, i) => Math.min(m, i.z), 0) - 1
  return items.map(i => (i.id === id ? { ...i, z: min } : i))
}

/** Painting order: lowest z first, so the highest ends up on top. */
export function inPaintOrder(items: WallItem[]): WallItem[] {
  return [...items].sort((a, b) => a.z - b.z)
}

export interface Bounds { minX: number; minY: number; maxX: number; maxY: number }

export function boundsOf(items: WallItem[]): Bounds | null {
  if (items.length === 0) return null
  return items.reduce<Bounds>(
    (b, i) => ({
      minX: Math.min(b.minX, i.x),
      minY: Math.min(b.minY, i.y),
      maxX: Math.max(b.maxX, i.x + i.width),
      maxY: Math.max(b.maxY, i.y + i.height)
    }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
  )
}

/**
 * A camera that frames everything, with breathing room.
 *
 * Used by "fit to content", which is the way back when you have panned into
 * empty space, on an infinite canvas with no scrollbars, being lost is the
 * one failure the user cannot get out of on their own.
 */
export function fitCamera(
  items: WallItem[],
  viewport: { width: number; height: number },
  padding = 80
): WallCamera {
  const b = boundsOf(items)
  if (!b || viewport.width <= 0 || viewport.height <= 0) return { ...DEFAULT_CAMERA }

  const contentWidth = Math.max(1, b.maxX - b.minX)
  const contentHeight = Math.max(1, b.maxY - b.minY)
  const zoom = Math.min(
    MAX_ZOOM,
    Math.max(
      MIN_ZOOM,
      Math.min(
        (viewport.width - padding * 2) / contentWidth,
        (viewport.height - padding * 2) / contentHeight
      )
    )
  )

  // Centre the content: the camera offset is in screen space, so the content
  // centre is scaled before being subtracted.
  return {
    zoom,
    x: viewport.width / 2 - ((b.minX + b.maxX) / 2) * zoom,
    y: viewport.height / 2 - ((b.minY + b.maxY) / 2) * zoom
  }
}

/** Screen point to wall point, for dropping something where the cursor is. */
export function toWallPoint(
  screen: { x: number; y: number },
  camera: WallCamera
): { x: number; y: number } {
  return {
    x: (screen.x - camera.x) / camera.zoom,
    y: (screen.y - camera.y) / camera.zoom
  }
}

/** Zooms about a point, so the thing under the cursor stays under the cursor. */
export function zoomAt(
  camera: WallCamera,
  screen: { x: number; y: number },
  factor: number
): WallCamera {
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, camera.zoom * factor))
  // Nothing to do if the clamp swallowed the change; recomputing would drift
  // the camera sideways for no visible zoom.
  if (zoom === camera.zoom) return camera

  const before = toWallPoint(screen, camera)
  return {
    zoom,
    x: screen.x - before.x * zoom,
    y: screen.y - before.y * zoom
  }
}

/** Creates an item at a wall position, sized and coloured for its kind. */
export function createWallItem(
  kind: WallItemKind,
  at: { x: number; y: number },
  items: WallItem[],
  extra: Partial<WallItem> = {}
): WallItem {
  const size = DEFAULT_SIZES[kind]
  return {
    id: `w-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    kind,
    // Placed centred on the cursor rather than starting there, which is what
    // dropping something somewhere feels like it should do.
    x: at.x - size.width / 2,
    y: at.y - size.height / 2,
    width: size.width,
    height: size.height,
    z: topZ(items),
    ...extra
  }
}

// Selection and bulk edits

export interface Rect { x: number; y: number; width: number; height: number }

/** Normalises a drag between two points into a rectangle with positive size. */
export function rectFromPoints(a: { x: number; y: number }, b: { x: number; y: number }): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y)
  }
}

/**
 * Ids of items the marquee touches.
 *
 * Intersection rather than containment: having to fully enclose a large frame
 * to select it means zooming out first, and every tool that gets this wrong
 * feels broken. Locked items are skipped, being unselectable is what locked
 * means.
 */
export function itemsInRect(items: WallItem[], rect: Rect): string[] {
  const right = rect.x + rect.width
  const bottom = rect.y + rect.height
  return items
    .filter(i => !i.locked)
    .filter(i => i.x < right && i.x + i.width > rect.x && i.y < bottom && i.y + i.height > rect.y)
    .map(i => i.id)
}

/** Moves a set of items together, leaving locked ones where they are. */
export function moveItems(items: WallItem[], ids: Set<string>, dx: number, dy: number): WallItem[] {
  return items.map(i =>
    ids.has(i.id) && !i.locked ? { ...i, x: i.x + dx, y: i.y + dy } : i
  )
}

/** Applies the same patch to a set of items. Locked items are left alone. */
export function patchItems(
  items: WallItem[],
  ids: Set<string>,
  patch: Partial<WallItem>
): WallItem[] {
  return items.map(i => (ids.has(i.id) && !i.locked ? { ...i, ...patch } : i))
}

/**
 * Copies items, offset so the duplicates are visibly separate from the
 * originals rather than exactly on top of them.
 *
 * Returns the new items only; the caller appends and selects them, so a
 * duplicate can be dragged away immediately.
 */
export function duplicateItems(
  items: WallItem[],
  ids: Set<string>,
  offset = 24
): WallItem[] {
  let z = topZ(items)
  return items
    .filter(i => ids.has(i.id))
    .map(i => {
      const copy: WallItem = {
        ...i,
        id: `w-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
        x: i.x + offset,
        y: i.y + offset,
        z: z++
      }
      // A duplicate arrives unlocked whatever the original was: otherwise the
      // copy of a locked background cannot be moved into place.
      delete copy.locked
      return copy
    })
}

/** Rounds to a grid. Used only when the user asks for snapping. */
export function snap(value: number, grid: number): number {
  if (grid <= 0) return value
  return Math.round(value / grid) * grid
}

export const SNAP_GRID = 24

/**
 * The topmost item containing a wall point, or null.
 *
 * Needed because the canvas takes pointer capture while dragging, and a
 * captured pointer retargets the click and dblclick that follow to the
 * capturing element, so `event.target` reports the viewport rather than the
 * item that was actually under the cursor. Coordinates do not lie.
 *
 * Hit-testing uses the unrotated box. A rotated item is therefore slightly
 * generous at its corners, which is the harmless direction to be wrong in.
 */
export function itemAtPoint(items: WallItem[], point: { x: number; y: number }): WallItem | null {
  let hit: WallItem | null = null
  for (const i of items) {
    const inside =
      point.x >= i.x && point.x <= i.x + i.width &&
      point.y >= i.y && point.y <= i.y + i.height
    if (inside && (!hit || i.z > hit.z)) hit = i
  }
  return hit
}
