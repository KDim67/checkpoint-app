/** a card is a reference, never a copy; hand-normalised since user data outlives builds */

import { isLinkable, parseWallLink } from './wallLink'
import { pruneGroups, regroupCopies } from './wallGroup'
import { isCodeLanguage } from './wallCode'

/** note is a sticky, doc a real note; stored names can't be migrated apart */
// bookmark is a pasted page's card, shape holds words inside an outline, code is a block of source
export type WallItemKind = 'card' | 'note' | 'doc' | 'image' | 'text' | 'frame' | 'ink' | 'arrow' | 'bookmark' | 'shape' | 'code'

export interface WallItem {
  /** wall-local, two placements of one card are two items */
  id: string
  kind: WallItemKind
  x: number
  y: number
  width: number
  height: number
  /** item id for card, note title for doc, media filename for image and a bookmark's icon */
  ref?: string
  /** body for note/text, label for frame and arrow, a bookmark's page title */
  text?: string
  /** a bookmark's page description */
  summary?: string
  /** a shape's outline, absent for a rectangle */
  shape?: ShapeType
  /** the side words sit on in a sticky, text box or shape; absent for the kind's own */
  align?: TextAlign
  /** a shape's outline colour, absent for the default */
  borderColor?: string
  /** a rounded shape's corners in pixels, absent for the default curve */
  radius?: number
  /** a shape's fill from 0.1 to 1, absent when solid */
  opacity?: number
  /** hex, or absent for the kind's default */
  color?: string
  /** flat [x0,y0,...] in the item's box, so move and resize work like everything else */
  points?: number[]
  strokeWidth?: number
  /** 0-1 per stroke, so toggling smoothing later doesn't redraw old lines */
  smooth?: number
  /** a highlighter stroke, drawn see-through */
  highlight?: boolean
  /** item ids; arrows are redrawn from their items so they never drift */
  from?: string
  to?: string
  /** a free end's wall point; an end has an item or a point */
  fromPoint?: { x: number; y: number }
  toPoint?: { x: number; y: number }
  /** absent at defaults, so pre-style arrows read as plain */
  arrowShape?: ArrowShape
  arrowLine?: ArrowLine
  arrowHeads?: ArrowHeads
  /** degrees */
  rotation?: number
  /** explicit so it survives a reload */
  z: number
  /** no drag, resize or marquee, so panning past a background image doesn't grab it */
  locked?: boolean
  /** a web address or wall:<wallId>/<itemId>, read through wallLink */
  link?: string
  /** items sharing one select, move and line up together, read through wallGroup */
  group?: string
  /** a sticky's labels by name, so they match the board's tags without breaking when one is deleted */
  tags?: string[]
  /** a code block's language, absent for plain text */
  language?: string
  /** the mind map a topic is part of, read through wallMindMap */
  map?: string
}

/** contents live under wallDocKey */
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

/** items that left the wall together, read through wallBin */
export interface WallBinEntry {
  id: string
  at: number
  items: WallItem[]
}

export interface WallDoc {
  version: 1
  items: WallItem[]
  /** reopening lands where you left it */
  camera: WallCamera
  /** hex or a preset name */
  background: string
  /** recently deleted, newest first; absent when empty */
  bin?: WallBinEntry[]
  /** frame ids in the order they present, absent for reading order */
  frameOrder?: string[]
}

export type TextAlign = 'left' | 'center' | 'right'
export const TEXT_ALIGNS: readonly TextAlign[] = ['left', 'center', 'right']

export const MIN_ZOOM = 0.2
export const MAX_ZOOM = 3

/** legible when dropped, no resize needed */
export const DEFAULT_SIZES: Record<WallItemKind, { width: number; height: number }> = {
  card: { width: 260, height: 120 },
  note: { width: 200, height: 200 },
  doc: { width: 240, height: 150 },
  image: { width: 280, height: 200 },
  text: { width: 240, height: 48 },
  frame: { width: 480, height: 360 },
  // icon row, two title lines and two of description
  bookmark: { width: 300, height: 128 },
  shape: { width: 160, height: 100 },
  // about ten lines of sixty characters
  code: { width: 420, height: 200 },
  // sized from their contents
  ink: { width: 120, height: 120 },
  arrow: { width: 1, height: 1 }
}

