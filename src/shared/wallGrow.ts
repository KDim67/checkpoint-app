/** the next item beside one already on the wall: its kind and look, where it goes, and bringing it into view */

import { createWallItem, DEFAULT_SIZES, WALL_COLORS, type WallCamera, type WallItem, type WallItemKind } from './wallModel'
import { isWritable } from './wallShape'

export type Side = 'top' | 'right' | 'bottom' | 'left'
export const SIDES: readonly Side[] = ['top', 'right', 'bottom', 'left']

/** room for an arrow between the two */
export const GROW_GAP = 64
/** any closer reads as touching */
const CLEARANCE = 8
/** rings further out before a crowded wall gets an overlap */
const RINGS = 3
/** straight out, then one along each way, then two */
const FAN = [0, 1, -1, 2, -2]

type Size = { width: number; height: number }

/** a sticky, text or shape brings its own kind and look; anything else starts a sticky */
export function grownItem(items: WallItem[], source: WallItem, side: Side): WallItem {
  const kind: WallItemKind = isWritable(source.kind) ? source.kind : 'note'
  const same = kind === source.kind
  const size: Size = !same
    ? DEFAULT_SIZES.note
    // a text box's height follows its words, a new one starts a line tall
    : { width: source.width, height: kind === 'text' ? DEFAULT_SIZES.text.height : source.height }
  const spot = freeSpot(items, source, size, side)

  return createWallItem(kind, { x: spot.x + size.width / 2, y: spot.y + size.height / 2 }, items, {
    width: size.width,
    height: size.height,
    ...(same
      ? { ...(source.color ? { color: source.color } : {}), ...(source.shape ? { shape: source.shape } : {}) }
      : { color: WALL_COLORS[items.length % WALL_COLORS.length] })
  })
}

/** fanning along the side, so repeat clicks build a column instead of a pile */
function freeSpot(items: WallItem[], source: WallItem, size: Size, side: Side): { x: number; y: number } {
  const across = side === 'left' || side === 'right'
  const out = (across ? size.width : size.height) + GROW_GAP
  const along = (across ? size.height : size.width) + GROW_GAP / 2
  const centreX = source.x + source.width / 2 - size.width / 2
  const centreY = source.y + source.height / 2 - size.height / 2
  // a frame holds things, it doesn't take up their room
  const solid = items.filter(i => i.kind !== 'arrow' && i.kind !== 'ink' && i.kind !== 'frame')
  const clear = (x: number, y: number): boolean => !solid.some(i =>
    x < i.x + i.width + CLEARANCE && x + size.width + CLEARANCE > i.x &&
    y < i.y + i.height + CLEARANCE && y + size.height + CLEARANCE > i.y)

  const ring = (r: number): { x: number; y: number } => {
    const reach = GROW_GAP + r * out
    if (side === 'right') return { x: source.x + source.width + reach, y: centreY }
    if (side === 'left') return { x: source.x - reach - size.width, y: centreY }
    if (side === 'bottom') return { x: centreX, y: source.y + source.height + reach }
    return { x: centreX, y: source.y - reach - size.height }
  }

  for (let r = 0; r <= RINGS; r++) {
    const base = ring(r)
    for (const step of FAN) {
      const spot = across ? { x: base.x, y: base.y + step * along } : { x: base.x + step * along, y: base.y }
      if (clear(spot.x, spot.y)) return spot
    }
  }
  // overlapping beats ignoring the click
  return ring(0)
}

/** the least pan that brings the item in past the margin; the same camera when it's already in view */
export function cameraShowing(
  camera: WallCamera,
  viewport: { width: number; height: number },
  item: { x: number; y: number; width: number; height: number },
  margin = 48
): WallCamera {
  // a box bigger than the view lines up on its start edge
  const shift = (start: number, length: number, room: number): number => {
    if (start < margin) return margin - start
    const end = start + length
    return end > room - margin ? Math.max(margin - start, room - margin - end) : 0
  }
  const dx = shift(item.x * camera.zoom + camera.x, item.width * camera.zoom, viewport.width)
  const dy = shift(item.y * camera.zoom + camera.y, item.height * camera.zoom, viewport.height)
  return dx === 0 && dy === 0 ? camera : { ...camera, x: camera.x + dx, y: camera.y + dy }
}
