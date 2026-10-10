/** lining items up: align and distribute on a selection, and the guides a drag snaps to */

import { moveItems, withFrameContents, type Bounds, type Rect, type WallItem } from './wallModel'
import { pulledBox, type Corner } from './wallPointer'
import { outlineOf, toLocal, turnedBox } from './wallTurn'

export type AlignEdge = 'left' | 'centre' | 'right' | 'top' | 'middle' | 'bottom'
export type DistributeAxis = 'horizontal' | 'vertical'

/** screen pixels a dragged edge has to come within before it snaps */
export const GUIDE_SNAP_PX = 8

/** screen pixels two edges or gaps can differ by and still read as the same */
const MATCH_PX = 0.5

/** equal gaps or sizes marked along a row, and again down a column, at most */
export const MARKS_EACH_WAY = 4

/** how the wall is seen while guiding: the zoom sets how near is near, and only what's on screen pulls */
export interface GuideView { zoom: number; view?: Rect }

/** what lines up as one piece, and every item that moves with it */
interface Unit { bounds: Bounds; moves: Set<string> }

/** a group is one piece and a frame brings what's in it; arrows follow their ends and locked items stay put; each lines up by what shows */
function unitsOf(items: WallItem[], ids: Set<string>): Unit[] {
  const chosen = items.filter(i => ids.has(i.id) && i.kind !== 'arrow' && !i.locked)
  // moved by their frame; as pieces of their own they'd move twice
  const carried = new Set<string>()
  for (const frame of chosen.filter(i => i.kind === 'frame')) {
    for (const id of withFrameContents(items, new Set([frame.id]))) if (id !== frame.id) carried.add(id)
  }

  const pieces = new Map<string, WallItem[]>()
  for (const item of chosen) {
    if (carried.has(item.id)) continue
    const key = item.group ? `group:${item.group}` : item.id
    pieces.set(key, [...(pieces.get(key) ?? []), item])
  }
  return [...pieces.values()].map(members => ({
    bounds: outlineOf(members) as Bounds,
    moves: withFrameContents(items, new Set(members.map(m => m.id)))
  }))
}

export const alignableUnits = (items: WallItem[], ids: Set<string>): number => unitsOf(items, ids).length

const spanOf = (units: Unit[]): Bounds => units.reduce<Bounds>((all, { bounds: b }) => ({
  minX: Math.min(all.minX, b.minX),
  minY: Math.min(all.minY, b.minY),
  maxX: Math.max(all.maxX, b.maxX),
  maxY: Math.max(all.maxY, b.maxY)
}), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity })

/** each piece's edge or centre onto the selection's own; fewer than two pieces leaves the wall alone */
export function alignItems(items: WallItem[], ids: Set<string>, edge: AlignEdge): WallItem[] {
  const units = unitsOf(items, ids)
  if (units.length < 2) return items
  const all = spanOf(units)

  return units.reduce((next, { bounds: b, moves }) => {
    const dx = edge === 'left' ? all.minX - b.minX
      : edge === 'right' ? all.maxX - b.maxX
      : edge === 'centre' ? (all.minX + all.maxX) / 2 - (b.minX + b.maxX) / 2
      : 0
    const dy = edge === 'top' ? all.minY - b.minY
      : edge === 'bottom' ? all.maxY - b.maxY
      : edge === 'middle' ? (all.minY + all.maxY) / 2 - (b.minY + b.maxY) / 2
      : 0
    return dx === 0 && dy === 0 ? next : moveItems(next, moves, dx, dy)
  }, items)
}

