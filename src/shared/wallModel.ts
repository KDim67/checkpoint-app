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
export type WallItemKind = 'card' | 'note' | 'doc' | 'image' | 'text' | 'frame' | 'ink' | 'arrow'

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
  /** Body for 'note' and 'text'; the label for 'frame' and for an arrow. */
  text?: string
  /** Hex, or absent to use the kind's default. */
  color?: string
  /**
   * An ink stroke, as flat [x0,y0,x1,y1,…] in the item's own box. Kept in box
   * coordinates rather than wall ones so moving and resizing are the same
   * operations they are for everything else: the SVG scales with the box.
   */
  points?: number[]
  strokeWidth?: number
  /**
   * How hard this stroke was smoothed, 0 to 1. Absent or zero draws the raw
   * samples. Stored per stroke rather than read from the live setting, so
   * turning smoothing off later does not redraw the lines already on the wall.
   */
  smooth?: number
  /**
   * An arrow's ends, as item ids. An arrow is not positioned: it is redrawn
   * from whatever the two items are doing, so it follows them for free and
   * cannot drift out of step with what it is pointing at.
   */
  from?: string
  to?: string
  /**
   * Where an end sits when it is attached to nothing, in wall coordinates.
   * An end has one or the other: an item it follows, or a point it stays at.
   */
  fromPoint?: { x: number; y: number }
  toPoint?: { x: number; y: number }
  /**
   * How an arrow is drawn. All three are absent at their default, so an arrow
   * saved before styles existed still reads as the plain one it was.
   */
  arrowShape?: ArrowShape
  arrowLine?: ArrowLine
  arrowHeads?: ArrowHeads
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
  frame: { width: 480, height: 360 },
  // Both are sized from their contents, never from a default.
  ink: { width: 120, height: 120 },
  arrow: { width: 1, height: 1 }
}

/** Sticky-note colours. Muted on purpose: a wall of saturated squares is noise. */
export const WALL_COLORS = [
  '#f6c453', '#f28b82', '#a7c7e7', '#b5e6b5',
  '#d7b3e8', '#f5b78c', '#9fdfd5', '#cfd3da'
]

const DEFAULT_CAMERA: WallCamera = { x: 0, y: 0, zoom: 1 }

/**
 * The first wall keeps the original single-wall key so old walls are still
 * found. Later ones are keyed by id alone. Workspace names are free text, so
 * `wall_${context}_${id}` could collide with another workspace's wall.
 */
export const DEFAULT_WALL_ID = 'main'
const DEFAULT_WALL_NAME = 'Wall'

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

const KINDS: WallItemKind[] = ['card', 'note', 'doc', 'image', 'text', 'frame', 'ink', 'arrow']

/** Pen widths, in wall units. Three is enough to be useful and to choose from. */
export const STROKE_WIDTHS = [2, 4, 8]

/** The route a connector takes between its two items. */
export type ArrowShape = 'straight' | 'curved' | 'elbow'
/** What the line itself looks like. */
export type ArrowLine = 'solid' | 'dashed' | 'dotted'
/** Which ends get a head. `none` makes it a plain connector. */
export type ArrowHeads = 'end' | 'both' | 'none'

// Order matters: the palette steps through each in turn, and the first is the
// default that is never written to the document.
export const ARROW_SHAPES: readonly ArrowShape[] = ['straight', 'curved', 'elbow']
export const ARROW_LINES: readonly ArrowLine[] = ['solid', 'dashed', 'dotted']
export const ARROW_HEAD_MODES: readonly ArrowHeads[] = ['end', 'both', 'none']

/** How hard a smoothed stroke gets smoothed. The pen offers this or nothing. */
export const SMOOTHING_STRENGTH = 0.9

/** A point off a stored document, or null if either coordinate is unusable. */
function readPoint(raw: unknown): { x: number; y: number } | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  const x = num(o.x, NaN)
  const y = num(o.y, NaN)
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null
}

/**
 * A path is only a path with two points, and an odd-length array means the
 * coordinates have been truncated somewhere, so the pairs cannot be trusted.
 */
function normalizePoints(raw: unknown): number[] | null {
  if (!Array.isArray(raw) || raw.length < 4 || raw.length % 2 !== 0) return null
  const points = raw.map(v => (typeof v === 'number' && Number.isFinite(v) ? v : null))
  return points.every((v): v is number => v !== null) ? (points as number[]) : null
}

