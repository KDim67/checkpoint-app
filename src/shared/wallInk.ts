/** the pen's other ends: erasing strokes, whole or in part, and lassoing items */

import { distanceToSegment, inkFromPath, inkNaturalSize, type Point, type WallItem } from './wallModel'

/** a highlighter stroke is this many pen widths and see-through, so the words under it still read */
export const HIGHLIGHT_SCALE = 3
export const HIGHLIGHT_OPACITY = 0.4

/** a stroke's points on the wall, scaled with its box the way it's drawn */
export function inkPoints(item: WallItem): Point[] {
  const points = item.points ?? []
  const natural = inkNaturalSize(item)
  const sx = natural.width === 0 ? 1 : item.width / natural.width
  const sy = natural.height === 0 ? 1 : item.height / natural.height
  const out: Point[] = []
  for (let i = 0; i + 1 < points.length; i += 2) {
    out.push({ x: item.x + points[i] * sx, y: item.y + points[i + 1] * sy })
  }
  return out
}

const cross = (o: Point, a: Point, b: Point): number => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)

/** zero when the two cross */
function segmentGap(a: Point, b: Point, c: Point, d: Point): number {
  const d1 = cross(c, d, a)
  const d2 = cross(c, d, b)
  const d3 = cross(a, b, c)
  const d4 = cross(a, b, d)
  if (d1 * d2 < 0 && d3 * d4 < 0) return 0
  return Math.min(distanceToSegment(a, c, d), distanceToSegment(b, c, d), distanceToSegment(c, a, b), distanceToSegment(d, a, b))
}

/** strokes touched between one pointer sample and the next, so a fast sweep can't skip over a line */
export function eraseAlong(items: WallItem[], from: Point, to: Point, radius: number): string[] {
  return items
    .filter(i => {
      if (i.kind !== 'ink' || i.locked) return false
      const width = i.strokeWidth ?? 4
      // the box first, most strokes are nowhere near
      const slack = radius + width
      if (Math.max(from.x, to.x) < i.x - slack || Math.min(from.x, to.x) > i.x + i.width + slack) return false
      if (Math.max(from.y, to.y) < i.y - slack || Math.min(from.y, to.y) > i.y + i.height + slack) return false

      const reach = radius + width / 2
      const points = inkPoints(i)
      if (points.length === 1) return distanceToSegment(points[0], from, to) <= reach
      for (let k = 1; k < points.length; k++) {
        if (segmentGap(from, to, points[k - 1], points[k]) <= reach) return true
      }
      return false
    })
    .map(i => i.id)
}

/** points no more than a step apart, so a cut can land between two samples the pen happened to take */
function densify(points: Point[], step: number): Point[] {
  if (points.length < 2) return points
  const out: Point[] = [points[0]]
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    const pieces = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step))
    for (let k = 1; k <= pieces; k++) {
      out.push({ x: a.x + ((b.x - a.x) * k) / pieces, y: a.y + ((b.y - a.y) * k) / pieces })
    }
  }
  return out
}

const pieceId = (): string => `w-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`

/** a stroke of its own along the points, in the look of the one it came from */
function pieceOf(points: Point[], source: WallItem, strokeWidth: number, newId: () => string): WallItem | null {
  const piece = inkFromPath(points, [], {
    strokeWidth,
    ...(source.color ? { color: source.color } : {}),
    ...(source.smooth ? { smooth: source.smooth } : {}),
    ...(source.highlight ? { highlight: true } : {})
  })
  return piece ? { ...piece, id: newId(), z: source.z } : null
}

