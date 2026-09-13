import type { ColumnConfig } from '../../lib/boardConfig'

/** sorted columns pick their own order, lanes are still worth aiming at; shared so collision and gap agree */
export function canAimAtSlot(column: ColumnConfig, swimlanes: boolean): boolean {
  return swimlanes || (column.sort ?? 'manual') === 'manual'
}
