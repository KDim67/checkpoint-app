/**
 * The last few changes to a card, in words.
 *
 * Written at save time from the difference between the card as it was loaded
 * and as it is being written, so one entry is one deliberate change rather
 * than one keystroke. That is the whole reason the modal buffers at all.
 *
 * Kept in the card's own metadata, so it travels with the card: a shared board
 * syncs it through the ordinary item update and needs no separate channel.
 */

import type { CardSnapshot } from './cardDraft'
import { authorLabel } from './identity'

export interface CardChange {
  id: string
  at: number
  /** May be empty. An entry written before anyone set a name still reads correctly. */
  by: string
  what: string
}

/** What the friend asked for, and enough to see what just happened without becoming a log. */
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

/**
 * One phrase per thing that moved. Plural because a single save can carry
 * several, and folding them into "edited the card" would say nothing.
 *
 * Column names are looked up rather than printed raw: the stored status is an
 * id, and "moved to in_review" is not what anybody called that column.
 */
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

  // The buffered half of metadata only. Checklist items, comments and
  // attachments write as they happen and log themselves at that moment.
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

/**
 * Newest first, capped. The cap is what keeps this in the card's metadata
 * rather than needing a table of its own, and what stops a card that is edited
 * every day from carrying a year of noise to every peer it syncs with.
 */
export function appendCardChanges(
  existing: CardChange[],
  phrases: string[],
  by: string,
  at: number
): CardChange[] {
  if (phrases.length === 0) return existing
  const author = by.trim()
  const fresh = phrases.map((what, i) => ({
    // Index included because a single save can produce several in the same millisecond.
    id: `chg-${at}-${i}`,
    at,
    by: author,
    what
  }))
  return [...fresh, ...existing].slice(0, CARD_HISTORY_LIMIT)
}

/**
 * Reads whatever is in metadata, which may be hand-edited or written by an
 * older build. Cards created before this existed store `{ text, createdAt }`
 * and no author, so both shapes are accepted rather than throwing that history
 * away on first open.
 */
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

/**
 * Deliberately not capped on the way in.
 *
 * Reading trimmed to five, and the next comment or checklist tick wrote that
 * trimmed list straight back, so merely opening a card built before the cap
 * and then touching anything destroyed the rest of its history. The cap
 * belongs on what is written and what is shown, not on what is read.
 */
export function visibleCardHistory(entries: CardChange[]): CardChange[] {
  return entries.slice(0, CARD_HISTORY_LIMIT)
}

/** "Dimitris renamed the card to X", or just the change when nobody is named. */
export function changeSentence(change: CardChange): string {
  if (!change.by) return change.what
  // Lowercased so the name leads the sentence instead of the verb.
  return `${authorLabel(change.by)} ${change.what.charAt(0).toLowerCase()}${change.what.slice(1)}`
}
