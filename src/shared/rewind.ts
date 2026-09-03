/**
 * Reconstructing what you were doing the last time you worked on something.
 *
 * Checkpoint already records five things separately and joins none of them:
 * which tasks a focus session covered, which windows were open and for how
 * long, what was copied, what was committed, and how a card moved. Each is
 * timestamped and sits in the same local database. This is the join.
 *
 * **Attribution here is inference, not fact.** Window activity is recorded per
 * workspace, never per card, the honest link is "you had this card selected in
 * a focus session, and here is what else happened during it". Everything below
 * is therefore scoped to a *sitting*: a span of time anchored by focus sessions
 * that named the card. Presenting it as anything more certain would be worse
 * than presenting nothing, because a confident wrong answer costs more to
 * unpick than a blank panel.
 *
 * Pure. No IPC, no dates beyond arithmetic on numbers the caller supplies.
 */

import type { ClipboardItem, FocusSession, GitCommit, Item } from './types'

/** A task or card as a focus session recorded it. */
export interface FocusTaskRef {
  id: string
  title: string
  completed?: boolean
}

/**
 * One continuous stretch of work: focus sessions close enough together to be
 * the same sitting rather than separate visits.
 */
export interface Sitting {
  start: number
  end: number
  /** Time actually focused, not wall-clock across the gaps. */
  durationMs: number
  sessionCount: number
  /** Retrospective notes the user wrote at the end of each session. */
  notes: string[]
  /** True when the card was ticked off in the last session of the sitting. */
  completed: boolean
}

/** Sessions further apart than this are separate sittings, not one long one. */
export const SITTING_GAP_MS = 90 * 60 * 1000 // 90 minutes

export interface RewindInput {
  item: Pick<Item, 'id' | 'title' | 'status' | 'updated_at' | 'metadata'>
  sessions: FocusSession[]
  /** Already narrowed to the sitting by the caller, the tracker query is ranged. */
  windows: { windowTitle: string; processName: string; durationMs: number }[]
  clipboard: ClipboardItem[]
  commits: GitCommit[]
  now: number
}

export type SignalKind =
  | 'stopped-mid-problem'
  | 'work-in-progress-commit'
  | 'nothing-committed'
  | 'checklist-unfinished'
  | 'stalled'

export interface Signal {
  kind: SignalKind
  /** One sentence, phrased as an observation rather than a verdict. */
  text: string
}

export interface Rewind {
  sitting: Sitting | null
  /** Days between the end of that sitting and now. */
  daysSince: number
  windows: { windowTitle: string; processName: string; durationMs: number }[]
  clipboard: ClipboardItem[]
  commits: GitCommit[]
  /** Card activity entries that fall inside the sitting. */
  boardMoves: { text: string; createdAt: number }[]
  signals: Signal[]
}

// Parsing

/** Reads a focus session's task list, which is stored as JSON text. */
export function parseFocusTasks(tasksJson: string | null | undefined): FocusTaskRef[] {
  if (!tasksJson) return []
  try {
    const parsed = JSON.parse(tasksJson)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(t => t && typeof t === 'object' && typeof t.id === 'string')
      .map(t => ({
        id: t.id as string,
        title: typeof t.title === 'string' ? t.title : '',
        completed: t.completed === true
      }))
  } catch {
    return []
  }
}

/** Card activity entries, which live as JSON in the item's metadata column. */
export function parseBoardMoves(metadata: string | null | undefined): { text: string; createdAt: number }[] {
  if (!metadata) return []
  try {
    const meta = JSON.parse(metadata)
    const acts = Array.isArray(meta?.activities) ? meta.activities : []
    return acts
      .filter((a: unknown) => {
        const o = a as { text?: unknown; createdAt?: unknown }
        return typeof o?.text === 'string' && typeof o?.createdAt === 'number'
      })
      .map((a: { text: string; createdAt: number }) => ({ text: a.text, createdAt: a.createdAt }))
  } catch {
    return []
  }
}

// The join

/** Focus sessions in which this item was one of the selected tasks. */
export function sessionsForItem(sessions: FocusSession[], itemId: string): FocusSession[] {
  return sessions
    .filter(s => parseFocusTasks(s.tasks_json).some(t => t.id === itemId))
    .sort((a, b) => a.completed_at - b.completed_at)
}

/**
 * Groups sessions into sittings.
 *
 * `completed_at` is when a session *ended*, so a session's span runs backwards
 * from it by its own duration, otherwise a 50-minute session looks like an
 * instant, and the window activity during it falls outside the span entirely.
 */
export function clusterSittings(sessions: FocusSession[], gapMs = SITTING_GAP_MS): Sitting[] {
  const ordered = [...sessions].sort((a, b) => a.completed_at - b.completed_at)
  const sittings: Sitting[] = []

  for (const session of ordered) {
    const start = session.completed_at - session.duration_ms
    const current = sittings[sittings.length - 1]

    if (current && start - current.end <= gapMs) {
      current.end = session.completed_at
      current.durationMs += session.duration_ms
      current.sessionCount++
      if (session.notes?.trim()) current.notes.push(session.notes.trim())
    } else {
      sittings.push({
        start,
        end: session.completed_at,
        durationMs: session.duration_ms,
        sessionCount: 1,
        notes: session.notes?.trim() ? [session.notes.trim()] : [],
        completed: false
      })
    }
  }

  return sittings
}

/** The most recent sitting that covered this item, or null if there is none. */
export function lastSittingFor(
  sessions: FocusSession[],
  itemId: string,
  gapMs = SITTING_GAP_MS
): Sitting | null {
  const relevant = sessionsForItem(sessions, itemId)
  if (relevant.length === 0) return null

  const sittings = clusterSittings(relevant, gapMs)
  const last = sittings[sittings.length - 1] ?? null
  if (!last) return null

  // Whether the item was ticked off is a property of the final session, not of
  // the sitting as a whole: it can be unticked and reselected across sessions.
  const lastSession = relevant[relevant.length - 1]
  last.completed = parseFocusTasks(lastSession.tasks_json).some(t => t.id === itemId && t.completed)
  return last
}

