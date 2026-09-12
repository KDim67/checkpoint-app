/**
 * Where a dragged card lands.
 *
 * Read by both the collision detector, which draws the preview, and the drop
 * handler, which writes the position. They have to agree.
 *
 * Pure: rectangles and numbers in, an id or an index out. No DOM, no dnd-kit.
 */

export interface Point {
  x: number
  y: number
}

/** A column's footprint, header and footer included. */
export interface ColumnBox {
  id: string
  left: number
  right: number
  top: number
  bottom: number
}

/** A card's slot in the layout as it stood when the drag began. */
export interface CardBox {
  id: string
  column: string
  top: number
  height: number
}

export interface DropTarget {
  column: string
  /** The card the dragged one goes above. null is the end of the column. */
  before: string | null
}

/** Fractional positions, so a card slots in without the column being renumbered. */
export const POSITION_STEP = 1000

/** Closer than this and two positions are the same number as far as sorting goes. */
const TOO_CLOSE = 0.00001

/** Zero inside the span, otherwise the distance to the nearer edge. */
function distanceTo(low: number, high: number, value: number): number {
  if (value < low) return low - value
  if (value > high) return value - high
  return 0
}

/**
 * The card the pointer would go above, or null for the end of the column.
 *
 * Measured against midpoints, not bounds, so the gaps between cards belong to
 * the card either side of them rather than to nothing.
 */
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

/** The bottom card of a column, or null if it has none. */
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

/**
 * Which column, and where in it.
 *
 * The pointer must be level with the board, so letting go above or below it
 * cancels. Within that band the nearest column horizontally wins, which covers
 * the gutters and the empty space past the last column.
 */
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

/**
 * The index the dragged card takes once it has been lifted out of wherever it
 * was. `order` is the destination column as the user sees it, `before` the card
 * it goes above, null for the end.
 *
 * The step of one is the sortable off-by-one. Moving a card further down its
 * own column, everything it passes has already shifted up into the slot it
 * left, so the card it is dropped above sits one place further along than its
 * index in the list with the dragged card taken out.
 */
export function dropIndex(order: string[], dragged: string, before: string | null): number {
  const rest = order.filter(id => id !== dragged)
  // Its own slot: lifted out and put back in the same place.
  if (before === dragged) return Math.max(0, order.indexOf(dragged))
  if (before === null) return rest.length
  const index = rest.indexOf(before)
  if (index === -1) return rest.length
  const from = order.indexOf(dragged)
  const to = order.indexOf(before)
  return from !== -1 && from < to ? index + 1 : index
}

/**
 * A position that sorts into `index` of a column whose cards already hold
 * `positions`, in that order.
 *
 * null when the two neighbours are already so close that a value between them
 * would not be a distinct number. That is the column asking to be renumbered,
 * not a failure.
 */
export function positionForIndex(positions: number[], index: number): number | null {
  if (positions.length === 0) return POSITION_STEP
  if (index <= 0) {
    const first = positions[0]
    // Halving is what makes room at the top of a column without renumbering it,
    // but it only makes room above a positive number. A first card sitting at
    // or below zero is stepped away from instead.
    return first > TOO_CLOSE ? first / 2 : first - POSITION_STEP
  }
  if (index >= positions.length) return positions[positions.length - 1] + POSITION_STEP
  const above = positions[index - 1]
  const below = positions[index]
  if (Math.abs(below - above) < TOO_CLOSE) return null
  return (above + below) / 2
}