/** equal gaps between pieces in reading order, the outermost two stay where they are; needs three */
export function distributeItems(items: WallItem[], ids: Set<string>, axis: DistributeAxis): WallItem[] {
  const units = unitsOf(items, ids)
  if (units.length < 3) return items
  const across = axis === 'horizontal'
  const start = (b: Bounds): number => (across ? b.minX : b.minY)
  const size = (b: Bounds): number => (across ? b.maxX - b.minX : b.maxY - b.minY)

  const sorted = [...units].sort((a, b) => start(a.bounds) + size(a.bounds) / 2 - (start(b.bounds) + size(b.bounds) / 2))
  const first = sorted[0].bounds
  const last = sorted[sorted.length - 1].bounds
  const occupied = sorted.reduce((sum, u) => sum + size(u.bounds), 0)
  const gap = (start(last) + size(last) - start(first) - occupied) / (sorted.length - 1)

  let cursor = start(first)
  return sorted.reduce((next, unit) => {
    const d = cursor - start(unit.bounds)
    cursor += size(unit.bounds) + gap
    return d === 0 ? next : moveItems(next, unit.moves, across ? d : 0, across ? 0 : d)
  }, items)
}

export interface Guide {
  axis: 'x' | 'y'
  /** where the line runs, across the other axis from 'from' to 'to' */
  at: number
  from: number
  to: number
}

/** a measured gap along a row (x) or a column (y), drawn from 'from' to 'to' at 'at' across */
export interface GapMark {
  axis: 'x' | 'y'
  from: number
  to: number
  at: number
}

type Axis = 'x' | 'y'

/** how near is near at the zoom the wall is seen at, in wall units */
interface Reach {
  /** a dragged edge snaps this close */
  snap: number
  /** two edges this close read as one line */
  exact: number
}

const reachAt = (zoom: number): Reach => ({ snap: GUIDE_SNAP_PX / zoom, exact: MATCH_PX / zoom })

const xsOf = (b: Bounds): number[] => [b.minX, (b.minX + b.maxX) / 2, b.maxX]
const ysOf = (b: Bounds): number[] => [b.minY, (b.minY + b.maxY) / 2, b.maxY]
const placesOf = (b: Bounds, axis: Axis): number[] => (axis === 'x' ? xsOf(b) : ysOf(b))

const sides = (axis: Axis) => axis === 'x'
  ? { lo: (b: Bounds) => b.minX, hi: (b: Bounds) => b.maxX, crossLo: (b: Bounds) => b.minY, crossHi: (b: Bounds) => b.maxY }
  : { lo: (b: Bounds) => b.minY, hi: (b: Bounds) => b.maxY, crossLo: (b: Bounds) => b.minX, crossHi: (b: Bounds) => b.maxX }

const shifted = (b: Bounds, dx: number, dy: number): Bounds =>
  ({ minX: b.minX + dx, maxX: b.maxX + dx, minY: b.minY + dy, maxY: b.maxY + dy })

/** what a drag can line up with, as each shows; only what's on screen pulls, a far item's line would run off the view */
function othersOf(items: WallItem[], skip: Set<string>, view?: Rect): Bounds[] {
  return items
    .filter(i => !skip.has(i.id) && i.kind !== 'arrow' && i.kind !== 'ink')
    .map(turnedBox)
    .filter(b => !view || (b.minX < view.x + view.width && b.maxX > view.x && b.minY < view.y + view.height && b.maxY > view.y))
}

/** what shares the box's row or column: its nearest neighbour each side, and the gaps already between neighbours */
function lineUp(box: Bounds, others: Bounds[], axis: Axis, exact: number): { before: Bounds | null; after: Bounds | null; pairs: [Bounds, Bounds][] } {
  const { lo, hi, crossLo, crossHi } = sides(axis)
  const line = others.filter(o => Math.min(crossHi(o), crossHi(box)) - Math.max(crossLo(o), crossLo(box)) > 0)
  const before = line.filter(o => hi(o) <= lo(box)).reduce<Bounds | null>((best, o) => (!best || hi(o) > hi(best) ? o : best), null)
  const after = line.filter(o => lo(o) >= hi(box)).reduce<Bounds | null>((best, o) => (!best || lo(o) < lo(best) ? o : best), null)

  const sorted = [...line].sort((a, b) => lo(a) - lo(b))
  const pairs: [Bounds, Bounds][] = []
  for (let i = 1; i < sorted.length; i++) {
    // touching items leave no gap worth measuring
    if (lo(sorted[i]) - hi(sorted[i - 1]) > exact) pairs.push([sorted[i - 1], sorted[i]])
  }
  return { before, after, pairs }
}