/** muted, a wall of saturated squares is noise */
export const WALL_COLORS = [
  '#f6c453', '#f28b82', '#a7c7e7', '#b5e6b5',
  '#d7b3e8', '#f5b78c', '#9fdfd5', '#cfd3da'
]

const DEFAULT_CAMERA: WallCamera = { x: 0, y: 0, zoom: 1 }

/** the first wall keeps the old single-wall key; later ones by id since names are free text */
export const DEFAULT_WALL_ID = 'main'
const DEFAULT_WALL_NAME = 'Wall'

export const wallDocKey = (context: string, wallId: string = DEFAULT_WALL_ID): string =>
  wallId === DEFAULT_WALL_ID ? `wall_${context}` : `wall_doc_${wallId}`

/** which walls exist and which was open */
export const wallIndexKey = (context: string): string => `wall_index_${context}`

function num(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v))
  return Number.isFinite(n) ? n : fallback
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

const KINDS: WallItemKind[] = ['card', 'note', 'doc', 'image', 'text', 'frame', 'ink', 'arrow', 'bookmark', 'shape', 'code']

export const MAX_TAGS = 10

/** trimmed names up to 40 characters, the same name in any case once, ten at most */
export function cleanTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of raw) {
    const name = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, 40) : ''
    if (!name || seen.has(name.toLowerCase())) continue
    seen.add(name.toLowerCase())
    out.push(name)
    if (out.length === MAX_TAGS) break
  }
  return out
}

/** wall units, three is enough */
export const STROKE_WIDTHS = [2, 4, 8]

/** the route between two items */
export type ArrowShape = 'straight' | 'curved' | 'elbow'
export type ArrowLine = 'solid' | 'dashed' | 'dotted'
/** none makes a plain connector */
export type ArrowHeads = 'end' | 'both' | 'none'

// order matters: the palette steps through, the first is the unwritten default
export const ARROW_SHAPES: readonly ArrowShape[] = ['straight', 'curved', 'elbow']
export const ARROW_LINES: readonly ArrowLine[] = ['solid', 'dashed', 'dotted']
export const ARROW_HEAD_MODES: readonly ArrowHeads[] = ['end', 'both', 'none']

/** a shape's outline; like the arrow styles, the first is the unwritten default */
export type ShapeType = 'rectangle' | 'rounded' | 'oval' | 'diamond' | 'triangle'
export const SHAPE_TYPES: readonly ShapeType[] = ['rectangle', 'rounded', 'oval', 'diamond', 'triangle']

/** smoothing is this strength or nothing */
export const SMOOTHING_STRENGTH = 0.9

/** null if a coordinate is unusable */
function readPoint(raw: unknown): { x: number; y: number } | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  const x = num(o.x, NaN)
  const y = num(o.y, NaN)
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null
}

