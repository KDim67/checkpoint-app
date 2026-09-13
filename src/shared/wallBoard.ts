/** DOM-free half of the rail; a column drop really moves the card */

import type { Item } from './types'
import type { ColumnConfig } from './boardModel'

/** private type so browser or file drops can't pose as cards */
export const WALL_DRAG_MIME = 'application/x-checkpoint-wall-item'

interface WallDragPayload {
  kind: 'card' | 'doc'
  /** card id, or note title for a doc */
  ref: string
}

export function encodeWallDrag(payload: WallDragPayload): string {
  return JSON.stringify(payload)
}

/** the source may not be us */
export function decodeWallDrag(raw: string | null | undefined): WallDragPayload | null {
  if (!raw) return null

  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { return null }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null

  const o = parsed as Record<string, unknown>
  const kind = o.kind === 'card' || o.kind === 'doc' ? o.kind : null
  const ref = typeof o.ref === 'string' ? o.ref.trim() : ''
  return kind && ref ? { kind, ref } : null
}

export interface BoardGroup {
  column: ColumnConfig
  cards: Item[]
}

/** cards of deleted columns vanish from the board, the rail still shows them */
export const ORPHAN_COLUMN_ID = '__orphaned__'

const ORPHAN_COLUMN: ColumnConfig = {
  id: ORPHAN_COLUMN_ID,
  name: 'No column',
  wipLimit: null
}

/** column order, by position, archived out */
export function groupCardsByColumn(cards: Item[], columns: ColumnConfig[]): BoardGroup[] {
  const byStatus = new Map<string, Item[]>()
  for (const card of cards) {
    if (card.status === 'archived') continue
    const bucket = byStatus.get(card.status)
    if (bucket) bucket.push(card)
    else byStatus.set(card.status, [card])
  }

  const groups: BoardGroup[] = columns.map(column => ({
    column,
    cards: (byStatus.get(column.id) ?? []).slice().sort((a, b) => a.position - b.position)
  }))

  const known = new Set(columns.map(c => c.id))
  const orphans = [...byStatus.entries()]
    .filter(([status]) => !known.has(status))
    .flatMap(([, items]) => items)
    .sort((a, b) => a.position - b.position)

  if (orphans.length > 0) groups.push({ column: ORPHAN_COLUMN, cards: orphans })
  return groups
}

/** every word in the title or a tag */
export function cardMatches(card: Item, words: string[]): boolean {
  if (words.length === 0) return true
  const hay = [card.title, ...(card.tags ?? []).map(t => t.name)].join(' ').toLowerCase()
  return words.every(w => hay.includes(w))
}

/** empty columns dropped while filtering */
export function filterGroups(groups: BoardGroup[], query: string): BoardGroup[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return groups
  return groups
    .map(g => ({ column: g.column, cards: g.cards.filter(c => cardMatches(c, words)) }))
    .filter(g => g.cards.length > 0)
}

/** the board's gap, so positions stay comparable */
const POSITION_GAP = 1000

/** end of the column, like the board */
export function appendPosition(cardsInColumn: Item[]): number {
  if (cardsInColumn.length === 0) return POSITION_GAP
  return Math.max(...cardsInColumn.map(c => c.position)) + POSITION_GAP
}

/** cards already there are skipped so the count is honest */
export function planHandoff(
  refs: string[],
  columnId: string,
  cards: Item[]
): { id: string; status: string; position: number }[] {
  const byId = new Map(cards.map(c => [c.id, c]))
  const inColumn = cards.filter(c => c.status === columnId)

  const plan: { id: string; status: string; position: number }[] = []
  let next = appendPosition(inColumn)

  for (const ref of refs) {
    const card = byId.get(ref)
    if (!card || card.status === columnId) continue
    plan.push({ id: card.id, status: columnId, position: next })
    // spaced so the picked-up order holds
    next += POSITION_GAP
  }
  return plan
}