/** the nudge into a gap the row or column already uses, or to equal gaps between two neighbours; null out of reach */
function spacingSnap(box: Bounds, others: Bounds[], axis: Axis, reach: Reach): number | null {
  const { lo, hi } = sides(axis)
  const { before, after, pairs } = lineUp(box, others, axis, reach.exact)
  const size = hi(box) - lo(box)
  const gaps = pairs.map(([a, b]) => lo(b) - hi(a))

  const targets: number[] = []
  if (before) gaps.forEach(g => targets.push(hi(before) + g))
  if (after) gaps.forEach(g => targets.push(lo(after) - g - size))
  if (before && after) targets.push((hi(before) + lo(after) - size) / 2)

  let best: number | null = null
  for (const target of targets) {
    const d = target - lo(box)
    if (Math.abs(d) <= reach.snap && (best === null || Math.abs(d) < Math.abs(best))) best = d
  }
  return best
}

/** the gaps beside the box that match another, then the gaps they match nearest first; a few each way, so a long row can't crowd out the column */
function gapMarks(box: Bounds, others: Bounds[], axis: Axis, reach: Reach): GapMark[] {
  const { lo, hi, crossLo, crossHi } = sides(axis)
  const { before, after, pairs } = lineUp(box, others, axis, reach.exact)
  const width = ([a, b]: [Bounds, Bounds]): number => lo(b) - hi(a)
  const mine: [Bounds, Bounds][] = [
    ...(before ? [[before, box] as [Bounds, Bounds]] : []),
    ...(after ? [[box, after] as [Bounds, Bounds]] : [])
  ].filter(pair => width(pair) > reach.exact)
  const all = [...pairs, ...mine]
  const same = (a: [Bounds, Bounds], b: [Bounds, Bounds]): boolean => Math.abs(width(a) - width(b)) < reach.exact

  const matching = mine.filter(pair => all.filter(other => same(other, pair)).length >= 2)
  const middle = (lo(box) + hi(box)) / 2
  const away = ([a, b]: [Bounds, Bounds]): number => Math.abs((hi(a) + lo(b)) / 2 - middle)
  const partners = pairs
    .filter(pair => matching.some(m => same(pair, m)))
    .sort((p, q) => away(p) - away(q))

  const marks = new Map<string, GapMark>()
  for (const [a, b] of [...matching, ...partners]) {
    const mark: GapMark = {
      axis,
      from: hi(a),
      to: lo(b),
      at: (Math.max(crossLo(a), crossLo(b)) + Math.min(crossHi(a), crossHi(b))) / 2
    }
    marks.set(`${mark.from},${mark.to},${mark.at}`, mark)
  }
  return [...marks.values()].slice(0, MARKS_EACH_WAY)
}

/** the nearest of another item's edges or centre to any of these, as the nudge onto it; null out of reach */
function nearestPlace(mine: number[], others: Bounds[], axis: Axis, snap: number): number | null {
  let best: number | null = null
  for (const other of others) {
    for (const t of placesOf(other, axis)) {
      for (const m of mine) {
        const d = t - m
        if (Math.abs(d) <= snap && (best === null || Math.abs(d) < Math.abs(best))) best = d
      }
    }
  }
  return best
}

/** the smaller nudge of two, either one missing */
const nearer = (a: number | null, b: number | null): number => {
  if (a === null) return b ?? 0
  if (b === null) return a
  return Math.abs(b) < Math.abs(a) ? b : a
}

