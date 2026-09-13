/** edits buffer until Save; this works out what actually changed, shared so the rule is testable */

import type { Item } from './types'

/** comments and ticks save as they happen */
export interface CardSnapshot {
  title: string
  body: string
  priority: number
  status: string
  due_at: number | null
  /** serialised, as stored */
  metadata: string
  tagIds: string[]
}

interface CardEdit {
  patch: Partial<Item>
  /** omitted when untouched, passing them rewrites the join table */
  tagIds?: string[]
  dirty: boolean
}

/** order doesn't matter */
function sameTagIds(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const seen = new Set(a)
  return b.every(id => seen.has(id))
}

export function cardEdit(saved: CardSnapshot, current: CardSnapshot): CardEdit {
  const patch: Partial<Item> = {}

  // trimmed; an empty title keeps the old name
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
