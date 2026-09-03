/**
 * Reading a board exported from another app.
 *
 * Checkpoint could already import its own export format, which is no help to
 * anyone arriving from somewhere else, the thing that actually stops people
 * moving in is retyping a board by hand.
 *
 * Pure: parsing only. The caller writes the board configuration and creates the
 * items through the ordinary paths, so an imported workspace is an ordinary one
 * the moment it exists.
 *
 * A note on what is *not* dropped. Trello's export marks archived lists and
 * cards with `closed: true`, and it is tempting to skip them. They are the
 * user's data, and silently losing them during a migration is the worst way to
 * find out an importer is lossy, so archived cards arrive archived, which
 * Checkpoint already has a place for, and archived lists are reported rather
 * than ignored.
 */

import type { ItemPriority } from './types'

export type ImportSource = 'trello'

export interface ImportedColumn {
  id: string
  name: string
}

export interface ImportedCard {
  title: string
  body: string
  /** Resolved column id, or 'archived'. */
  status: string
  position: number
  due_at: number | null
  priority: ItemPriority
  /** Labels, with the colour Trello gave them, to become tags. */
  labels: { name: string; color: string }[]
  checklist: { text: string; done: boolean }[]
}

export interface ImportedBoard {
  source: ImportSource
  /** The board's own name, offered as the workspace name. */
  name: string
  columns: ImportedColumn[]
  cards: ImportedCard[]
  /** Human-readable notes about anything that could not be carried over. */
  notes: string[]
}

// Trello

/** Trello's named colours, mapped onto hex so labels survive as tags. */
const TRELLO_LABEL_COLORS: Record<string, string> = {
  green: '#61bd4f',
  yellow: '#f2d600',
  orange: '#ff9f1a',
  red: '#eb5a46',
  purple: '#c377e0',
  blue: '#0079bf',
  sky: '#00c2e0',
  lime: '#51e898',
  pink: '#ff78cb',
  black: '#344563'
}

export function trelloLabelColor(color: unknown): string {
  const key = typeof color === 'string' ? color.replace(/_(light|dark)$/, '') : ''
  return TRELLO_LABEL_COLORS[key] ?? '#6b7280'
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}
function asObject(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}
function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

/**
 * Column ids follow the same rule the board templates use, so an imported
 * column and a hand-made one of the same name agree. Two lists can share a
 * name, though, and a duplicate id would silently merge them, hence the
 * uniqueness pass.
 */
function columnId(name: string, taken: Set<string>): string {
  const base = name.trim().toLowerCase().replace(/\s+/g, '_') || 'column'
  let id = base
  let n = 2
  while (taken.has(id)) { id = `${base}_${n}`; n++ }
  taken.add(id)
  return id
}

/** True when the object looks like a Trello board export. */
export function detectImportSource(parsed: unknown): ImportSource | null {
  const o = asObject(parsed)
  if (!o) return null
  // Trello always carries both, and Checkpoint's own export carries neither.
  if (Array.isArray(o.lists) && Array.isArray(o.cards)) return 'trello'
  return null
}