/** one line for each of these places another item lines up on, across the box and every item sitting on it */
function linesAt(places: number[], box: Bounds, others: Bounds[], axis: Axis, exact: number): Guide[] {
  const { crossLo, crossHi } = sides(axis)
  const guides: Guide[] = []
  for (const at of new Set(places)) {
    const matched = others.filter(o => placesOf(o, axis).some(t => Math.abs(t - at) < exact))
    if (matched.length === 0) continue
    guides.push({
      axis,
      at,
      from: matched.reduce((min, o) => Math.min(min, crossLo(o)), crossLo(box)),
      to: matched.reduce((max, o) => Math.max(max, crossHi(o)), crossHi(box))
    })
  }
  return guides
}

/** the nudge that lines the moving items up with another item's edges or centre, or spaces them like their neighbours */
export function alignGuides(
  items: WallItem[],
  moving: Set<string>,
  { zoom, view }: GuideView
): { dx: number; dy: number; guides: Guide[]; gaps: GapMark[] } {
  const box = outlineOf(items.filter(i => moving.has(i.id) && i.kind !== 'arrow'))
  if (!box) return { dx: 0, dy: 0, guides: [], gaps: [] }
  const reach = reachAt(zoom)
  const others = othersOf(items, moving, view)

  const dx = nearer(nearestPlace(xsOf(box), others, 'x', reach.snap), spacingSnap(box, others, 'x', reach))
  // sideways first, so the column it is spaced in is the one it lands in
  const across = shifted(box, dx, 0)
  const dy = nearer(nearestPlace(ysOf(across), others, 'y', reach.snap), spacingSnap(across, others, 'y', reach))
  const moved = shifted(box, dx, dy)

  return {
    dx,
    dy,
    guides: [...linesAt(xsOf(moved), moved, others, 'x', reach.exact), ...linesAt(ysOf(moved), moved, others, 'y', reach.exact)],
    gaps: [...gapMarks(moved, others, 'x', reach), ...gapMarks(moved, others, 'y', reach)]
  }
}

/** a side a resize pulls: which of the item's own sizes it changes, and where it faces on the wall */
interface PulledSide {
  own: 'width' | 'height'
  /** how the pull along the item's own side grows it: a west or north corner pulls the other way */
  grow: 1 | -1
  axis: Axis
  /** toward the larger numbers on the wall, or the smaller */
  outward: 1 | -1
}

/** quarter turns only; at any other angle the item's edges aren't straight on the wall */
const quarterOf = (degrees: number): number | null => {
  const turn = ((degrees % 360) + 360) % 360
  return turn % 90 === 0 ? turn / 90 : null
}

/** the two sides a corner pulls, as the wall sees them on an item turned this many quarters */
function pulledSides(corner: Corner, quarter: number, keepHeight: boolean): PulledSide[] {
  const growWidth = corner.includes('w') ? -1 : 1
  const growHeight = corner.includes('n') ? -1 : 1
  // the item's own across runs down the wall after one quarter, backwards after two, up after three
  const acrossFacing = quarter < 2 ? 1 : -1
  const downFacing = quarter === 0 || quarter === 3 ? 1 : -1
  const odd = quarter % 2 === 1
  const pulled: PulledSide[] = [{ own: 'width', grow: growWidth, axis: odd ? 'y' : 'x', outward: (growWidth * acrossFacing) as 1 | -1 }]
  if (!keepHeight) pulled.push({ own: 'height', grow: growHeight, axis: odd ? 'x' : 'y', outward: (growHeight * downFacing) as 1 | -1 })
  return pulled
}

const extent = (b: Bounds, axis: Axis): number => (axis === 'x' ? b.maxX - b.minX : b.maxY - b.minY)

