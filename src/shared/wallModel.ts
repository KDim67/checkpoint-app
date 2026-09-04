/**
 * The Wall: a freeform canvas per workspace. Nothing snaps, sorts or has a
 * status, so the model stays dumb. Coordinates, sizes, colours, paint order.
 *
 * A card here is a reference, never a copy. It stores an id, so the card always
 * renders live instead of going stale.
 *
 * Hand-normalised like `boardModel.ts`: this is user data that outlives builds.
 */

/**
 * `note` is a sticky note, `doc` a real note from the Notes view. Yes,
 * `sticky`/`note` would read better, but walls already store stickies as
 * `note` and no migration could tell the two apart after a rename.
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

/** A wall's identity. The contents live under `wallDocKey`, not in here. */
export interface WallRef {
  id: string
  name: string
}

export interface WallIndex {
  version: 1
  walls: WallRef[]
  activeId: string
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

/**
 * The first wall keeps the original single-wall key so old walls are still
 * found. Later ones are keyed by id alone. Workspace names are free text, so
 * `wall_${context}_${id}` could collide with another workspace's wall.
 */
export const DEFAULT_WALL_ID = 'main'
export const DEFAULT_WALL_NAME = 'Wall'

export const wallDocKey = (context: string, wallId: string = DEFAULT_WALL_ID): string =>
  wallId === DEFAULT_WALL_ID ? `wall_${context}` : `wall_doc_${wallId}`

/** Which walls a workspace has, and which one it was left on. */
export const wallIndexKey = (context: string): string => `wall_index_${context}`

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
 * Accepts anything. A parsed document, a JSON string, undefined, an older
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
 * Frames everything, with breathing room. This is "fit to content". The way
 * back from panning into empty space, which has no scrollbars to rescue you.
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
 * Intersection, not containment. Needing to enclose a big frame means zooming
 * out first, which feels broken. Locked items skipped; that is what locked is.
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
 * Offset so duplicates are not exactly on top of the originals. Returns only
 * the new items. The caller appends and selects them.
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
 * Topmost item under a wall point. Needed because pointer capture retargets the
 * following click/dblclick to the viewport, so `event.target` lies.
 *
 * Uses the unrotated box, so rotated items are a little generous at the corners.
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

/** A camera that centres one item in the viewport, keeping the current zoom. */
export function cameraCentredOn(
  item: WallItem,
  viewport: { width: number; height: number },
  zoom: number
): WallCamera {
  return {
    zoom,
    x: viewport.width / 2 - (item.x + item.width / 2) * zoom,
    y: viewport.height / 2 - (item.y + item.height / 2) * zoom
  }
}

/**
 * Titles live on the referenced record, not the wall item, so the caller
 * resolves them and passes them in.
 */
export function searchableText(item: WallItem, resolvedTitle?: string): string {
  return [item.text ?? '', resolvedTitle ?? ''].join(' ').trim().toLowerCase()
}

/** Items whose text contains every word of the query, in paint order. */
export function searchItems(
  items: WallItem[],
  query: string,
  titleOf: (item: WallItem) => string | undefined
): WallItem[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return []
  return inPaintOrder(items)
    .filter(i => {
      const hay = searchableText(i, titleOf(i))
      return hay && words.every(w => hay.includes(w))
    })
    .reverse()
}

// Several walls per workspace

function newWallId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
}

export function normalizeWallIndex(raw: unknown): WallIndex {
  let source = raw
  if (typeof raw === 'string') {
    try { source = JSON.parse(raw) } catch { source = null }
  }

  const o = source && typeof source === 'object' && !Array.isArray(source)
    ? (source as Record<string, unknown>)
    : {}

  const seen = new Set<string>()
  const walls: WallRef[] = (Array.isArray(o.walls) ? o.walls : [])
    .map((entry): WallRef | null => {
      if (!entry || typeof entry !== 'object') return null
      const e = entry as Record<string, unknown>
      const id = str(e.id).trim()
      // A duplicate id would mean two tabs writing the same document, which
      // reads as one wall losing edits to another.
      if (!id || seen.has(id)) return null
      seen.add(id)
      return { id, name: str(e.name).trim() || DEFAULT_WALL_NAME }
    })
    .filter((w): w is WallRef => w !== null)

  // Only when nothing was stored: a workspace that has never had an index still
  // has a wall at the original key, and this is what makes it reachable. A
  // stored list is trusted as it stands, so a deleted wall stays deleted.
  if (walls.length === 0) walls.push({ id: DEFAULT_WALL_ID, name: DEFAULT_WALL_NAME })

  const stored = str(o.activeId)
  return {
    version: 1,
    walls,
    activeId: walls.some(w => w.id === stored) ? stored : walls[0].id
  }
}

/** Adds a wall and switches to it, since creating one is a request to use it. */
export function createWall(index: WallIndex, name?: string): { index: WallIndex; wall: WallRef } {
  const wall: WallRef = {
    id: newWallId(),
    name: (name ?? '').trim() || `Wall ${index.walls.length + 1}`
  }
  return {
    index: { ...index, walls: [...index.walls, wall], activeId: wall.id },
    wall
  }
}

export function renameWall(index: WallIndex, id: string, name: string): WallIndex {
  const trimmed = name.trim()
  if (!trimmed) return index
  return { ...index, walls: index.walls.map(w => (w.id === id ? { ...w, name: trimmed } : w)) }
}

/**
 * Refuses to remove the last wall: a workspace with no wall has nowhere to put
 * the next thing, and the view would have nothing to show.
 */
export function removeWall(index: WallIndex, id: string): WallIndex {
  if (index.walls.length <= 1) return index
  const walls = index.walls.filter(w => w.id !== id)
  if (walls.length === index.walls.length) return index
  return {
    ...index,
    walls,
    activeId: index.activeId === id ? walls[0].id : index.activeId
  }
}

export function setActiveWall(index: WallIndex, id: string): WallIndex {
  return index.walls.some(w => w.id === id) ? { ...index, activeId: id } : index
}

// Frames as containers

/**
 * What a frame holds. Items whose centre is inside it. Centre, not full
 * enclosure, or a frame quietly drops things at its border.
 *
 * Locked items excluded (a locked background image is the usual case), and
 * rotation ignored: the unrotated rect is what gets tested.
 */
export function itemsInFrame(items: WallItem[], frame: WallItem): string[] {
  if (frame.kind !== 'frame') return []
  const right = frame.x + frame.width
  const bottom = frame.y + frame.height

  return items
    .filter(item => {
      if (item.id === frame.id || item.locked) return false
      const cx = item.x + item.width / 2
      const cy = item.y + item.height / 2
      return cx >= frame.x && cx <= right && cy >= frame.y && cy <= bottom
    })
    .map(item => item.id)
}

/**
 * What actually moves: a frame brings its contents. Loops until nothing new is
 * added so nested frames follow. Terminates because the set only grows.
 */
export function withFrameContents(items: WallItem[], ids: Set<string>): Set<string> {
  const out = new Set(ids)
  let growing = true

  while (growing) {
    growing = false
    for (const item of items) {
      if (item.kind !== 'frame' || !out.has(item.id)) continue
      for (const inner of itemsInFrame(items, item)) {
        if (!out.has(inner)) {
          out.add(inner)
          growing = true
        }
      }
    }
  }
  return out
}
