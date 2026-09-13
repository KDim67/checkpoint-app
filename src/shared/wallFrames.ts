/** frames as the wall's pages: their order, their names, a frame around a selection, and what each one holds */

import { boundsOf, createWallItem, withFrameContents, type WallItem } from './wallModel'
import { inReadingOrder } from './wallNavigate'

/** a chosen order first; the rest row by row, as the keyboard steps through the wall */
export function framesInOrder(items: WallItem[], order?: string[]): WallItem[] {
  const reading = inReadingOrder(items.filter(i => i.kind === 'frame'))
  if (!order || order.length === 0) return reading

  // a deleted frame's id is skipped, a new frame joins after the chosen ones
  const byId = new Map(reading.map(f => [f.id, f]))
  const chosen = [...new Set(order)].map(id => byId.get(id)).filter((f): f is WallItem => !!f)
  const placed = new Set(chosen.map(f => f.id))
  return [...chosen, ...reading.filter(f => !placed.has(f.id))]
}

/** every frame's id after one moves, the whole list so the order stays complete */
export function moveFrame(frames: WallItem[], from: number, to: number): string[] {
  const ids = frames.map(f => f.id)
  if (from < 0 || from >= ids.length || to < 0 || to >= ids.length) return ids
  const [moved] = ids.splice(from, 1)
  ids.splice(to, 0, moved)
  return ids
}

export const frameLabel = (frame: WallItem, index: number): string => frame.text?.trim() || `Frame ${index + 1}`

export type PresentAction = 'next' | 'previous' | 'first' | 'last' | 'exit'

/** the keys a slideshow listens to; null leaves the key alone */
export function presentKey(key: string): PresentAction | null {
  if (key === 'ArrowRight' || key === 'ArrowDown' || key === 'PageDown' || key === ' ') return 'next'
  if (key === 'ArrowLeft' || key === 'ArrowUp' || key === 'PageUp') return 'previous'
  if (key === 'Home') return 'first'
  if (key === 'End') return 'last'
  return key === 'Escape' ? 'exit' : null
}

/** so nothing inside touches the border */
const FRAME_PAD = 40

/** around the picked items and behind the lowest of them; null when nothing picked has a box */
export function frameAround(items: WallItem[], ids: Set<string>): WallItem | null {
  const chosen = items.filter(i => ids.has(i.id) && i.kind !== 'arrow')
  const bounds = boundsOf(chosen)
  if (!bounds) return null
  return createWallItem('frame', { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 }, items, {
    width: bounds.maxX - bounds.minX + FRAME_PAD * 2,
    height: bounds.maxY - bounds.minY + FRAME_PAD * 2,
    z: chosen.reduce((lowest, i) => Math.min(lowest, i.z), Infinity) - 1
  })
}

/** the frame, what sits inside it, and connectors whose item ends are all inside too */
export function frameContents(items: WallItem[], frame: WallItem): WallItem[] {
  const inside = withFrameContents(items, new Set([frame.id]))
  return items.filter(i => i.kind === 'arrow'
    // an arrow's box is a placeholder, only its ends say where it is
    ? (!!i.from || !!i.to) && [i.from, i.to].every(end => !end || inside.has(end))
    : inside.has(i.id))
}