/** two points minimum; odd length means truncated */
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

  // nothing to point at can't render
  const ref = str(o.ref).trim()
  if ((kind === 'card' || kind === 'doc' || kind === 'image') && !ref) return null

  // no path or no ends is invisible, and invisible can't be selected to delete
  const points = normalizePoints(o.points)
  if (kind === 'ink' && !points) return null

  // a bookmark is its address, without a web one there's nothing to open
  if (kind === 'bookmark' && parseWallLink(o.link)?.type !== 'url') return null

  const from = str(o.from).trim()
  const to = str(o.to).trim()
  const fromPoint = readPoint(o.fromPoint)
  const toPoint = readPoint(o.toPoint)
  // each end needs an item or a point
  if (kind === 'arrow' && ((!from && !fromPoint) || (!to && !toPoint))) return null

  // true from v1, a strength from the dial build; both still render
  const smooth = o.smooth === true
    ? SMOOTHING_STRENGTH
    : Math.min(1, Math.max(0, num(o.smooth, 0)))

  // unknown styles fall back so hand edits can't ask for the undrawable
  const oneOf = <T extends string>(value: unknown, allowed: readonly T[]): T | null => {
    const v = str(value) as T
    return allowed.includes(v) ? v : null
  }
  const arrowShape = oneOf(o.arrowShape, ARROW_SHAPES)
  const arrowLine = oneOf(o.arrowLine, ARROW_LINES)
  const arrowHeads = oneOf(o.arrowHeads, ARROW_HEAD_MODES)
  const shape = kind === 'shape' ? oneOf(o.shape, SHAPE_TYPES) : null
  // a side only for words, and only when it isn't where the kind puts them anyway
  const align = kind === 'note' || kind === 'text' || kind === 'shape' ? oneOf(o.align, TEXT_ALIGNS) : null
  const ownAlign: TextAlign = kind === 'shape' ? 'center' : 'left'
  const radius = kind === 'shape' ? num(o.radius, NaN) : NaN
  const opacity = kind === 'shape' ? num(o.opacity, NaN) : NaN
  const tags = kind === 'note' ? cleanTags(o.tags) : []
  // a topic holds words, so only the kinds that do can be one
  const map = kind === 'note' || kind === 'text' || kind === 'shape' ? str(o.map).trim() : ''

  // a hand-edited doc can't plant a link main would refuse
  const link = (isLinkable(kind) || kind === 'bookmark') && parseWallLink(o.link) ? str(o.link).trim() : ''

  const size = DEFAULT_SIZES[kind]
  return {
    id: str(o.id).trim() || `w${index}-${Math.random().toString(36).slice(2, 8)}`,
    kind,
    x: num(o.x, 0),
    y: num(o.y, 0),
    // floors: zero-size items are unclickable
    width: Math.max(40, num(o.width, size.width)),
    height: Math.max(32, num(o.height, size.height)),
    ...(ref ? { ref } : {}),
    ...(typeof o.text === 'string' ? { text: o.text } : {}),
    ...(str(o.summary).trim() ? { summary: str(o.summary) } : {}),
    ...(str(o.color) ? { color: str(o.color) } : {}),
    ...(points ? { points } : {}),
    ...(num(o.strokeWidth, 0) > 0 ? { strokeWidth: num(o.strokeWidth, STROKE_WIDTHS[1]) } : {}),
    ...(smooth > 0 ? { smooth } : {}),
    ...(kind === 'ink' && o.highlight === true ? { highlight: true } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    // the item wins over a stale point
    ...(!from && fromPoint ? { fromPoint } : {}),
    ...(!to && toPoint ? { toPoint } : {}),
    // defaults left out, only restyled arrows carry it
    ...(arrowShape && arrowShape !== ARROW_SHAPES[0] ? { arrowShape } : {}),
    ...(arrowLine && arrowLine !== ARROW_LINES[0] ? { arrowLine } : {}),
    ...(arrowHeads && arrowHeads !== ARROW_HEAD_MODES[0] ? { arrowHeads } : {}),
    ...(shape && shape !== SHAPE_TYPES[0] ? { shape } : {}),
    ...(align && align !== ownAlign ? { align } : {}),
    ...(kind === 'shape' && str(o.borderColor) ? { borderColor: str(o.borderColor) } : {}),
    ...(Number.isFinite(radius) ? { radius: Math.min(200, Math.max(0, radius)) } : {}),
    // a fill too faint to see can't be found to click
    ...(Number.isFinite(opacity) && opacity < 1 ? { opacity: Math.max(0.1, opacity) } : {}),
    ...(Number.isFinite(num(o.rotation, NaN)) ? { rotation: num(o.rotation, 0) } : {}),
    ...(o.locked === true ? { locked: true } : {}),
    ...(link ? { link } : {}),
    // an arrow moves with its ends, never as a member
    ...(kind !== 'arrow' && str(o.group).trim() ? { group: str(o.group).trim() } : {}),
    ...(tags.length > 0 ? { tags } : {}),
    ...(kind === 'code' && isCodeLanguage(o.language) ? { language: o.language } : {}),
    ...(map ? { map } : {}),
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

/** anything in, a renderable wall out */
export function normalizeWallDoc(raw: unknown): WallDoc {
  let source = raw
  if (typeof raw === 'string') {
    try { source = JSON.parse(raw) } catch { source = null }
  }

  const o = source && typeof source === 'object' && !Array.isArray(source)
    ? (source as Record<string, unknown>)
    : {}

  // a deleted member can leave a group of one
  const items = pruneGroups((Array.isArray(o.items) ? o.items : [])
    .map((item, i) => normalizeWallItem(item, i))
    .filter((item): item is WallItem => item !== null))

  const frameOrder = [...new Set((Array.isArray(o.frameOrder) ? o.frameOrder : [])
    .filter((id): id is string => typeof id === 'string' && id.trim() !== ''))]

  // whole entries only, a half-read deletion would restore the wrong things
  const bin = (Array.isArray(o.bin) ? o.bin : []).flatMap((raw, n): WallBinEntry[] => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return []
    const e = raw as Record<string, unknown>
    const at = num(e.at, NaN)
    const kept = (Array.isArray(e.items) ? e.items : [])
      .map((item, i) => normalizeWallItem(item, i))
      .filter((item): item is WallItem => item !== null)
    return Number.isFinite(at) && kept.length > 0 ? [{ id: str(e.id).trim() || `bin-${n}`, at, items: kept }] : []
  })

  return {
    version: 1,
    items,
    camera: normalizeCamera(o.camera),
    background: str(o.background) || 'default',
    ...(bin.length > 0 ? { bin } : {}),
    ...(frameOrder.length > 0 ? { frameOrder } : {})
  }
}

/** above everything present */
export function topZ(items: WallItem[]): number {
  return items.reduce((max, i) => Math.max(max, i.z), 0) + 1
}

/** without disturbing the rest */
export function bringToFront(items: WallItem[], id: string): WallItem[] {
  const top = topZ(items)
  return items.map(i => (i.id === id ? { ...i, z: top } : i))
}

export function sendToBack(items: WallItem[], id: string): WallItem[] {
  const min = items.reduce((m, i) => Math.min(m, i.z), 0) - 1
  return items.map(i => (i.id === id ? { ...i, z: min } : i))
}

/** lowest z first */
export function inPaintOrder(items: WallItem[]): WallItem[] {
  return [...items].sort((a, b) => a.z - b.z)
}

export interface Bounds { minX: number; minY: number; maxX: number; maxY: number }

export function boundsOf(items: WallItem[]): Bounds | null {
  // arrow boxes are placeholders; a pinned end is real extent
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

/** fit to content, the way back from empty space */
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

  // the camera offset is in screen space, so scale the centre first
  return {
    zoom,
    x: viewport.width / 2 - ((b.minX + b.maxX) / 2) * zoom,
    y: viewport.height / 2 - ((b.minY + b.maxY) / 2) * zoom
  }
}

/** for dropping at the cursor */
export function toWallPoint(
  screen: { x: number; y: number },
  camera: WallCamera
): { x: number; y: number } {
  return {
    x: (screen.x - camera.x) / camera.zoom,
    y: (screen.y - camera.y) / camera.zoom
  }
}

/** the thing under the cursor stays there */
export function zoomAt(
  camera: WallCamera,
  screen: { x: number; y: number },
  factor: number
): WallCamera {
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, camera.zoom * factor))
  // the clamp swallowed it; recomputing would drift sideways
  if (zoom === camera.zoom) return camera

  const before = toWallPoint(screen, camera)
  return {
    zoom,
    x: screen.x - before.x * zoom,
    y: screen.y - before.y * zoom
  }
}

