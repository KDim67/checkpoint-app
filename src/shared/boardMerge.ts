/**
 * Reconciling two copies of the same board: everything from both.
 *
 * A card either side has, the merged board has. A card both sides have keeps
 * what each of them added to it. Only a tombstone drops anything.
 *
 * Pure: two boards in, one board out. No database, no network.
 */

import type { BoardConfig, ColumnConfig } from './boardModel'
import type { Item, Relation, Tag } from './types'

export interface ItemTagLink {
  item_id: string
  tag_id: string
}

/** One copy of a board, whole. Items are the cards and tasks, nothing else. */
export interface BoardSide {
  context: string
  items: Item[]
  tags: Tag[]
  itemTags: ItemTagLink[]
  relations: Relation[]
  board: BoardConfig
}

/** What the merge did, in the terms the user would put it in. */
export interface MergeSummary {
  columnsAdded: number
  cardsAdded: number
  /** Cards both sides had, where their copy was the more recent one. */
  cardsUpdated: number
  tagsAdded: number
  /** Cards they still have that were deleted here. Left deleted. */
  cardsLeftDeleted: number
  /** Cards here that they had deleted, and that nobody has touched since. */
  cardsTakenAway: number
}

export interface MergeResult extends BoardSide {
  summary: MergeSummary
}

const named = (name: string): string => name.trim().toLowerCase()

/**
 * Their column ids, translated to this board's.
 *
 * Two copies of one board already agree, so this comes back empty. Two boards
 * built separately can still both have a To Do, and pairing those by name is
 * the difference between a merge and two of every column. A card's status is a
 * column id, so anything translated here has to be translated on the cards.
 */
export function columnMap(mine: ColumnConfig[], theirs: ColumnConfig[]): Map<string, string> {
  const ids = new Set(mine.map(column => column.id))
  const names = new Map<string, string>()
  // First wins, so a board with two columns of the same name pairs against the
  // one the user would point at.
  for (const column of mine) {
    const key = named(column.name)
    if (!names.has(key)) names.set(key, column.id)
  }

  const map = new Map<string, string>()
  for (const column of theirs) {
    if (ids.has(column.id)) continue
    const match = names.get(named(column.name))
    if (match) map.set(column.id, match)
  }
  return map
}

/** Mine in their order, then theirs that this board has no column for. */
export function mergeColumns(
  mine: ColumnConfig[],
  theirs: ColumnConfig[],
  map: Map<string, string>
): ColumnConfig[] {
  const columns = mine.map(column => ({ ...column }))
  const known = new Set(columns.map(column => column.id))
  for (const column of theirs) {
    const id = map.get(column.id) ?? column.id
    if (known.has(id)) continue
    known.add(id)
    columns.push({ ...column, id })
  }
  return columns
}

// The card's own contents

/** The metadata lists a card keeps, which are pooled rather than replaced. */
const POOLED = ['comments', 'checklist', 'attachments', 'activities']

function readMeta(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw || '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    // A card whose metadata will not parse is a card with no metadata. Throwing
    // here would take the whole merge down over one bad row.
    return {}
  }
}

function entryKey(entry: unknown): string {
  if (entry && typeof entry === 'object') {
    const id = (entry as { id?: unknown }).id
    if (typeof id === 'string' && id) return `id:${id}`
  }
  // Written before these carried ids, or written by something else. Paired on
  // the whole value instead, which at least keeps the merge from duplicating it.
  return `raw:${JSON.stringify(entry)}`
}

/**
 * Two versions of one list, pooled by entry id.
 *
 * Older side first, so a comment thread still reads in order. An entry both
 * sides have comes from the newer one, where the edit would have been made.
 */
export function poolEntries(older: unknown[], newer: unknown[]): unknown[] {
  const out: unknown[] = []
  const seen = new Map<string, number>()
  for (const entry of older) {
    const key = entryKey(entry)
    if (seen.has(key)) continue
    seen.set(key, out.length)
    out.push(entry)
  }
  for (const entry of newer) {
    const key = entryKey(entry)
    const at = seen.get(key)
    if (at === undefined) {
      seen.set(key, out.length)
      out.push(entry)
      continue
    }
    out[at] = entry
  }
  return out
}

/**
 * One card's metadata from both copies.
 *
 * Single values come from the newer side. The lists are the exception: a
 * comment written on each side is two comments, not one.
 */
export function mergeMetadata(older: string, newer: string): string {
  const left = readMeta(older)
  const right = readMeta(newer)
  const out: Record<string, unknown> = { ...left, ...right }
  for (const key of POOLED) {
    if (!Array.isArray(left[key]) || !Array.isArray(right[key])) continue
    out[key] = poolEntries(left[key] as unknown[], right[key] as unknown[])
  }
  return JSON.stringify(out)
}

