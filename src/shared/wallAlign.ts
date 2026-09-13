/** lining items up: align and distribute on a selection, and the guides a drag snaps to */

import { boundsOf, moveItems, withFrameContents, type Bounds, type Rect, type WallItem } from './wallModel'

export type AlignEdge = 'left' | 'centre' | 'right' | 'top' | 'middle' | 'bottom'
export type DistributeAxis = 'horizontal' | 'vertical'

/** screen pixels a dragged edge has to come within before it snaps */
export const GUIDE_SNAP_PX = 6

/** what lines up as one piece, and every item that moves with it */
interface Unit { bounds: Bounds; moves: Set<string> }

/** a group is one piece and a frame brings what's in it; arrows follow their ends and locked items stay put */
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
    bounds: boundsOf(members) as Bounds,
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

const boxOf = (i: WallItem): Bounds => ({ minX: i.x, minY: i.y, maxX: i.x + i.width, maxY: i.y + i.height })
const xsOf = (b: Bounds): number[] => [b.minX, (b.minX + b.maxX) / 2, b.maxX]
const ysOf = (b: Bounds): number[] => [b.minY, (b.minY + b.maxY) / 2, b.maxY]

/** the nudge that lines the moving items' edges or centre up with another item's, and a line for each match */
export function alignGuides(
  items: WallItem[],
  moving: Set<string>,
  threshold: number,
  /** only what's on screen pulls, a far item's line would run off the view */
  view?: Rect
): { dx: number; dy: number; guides: Guide[] } {
  const box = boundsOf(items.filter(i => moving.has(i.id) && i.kind !== 'arrow'))
  if (!box) return { dx: 0, dy: 0, guides: [] }
  const others = items
    .filter(i => !moving.has(i.id) && i.kind !== 'arrow' && i.kind !== 'ink')
    .filter(i => !view || (i.x < view.x + view.width && i.x + i.width > view.x && i.y < view.y + view.height && i.y + i.height > view.y))
    .map(boxOf)

  const nearest = (mine: number[], theirs: (b: Bounds) => number[]): number => {
    let best: number | null = null
    for (const other of others) {
      for (const t of theirs(other)) {
        for (const m of mine) {
          const d = t - m
          if (Math.abs(d) <= threshold && (best === null || Math.abs(d) < Math.abs(best))) best = d
        }
      }
    }
    return best ?? 0
  }
  const dx = nearest(xsOf(box), xsOf)
  const dy = nearest(ysOf(box), ysOf)
  const moved: Bounds = { minX: box.minX + dx, maxX: box.maxX + dx, minY: box.minY + dy, maxY: box.maxY + dy }

  const guides: Guide[] = []
  // one line a matched position, across the moving box and every item sitting on it
  const lines = (axis: Guide['axis'], mine: number[], theirs: (b: Bounds) => number[], low: (b: Bounds) => number, high: (b: Bounds) => number): void => {
    for (const at of new Set(mine)) {
      const matched = others.filter(o => theirs(o).some(t => Math.abs(t - at) < 0.5))
      if (matched.length === 0) continue
      guides.push({
        axis,
        at,
        from: matched.reduce((min, o) => Math.min(min, low(o)), low(moved)),
        to: matched.reduce((max, o) => Math.max(max, high(o)), high(moved))
      })
    }
  }
  lines('x', xsOf(moved), xsOf, b => b.minY, b => b.maxY)
  lines('y', ysOf(moved), ysOf, b => b.minX, b => b.maxX)
  return { dx, dy, guides }
}