/** sized and coloured for its kind */
export function createWallItem(
  kind: WallItemKind,
  at: { x: number; y: number },
  items: WallItem[],
  extra: Partial<WallItem> = {}
): WallItem {
  // by the size it will have, a sized item centred by the default one landed off to a side
  const width = extra.width ?? DEFAULT_SIZES[kind].width
  const height = extra.height ?? DEFAULT_SIZES[kind].height
  return {
    id: `w-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    kind,
    // centred on the cursor, like a drop should feel
    x: at.x - width / 2,
    y: at.y - height / 2,
    width,
    height,
    z: topZ(items),
    ...extra
  }
}

export interface Rect { x: number; y: number; width: number; height: number }

/** positive size from any two points */
export function rectFromPoints(a: { x: number; y: number }, b: { x: number; y: number }): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y)
  }
}

/** intersection, not containment; locked items skipped */
export function itemsInRect(items: WallItem[], rect: Rect): string[] {
  const right = rect.x + rect.width
  const bottom = rect.y + rect.height
  return items
    .filter(i => !i.locked && i.kind !== 'arrow')
    .filter(i => i.x < right && i.x + i.width > rect.x && i.y < bottom && i.y + i.height > rect.y)
    .map(i => i.id)
}

/** locked ones stay put */
export function moveItems(items: WallItem[], ids: Set<string>, dx: number, dy: number): WallItem[] {
  return items.map(i =>
    ids.has(i.id) && !i.locked ? { ...i, x: i.x + dx, y: i.y + dy } : i
  )
}

/** locked left alone */
export function patchItems(
  items: WallItem[],
  ids: Set<string>,
  patch: Partial<WallItem>
): WallItem[] {
  return items.map(i => (ids.has(i.id) && !i.locked ? { ...i, ...patch } : i))
}

/** offset from the originals; the caller appends and selects */
export function duplicateItems(
  items: WallItem[],
  ids: Set<string>,
  offset = 24
): WallItem[] {
  let z = topZ(items)
  return regroupCopies(items
    .filter(i => ids.has(i.id))
    .map(i => {
      const copy: WallItem = {
        ...i,
        id: `w-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
        x: i.x + offset,
        y: i.y + offset,
        z: z++
      }
      // copies arrive unlocked so a locked background's copy can be moved
      delete copy.locked
      return copy
    }))
}