export function normalizeWallItem(raw: unknown, index: number): WallItem | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>

  const kind = KINDS.includes(o.kind as WallItemKind) ? (o.kind as WallItemKind) : null
  if (!kind) return null

  // A card, doc or image with nothing to point at cannot render, and an empty
  // box the user cannot identify is worse than a missing one.
  const ref = str(o.ref).trim()
  if ((kind === 'card' || kind === 'doc' || kind === 'image') && !ref) return null

  // Same rule for the two drawn kinds: a stroke with no path and an arrow with
  // no ends are both invisible, and an invisible item cannot be selected to be
  // deleted.
  const points = normalizePoints(o.points)
  if (kind === 'ink' && !points) return null

  const from = str(o.from).trim()
  const to = str(o.to).trim()
  const fromPoint = readPoint(o.fromPoint)
  const toPoint = readPoint(o.toPoint)
  // Each end needs one anchor or the other. An end with neither cannot be
  // drawn, and an arrow that cannot be drawn cannot be selected to be deleted.
  if (kind === 'arrow' && ((!from && !fromPoint) || (!to && !toPoint))) return null

  // `true` is what the first version wrote, and the build after it wrote a
  // strength off a dial. Any strength still renders, so nothing already drawn
  // changes shape under the user.
  const smooth = o.smooth === true
    ? SMOOTHING_STRENGTH
    : Math.min(1, Math.max(0, num(o.smooth, 0)))

  // Anything unrecognised falls back to the default rather than being kept,
  // so a document edited by hand cannot ask for a style that cannot be drawn.
  const oneOf = <T extends string>(value: unknown, allowed: readonly T[]): T | null => {
    const v = str(value) as T
    return allowed.includes(v) ? v : null
  }
  const arrowShape = oneOf(o.arrowShape, ARROW_SHAPES)
  const arrowLine = oneOf(o.arrowLine, ARROW_LINES)
  const arrowHeads = oneOf(o.arrowHeads, ARROW_HEAD_MODES)

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
    ...(points ? { points } : {}),
    ...(num(o.strokeWidth, 0) > 0 ? { strokeWidth: num(o.strokeWidth, STROKE_WIDTHS[1]) } : {}),
    ...(smooth > 0 ? { smooth } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    // The item wins when both are somehow present, so a stale point left over
    // from a detached end cannot override the thing it was reattached to.
    ...(!from && fromPoint ? { fromPoint } : {}),
    ...(!to && toPoint ? { toPoint } : {}),
    // The default is left out, so only an arrow that was actually restyled
    // carries the field.
    ...(arrowShape && arrowShape !== ARROW_SHAPES[0] ? { arrowShape } : {}),
    ...(arrowLine && arrowLine !== ARROW_LINES[0] ? { arrowLine } : {}),
    ...(arrowHeads && arrowHeads !== ARROW_HEAD_MODES[0] ? { arrowHeads } : {}),
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
  // An arrow's own box is a placeholder that is not where it is drawn, so
  // counting it would pull "fit to content" towards a point with nothing at
  // it. An end pinned to the wall is different: that really is somewhere the
  // wall extends to, and leaving it out crops it off an export.
  const boxed = items.filter(i => i.kind !== 'arrow')
  const loose = items
    .filter(i => i.kind === 'arrow')
    .flatMap(i => [i.fromPoint, i.toPoint])
    .filter((p): p is { x: number; y: number } => !!p)

  if (boxed.length === 0 && loose.length === 0) return null

  const bounds = boxed.reduce<Bounds>(
    (b, i) => ({
      minX: Math.min(b.minX, i.x),
      minY: Math.min(b.minY, i.y),
      maxX: Math.max(b.maxX, i.x + i.width),
      maxY: Math.max(b.maxY, i.y + i.height)
    }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
  )

  return loose.reduce<Bounds>(
    (b, p) => ({
      minX: Math.min(b.minX, p.x),
      minY: Math.min(b.minY, p.y),
      maxX: Math.max(b.maxX, p.x),
      maxY: Math.max(b.maxY, p.y)
    }),
    bounds
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
    .filter(i => !i.locked && i.kind !== 'arrow')
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

/** Dots closer together than this stop reading as dots. */
export const MIN_GRID_PX = 12

/**
 * The spacing to draw the background dots at, in screen pixels.
 *
 * The step doubles instead of the spacing shrinking without limit. Zoomed all
 * the way out the plain grid lands under five pixels apart, which Chromium
 * paints as a flat tint rather than as dots, and in patches that disagree with
 * each other along its tile boundaries.
 */
export function gridSpacing(zoom: number): number {
  if (!(zoom > 0)) return SNAP_GRID
  let step = SNAP_GRID
  while (step * zoom < MIN_GRID_PX) step *= 2
  return step * zoom
}

/**
 * Topmost item under a wall point. Needed because pointer capture retargets the
 * following click/dblclick to the viewport, so `event.target` lies.
 *
 * Uses the unrotated box, so rotated items are a little generous at the corners.
 */
export function itemAtPoint(items: WallItem[], point: { x: number; y: number }): WallItem | null {
  let hit: WallItem | null = null
  for (const i of items) {
    // Neither of these is really the shape of its box. An arrow's box is a
    // placeholder, and a stroke's is a rectangle around a line that is mostly
    // not in it, so treating either as solid blocks whatever is underneath.
    if (i.kind === 'arrow' || i.kind === 'ink') continue
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
function searchableText(item: WallItem, resolvedTitle?: string): string {
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

// Drawing and arrows

/** Margin around a stroke so the cap is not clipped by its own box. */
const INK_PAD = 8

/**
 * Turns a drawn path in wall coordinates into an ink item.
 *
 * The box is the path's bounds plus a pad, and the points are rebased into it,
 * so the stroke moves and resizes like any other item with no special cases.
 * Null when the path is a single point, which is a click and not a stroke.
 */
/**
 * How far a sample may sit from the line between its neighbours before it is
 * worth keeping. In wall units, and well under a stroke's own width, so the
 * line that is drawn does not change shape.
 */
export const SIMPLIFY_TOLERANCE = 0.7

/**
 * Ramer-Douglas-Peucker: drops the samples a stroke does not need.
 *
 * A pointer emits a sample every few milliseconds, so a single confident
 * gesture arrives as hundreds of points sitting almost exactly on top of one
 * another. They cost nothing to draw but everything is stored: the wall
 * document is JSON in a settings row, it is synced between machines, and it is
 * exported. A drawing session used to add tens of thousands of numbers to it.
 *
 * The first and last points are always kept, so a line drawn to touch
 * something still touches it.
 */
export function simplifyPath(points: Point[], tolerance = SIMPLIFY_TOLERANCE): Point[] {
  if (points.length < 3) return points

  const keep = new Array<boolean>(points.length).fill(false)
  keep[0] = true
  keep[points.length - 1] = true

  // Iterative rather than recursive: a long stroke is thousands of points and
  // the recursion depth follows the data.
  const stack: Array<[number, number]> = [[0, points.length - 1]]

  for (let span = stack.pop(); span; span = stack.pop()) {
    const [first, last] = span
    if (last <= first + 1) continue

    let furthest = -1
    let worst = tolerance

    for (let i = first + 1; i < last; i++) {
      const distance = distanceToSegment(points[i], points[first], points[last])
      if (distance > worst) {
        worst = distance
        furthest = i
      }
    }

    // Nothing strays far enough, so everything between the ends goes.
    if (furthest === -1) continue

    keep[furthest] = true
    stack.push([first, furthest], [furthest, last])
  }

  return points.filter((_, i) => keep[i])
}

export function inkFromPath(
  path: { x: number; y: number }[],
  items: WallItem[],
  extra: Partial<WallItem> = {}
): WallItem | null {
  if (path.length < 2) return null

  // Thinned before the box is measured, so a sample dropped at the very edge
  // cannot leave the box larger than the stroke inside it.
  const simplified = simplifyPath(path)

  const xs = simplified.map(p => p.x)
  const ys = simplified.map(p => p.y)
  const minX = Math.min(...xs) - INK_PAD
  const minY = Math.min(...ys) - INK_PAD
  const width = Math.max(...xs) + INK_PAD - minX
  const height = Math.max(...ys) + INK_PAD - minY

  return {
    id: `w-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    kind: 'ink',
    x: minX,
    y: minY,
    // Not floored to the usual minimum: a straight horizontal line is a
    // legitimate stroke and its box is genuinely only as tall as the pad.
    width,
    height,
    points: simplified.flatMap(p => [p.x - minX, p.y - minY]),
    z: topZ(items),
    ...extra
  }
}

/**
 * The `d` of an ink stroke, in the box coordinates the SVG scales.
 *
 * Smoothed strokes curve through the midpoint of each pair of samples, using
 * the sample itself as the control point. Pointer samples are noisy and evenly
 * spaced, so this is enough to take the hand-shake out without the line
 * drifting away from where it was drawn.
 */
/**
 * Pulls each interior sample towards the average of its neighbours.
 *
 * The ends are left exactly where they were: a line drawn to touch something
 * has to keep touching it, however hard the rest is smoothed.
 */
export function smoothPoints(points: number[], strength: number): number[] {
  if (strength <= 0 || points.length < 6) return points

  const out = points.slice()
  for (let i = 2; i < points.length - 2; i += 2) {
    const midX = (points[i - 2] + points[i + 2]) / 2
    const midY = (points[i - 1] + points[i + 3]) / 2
    out[i] = points[i] + (midX - points[i]) * strength
    out[i + 1] = points[i + 1] + (midY - points[i + 1]) * strength
  }
  return out
}

export function inkPath(item: WallItem): string {
  const raw = item.points ?? []
  const p = smoothPoints(raw, item.smooth ?? 0)
  if (p.length < 4) return ''

  if (!item.smooth || p.length < 8) {
    return p.reduce((d, value, i) => {
      if (i % 2 !== 0) return d
      return `${d}${i === 0 ? 'M' : 'L'}${value.toFixed(1)},${p[i + 1].toFixed(1)}`
    }, '')
  }

  let d = `M${p[0].toFixed(1)},${p[1].toFixed(1)}`
  for (let i = 2; i < p.length - 2; i += 2) {
    const midX = (p[i] + p[i + 2]) / 2
    const midY = (p[i + 1] + p[i + 3]) / 2
    d += `Q${p[i].toFixed(1)},${p[i + 1].toFixed(1)} ${midX.toFixed(1)},${midY.toFixed(1)}`
  }
  // The last sample is joined straight, since it has no successor to average.
  return `${d}L${p[p.length - 2].toFixed(1)},${p[p.length - 1].toFixed(1)}`
}

export interface Point { x: number; y: number }

const centreOf = (item: WallItem): Point => ({
  x: item.x + item.width / 2,
  y: item.y + item.height / 2
})

/**
 * Where an arrow between two items should start and stop: on the edge of each
 * box rather than at its centre, so the head lands against the item instead of
 * inside it.
 */
export function arrowEnds(from: WallItem, to: WallItem): { start: Point; end: Point } {
  const a = centreOf(from)
  const b = centreOf(to)
  return { start: edgePoint(from, a, b), end: edgePoint(to, b, a) }
}

/** Walks from a box's centre towards a target and stops at the box edge. */
function edgePoint(box: WallItem, centre: Point, towards: Point): Point {
  const dx = towards.x - centre.x
  const dy = towards.y - centre.y
  if (dx === 0 && dy === 0) return centre

  // The scale at which the ray first crosses each pair of sides. The smaller
  // one is the side it actually leaves through.
  const scaleX = dx === 0 ? Infinity : (box.width / 2) / Math.abs(dx)
  const scaleY = dy === 0 ? Infinity : (box.height / 2) / Math.abs(dy)
  const scale = Math.min(scaleX, scaleY)

  return { x: centre.x + dx * scale, y: centre.y + dy * scale }
}

/** Distance from a point to a segment. Used to click a line that has no box. */
export function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lengthSq = dx * dx + dy * dy
  if (lengthSq === 0) return Math.hypot(p.x - a.x, p.y - a.y)

  // Clamped, so a point beyond either end measures to that end and not to the
  // infinite line through them.
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}


/** Distance to the nearest of a run of segments. */
export function distanceToPolyline(p: Point, points: Point[]): number {
  if (points.length === 0) return Infinity
  if (points.length === 1) return Math.hypot(p.x - points[0].x, p.y - points[0].y)

  let best = Infinity
  for (let i = 1; i < points.length; i++) {
    best = Math.min(best, distanceToSegment(p, points[i - 1], points[i]))
  }
  return best
}

/** The point where a ray leaving `box` horizontally or vertically crosses it. */
function sidePoint(box: WallItem, horizontal: boolean, positive: boolean): Point {
  const c = centreOf(box)
  return horizontal
    ? { x: c.x + (positive ? 1 : -1) * box.width / 2, y: c.y }
    : { x: c.x, y: c.y + (positive ? 1 : -1) * box.height / 2 }
}

/**
 * A path through a run of points with the corners taken off.
 *
 * The radius shrinks to fit whichever segment is shortest, so two items almost
 * on top of each other get a tight corner rather than a curve that overshoots
 * the line it belongs to.
 */
export function roundedPath(points: Point[], radius: number): string {
  if (points.length < 2) return ''
  if (points.length === 2) {
    return `M${points[0].x},${points[0].y}L${points[1].x},${points[1].y}`
  }

  let d = `M${points[0].x},${points[0].y}`
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1]
    const corner = points[i]
    const next = points[i + 1]

    const inLen = Math.hypot(corner.x - prev.x, corner.y - prev.y) || 1
    const outLen = Math.hypot(next.x - corner.x, next.y - corner.y) || 1
    const r = Math.min(radius, inLen / 2, outLen / 2)

    const enter = {
      x: corner.x - ((corner.x - prev.x) / inLen) * r,
      y: corner.y - ((corner.y - prev.y) / inLen) * r
    }
    const leave = {
      x: corner.x + ((next.x - corner.x) / outLen) * r,
      y: corner.y + ((next.y - corner.y) / outLen) * r
    }

    d += `L${enter.x},${enter.y}Q${corner.x},${corner.y} ${leave.x},${leave.y}`
  }

  const last = points[points.length - 1]
  return `${d}L${last.x},${last.y}`
}

/**
 * A point wearing an item's clothes, so a loose end goes through exactly the
 * same geometry as an attached one. A box with no size has its edge at its
 * centre, which is what a point is.
 */
function pointAnchor(p: Point): WallItem {
  return { id: '', kind: 'note', x: p.x, y: p.y, width: 0, height: 0, z: 0 }
}

/**
 * What an arrow's two ends currently resolve to, or null when one of them
 * names an item that is no longer there.
 */
export function arrowAnchors(
  arrow: WallItem,
  byId: Map<string, WallItem>
): { from: WallItem; to: WallItem } | null {
  const from = arrow.from ? byId.get(arrow.from) : arrow.fromPoint && pointAnchor(arrow.fromPoint)
  const to = arrow.to ? byId.get(arrow.to) : arrow.toPoint && pointAnchor(arrow.toPoint)
  return from && to ? { from, to } : null
}

/** How much shorter to draw the line at each end than it really is. */
interface ArrowTrim {
  start?: number
  end?: number
}

interface ArrowGeometry {
  /** Where the connector really begins and ends. The heads go here. */
  start: Point
  end: Point
  /** The line, as SVG path data, stopped short by whatever trim was asked for. */
  d: string
  /** Which way a head at the far end points, in radians. */
  endAngle: number
  /** Which way a head at the near end points. Back out of the item it left. */
  startAngle: number
  /** Straight segments following the line, for hit testing. */
  polyline: Point[]
  /**
   * Halfway along, where a label sits.
   *
   * Measured on the untrimmed line, so adding or removing an arrowhead does
   * not shift the label that is already there.
   */
  mid: Point
}

/** The point half way along a run of segments, by length rather than by index. */
export function midpointAlong(points: Point[]): Point {
  if (points.length === 0) return { x: 0, y: 0 }
  if (points.length === 1) return points[0]

  const legs: number[] = []
  let total = 0
  for (let i = 1; i < points.length; i++) {
    const length = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y)
    legs.push(length)
    total += length
  }
  // Every point in the same place, so anywhere is the middle.
  if (total === 0) return points[0]

  let walked = 0
  for (let i = 0; i < legs.length; i++) {
    if (walked + legs[i] >= total / 2) {
      const t = legs[i] === 0 ? 0 : (total / 2 - walked) / legs[i]
      return {
        x: points[i].x + (points[i + 1].x - points[i].x) * t,
        y: points[i].y + (points[i + 1].y - points[i].y) * t
      }
    }
    walked += legs[i]
  }
  return points[points.length - 1]
}

/**
 * The trim actually applied, never more than a share of the run.
 *
 * Two items almost touching leave a few pixels between them; taking a whole
 * arrowhead off each end of that would draw the line backwards.
 */
function clampTrim(trim: ArrowTrim, start: Point, end: Point): [number, number] {
  const cap = Math.hypot(end.x - start.x, end.y - start.y) * 0.4
  return [
    Math.max(0, Math.min(trim.start ?? 0, cap)),
    Math.max(0, Math.min(trim.end ?? 0, cap))
  ]
}

/** How far a curved connector bows out, as a fraction of its own length. */
const BOW = 0.22
/** Past this it stops bowing further, or a wall-length arrow becomes a circle. */
const MAX_BOW = 140
const ELBOW_RADIUS = 12

/**
 * Everything needed to draw one connector: where it starts and ends, the path
 * between them, and which way each head points.
 *
 * The renderer gets no say in any of it, so the line that is drawn and the
 * line that is clicked are the same line by construction.
 */
/** Slides a point back along a heading. Used to stop a line behind its head. */
function pullBack(p: Point, angle: number, by: number): Point {
  return { x: p.x - by * Math.cos(angle), y: p.y - by * Math.sin(angle) }
}

/**
 * Everything needed to draw one connector.
 *
 * `trim` shortens the drawn line without moving where the connector actually
 * starts and ends, so a head sits at the true endpoint while the stroke stops
 * behind it. Neither trim may eat more than a fraction of the run, or two
 * items almost touching would produce a line drawn backwards.
 */
export function arrowGeometry(
  from: WallItem,
  to: WallItem,
  shape: ArrowShape = 'straight',
  trim: ArrowTrim = {}
): ArrowGeometry {
  if (shape === 'elbow') {
    const a = centreOf(from)
    const b = centreOf(to)
    // Whichever way the two are further apart is the way the connector leaves,
    // which is what keeps an elbow from doubling back on itself.
    const horizontal = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y)
    const positive = horizontal ? b.x >= a.x : b.y >= a.y

    const start = sidePoint(from, horizontal, positive)
    const end = sidePoint(to, horizontal, !positive)
    const mid = horizontal ? (start.x + end.x) / 2 : (start.y + end.y) / 2
    const corners: Point[] = horizontal
      ? [start, { x: mid, y: start.y }, { x: mid, y: end.y }, end]
      : [start, { x: start.x, y: mid }, { x: end.x, y: mid }, end]

    const forward = positive ? 0 : Math.PI
    const endAngle = horizontal ? forward : (positive ? Math.PI / 2 : -Math.PI / 2)
    const startAngle = endAngle + Math.PI

    const [ts, te] = clampTrim(trim, start, end)
    const drawn = [...corners]
    drawn[0] = pullBack(start, startAngle, ts)
    drawn[drawn.length - 1] = pullBack(end, endAngle, te)

    return {
      start,
      end,
      d: roundedPath(drawn, ELBOW_RADIUS),
      endAngle,
      startAngle,
      polyline: drawn,
      mid: midpointAlong(corners)
    }
  }

  const { start, end } = arrowEnds(from, to)

  if (shape === 'curved') {
    const dx = end.x - start.x
    const dy = end.y - start.y
    const length = Math.hypot(dx, dy) || 1
    const bow = Math.min(length * BOW, MAX_BOW)

    // Perpendicular to the line, so it always bows the same way round.
    const control = {
      x: (start.x + end.x) / 2 - (dy / length) * bow,
      y: (start.y + end.y) / 2 + (dx / length) * bow
    }

    // The tangent at either end of a quadratic points away from the control.
    const endAngle = Math.atan2(end.y - control.y, end.x - control.x)
    const startAngle = Math.atan2(start.y - control.y, start.x - control.x)

    const [ts, te] = clampTrim(trim, start, end)
    // Pulled back along the tangent, keeping the same control point. The curve
    // stops a little early rather than being re-solved, which at the few pixels
    // a head needs is not a difference anyone can see.
    const drawnStart = pullBack(start, startAngle, ts)
    const drawnEnd = pullBack(end, endAngle, te)

    // Sampled rather than solved: a handful of points is close enough to click
    // and avoids a quadratic root-finder living in a hit test.
    const polyline: Point[] = []
    const steps = 12
    for (let i = 0; i <= steps; i++) {
      const t = i / steps
      const u = 1 - t
      polyline.push({
        x: u * u * drawnStart.x + 2 * u * t * control.x + t * t * drawnEnd.x,
        y: u * u * drawnStart.y + 2 * u * t * control.y + t * t * drawnEnd.y
      })
    }

    return {
      start,
      end,
      d: `M${drawnStart.x},${drawnStart.y}Q${control.x},${control.y} ${drawnEnd.x},${drawnEnd.y}`,
      endAngle,
      startAngle,
      polyline,
      // The quadratic at t = 0.5, which is exact rather than sampled.
      mid: {
        x: 0.25 * start.x + 0.5 * control.x + 0.25 * end.x,
        y: 0.25 * start.y + 0.5 * control.y + 0.25 * end.y
      }
    }
  }

  const angle = Math.atan2(end.y - start.y, end.x - start.x)
  const [ts, te] = clampTrim(trim, start, end)
  const drawnStart = pullBack(start, angle + Math.PI, ts)
  const drawnEnd = pullBack(end, angle, te)

  return {
    start,
    end,
    d: `M${drawnStart.x},${drawnStart.y}L${drawnEnd.x},${drawnEnd.y}`,
    endAngle: angle,
    startAngle: angle + Math.PI,
    polyline: [drawnStart, drawnEnd],
    mid: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }
  }
}

/**
 * The dash pattern for a line style, scaled to the stroke so a thick dashed
 * line does not read as solid.
 *
 * Undefined for a solid line rather than a pattern meaning "no gaps", since
 * that is what SVG wants and it keeps the attribute off the element.
 */
export function arrowDash(line: ArrowLine, strokeWidth: number): string | undefined {
  const w = Math.max(1, strokeWidth)
  if (line === 'dashed') return `${w * 3} ${w * 2}`
  // Round caps turn a very short dash into a dot.
  if (line === 'dotted') return `1 ${w * 2}`
  return undefined
}

/** How long a head is, tip to barb. */
function headSize(strokeWidth: number): number {
  return 9 + Math.max(1, strokeWidth) * 2.4
}

/**
 * How far back the line should stop.
 *
 * The notch, not the barbs: the line runs into the head far enough that a
 * thick round-capped stroke leaves no gap, without filling the notch in and
 * turning the head back into a plain triangle.
 */
export function arrowHeadInset(strokeWidth: number): number {
  return headSize(strokeWidth) * NOTCH
}

/** How far the back of the head dips towards the tip, as a fraction of it. */
const NOTCH = 0.72

/**
 * An arrowhead pointing along `angle`: a tip, two barbs and a notched back.
 *
 * The notch is what stops it reading as a triangle balanced on the end of a
 * line, which is what it looked like at the thicker stroke widths.
 */
export function arrowHeadPoints(tip: Point, angle: number, strokeWidth: number): string {
  const size = headSize(strokeWidth)
  const spread = 0.46
  const back = size * NOTCH
  return [
    `${tip.x},${tip.y}`,
    `${tip.x - size * Math.cos(angle - spread)},${tip.y - size * Math.sin(angle - spread)}`,
    `${tip.x - back * Math.cos(angle)},${tip.y - back * Math.sin(angle)}`,
    `${tip.x - size * Math.cos(angle + spread)},${tip.y - size * Math.sin(angle + spread)}`
  ].join(' ')
}

/**
 * Arrows whose ends both still exist. Deleting an item leaves its arrows
 * pointing at nothing, and an arrow to nowhere cannot be drawn or explained.
 */
export function pruneArrows(items: WallItem[]): WallItem[] {
  const present = new Set(items.filter(i => i.kind !== 'arrow').map(i => i.id))
  // An end pinned to a point survives on its own. Only an end that named an
  // item which has since gone takes its arrow with it.
  const anchored = (id: string | undefined, point: unknown): boolean =>
    id ? present.has(id) : !!point

  return items.filter(i =>
    i.kind !== 'arrow' || (anchored(i.from, i.fromPoint) && anchored(i.to, i.toPoint))
  )
}

/**
 * The size the stroke was drawn at. The SVG keeps this as its viewBox, so
 * resizing the box scales the drawing instead of cropping it.
 */
export function inkNaturalSize(item: WallItem): { width: number; height: number } {
  const points = item.points ?? []
  let maxX = 0
  let maxY = 0
  for (let i = 0; i < points.length; i += 2) {
    if (points[i] > maxX) maxX = points[i]
    if (points[i + 1] > maxY) maxY = points[i + 1]
  }
  return { width: maxX + INK_PAD, height: maxY + INK_PAD }
}
