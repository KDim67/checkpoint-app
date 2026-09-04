/**
 * The board shown beside the Wall. The DOM-free half: what a drag carries, how
 * cards group into columns, where one lands when handed back.
 *
 * Position on the wall still means nothing. Dropping onto a named column is not
 * a position though, so that one gesture moves the card for real.
 */

import type { Item } from './types'
import type { ColumnConfig } from './boardModel'

/** Private type, so a drop from a browser or file manager cannot look like a card. */
export const WALL_DRAG_MIME = 'application/x-checkpoint-wall-item'

export interface WallDragPayload {
  kind: 'card' | 'doc'
  /** An item id for a card, a note title for a doc. As `WallItem.ref`. */
  ref: string
}

export function encodeWallDrag(payload: WallDragPayload): string {
  return JSON.stringify(payload)
}

/** A drop carries whatever the source wrote, and that source may not be us. */
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

// Grouping

export interface BoardGroup {
  column: ColumnConfig
  cards: Item[]
}

/**
 * Cards whose column was deleted keep its id and vanish from the board, so the
 * rail is the only place left to see them.
 */
export const ORPHAN_COLUMN_ID = '__orphaned__'

export const ORPHAN_COLUMN: ColumnConfig = {
  id: ORPHAN_COLUMN_ID,
  name: 'No column',
  wipLimit: null
}

/** By status, in column order, sorted by position. Archived left out, as on the board. */
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

/** Every word of the query has to appear, in the title or in a tag. */
export function cardMatches(card: Item, words: string[]): boolean {
  if (words.length === 0) return true
  const hay = [card.title, ...(card.tags ?? []).map(t => t.name)].join(' ').toLowerCase()
  return words.every(w => hay.includes(w))
}

/** Empty columns are dropped while filtering. They are noise, not structure. */
export function filterGroups(groups: BoardGroup[], query: string): BoardGroup[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return groups
  return groups
    .map(g => ({ column: g.column, cards: g.cards.filter(c => cardMatches(c, words)) }))
    .filter(g => g.cards.length > 0)
}

// Handing a card back to the board

/** Matches the board's own gap, so positions stay comparable between the two. */
const POSITION_GAP = 1000

/** At the end of the column, matching what the board does for the same drop. */
export function appendPosition(cardsInColumn: Item[]): number {
  if (cardsInColumn.length === 0) return POSITION_GAP
  return Math.max(...cardsInColumn.map(c => c.position)) + POSITION_GAP
}

/**
 * Which selected items are cards that would actually move, and where to. Cards
 * already in the column are skipped so the "moved N" count stays honest.
 */
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
    // Spaced, so a multi-card hand-off keeps the order it was picked up in.
    next += POSITION_GAP
  }
  return plan
}
