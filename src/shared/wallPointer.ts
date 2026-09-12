/**
 * What the Wall decides about a pointer gesture, apart from the page it happens
 * on.
 *
 * The handlers in WallView still own hit-testing against the DOM, pointer
 * capture and the frames they paint by hand. The decisions they make along the
 * way are here, where they can be tested without any of that.
 */

import { itemAtPoint, snap, SNAP_GRID, type Point, type WallItem } from './wallModel'

/** The gesture a press started, held until the pointer is let go. */
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
      /** Started from a hover handle rather than the arrow tool. */
      viaHandle?: boolean
    }
  | { mode: 'arrowEnd'; id: string; end: 'start' | 'end' }
  | { mode: 'rotate'; id: string; cx: number; cy: number; start: number }
  | { mode: 'marquee'; startX: number; startY: number; base: Set<string> }
  | { mode: 'draw' }
  | null

/**
 * How far a connector has to be dragged before it will be left pointing at
 * empty canvas. Well past the distance a click may wander, so a short slip does
 * not leave a stub of an arrow behind.
 */
export const LOOSE_END_SLOP = 24

/**
 * The selection after pressing an item.
 *
 * Pressing one that is already selected keeps the selection, and the very same
 * set, so a group can be picked up by any of its members without a render for
 * a selection that did not change. Shift toggles the item instead.
 */
export function pressSelection(selected: Set<string>, id: string, shift: boolean): Set<string> {
  const already = selected.has(id)
  return shift
    ? new Set(already ? [...selected].filter(x => x !== id) : [...selected, id])
    : (already ? selected : new Set([id]))
}

/** Where a rotation handle drag starts from: the pointer's angle less the item's rotation. */
export function rotationStart(pointer: Point, centre: Point, rotation: number): number {
  return Math.atan2(pointer.y - centre.y, pointer.x - centre.x) * (180 / Math.PI) - rotation
}

/** The rotation a handle drag has reached. Shift snaps to 15°, the way every rotation handle does. */
export function rotationAngle(pointer: Point, centre: Point, start: number, snapped: boolean): number {
  const angle = Math.atan2(pointer.y - centre.y, pointer.x - centre.x) * (180 / Math.PI) - start
  return snapped ? Math.round(angle / 15) * 15 : Math.round(angle)
}

/** The size a resize handle has dragged an item to, from the size it had at the press. */
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

/** The items being moved, put on the grid when snapping is on. The array as given when it is not. */
export function snapMoving(items: WallItem[], moving: Set<string>, snapping: boolean): WallItem[] {
  return snapping
    ? items.map(i => (moving.has(i.id) ? { ...i, x: snap(i.x, SNAP_GRID), y: snap(i.y, SNAP_GRID) } : i))
    : items
}

/** Whether a pen sample is within two screen pixels of the last one kept. */
export function isStrokeJitter(last: Point, at: Point, zoom: number): boolean {
  return Math.hypot(at.x - last.x, at.y - last.y) < 2 / zoom
}

/**
 * Where a dragged arrow end lands, and the patch that puts it there.
 *
 * Not onto the item at the other end, which would be a loop with nothing to
 * draw, and not onto another arrow. Left where it is dropped when that is
 * nowhere: an arrow pointing at a spot on the wall is a thing people mean.
 */
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

/** The item a connector being dragged out would end on: not another arrow, and not the item it started from. */
export function arrowDropTarget(items: WallItem[], at: Point, fromId: string): string | null {
  const hit = itemAtPoint(items, at)
  return hit && hit.id !== fromId && hit.kind !== 'arrow' ? hit.id : null
}

export interface ArrowRelease {
  /** The connector to draw. A null `to` leaves its far end where the pointer was let go. */
  draw: { from: string; to: string | null } | null
  /** What the arrow tool is waiting on next. Undefined leaves it as it was. */
  armed: string | null | undefined
  /** Whether the pointer goes back to the select tool. */
  handBack: boolean
}

/** What letting go of a connector gesture does. */
export function arrowRelease(gesture: {
  fromId: string
  moved: boolean
  overId: string | null
  viaHandle?: boolean
  /** Screen distance from the press to the release. */
  travelled: number
  /** The item already picked as a source, if any. */
  armed: string | null
}): ArrowRelease {
  if (gesture.moved) {
    // Dropped on empty canvas, the far end stays where it was let go. An arrow
    // pointing at a spot rather than at a thing is a normal thing to want on a
    // wall.
    const draw = gesture.overId
      ? { from: gesture.fromId, to: gesture.overId }
      : gesture.travelled > LOOSE_END_SLOP ? { from: gesture.fromId, to: null } : null
    // A finished arrow hands the pointer back. A slip that drew nothing does
    // not: the tool is still armed because it was never used.
    return { draw, armed: null, handBack: draw !== null }
  }

  // A handle press that never moved is a misfire, not the first half of a
  // gesture: there is no mode to be left waiting in.
  if (gesture.viaHandle) return { draw: null, armed: undefined, handBack: false }

  // Never moved, so it was a click. Pick a source, then a target, which is the
  // easier gesture when the two items nearly touch.
  if (gesture.armed && gesture.armed !== gesture.fromId) {
    return { draw: { from: gesture.armed, to: gesture.fromId }, armed: null, handBack: true }
  }
  // Clicking the same item again puts it down rather than looping it.
  return { draw: null, armed: gesture.armed === gesture.fromId ? null : gesture.fromId, handBack: false }
}

/**
 * Whether a finished gesture takes an undo step of its own. A move that never
 * passed the click threshold changed nothing, and a stroke or a new connector
 * is recorded as it is added.
 */
export function recordsHistory(drag: WallDrag): boolean {
  if (!drag) return false
  if (drag.mode === 'move') return drag.moved
  return drag.mode === 'resize' || drag.mode === 'rotate' || drag.mode === 'arrowEnd'
}