/** only when snapping is on */
export function snap(value: number, grid: number): number {
  if (grid <= 0) return value
  return Math.round(value / grid) * grid
}

export const SNAP_GRID = 24

/** closer stops reading as dots */
export const MIN_GRID_PX = 12

/** doubles the step instead of shrinking; under ~5px chromium paints a flat, patchy tint */
export function gridSpacing(zoom: number): number {
  if (!(zoom > 0)) return SNAP_GRID
  let step = SNAP_GRID
  while (step * zoom < MIN_GRID_PX) step *= 2
  return step * zoom
}

/** pointer capture retargets clicks, so hit-test by point; unrotated box */
export function itemAtPoint(items: WallItem[], point: { x: number; y: number }): WallItem | null {
  let hit: WallItem | null = null
  for (const i of items) {
    // arrow and ink boxes aren't their shape, don't let them block
    if (i.kind === 'arrow' || i.kind === 'ink') continue
    const inside =
      point.x >= i.x && point.x <= i.x + i.width &&
      point.y >= i.y && point.y <= i.y + i.height
    if (inside && (!hit || i.z > hit.z)) hit = i
  }
  return hit
}

/** keeps zoom */
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

/** titles live on the referenced record, the caller resolves them */
function searchableText(item: WallItem, resolvedTitle?: string): string {
  // web addresses only, an item link's ids mean nothing to type
  const link = parseWallLink(item.link)
  return [item.text ?? '', item.summary ?? '', resolvedTitle ?? '', link?.type === 'url' ? link.url : '', ...(item.tags ?? [])]
    .join(' ').trim().toLowerCase()
}

/** every word, in paint order */
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
      // duplicate ids would have two tabs writing one doc
      if (!id || seen.has(id)) return null
      seen.add(id)
      return { id, name: str(e.name).trim() || DEFAULT_WALL_NAME }
    })
    .filter((w): w is WallRef => w !== null)

  // only when nothing's stored, so a deleted wall stays deleted
  if (walls.length === 0) walls.push({ id: DEFAULT_WALL_ID, name: DEFAULT_WALL_NAME })

  const stored = str(o.activeId)
  return {
    version: 1,
    walls,
    activeId: walls.some(w => w.id === stored) ? stored : walls[0].id
  }
}

