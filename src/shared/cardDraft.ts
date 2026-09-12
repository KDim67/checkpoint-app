/**
 * What the card modal has to write when Save is pressed.
 *
 * The modal used to write on every keystroke and every dropdown change. That
 * made closing without committing impossible, and it would have turned a
 * "last five changes" history into a log of typing. Edits now sit in memory
 * and this works out what actually differs from the card as it was loaded.
 *
 * Pure and shared so the rule about what counts as a change is testable, and
 * in one place rather than spread across twenty-five call sites.
 */

import type { Item } from './types'

/** The buffered half of a card. Comments and checklist ticks are not here: they save as they happen. */
export interface CardSnapshot {
  title: string
  body: string
  priority: number
  status: string
  due_at: number | null
  /** Serialised, because that is what goes to the database and what came back from it. */
  metadata: string
  tagIds: string[]
}

interface CardEdit {
  patch: Partial<Item>
  /** Left out entirely when the tags were not touched: passing them rewrites the join table. */
  tagIds?: string[]
  dirty: boolean
}

/** Order is not meaningful. The same tags in a different order is not an edit. */
function sameTagIds(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const seen = new Set(a)
  return b.every(id => seen.has(id))
}

export function cardEdit(saved: CardSnapshot, current: CardSnapshot): CardEdit {
  const patch: Partial<Item> = {}

  // Trimmed, and an empty title is not a change but a mistake: the card keeps
  // the name it had rather than becoming untitled.
  const title = current.title.trim()
  if (title && title !== saved.title) patch.title = title

  if (current.body !== saved.body) patch.body = current.body
  if (current.priority !== saved.priority) patch.priority = current.priority as Item['priority']
  if (current.status !== saved.status) patch.status = current.status
  if (current.due_at !== saved.due_at) patch.due_at = current.due_at
  if (current.metadata !== saved.metadata) patch.metadata = current.metadata

  const tagsChanged = !sameTagIds(saved.tagIds, current.tagIds)

  return {
    patch,
    tagIds: tagsChanged ? current.tagIds : undefined,
    dirty: Object.keys(patch).length > 0 || tagsChanged
  }
}
