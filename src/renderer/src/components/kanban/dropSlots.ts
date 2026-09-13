import type { ColumnConfig } from '../../lib/boardConfig'

/**
 * Whether a drop can pick a slot in a column or only land in it.
 *
 * A column sorted by priority or due date decides its own order, so a slot
 * picked in one is a slot the card would not keep. Swimlanes override a
 * column's own sort with a priority grouping, and a lane is very much worth
 * aiming at: dropping into one is how a card's priority gets set.
 *
 * Read by the collision detector and by the column that draws the gap. Written
 * out twice they could disagree, and then the gap is drawn somewhere the card
 * is not going to land.
 */
export function canAimAtSlot(column: ColumnConfig, swimlanes: boolean): boolean {
  return swimlanes || (column.sort ?? 'manual') === 'manual'
}