/** only what the eraser passes over goes; a stroke cut through the middle leaves a stroke each side, and what was cut away comes back as strokes for Recently deleted */
export function eraseParts(
  items: WallItem[],
  from: Point,
  to: Point,
  radius: number,
  newId: () => string = pieceId
): { items: WallItem[]; touched: boolean; erased: WallItem[] } {
  const hit = new Set(eraseAlong(items, from, to, radius))
  if (hit.size === 0) return { items, touched: false, erased: [] }

  const erased: WallItem[] = []
  const next = items.flatMap((item): WallItem[] => {
    if (!hit.has(item.id)) return [item]
    const natural = inkNaturalSize(item)
    const sx = natural.width === 0 ? 1 : item.width / natural.width
    const sy = natural.height === 0 ? 1 : item.height / natural.height
    // the pieces draw at their own size, so the width carries the stretch the box gave the line
    const strokeWidth = (item.strokeWidth ?? 4) * Math.sqrt(sx * sy)
    const reach = radius + strokeWidth / 2

    const runs: Point[][] = []
    // each cut takes the kept point either side, so putting it back joins the line up again
    const cuts: Point[][] = []
    let run: Point[] = []
    let cut: Point[] = []
    let previous: Point | null = null
    for (const point of densify(inkPoints(item), Math.max(1, radius / 2))) {
      if (distanceToSegment(point, from, to) <= reach) {
        if (run.length > 1) runs.push(run)
        run = []
        if (cut.length === 0 && previous) cut.push(previous)
        cut.push(point)
      } else {
        if (cut.length > 0) {
          cuts.push([...cut, point])
          cut = []
        }
        run.push(point)
      }
      previous = point
    }
    if (run.length > 1) runs.push(run)
    if (cut.length > 0) cuts.push(cut)

    // nothing left of it, so the stroke itself is what went
    if (runs.length === 0) {
      erased.push(item)
      return []
    }
    const kept = runs.flatMap(points => {
      const piece = pieceOf(points, item, strokeWidth, newId)
      return piece ? [piece] : []
    })
    for (const points of cuts) {
      const piece = pieceOf(points, item, strokeWidth, newId)
      if (piece) erased.push(piece)
    }
    return kept
  })
  return { items: next, touched: true, erased }
}

const sameLook = (a: WallItem, b: WallItem): boolean =>
  a.color === b.color && !!a.highlight === !!b.highlight && (a.smooth ?? 0) === (b.smooth ?? 0) &&
  Math.abs((a.strokeWidth ?? 4) - (b.strokeWidth ?? 4)) < 0.01

/** cuts from one sweep that meet end to start become one stroke, so a long erase is one thing to bring back */
export function joinStrokes(strokes: WallItem[], newId: () => string = pieceId): WallItem[] {
  const lines = strokes.map(source => ({ source, points: inkPoints(source), joined: false }))
  const meets = (a: Point, b: Point): boolean => Math.hypot(a.x - b.x, a.y - b.y) < 0.5

  let merged = true
  while (merged) {
    merged = false
    for (let i = 0; i < lines.length && !merged; i++) {
      for (let j = 0; j < lines.length && !merged; j++) {
        const a = lines[i]
        const b = lines[j]
        if (i === j || a.points.length === 0 || b.points.length === 0 || !sameLook(a.source, b.source)) continue
        if (!meets(a.points[a.points.length - 1], b.points[0])) continue
        lines[i] = { source: a.source, points: [...a.points, ...b.points.slice(1)], joined: true }
        lines.splice(j, 1)
        merged = true
      }
    }
  }

  return lines.flatMap(line => {
    if (!line.joined) return [line.source]
    const piece = pieceOf(line.points, line.source, line.source.strokeWidth ?? 4, newId)
    return piece ? [piece] : []
  })
}

/** even-odd ray cast */
function enclosed(p: Point, polygon: Point[]): boolean {
  let hit = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]
    const b = polygon[j]
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) hit = !hit
  }
  return hit
}

/** items whose middle the loop goes round; an open loop closes straight back to where it started */
export function lassoPick(items: WallItem[], path: Point[]): string[] {
  if (path.length < 3) return []
  return items
    .filter(i => i.kind !== 'arrow' && !i.locked && enclosed({ x: i.x + i.width / 2, y: i.y + i.height / 2 }, path))
    .map(i => i.id)
}
