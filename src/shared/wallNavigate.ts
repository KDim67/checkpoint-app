/** moving the selection by keyboard: through the wall in reading order, or to the nearest item in a direction */

import type { WallItem } from './wallModel'
import type { Direction } from './wallClipboard'

/** an arrow has no box to land on and a locked item can't be picked */
const reachable = (item: WallItem): boolean => item.kind !== 'arrow' && !item.locked

/** row by row like a page; an item whose top sits above the middle of a row's first item joins that row */
export function inReadingOrder(items: WallItem[]): WallItem[] {
  const rows: WallItem[][] = []
  for (const item of [...items].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const row = rows[rows.length - 1]
    if (row && item.y < row[0].y + row[0].height / 2) row.push(item)
    else rows.push([item])
  }
  return rows.flatMap(row => row.sort((a, b) => a.x - b.x))
}

/** the next one along, wrapping round; the first, or the last going back, when nothing is picked */
export function stepThrough(items: WallItem[], currentId: string | null, back: boolean): WallItem | null {
  const order = inReadingOrder(items.filter(reachable))
  if (order.length === 0) return null
  const at = currentId ? order.findIndex(i => i.id === currentId) : -1
  if (at === -1) return back ? order[order.length - 1] : order[0]
  return order[(at + (back ? -1 : 1) + order.length) % order.length]
}

/** the closest item that way by middles, drifting sideways counting double; null when there's nothing further */
export function nearestToward(items: WallItem[], fromId: string, direction: Direction): WallItem | null {
  const from = items.find(i => i.id === fromId)
  if (!from) return null
  const ox = from.x + from.width / 2
  const oy = from.y + from.height / 2
  const across = direction === 'left' || direction === 'right'

  let best: WallItem | null = null
  let bestScore = Infinity
  for (const item of items) {
    if (item.id === fromId || !reachable(item)) continue
    const dx = item.x + item.width / 2 - ox
    const dy = item.y + item.height / 2 - oy
    const along = direction === 'right' ? dx : direction === 'left' ? -dx : direction === 'down' ? dy : -dy
    if (along <= 0) continue
    const score = along + 2 * Math.abs(across ? dy : dx)
    if (score < bestScore) {
      best = item
      bestScore = score
    }
  }
  return best
}
