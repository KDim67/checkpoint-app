/** shared by the collision detector and the drop handler so preview and write agree; pure */

export interface Point {
  x: number
  y: number
}

/** header and footer included */
export interface ColumnBox {
  id: string
  left: number
  right: number
  top: number
  bottom: number
}

/** as laid out when the drag began */
export interface CardBox {
  id: string
  column: string
  top: number
  height: number
}

export interface DropTarget {
  column: string
  /** null is the end of the column */
  before: string | null
}

/** fractional, so a card slots in without renumbering */
export const POSITION_STEP = 1000

/** closer than this sorts as equal */
const TOO_CLOSE = 0.00001

/** zero inside the span */
function distanceTo(low: number, high: number, value: number): number {
  if (value < low) return low - value
  if (value > high) return value - high
  return 0
}

/** midpoints, not bounds, so gaps belong to the cards either side */
export function cardAbove(cards: CardBox[], column: string, y: number): string | null {
  let before: string | null = null
  let highest = Infinity
  for (const card of cards) {
    if (card.column !== column) continue
    if (y >= card.top + card.height / 2) continue
    if (card.top < highest) {
      highest = card.top
      before = card.id
    }
  }
  return before
}

/** null if empty */
export function lastCardIn(cards: CardBox[], column: string): string | null {
  let last: string | null = null
  let lowest = -Infinity
  for (const card of cards) {
    if (card.column !== column) continue
    if (card.top > lowest) {
      lowest = card.top
      last = card.id
    }
  }
  return last
}

/** releasing above or below the board cancels; nearest column horizontally wins */
export function dropTargetAt(
  columns: ColumnBox[],
  cards: CardBox[],
  point: Point
): DropTarget | null {
  let target: ColumnBox | null = null
  let nearest = Infinity
  for (const column of columns) {
    if (point.y < column.top || point.y > column.bottom) continue
    const distance = distanceTo(column.left, column.right, point.x)
    if (distance < nearest) {
      nearest = distance
      target = column
    }
  }
  if (!target) return null
  return { column: target.id, before: cardAbove(cards, target.id, point.y) }
}

/** the sortable off-by-one: moving down, passed cards already shifted up */
export function dropIndex(order: string[], dragged: string, before: string | null): number {
  const rest = order.filter(id => id !== dragged)
  // lifted out and put back in place
  if (before === dragged) return Math.max(0, order.indexOf(dragged))
  if (before === null) return rest.length
  const index = rest.indexOf(before)
  if (index === -1) return rest.length
  const from = order.indexOf(dragged)
  const to = order.indexOf(before)
  return from !== -1 && from < to ? index + 1 : index
}

/** null means the neighbours are too close, renumber the column */
export function positionForIndex(positions: number[], index: number): number | null {
  if (positions.length === 0) return POSITION_STEP
  if (index <= 0) {
    const first = positions[0]
    // halving only makes room above a positive number
    return first > TOO_CLOSE ? first / 2 : first - POSITION_STEP
  }
  if (index >= positions.length) return positions[positions.length - 1] + POSITION_STEP
  const above = positions[index - 1]
  const below = positions[index]
  if (Math.abs(below - above) < TOO_CLOSE) return null
  return (above + below) / 2
}
