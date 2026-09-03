/**
 * The board, shown beside the Wall.
 *
 * The Wall and the Kanban board are separate views, so until now a card got
 * onto a wall through a picker: open a list, find the card, and it appears in
 * the middle of the view. That works, but it is not what anyone means by
 * putting a card on a wall.
 *
 * Side by side, the board becomes a rail down one edge and the gesture becomes
 * the literal one, pick a card up out of its column and drop it where you want
 * it. This module is the part of that with no DOM in it: what a drag carries,
 * how cards group into columns, and where a card lands when it is handed back.
 *
 * The direction back matters as much as the direction out. **Moving an item on
 * the wall still means nothing**, that is the Wall's whole premise, and it does
 * not change here. But dropping a card *onto a named column* is not a position,
 * it is a statement, and it is allowed to move the card for real.
 */

import type { Item } from './types'
import type { ColumnConfig } from './boardModel'

/**
 * A private type, so a drop that came from a browser, a file manager, or
 * another part of the app cannot be mistaken for a card being placed.
 */
export const WALL_DRAG_MIME = 'application/x-checkpoint-wall-item'

export interface WallDragPayload {
  kind: 'card' | 'doc'
  /** An item id for a card, a note title for a doc, as `WallItem.ref`. */
  ref: string
}

export function encodeWallDrag(payload: WallDragPayload): string {
  return JSON.stringify(payload)
}

/**
 * Hand-normalised rather than trusted: a drop carries whatever the source chose
 * to write, and the source is not necessarily this application.
 */
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
 * Where cards go when the column they name is gone. Deleting a column leaves
 * its cards behind holding its id, and they are invisible on the board itself, 
 * so the rail is the one place they can be seen, and they are worth showing
 * rather than silently dropping.
 */
export const ORPHAN_COLUMN_ID = '__orphaned__'

export const ORPHAN_COLUMN: ColumnConfig = {
  id: ORPHAN_COLUMN_ID,
  name: 'No column',
  wipLimit: null
}

/**
 * Groups cards the way the board does: by status, in column order, sorted by
 * position. Archived cards are left out, the board hides them too.
 */
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

/**
 * Filters the cards, and drops the columns left empty: with a query running,
 * a column of nothing is noise rather than structure.
 */
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

/**
 * Where a card lands when it is dropped on a column rather than between two
 * cards: at the end, which is what the board does for the same gesture.
 */
export function appendPosition(cardsInColumn: Item[]): number {
  if (cardsInColumn.length === 0) return POSITION_GAP
  return Math.max(...cardsInColumn.map(c => c.position)) + POSITION_GAP
}

/**
 * Which of the selected wall items are cards that would actually move, and to
 * what position. A card already in the target column is left out: the move
 * would be a no-op, and reporting "moved 3 cards" for it would be a lie.
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
    // Spaced apart, so a multi-card hand-off keeps the order it was picked up in
    // instead of collapsing onto one position.
    next += POSITION_GAP
  }
  return plan
}
