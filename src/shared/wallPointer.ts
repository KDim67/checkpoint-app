/** the decisions, testable without the DOM; handlers keep hit-testing, capture and painting */

import { itemAtPoint, snap, SNAP_GRID, type Point, type WallItem } from './wallModel'

/** held until release */
export type WallDrag =
  | { mode: 'pan'; startX: number; startY: number; camX: number; camY: number }
  | { mode: 'move'; startX: number; startY: number; origin: WallItem[]; moved: boolean }
  | { mode: 'resize'; id: string; startX: number; startY: number; w: number; h: number }
  | {
      mode: 'arrow'
      fromId: string
      startX: number
      startY: number
      moved: boolean
      overId: string | null
      /** from a hover handle, not the arrow tool */
      viaHandle?: boolean
    }
  | { mode: 'arrowEnd'; id: string; end: 'start' | 'end' }
  | { mode: 'rotate'; id: string; cx: number; cy: number; start: number }
  | { mode: 'marquee'; startX: number; startY: number; base: Set<string> }
  | { mode: 'draw' }
  | null

/** well past click slop so a slip doesn't leave a stub */
export const LOOSE_END_SLOP = 24

/** pressing a selected item keeps the same set, no render; shift toggles */
export function pressSelection(selected: Set<string>, id: string, shift: boolean): Set<string> {
  const already = selected.has(id)
  return shift
    ? new Set(already ? [...selected].filter(x => x !== id) : [...selected, id])
    : (already ? selected : new Set([id]))
}

/** pointer angle less rotation */
export function rotationStart(pointer: Point, centre: Point, rotation: number): number {
  return Math.atan2(pointer.y - centre.y, pointer.x - centre.x) * (180 / Math.PI) - rotation
}

/** shift snaps to 15° */
export function rotationAngle(pointer: Point, centre: Point, start: number, snapped: boolean): number {
  const angle = Math.atan2(pointer.y - centre.y, pointer.x - centre.x) * (180 / Math.PI) - start
  return snapped ? Math.round(angle / 15) * 15 : Math.round(angle)
}

/** from the size at the press */
export function resizedSize(
  width: number,
  height: number,
  dx: number,
  dy: number,
  snapping: boolean
): { width: number; height: number } {
  return {
    width: Math.max(40, snapping ? snap(width + dx, SNAP_GRID) : width + dx),
    height: Math.max(32, snapping ? snap(height + dy, SNAP_GRID) : height + dy)
  }
}

/** the given array when not snapping */
export function snapMoving(items: WallItem[], moving: Set<string>, snapping: boolean): WallItem[] {
  return snapping
    ? items.map(i => (moving.has(i.id) ? { ...i, x: snap(i.x, SNAP_GRID), y: snap(i.y, SNAP_GRID) } : i))
    : items
}

/** within two screen pixels of the last kept */
export function isStrokeJitter(last: Point, at: Point, zoom: number): boolean {
  return Math.hypot(at.x - last.x, at.y - last.y) < 2 / zoom
}

/** never onto its own other end or another arrow; nowhere leaves it pointing at a spot */
export function arrowEndTarget(
  items: WallItem[],
  at: Point,
  arrow: WallItem,
  end: 'start' | 'end'
): { targetId: string | null; patch: Partial<WallItem> } {
  const other = end === 'start' ? arrow.to : arrow.from
  const hit = itemAtPoint(items, at)
  const target = hit && hit.kind !== 'arrow' && hit.id !== other ? hit : null
  const patch = end === 'start'
    ? (target ? { from: target.id, fromPoint: undefined } : { from: undefined, fromPoint: at })
    : (target ? { to: target.id, toPoint: undefined } : { to: undefined, toPoint: at })
  return { targetId: target?.id ?? null, patch }
}

/** not an arrow, not its source */
export function arrowDropTarget(items: WallItem[], at: Point, fromId: string): string | null {
  const hit = itemAtPoint(items, at)
  return hit && hit.id !== fromId && hit.kind !== 'arrow' ? hit.id : null
}

export interface ArrowRelease {
  /** a null to leaves the far end at the release */
  draw: { from: string; to: string | null } | null
  /** undefined leaves it as it was */
  armed: string | null | undefined
  /** back to select */
  handBack: boolean
}

export function arrowRelease(gesture: {
  fromId: string
  moved: boolean
  overId: string | null
  viaHandle?: boolean
  /** screen distance */
  travelled: number
  /** source already picked */
  armed: string | null
}): ArrowRelease {
  if (gesture.moved) {
    // dropped on canvas, the far end stays there
    const draw = gesture.overId
      ? { from: gesture.fromId, to: gesture.overId }
      : gesture.travelled > LOOSE_END_SLOP ? { from: gesture.fromId, to: null } : null
    // a finished arrow hands back; a slip keeps the tool armed
    return { draw, armed: null, handBack: draw !== null }
  }

  // a still handle press is a misfire, nothing to wait in
  if (gesture.viaHandle) return { draw: null, armed: undefined, handBack: false }

  // a click: pick source then target, easier when items nearly touch
  if (gesture.armed && gesture.armed !== gesture.fromId) {
    return { draw: { from: gesture.armed, to: gesture.fromId }, armed: null, handBack: true }
  }
  // clicking the same item puts it down
  return { draw: null, armed: gesture.armed === gesture.fromId ? null : gesture.fromId, handBack: false }
}

/** moves under the threshold changed nothing; strokes and connectors record as added */
export function recordsHistory(drag: WallDrag): boolean {
  if (!drag) return false
  if (drag.mode === 'move') return drag.moved
  return drag.mode === 'resize' || drag.mode === 'rotate' || drag.mode === 'arrowEnd'
}