/** creating one is a request to use it */
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

/** never the last wall */
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

/** centre inside, not full enclosure; locked and rotation ignored */
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

/** frames bring contents, loops for nesting; terminates since the set only grows */
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

/** so the cap isn't clipped */
const INK_PAD = 8

/** well under a stroke width, so the drawn line doesn't change shape */
export const SIMPLIFY_TOLERANCE = 0.7

/** RDP: pointers emit hundreds of near-identical samples and all are stored and synced; ends kept */
export function simplifyPath(points: Point[], tolerance = SIMPLIFY_TOLERANCE): Point[] {
  if (points.length < 3) return points

  const keep = new Array<boolean>(points.length).fill(false)
  keep[0] = true
  keep[points.length - 1] = true

  // iterative, long strokes would recurse thousands deep
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

    // nothing strays far enough, drop everything between
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

  // thinned before measuring so a dropped edge sample can't bloat the box
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
    // not floored, a horizontal line's box is only the pad tall
    width,
    height,
    points: simplified.flatMap(p => [p.x - minX, p.y - minY]),
    z: topZ(items),
    ...extra
  }
}

/** ends stay put so a line drawn to touch something still does */
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
  // the last sample joins straight
  return `${d}L${p[p.length - 2].toFixed(1)},${p[p.length - 1].toFixed(1)}`
}

export interface Point { x: number; y: number }

const centreOf = (item: WallItem): Point => ({
  x: item.x + item.width / 2,
  y: item.y + item.height / 2
})

/** on each box's edge so the head lands against the item */
export function arrowEnds(from: WallItem, to: WallItem): { start: Point; end: Point } {
  const a = centreOf(from)
  const b = centreOf(to)
  return { start: edgePoint(from, a, b), end: edgePoint(to, b, a) }
}

/** centre towards the target, stops at the edge */
function edgePoint(box: WallItem, centre: Point, towards: Point): Point {
  const dx = towards.x - centre.x
  const dy = towards.y - centre.y
  if (dx === 0 && dy === 0) return centre

  // the smaller scale is the side it leaves through
  const scaleX = dx === 0 ? Infinity : (box.width / 2) / Math.abs(dx)
  const scaleY = dy === 0 ? Infinity : (box.height / 2) / Math.abs(dy)
  const scale = Math.min(scaleX, scaleY)

  return { x: centre.x + dx * scale, y: centre.y + dy * scale }
}

/** for clicking a line with no box */
export function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lengthSq = dx * dx + dy * dy
  if (lengthSq === 0) return Math.hypot(p.x - a.x, p.y - a.y)

  // clamped to the segment, not the infinite line
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}


/** nearest of the segments */
export function distanceToPolyline(p: Point, points: Point[]): number {
  if (points.length === 0) return Infinity
  if (points.length === 1) return Math.hypot(p.x - points[0].x, p.y - points[0].y)

  let best = Infinity
  for (let i = 1; i < points.length; i++) {
    best = Math.min(best, distanceToSegment(p, points[i - 1], points[i]))
  }
  return best
}

/** where a horizontal or vertical ray crosses the box */
function sidePoint(box: WallItem, horizontal: boolean, positive: boolean): Point {
  const c = centreOf(box)
  return horizontal
    ? { x: c.x + (positive ? 1 : -1) * box.width / 2, y: c.y }
    : { x: c.x, y: c.y + (positive ? 1 : -1) * box.height / 2 }
}

/** radius shrinks to the shortest segment so near items don't overshoot */
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

/** a point dressed as an item so loose ends share the geometry */
function pointAnchor(p: Point): WallItem {
  return { id: '', kind: 'note', x: p.x, y: p.y, width: 0, height: 0, z: 0 }
}

/** null when an end names a missing item */
export function arrowAnchors(
  arrow: WallItem,
  byId: Map<string, WallItem>
): { from: WallItem; to: WallItem } | null {
  const from = arrow.from ? byId.get(arrow.from) : arrow.fromPoint && pointAnchor(arrow.fromPoint)
  const to = arrow.to ? byId.get(arrow.to) : arrow.toPoint && pointAnchor(arrow.toPoint)
  return from && to ? { from, to } : null
}

