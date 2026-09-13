/** joins focus, windows, clipboard, commits and board moves; inference scoped to a sitting, never per card */

import type { ClipboardItem, FocusSession, GitCommit, Item } from './types'

/** as a focus session recorded it */
interface FocusTaskRef {
  id: string
  title: string
  completed?: boolean
}

/** sessions close enough to be one sitting */
interface Sitting {
  start: number
  end: number
  /** focused time, not wall-clock across gaps */
  durationMs: number
  sessionCount: number
  /** retro notes from each session */
  notes: string[]
  /** ticked off in the sitting's last session */
  completed: boolean
}

/** further apart is a separate sitting */
export const SITTING_GAP_MS = 90 * 60 * 1000 // 90 minutes

export interface RewindInput {
  item: Pick<Item, 'id' | 'title' | 'status' | 'updated_at' | 'metadata'>
  sessions: FocusSession[]
  /** already narrowed by the caller */
  windows: { windowTitle: string; processName: string; durationMs: number }[]
  clipboard: ClipboardItem[]
  commits: GitCommit[]
  now: number
}

type SignalKind =
  | 'stopped-mid-problem'
  | 'work-in-progress-commit'
  | 'nothing-committed'
  | 'checklist-unfinished'
  | 'stalled'

export interface Signal {
  kind: SignalKind
  /** an observation, not a verdict */
  text: string
}

export interface Rewind {
  sitting: Sitting | null
  /** since that sitting ended */
  daysSince: number
  windows: { windowTitle: string; processName: string; durationMs: number }[]
  clipboard: ClipboardItem[]
  commits: GitCommit[]
  /** card activity inside the sitting */
  boardMoves: { text: string; createdAt: number }[]
  signals: Signal[]
}

/** stored as JSON text */
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

/** from the metadata JSON */
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

/** sessions that selected this item */
export function sessionsForItem(sessions: FocusSession[], itemId: string): FocusSession[] {
  return sessions
    .filter(s => parseFocusTasks(s.tasks_json).some(t => t.id === itemId))
    .sort((a, b) => a.completed_at - b.completed_at)
}

/** completed_at is the end, so spans run backwards by duration */
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

/** null if none */
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

  // ticked-off belongs to the final session, it can be unticked in between
  const lastSession = relevant[relevant.length - 1]
  last.completed = parseFocusTasks(lastSession.tasks_json).some(t => t.id === itemId && t.completed)
  return last
}

/** timestamp inside the sitting */
export function within<T>(rows: T[], at: (row: T) => number, sitting: Sitting): T[] {
  return rows.filter(row => {
    const t = at(row)
    return Number.isFinite(t) && t >= sitting.start && t <= sitting.end
  })
}

/** conservative: a false "stopped mid-problem" invents a story */
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

/** commits that describe a pause */
const WIP_HINTS = [/\bwip\b/i, /\btemp\b/i, /\bcheckpoint\b/i, /\bsquash\b/i, /\bfixup\b/i, /\bdo not merge\b/i]

export function looksUnfinished(message: string): boolean {
  return WIP_HINTS.some(re => re.test(message ?? ''))
}

/** floored, "9 days ago" not 9.4 */
export function daysBetween(from: number, to: number): number {
  return Math.max(0, Math.floor((to - from) / 86_400_000))
}

/** what happened, not a diagnosis */
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

/** everything the panel needs */
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

  // longest first, most time is what you were doing
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

/** shortest accurate form */
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