/** Whether a card is exactly as the shared ancestor left it. */
function untouchedSince(item: Item, base: Item | undefined): boolean {
  if (!base) return false
  return item.updated_at === base.updated_at && item.metadata === base.metadata
}

/**
 * One card as both copies left it.
 *
 * With an ancestor the question is which side changed it, and only a card
 * changed on both sides is a real conflict. Without one it can only ask which
 * save came last. Conflicts go to the later save either way.
 */
export function mergeItem(mine: Item, theirs: Item, base?: Item): Item {
  // One side moved and the other did not: no contest, whatever the stamps say.
  if (untouchedSince(mine, base) && !untouchedSince(theirs, base)) return { ...theirs, context: mine.context }
  if (untouchedSince(theirs, base) && !untouchedSince(mine, base)) return { ...mine }

  const theirsIsNewer = theirs.updated_at > mine.updated_at
  const newer = theirsIsNewer ? theirs : mine
  const older = theirsIsNewer ? mine : theirs
  return {
    ...newer,
    // From this side whatever happens: a merge must not move a card out of the
    // workspace it is being merged into.
    context: mine.context,
    created_at: Math.min(mine.created_at, theirs.created_at),
    updated_at: Math.max(mine.updated_at, theirs.updated_at),
    metadata: mergeMetadata(older.metadata, newer.metadata)
  }
}

// The board

/**
 * Everything both copies have.
 *
 * `deletedHere` is the ids this side has a tombstone for, and the only thing
 * keeping this from being a straight union.
 */
export function mergeBoards(
  mine: BoardSide,
  theirs: BoardSide,
  deletedHere: ReadonlySet<string> = new Set(),
  /**
   * What they deleted, and when. Asymmetric with `deletedHere` on purpose:
   * theirs only removes a card here if it came after this side last edited it,
   * so a delete cannot undo work done since.
   */
  deletedThere: ReadonlyMap<string, number> = new Map(),
  /** The board as it stood when these two copies were last the same. */
  base: ReadonlyMap<string, Item> = new Map()
): MergeResult {
  const map = columnMap(mine.board.columns, theirs.board.columns)
  const columns = mergeColumns(mine.board.columns, theirs.board.columns, map)

  const summary: MergeSummary = {
    columnsAdded: columns.length - mine.board.columns.length,
    cardsAdded: 0,
    cardsUpdated: 0,
    tagsAdded: 0,
    cardsLeftDeleted: 0,
    cardsTakenAway: 0
  }

  // Their deletions, applied before anything is added, and only where the
  // delete came after this side last touched the card.
  const items: Item[] = []
  for (const item of mine.items) {
    const deletedAt = deletedThere.get(item.id)
    if (deletedAt !== undefined && deletedAt >= item.updated_at) {
      summary.cardsTakenAway++
      continue
    }
    items.push({ ...item })
  }

  const at = new Map<string, number>()
  items.forEach((item, index) => at.set(item.id, index))

  for (const raw of theirs.items) {
    if (deletedHere.has(raw.id)) {
      summary.cardsLeftDeleted++
      continue
    }
    const incoming: Item = {
      ...raw,
      context: mine.context,
      // Their column ids, where this board knows the same column by another id.
      status: map.get(raw.status) ?? raw.status
    }
    const index = at.get(raw.id)
    if (index === undefined) {
      at.set(raw.id, items.length)
      items.push(incoming)
      summary.cardsAdded++
      continue
    }
    const merged = mergeItem(items[index], incoming, base.get(raw.id))
    if (merged.updated_at !== items[index].updated_at || merged.metadata !== items[index].metadata) {
      summary.cardsUpdated++
    }
    items[index] = merged
  }

  const tags = mine.tags.map(tag => ({ ...tag }))
  const tagIds = new Set(tags.map(tag => tag.id))
  for (const tag of theirs.tags) {
    // A tag this side knows keeps this side's name and colour: same tag either
    // way, and renaming someone's tags under them would be the surprise.
    if (tagIds.has(tag.id) || deletedHere.has(tag.id)) continue
    tagIds.add(tag.id)
    tags.push({ ...tag })
    summary.tagsAdded++
  }

  // A tag taken off a card on one side is still on it on the other, and the
  // merge keeps it. Losing nothing cuts both ways.
  const itemIds = new Set(items.map(item => item.id))
  const itemTags: ItemTagLink[] = []
  const linked = new Set<string>()
  for (const link of [...mine.itemTags, ...theirs.itemTags]) {
    if (!itemIds.has(link.item_id) || !tagIds.has(link.tag_id)) continue
    const key = `${link.item_id} ${link.tag_id}`
    if (linked.has(key)) continue
    linked.add(key)
    itemTags.push({ item_id: link.item_id, tag_id: link.tag_id })
  }

  const relations: Relation[] = []
  const relationIds = new Set<string>()
  for (const relation of [...mine.relations, ...theirs.relations]) {
    if (relationIds.has(relation.id) || deletedHere.has(relation.id)) continue
    // One end on this board is enough, matching what the sender sends. A
    // relation reaching out of the board is still that card's relation.
    if (!itemIds.has(relation.from_id) && !itemIds.has(relation.to_id)) continue
    relationIds.add(relation.id)
    relations.push({ ...relation })
  }

  // Anything that came back onto the board through the merge is not archived.
  const archivedColumns = mergeColumns(
    mine.board.archivedColumns,
    theirs.board.archivedColumns,
    map
  ).filter(column => !columns.some(live => live.id === column.id))

  return {
    context: mine.context,
    items,
    tags,
    itemTags,
    relations,
    // The background, swimlanes, card face and filters are how this user looks
    // at the board, and not the other copy's business.
    board: { ...mine.board, columns, archivedColumns },
    summary
  }
}