/** Rows whose timestamp falls inside the sitting. */
export function within<T>(rows: T[], at: (row: T) => number, sitting: Sitting): T[] {
  return rows.filter(row => {
    const t = at(row)
    return Number.isFinite(t) && t >= sitting.start && t <= sitting.end
  })
}

// Reading the evidence

/**
 * Wording that suggests the copied text is a failure rather than a snippet.
 * Deliberately conservative: a false "you stopped mid-problem" is worse than
 * staying quiet, because it invents a story about the user's own work.
 */
const ERROR_HINTS = [
  /\bexception\b/i,
  /\berror\s*:/i,
  /\btraceback\b/i,
  /\bstack\s*trace\b/i,
  /\bnullreference/i,
  /\bsegmentation fault\b/i,
  /\bpanic:/i,
  /\bunhandled\b/i,
  /\bcannot read (?:property|properties)\b/i,
  /\bis not a function\b/i,
  /\bundefined is not\b/i,
  /^\s*at\s+\S+.*:\d+/m
]

export function looksLikeAnError(text: string): boolean {
  if (!text || text.length < 8) return false
  return ERROR_HINTS.some(re => re.test(text))
}

/** Commit messages that describe a pause rather than a finished piece of work. */
const WIP_HINTS = [/\bwip\b/i, /\btemp\b/i, /\bcheckpoint\b/i, /\bsquash\b/i, /\bfixup\b/i, /\bdo not merge\b/i]

export function looksUnfinished(message: string): boolean {
  return WIP_HINTS.some(re => re.test(message ?? ''))
}

/** Days between two moments, floored, "9 days ago" rather than 9.4. */
export function daysBetween(from: number, to: number): number {
  return Math.max(0, Math.floor((to - from) / 86_400_000))
}

/**
 * Observations drawn from the evidence.
 *
 * Every one is phrased as something that happened, not as a diagnosis. The
 * point is to hand back a fact the user had forgotten, and let them draw the
 * conclusion.
 */
export function detectSignals(
  input: RewindInput,
  sitting: Sitting,
  clipboard: ClipboardItem[],
  commits: GitCommit[]
): Signal[] {
  const signals: Signal[] = []

  const lastCopied = [...clipboard].sort((a, b) => b.created_at - a.created_at)[0]
  if (lastCopied && looksLikeAnError(lastCopied.content)) {
    signals.push({
      kind: 'stopped-mid-problem',
      text: 'The last thing you copied looks like an error.'
    })
  }

  const lastCommit = [...commits].sort((a, b) => Date.parse(b.date) - Date.parse(a.date))[0]
  if (lastCommit && looksUnfinished(lastCommit.message)) {
    signals.push({
      kind: 'work-in-progress-commit',
      text: 'Your last commit was marked unfinished.'
    })
  }

  if (commits.length === 0 && sitting.durationMs >= 20 * 60 * 1000) {
    signals.push({
      kind: 'nothing-committed',
      text: 'You worked for a while but committed nothing.'
    })
  }

  const meta = safeMetadata(input.item.metadata)
  const checklist = Array.isArray(meta.checklist) ? meta.checklist : []
  const open = checklist.filter((c: { done?: boolean }) => c && c.done !== true).length
  if (open > 0) {
    signals.push({
      kind: 'checklist-unfinished',
      text: `${open} checklist item${open === 1 ? '' : 's'} still unticked.`
    })
  }

  const days = daysBetween(sitting.end, input.now)
  const settled = input.item.status === 'done' || input.item.status === 'archived'
  if (!settled && days >= 7) {
    signals.push({
      kind: 'stalled',
      text: `Untouched for ${days} days, and still not done.`
    })
  }

  return signals
}

function safeMetadata(metadata: string | null | undefined): Record<string, unknown> {
  if (!metadata) return {}
  try {
    const parsed = JSON.parse(metadata)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

/** Everything the panel needs, from the raw streams. */
export function buildRewind(input: RewindInput, gapMs = SITTING_GAP_MS): Rewind {
  const sitting = lastSittingFor(input.sessions, input.item.id, gapMs)

  if (!sitting) {
    return {
      sitting: null,
      daysSince: 0,
      windows: [],
      clipboard: [],
      commits: [],
      boardMoves: [],
      signals: []
    }
  }

  const clipboard = within(input.clipboard, c => c.created_at, sitting)
    .sort((a, b) => b.created_at - a.created_at)
  const commits = within(input.commits, c => Date.parse(c.date), sitting)
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
  const boardMoves = within(parseBoardMoves(input.item.metadata), m => m.createdAt, sitting)
    .sort((a, b) => b.createdAt - a.createdAt)

  // Longest first: what you spent the most time in is what you were doing.
  const windows = [...input.windows].sort((a, b) => b.durationMs - a.durationMs)

  return {
    sitting,
    daysSince: daysBetween(sitting.end, input.now),
    windows,
    clipboard,
    commits,
    boardMoves,
    signals: detectSignals(input, sitting, clipboard, commits)
  }
}

/** "1h 45m", "22m", "40s", the shortest form that is still accurate. */
export function formatDuration(ms: number): string {
  if (ms < 1000) return '0s'
  const totalMinutes = Math.floor(ms / 60000)
  if (totalMinutes < 1) return `${Math.floor(ms / 1000)}s`
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours === 0) return `${minutes}m`
  if (minutes === 0) return `${hours}h`
  return `${hours}h ${minutes}m`
}
