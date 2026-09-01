/**
 * Subtasks as rows rather than markdown checkboxes.
 *
 * They used to live as `- [ ]` lines inside a task's body, which meant they
 * could not be counted, rolled up into progress, or handed to an agent as
 * separate work, the things a subtask is for.
 *
 * They are deliberately **their own lightweight table, not full items**. Making
 * each subtask an item would have given them tags and due dates for free, but
 * every existing query, the board, the backlog table, task counts, search, 
 * would then have needed to learn to exclude them, and each place that forgot
 * would quietly show subtasks as top-level work. A small table costs those
 * features and touches nothing else.
 */

export interface Subtask {
  id: string
  itemId: string
  title: string
  done: boolean
  /** Sort order within its parent. Sparse, so one can be inserted between two. */
  position: number
}

export interface SubtaskProgress {
  total: number
  done: number
  /** 0–1. Zero when there are no subtasks, so callers can render a bar directly. */
  ratio: number
}

export function computeProgress(subtasks: Subtask[]): SubtaskProgress {
  const total = subtasks.length
  const done = subtasks.filter(s => s.done).length
  return { total, done, ratio: total === 0 ? 0 : done / total }
}

/** Coerces one stored row. Returns null when it has no usable identity. */
export function normalizeSubtask(raw: unknown): Subtask | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const id = typeof o.id === 'string' ? o.id.trim() : ''
  const itemId = typeof (o.itemId ?? o.item_id) === 'string' ? String(o.itemId ?? o.item_id).trim() : ''
  const title = typeof o.title === 'string' ? o.title.trim() : ''
  if (!id || !itemId || !title) return null

  const position = Number(o.position)
  return {
    id,
    itemId,
    title,
    // SQLite has no boolean, so the stored value is 0/1.
    done: o.done === true || o.done === 1,
    position: Number.isFinite(position) ? position : 0
  }
}

export function normalizeSubtasks(raw: unknown): Subtask[] {
  if (!Array.isArray(raw)) return []
  const out: Subtask[] = []
  for (const entry of raw) {
    const subtask = normalizeSubtask(entry)
    if (subtask) out.push(subtask)
  }
  return out.sort((a, b) => a.position - b.position)
}

/**
 * Position for a new subtask appended to a list.
 *
 * Spaced by 1000 so a later insertion between two neighbours has room without
 * renumbering the whole list, the same trick the board uses for cards.
 */
export function nextPosition(existing: Subtask[]): number {
  if (existing.length === 0) return 1000
  return Math.max(...existing.map(s => s.position)) + 1000
}

/** Matches a markdown task list line, capturing its state and text. */
const CHECKLIST_LINE = /^\s*[-*]\s+\[([ xX])\]\s*(.*)$/

export interface ParsedChecklist {
  /** The checkbox lines found, in document order. */
  items: { title: string; done: boolean }[]
  /** The body with those lines removed, for when they are converted. */
  remainingBody: string
}

/**
 * Pulls markdown checkboxes out of a body.
 *
 * Exists so the subtasks people already wrote as `- [ ]` lines can become real
 * ones instead of being stranded. The conversion is offered rather than applied
 * automatically: rewriting someone's note without asking is not a migration, it
 * is data loss with extra steps.
 *
 * Lines whose text is empty are left alone, `- [ ]` on its own is more likely
 * a template the user is about to fill in than a subtask named "".
 */
export function parseChecklist(body: string): ParsedChecklist {
  const items: { title: string; done: boolean }[] = []
  const kept: string[] = []

  for (const line of (body ?? '').split('\n')) {
    const match = CHECKLIST_LINE.exec(line)
    const title = match?.[2]?.trim() ?? ''
    if (match && title) {
      items.push({ title, done: match[1].toLowerCase() === 'x' })
    } else {
      kept.push(line)
    }
  }

  // Collapse the run of blank lines a removed block leaves behind, but keep
  // paragraph breaks the user wrote.
  const remainingBody = kept.join('\n').replace(/\n{3,}/g, '\n\n').trim()
  return { items, remainingBody }
}

/** True when a body contains at least one convertible checkbox. */
export function hasChecklist(body: string): boolean {
  return parseChecklist(body).items.length > 0
}