export function parseTrelloBoard(parsed: unknown): ImportedBoard | null {
  const o = asObject(parsed)
  if (!o || !Array.isArray(o.lists) || !Array.isArray(o.cards)) return null

  const notes: string[] = []

  // Lists in the order Trello shows them. `pos` is a float, not an index.
  const openLists = asArray(o.lists)
    .map(asObject)
    .filter((l): l is Record<string, unknown> => l !== null)
    .filter(l => l.closed !== true)
    .sort((a, b) => Number(a.pos ?? 0) - Number(b.pos ?? 0))

  const archivedListCount = asArray(o.lists).filter(l => asObject(l)?.closed === true).length
  if (archivedListCount > 0) {
    notes.push(`${archivedListCount} archived list${archivedListCount === 1 ? '' : 's'} were not imported.`)
  }

  const taken = new Set<string>()
  const columns: ImportedColumn[] = []
  /** Trello list id → Checkpoint column id. */
  const listToColumn = new Map<string, string>()

  for (const list of openLists) {
    const name = str(list.name).trim() || 'Untitled'
    const id = columnId(name, taken)
    columns.push({ id, name })
    listToColumn.set(str(list.id), id)
  }

  if (columns.length === 0) return null

  // Checklists are stored alongside the cards, keyed by card id.
  const checklistsByCard = new Map<string, { text: string; done: boolean }[]>()
  for (const raw of asArray(o.checklists)) {
    const cl = asObject(raw)
    if (!cl) continue
    const cardId = str(cl.idCard)
    if (!cardId) continue
    const items = asArray(cl.checkItems)
      .map(asObject)
      .filter((i): i is Record<string, unknown> => i !== null)
      .sort((a, b) => Number(a.pos ?? 0) - Number(b.pos ?? 0))
      .map(i => ({ text: str(i.name), done: i.state === 'complete' }))
      .filter(i => i.text)
    if (items.length === 0) continue
    checklistsByCard.set(cardId, [...(checklistsByCard.get(cardId) ?? []), ...items])
  }

  const perColumn = new Map<string, number>()
  const cards: ImportedCard[] = []

  const sortedCards = asArray(o.cards)
    .map(asObject)
    .filter((c): c is Record<string, unknown> => c !== null)
    .sort((a, b) => Number(a.pos ?? 0) - Number(b.pos ?? 0))

  let orphaned = 0
  for (const card of sortedCards) {
    const title = str(card.name).trim()
    if (!title) continue

    const archived = card.closed === true
    const mapped = listToColumn.get(str(card.idList))
    // A card whose list was archived has nowhere to land. Rather than dropping
    // it, it goes to the first column, visible, and therefore fixable.
    if (!mapped && !archived) orphaned++
    const status = archived ? 'archived' : (mapped ?? columns[0].id)

    const seen = perColumn.get(status) ?? 0
    perColumn.set(status, seen + 1)

    const dueRaw = str(card.due)
    const due = dueRaw ? Date.parse(dueRaw) : NaN

    cards.push({
      title,
      body: str(card.desc),
      status,
      position: (seen + 1) * 1000,
      due_at: Number.isFinite(due) ? due : null,
      // Trello has no priority; guessing one would be inventing data.
      priority: 0,
      labels: asArray(card.labels)
        .map(asObject)
        .map(l => ({ name: str(l?.name).trim(), color: trelloLabelColor(l?.color) }))
        .filter(l => l.name),
      checklist: checklistsByCard.get(str(card.id)) ?? []
    })
  }

  if (orphaned > 0) {
    notes.push(`${orphaned} card${orphaned === 1 ? '' : 's'} came from an archived list and were placed in "${columns[0].name}".`)
  }

  const archivedCards = cards.filter(c => c.status === 'archived').length
  if (archivedCards > 0) {
    notes.push(`${archivedCards} archived card${archivedCards === 1 ? '' : 's'} were imported as archived.`)
  }

  return {
    source: 'trello',
    name: str(o.name).trim() || 'Imported board',
    columns,
    cards,
    notes
  }
}

/** Parses whatever the file turned out to be, or null if unrecognised. */
export function parseForeignBoard(parsed: unknown): ImportedBoard | null {
  switch (detectImportSource(parsed)) {
    case 'trello': return parseTrelloBoard(parsed)
    default: return null
  }
}

/** "3 columns · 24 cards" for the confirmation dialog. */
export function describeImport(board: ImportedBoard): string {
  const cols = `${board.columns.length} column${board.columns.length === 1 ? '' : 's'}`
  const cards = `${board.cards.length} card${board.cards.length === 1 ? '' : 's'}`
  return `${cols} · ${cards}`
}

/** Every distinct label across the board, with the colour to give its tag. */
export function collectLabels(board: ImportedBoard): { name: string; color: string }[] {
  // First colour wins: Trello allows the same label name under two colours, and
  // a tag can only have one.
  const seen = new Map<string, string>()
  for (const card of board.cards) {
    for (const label of card.labels) {
      if (!seen.has(label.name)) seen.set(label.name, label.color)
    }
  }
  return [...seen.entries()].map(([name, color]) => ({ name, color }))
}