/** shorter at each end than the true line */
interface ArrowTrim {
  start?: number
  end?: number
}

interface ArrowGeometry {
  /** the true ends, heads go here */
  start: Point
  end: Point
  /** SVG path, trimmed */
  d: string
  /** far head direction, radians */
  endAngle: number
  /** the near head points back out of its item */
  startAngle: number
  /** straight segments for hit testing */
  polyline: Point[]
  /** on the untrimmed line so heads don't move the label */
  mid: Point
}

/** by length, not index */
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
  // all points coincide, anywhere is the middle
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

/** never more than a share of the run, or near items draw backwards */
function clampTrim(trim: ArrowTrim, start: Point, end: Point): [number, number] {
  const cap = Math.hypot(end.x - start.x, end.y - start.y) * 0.4
  return [
    Math.max(0, Math.min(trim.start ?? 0, cap)),
    Math.max(0, Math.min(trim.end ?? 0, cap))
  ]
}

/** bow as a fraction of length */
const BOW = 0.22
/** cap, or a long arrow becomes a circle */
const MAX_BOW = 140
const ELBOW_RADIUS = 12

/** stops a line behind its head */
function pullBack(p: Point, angle: number, by: number): Point {
  return { x: p.x - by * Math.cos(angle), y: p.y - by * Math.sin(angle) }
}

/** one geometry for drawing and clicking; trim shortens the stroke, heads stay at the true ends */
export function arrowGeometry(
  from: WallItem,
  to: WallItem,
  shape: ArrowShape = 'straight',
  trim: ArrowTrim = {}
): ArrowGeometry {
  if (shape === 'elbow') {
    const a = centreOf(from)
    const b = centreOf(to)
    // leave along the wider separation so elbows don't double back
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

    // perpendicular so it always bows the same way
    const control = {
      x: (start.x + end.x) / 2 - (dy / length) * bow,
      y: (start.y + end.y) / 2 + (dx / length) * bow
    }

    // a quadratic's end tangents point away from the control
    const endAngle = Math.atan2(end.y - control.y, end.x - control.x)
    const startAngle = Math.atan2(start.y - control.y, start.x - control.x)

    const [ts, te] = clampTrim(trim, start, end)
    // pulled back along the tangent, not re-solved; invisible at head size
    const drawnStart = pullBack(start, startAngle, ts)
    const drawnEnd = pullBack(end, endAngle, te)

    // sampled, avoids a root-finder in a hit test
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
      // exact at t = 0.5
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

/** scaled to the stroke; undefined for solid so the attribute stays off */
export function arrowDash(line: ArrowLine, strokeWidth: number): string | undefined {
  const w = Math.max(1, strokeWidth)
  if (line === 'dashed') return `${w * 3} ${w * 2}`
  // round caps turn a short dash into a dot
  if (line === 'dotted') return `1 ${w * 2}`
  return undefined
}

/** tip to barb */
function headSize(strokeWidth: number): number {
  return 9 + Math.max(1, strokeWidth) * 2.4
}

/** to the notch, so thick round caps leave no gap without filling the notch */
export function arrowHeadInset(strokeWidth: number): number {
  return headSize(strokeWidth) * NOTCH
}

/** back dip towards the tip */
const NOTCH = 0.72

/** notched so it doesn't read as a triangle on a stick */
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

/** deleting an item leaves arrows to nowhere */
export function pruneArrows(items: WallItem[]): WallItem[] {
  const present = new Set(items.filter(i => i.kind !== 'arrow').map(i => i.id))
  // point-pinned ends survive, only a vanished item takes its arrow
  const anchored = (id: string | undefined, point: unknown): boolean =>
    id ? present.has(id) : !!point

  return items.filter(i =>
    i.kind !== 'arrow' || (anchored(i.from, i.fromPoint) && anchored(i.to, i.toPoint))
  )
}

/** the drawn size, kept as viewBox so resizing scales */
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