/** What taking someone else's merged board would do to this one. */
export interface MergeImpact {
  cardsAdded: number
  cardsChanged: number
  /** Cards deleted here that the merge would put back. Worth saying out loud. */
  cardsReturning: number
  /**
   * Cards here that the merge would take away, because the other side had
   * deleted them and a merge honours the deletions of whoever ran it.
   *
   * The one way a merge can cost this board something, so it cannot be left to
   * the sentence about nothing being lost.
   */
  cardsRemoved: number
}

/**
 * What a proposed board would change, without changing anything.
 *
 * Asked before the question reaches the user, so the dialog can put numbers on
 * it rather than asking whether they want to merge.
 */
export function mergeImpact(
  mine: Item[],
  proposed: Item[],
  deletedHere: ReadonlySet<string> = new Set()
): MergeImpact {
  const here = new Map(mine.map(item => [item.id, item]))
  const offered = new Set(proposed.map(item => item.id))
  const impact: MergeImpact = {
    cardsAdded: 0,
    cardsChanged: 0,
    cardsReturning: 0,
    cardsRemoved: mine.reduce((count, item) => (offered.has(item.id) ? count : count + 1), 0)
  }
  for (const item of proposed) {
    const existing = here.get(item.id)
    if (!existing) {
      if (deletedHere.has(item.id)) impact.cardsReturning++
      else impact.cardsAdded++
      continue
    }
    // The stamp moves on any save, the metadata on anything added to the card.
    if (item.updated_at !== existing.updated_at || item.metadata !== existing.metadata) {
      impact.cardsChanged++
    }
  }
  return impact
}

/** What it would do, in one line, or null when it would do nothing. */
export function describeImpact(impact: MergeImpact): string | null {
  const parts: string[] = []
  if (impact.cardsAdded > 0) {
    parts.push(`${impact.cardsAdded} card${impact.cardsAdded === 1 ? '' : 's'} added`)
  }
  if (impact.cardsChanged > 0) parts.push(`${impact.cardsChanged} changed`)
  if (impact.cardsReturning > 0) {
    parts.push(`${impact.cardsReturning} you had deleted put back`)
  }
  if (impact.cardsRemoved > 0) {
    parts.push(`${impact.cardsRemoved} of yours taken away`)
  }
  return parts.length > 0 ? parts.join(', ') : null
}

/** What the merge did, in one line, or null when it changed nothing. */
export function describeMerge(summary: MergeSummary): string | null {
  const parts: string[] = []
  if (summary.cardsAdded > 0) parts.push(`${summary.cardsAdded} card${summary.cardsAdded === 1 ? '' : 's'} added`)
  if (summary.cardsUpdated > 0) parts.push(`${summary.cardsUpdated} updated`)
  if (summary.columnsAdded > 0) parts.push(`${summary.columnsAdded} column${summary.columnsAdded === 1 ? '' : 's'} added`)
  if (summary.tagsAdded > 0) parts.push(`${summary.tagsAdded} tag${summary.tagsAdded === 1 ? '' : 's'} added`)
  if (summary.cardsLeftDeleted > 0) {
    parts.push(`${summary.cardsLeftDeleted} you had deleted not brought back`)
  }
  if (summary.cardsTakenAway > 0) {
    parts.push(`${summary.cardsTakenAway} they had deleted removed`)
  }
  if (parts.length === 0) return null
  return parts.join(', ')
}