/** how much more this side should grow to land on another item's edge, centre or size; null out of reach */
function pullOnto(side: PulledSide, shown: Bounds, others: Bounds[], snap: number): number | null {
  const { lo, hi } = sides(side.axis)
  const edge = side.outward > 0 ? hi(shown) : lo(shown)
  const size = extent(shown, side.axis)
  let best: number | null = null
  const consider = (grow: number): void => {
    if (Math.abs(grow) <= snap && (best === null || Math.abs(grow) < Math.abs(best))) best = grow
  }
  for (const other of others) {
    for (const t of placesOf(other, side.axis)) consider((t - edge) * side.outward)
    consider(extent(other, side.axis) - size)
  }
  return best
}

/** a measuring bar over a box's width or height, a snap's distance outside it */
const sizeMark = (b: Bounds, axis: Axis, offset: number): GapMark => axis === 'x'
  ? { axis, from: b.minX, to: b.maxX, at: b.minY - offset }
  : { axis, from: b.minY, to: b.maxY, at: b.minX - offset }

/**
 * a corner pulled by a pointer's travel on the wall, its edges snapping onto other items' edges, centres and sizes
 * as a drag's do; straight and quarter-turned items only, and the grid is the drag's own business
 */
export function resizeGuides(
  items: WallItem[],
  start: WallItem,
  corner: Corner,
  dx: number,
  dy: number,
  shape: { keepShape: boolean; keepHeight?: boolean },
  { zoom, view }: GuideView
): { box: { x: number; y: number; width: number; height: number }; guides: Guide[]; gaps: GapMark[] } {
  const rules = { snapping: false, ...shape }
  const rotation = start.rotation ?? 0
  const [along, down] = toLocal(dx, dy, rotation)
  const plain = pulledBox(start, corner, along, down, rules)
  const quarter = quarterOf(rotation)
  if (quarter === null) return { box: plain, guides: [], gaps: [] }

  const reach = reachAt(zoom)
  const others = othersOf(items, new Set([start.id]), view)
  const pulled = pulledSides(corner, quarter, shape.keepHeight ?? false)
  const shownPlain = turnedBox({ ...plain, rotation })
  const pulls = pulled.map(side => ({ side, by: pullOnto(side, shownPlain, others, reach.snap) }))

  let box = plain
  if (shape.keepShape) {
    // one side leads and the other follows the shape, so only the nearer snap can hold
    const lead = pulls.filter(p => p.by !== null).sort((a, b) => Math.abs(a.by as number) - Math.abs(b.by as number))[0]
    if (lead) {
      const scale = (plain[lead.side.own] + (lead.by as number)) / start[lead.side.own]
      const growWidth = corner.includes('w') ? -1 : 1
      const growHeight = corner.includes('n') ? -1 : 1
      box = pulledBox(start, corner, (start.width * scale - start.width) * growWidth, (start.height * scale - start.height) * growHeight, rules)
    }
  } else if (pulls.some(p => p.by !== null)) {
    let nextAlong = along
    let nextDown = down
    for (const { side, by } of pulls) {
      if (by === null) continue
      if (side.own === 'width') nextAlong += by * side.grow
      else nextDown += by * side.grow
    }
    box = pulledBox(start, corner, nextAlong, nextDown, rules)
  }

  const shown = turnedBox({ ...box, rotation })
  const guides = pulled.flatMap(side => linesAt([side.outward > 0 ? sides(side.axis).hi(shown) : sides(side.axis).lo(shown)], shown, others, side.axis, reach.exact))
  const gaps = [...new Set(pulled.map(side => side.axis))].flatMap(axis => {
    const size = extent(shown, axis)
    const middle = (sides(axis).lo(shown) + sides(axis).hi(shown)) / 2
    const same = others
      .filter(o => Math.abs(extent(o, axis) - size) < reach.exact)
      .sort((a, b) => Math.abs((sides(axis).lo(a) + sides(axis).hi(a)) / 2 - middle) - Math.abs((sides(axis).lo(b) + sides(axis).hi(b)) / 2 - middle))
    return same.length === 0 ? [] : [shown, ...same].slice(0, MARKS_EACH_WAY).map(b => sizeMark(b, axis, reach.snap))
  })
  return { box, guides, gaps }
}
