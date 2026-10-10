/** a turned item: what it covers on the wall, and a pointer's travel read in its own directions */

import type { Bounds } from './wallModel'

interface Placed { x: number; y: number; width: number; height: number; rotation?: number }

/** a turn as 0 to 359, so a quarter is recognised whichever way it was made */
const turnOf = (degrees: number): number => ((degrees % 360) + 360) % 360

/** a pointer's travel on the wall in a turned item's own directions; quarter turns are exact, or edges would miss by a hair */
export function toLocal(dx: number, dy: number, degrees: number): [number, number] {
  const turn = turnOf(degrees)
  // 0 minus, so a quarter turn never hands back a negative zero
  if (turn === 0) return [dx, dy]
  if (turn === 90) return [dy, 0 - dx]
  if (turn === 180) return [0 - dx, 0 - dy]
  if (turn === 270) return [0 - dy, dx]
  const angle = (-turn * Math.PI) / 180
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return [dx * cos - dy * sin, dx * sin + dy * cos]
}

/** the upright box a turned item covers, which is what people line things up by */
export function turnedBox(item: Placed): Bounds {
  const turn = turnOf(item.rotation ?? 0)
  // upright or upside down it covers its own box, kept to its own numbers
  if (turn % 180 === 0) return { minX: item.x, minY: item.y, maxX: item.x + item.width, maxY: item.y + item.height }

  let across = item.height
  let down = item.width
  if (turn % 180 !== 90) {
    const angle = (turn * Math.PI) / 180
    const cos = Math.abs(Math.cos(angle))
    const sin = Math.abs(Math.sin(angle))
    across = item.width * cos + item.height * sin
    down = item.width * sin + item.height * cos
  }
  const middleX = item.x + item.width / 2
  const middleY = item.y + item.height / 2
  return { minX: middleX - across / 2, minY: middleY - down / 2, maxX: middleX + across / 2, maxY: middleY + down / 2 }
}

/** the box around several items as they show; nothing for no items */
export function outlineOf(items: Placed[]): Bounds | null {
  if (items.length === 0) return null
  return items.map(turnedBox).reduce((all, b) => ({
    minX: Math.min(all.minX, b.minX),
    minY: Math.min(all.minY, b.minY),
    maxX: Math.max(all.maxX, b.maxX),
    maxY: Math.max(all.maxY, b.maxY)
  }))
}
