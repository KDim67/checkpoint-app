/** written at save from the diff, one entry per deliberate change; in metadata so it syncs with the card */

import type { CardSnapshot } from './cardDraft'
import { authorLabel } from './identity'

export interface CardChange {
  id: string
  at: number
  /** may be empty for entries from before names */
  by: string
  what: string
}

/** enough to see what just happened without becoming a log */
export const CARD_HISTORY_LIMIT = 5

const PRIORITY_LABELS: Record<number, string> = { 0: 'None', 1: 'Low', 2: 'Medium', 3: 'High' }

function priorityLabel(value: number): string {
  return PRIORITY_LABELS[value] ?? String(value)
}

function dateLabel(at: number): string {
  return new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function parseMeta(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw || '{}')
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function coverLabel(cover: unknown): string {
  if (!cover || typeof cover !== 'object') return ''
  const c = cover as { type?: string; value?: string }
  if (c.type === 'color') return `Set the cover colour to ${c.value}`
  if (c.type === 'image') return 'Set a cover image'
  return 'Set the cover'
}

/** one phrase per change; column names looked up, not raw ids */
export function describeCardChanges(
  before: CardSnapshot,
  after: CardSnapshot,
  columnName: (status: string) => string
): string[] {
  const changes: string[] = []

  const title = after.title.trim()
  if (title && title !== before.title) changes.push(`Renamed the card to "${title}"`)
  if (after.body !== before.body) {
    changes.push(before.body.trim() ? 'Edited the description' : 'Wrote the description')
  }
  if (after.priority !== before.priority) {
    changes.push(`Set priority to ${priorityLabel(after.priority)}`)
  }
  if (after.status !== before.status) {
    changes.push(`Moved to ${columnName(after.status)}`)
  }
  if (after.due_at !== before.due_at) {
    changes.push(after.due_at ? `Set the due date to ${dateLabel(after.due_at)}` : 'Cleared the due date')
  }

  const added = after.tagIds.filter(id => !before.tagIds.includes(id)).length
  const removed = before.tagIds.filter(id => !after.tagIds.includes(id)).length
  if (added > 0) changes.push(`Added ${added} tag${added === 1 ? '' : 's'}`)
  if (removed > 0) changes.push(`Removed ${removed} tag${removed === 1 ? '' : 's'}`)

  // buffered metadata only, the rest logs as it happens
  const metaBefore = parseMeta(before.metadata)
  const metaAfter = parseMeta(after.metadata)

  if (JSON.stringify(metaBefore.cover ?? null) !== JSON.stringify(metaAfter.cover ?? null)) {
    changes.push(metaAfter.cover ? coverLabel(metaAfter.cover) : 'Removed the cover')
  }
  if (Boolean(metaBefore.isTemplate) !== Boolean(metaAfter.isTemplate)) {
    changes.push(metaAfter.isTemplate ? 'Made this a template' : 'Made this an ordinary card')
  }
  if (Boolean(metaBefore.dueDateCompleted) !== Boolean(metaAfter.dueDateCompleted)) {
    changes.push(metaAfter.dueDateCompleted ? 'Marked the due date done' : 'Marked the due date not done')
  }

  return changes
}

/** newest first, capped so it fits in metadata and doesn't sync a year of noise */
export function appendCardChanges(
  existing: CardChange[],
  phrases: string[],
  by: string,
  at: number
): CardChange[] {
  if (phrases.length === 0) return existing
  const author = by.trim()
  const fresh = phrases.map((what, i) => ({
    // indexed, one save can make several in one ms
    id: `chg-${at}-${i}`,
    at,
    by: author,
    what
  }))
  return [...fresh, ...existing].slice(0, CARD_HISTORY_LIMIT)
}

/** older builds stored { text, createdAt } without an author, accept both */
export function readCardHistory(raw: unknown): CardChange[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((e): e is Record<string, unknown> => Boolean(e) && typeof e === 'object')
    .map((e, i) => {
      const what = typeof e.what === 'string' ? e.what : typeof e.text === 'string' ? e.text : ''
      const at = typeof e.at === 'number' ? e.at : typeof e.createdAt === 'number' ? e.createdAt : 0
      return {
        id: typeof e.id === 'string' ? e.id : `chg-${i}`,
        at: Number.isFinite(at) ? at : 0,
        by: typeof e.by === 'string' ? e.by : '',
        what
      }
    })
    .filter(e => e.what)
}

/** not capped on read, a trimmed read got written back and destroyed history */
export function visibleCardHistory(entries: CardChange[]): CardChange[] {
  return entries.slice(0, CARD_HISTORY_LIMIT)
}

/** "<name> renamed the card to X", or just the change */
export function changeSentence(change: CardChange): string {
  if (!change.by) return change.what
  // lowercased so the name leads
  return `${authorLabel(change.by)} ${change.what.charAt(0).toLowerCase()}${change.what.slice(1)}`
}
