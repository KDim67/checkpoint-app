/** rows, not body lines; own table so item queries needn't exclude them */

export interface Subtask {
  id: string
  itemId: string
  title: string
  done: boolean
  /** sparse, room to insert between */
  position: number
}

interface SubtaskProgress {
  total: number
  done: number
  /** 0-1, zero with none so a bar renders directly */
  ratio: number
}

export function computeProgress(subtasks: Subtask[]): SubtaskProgress {
  const total = subtasks.length
  const done = subtasks.filter(s => s.done).length
  return { total, done, ratio: total === 0 ? 0 : done / total }
}

/** null without an identity */
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
    // SQLite 0/1
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

/** spaced 1000 like the board's cards */
export function nextPosition(existing: Subtask[]): number {
  if (existing.length === 0) return 1000
  return Math.max(...existing.map(s => s.position)) + 1000
}

/** captures state and text */
const CHECKLIST_LINE = /^\s*[-*]\s+\[([ xX])\]\s*(.*)$/

interface ParsedChecklist {
  /** in document order */
  items: { title: string; done: boolean }[]
  /** with those lines removed */
  remainingBody: string
}

/** offered, never automatic; a bare - [ ] is a template, skipped */
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

  // collapse blank runs, keep paragraph breaks
  const remainingBody = kept.join('\n').replace(/\n{3,}/g, '\n\n').trim()
  return { items, remainingBody }
}

export function hasChecklist(body: string): boolean {
  return parseChecklist(body).items.length > 0
}
