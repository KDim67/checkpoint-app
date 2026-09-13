import { describe, it, expect } from 'vitest'
import {
  buildRewind,
  clusterSittings,
  daysBetween,
  detectSignals,
  formatDuration,
  lastSittingFor,
  looksLikeAnError,
  looksUnfinished,
  parseBoardMoves,
  parseFocusTasks,
  sessionsForItem,
  SITTING_GAP_MS,
  within,
  type RewindInput
} from '../src/shared/rewind'
import type { ClipboardItem, FocusSession, GitCommit } from '../src/shared/types'
import { defined } from './helpers/defined'

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

const T = Date.UTC(2026, 5, 15, 12, 0, 0) // a fixed noon to reason from

const session = (over: Partial<FocusSession> = {}): FocusSession => ({
  id: 's1',
  context: 'work',
  duration_ms: 25 * MIN,
  completed_at: T,
  notes: '',
  tasks_json: JSON.stringify([{ id: 'card-1', title: 'A card', completed: false }]),
  ...over
})

const clip = (content: string, created_at: number): ClipboardItem => ({
  id: `c-${created_at}`,
  content,
  is_pinned: 0,
  label: null,
  created_at
})

const commit = (message: string, at: number): GitCommit => ({
  hash: 'abc123',
  message,
  author: 'me',
  date: new Date(at).toISOString()
})

const input = (over: Partial<RewindInput> = {}): RewindInput => ({
  item: { id: 'card-1', title: 'A card', status: 'in_progress', updated_at: T, metadata: '{}' },
  sessions: [session()],
  windows: [],
  clipboard: [],
  commits: [],
  now: T + DAY,
  ...over
})

describe('parseFocusTasks', () => {
  it('reads the id, title and done state', () => {
    expect(parseFocusTasks('[{"id":"a","title":"T","completed":true}]'))
      .toEqual([{ id: 'a', title: 'T', completed: true }])
  })

  it('survives absent or broken JSON', () => {
    expect(parseFocusTasks(null)).toEqual([])
    expect(parseFocusTasks('')).toEqual([])
    expect(parseFocusTasks('{oops')).toEqual([])
    expect(parseFocusTasks('{"not":"an array"}')).toEqual([])
  })

  it('drops entries with no id, since the id is what the join needs', () => {
    expect(parseFocusTasks('[{"title":"no id"},{"id":"good","title":"x"}]'))
      .toEqual([{ id: 'good', title: 'x', completed: false }])
  })
})

describe('sessionsForItem', () => {
  it('matches on id, not on title', () => {
    // titles can repeat, the id joins exactly
    const sessions = [
      session({ id: 'a', tasks_json: JSON.stringify([{ id: 'other', title: 'A card' }]) }),
      session({ id: 'b', tasks_json: JSON.stringify([{ id: 'card-1', title: 'Different name' }]) })
    ]
    expect(sessionsForItem(sessions, 'card-1').map(s => s.id)).toEqual(['b'])
  })

  it('finds the card among several selected tasks', () => {
    const s = session({
      tasks_json: JSON.stringify([{ id: 'x' }, { id: 'card-1' }, { id: 'y' }])
    })
    expect(sessionsForItem([s], 'card-1')).toHaveLength(1)
  })

  it('returns nothing when the card was never in a session', () => {
    expect(sessionsForItem([session()], 'never-picked')).toEqual([])
  })
})

describe('clusterSittings', () => {
  it('treats a session as spanning backwards from when it ended', () => {
    // completed_at is the end, or the span is an instant
    const [sit] = clusterSittings([session({ duration_ms: 25 * MIN, completed_at: T })])
    expect(sit.start).toBe(T - 25 * MIN)
    expect(sit.end).toBe(T)
  })

  it('joins sessions separated by a short break into one sitting', () => {
    const sittings = clusterSittings([
      session({ id: 'a', completed_at: T }),
      session({ id: 'b', completed_at: T + 30 * MIN })
    ])
    expect(sittings).toHaveLength(1)
    expect(sittings[0].sessionCount).toBe(2)
    expect(sittings[0].durationMs).toBe(50 * MIN)
  })

  it('splits sessions separated by more than the gap', () => {
    const sittings = clusterSittings([
      session({ id: 'a', completed_at: T }),
      session({ id: 'b', completed_at: T + 4 * HOUR })
    ])
    expect(sittings).toHaveLength(2)
  })

  it('sums focused time rather than wall clock across the break', () => {
    const sittings = clusterSittings([
      session({ id: 'a', duration_ms: 25 * MIN, completed_at: T }),
      session({ id: 'b', duration_ms: 25 * MIN, completed_at: T + 60 * MIN })
    ])
    expect(sittings[0].durationMs).toBe(50 * MIN)
    // longer than focused time, that's the point
    expect(sittings[0].end - sittings[0].start).toBeGreaterThan(50 * MIN)
  })

  it('collects the retrospective notes and skips the blank ones', () => {
    const sittings = clusterSittings([
      session({ id: 'a', notes: 'chased a deadzone bug', completed_at: T }),
      session({ id: 'b', notes: '   ', completed_at: T + 30 * MIN })
    ])
    expect(sittings[0].notes).toEqual(['chased a deadzone bug'])
  })

  it('handles sessions given out of order', () => {
    const sittings = clusterSittings([
      session({ id: 'late', completed_at: T + 4 * HOUR }),
      session({ id: 'early', completed_at: T })
    ])
    expect(sittings).toHaveLength(2)
    expect(sittings[0].end).toBeLessThan(sittings[1].end)
  })

  it('is empty for no sessions', () => {
    expect(clusterSittings([])).toEqual([])
  })
})

describe('lastSittingFor', () => {
  it('returns the most recent sitting, not the first', () => {
    const sit = defined(lastSittingFor([
      session({ id: 'old', completed_at: T - 5 * DAY }),
      session({ id: 'recent', completed_at: T })
    ], 'card-1'))
    expect(sit.end).toBe(T)
  })

  it('reports whether the card was ticked off in the final session', () => {
    const sit = defined(lastSittingFor([
      session({ id: 'a', completed_at: T, tasks_json: JSON.stringify([{ id: 'card-1', completed: false }]) }),
      session({ id: 'b', completed_at: T + 30 * MIN, tasks_json: JSON.stringify([{ id: 'card-1', completed: true }]) })
    ], 'card-1'))
    expect(sit.completed).toBe(true)
  })

  it('is null when the card was never focused on', () => {
    expect(lastSittingFor([session()], 'other-card')).toBeNull()
  })
})

describe('within', () => {
  const sitting = { start: T, end: T + HOUR, durationMs: HOUR, sessionCount: 1, notes: [], completed: false }

  it('keeps rows inside the span and drops the rest', () => {
    const rows = [clip('before', T - MIN), clip('during', T + MIN), clip('after', T + 2 * HOUR)]
    expect(within(rows, c => c.created_at, sitting).map(c => c.content)).toEqual(['during'])
  })

  it('includes the exact boundaries', () => {
    const rows = [clip('start', T), clip('end', T + HOUR)]
    expect(within(rows, c => c.created_at, sitting)).toHaveLength(2)
  })

  it('drops rows whose timestamp will not parse', () => {
    const rows = [{ at: NaN }]
    expect(within(rows, r => r.at, sitting)).toEqual([])
  })
})

describe('looksLikeAnError', () => {
  it('spots the common shapes', () => {
    expect(looksLikeAnError('NullReferenceException at ProcessMove')).toBe(true)
    expect(looksLikeAnError('Traceback (most recent call last):')).toBe(true)
    expect(looksLikeAnError('TypeError: undefined is not a function')).toBe(true)
    expect(looksLikeAnError('    at Object.<anonymous> (/app/index.js:12)')).toBe(true)
  })

  it('stays quiet on ordinary copied text', () => {
    // a false alarm invents a story about the user's work
    expect(looksLikeAnError('const x = 5')).toBe(false)
    expect(looksLikeAnError('https://example.com/docs')).toBe(false)
    expect(looksLikeAnError('remember to buy milk')).toBe(false)
  })

  it('ignores fragments too short to judge', () => {
    expect(looksLikeAnError('error')).toBe(false)
    expect(looksLikeAnError('')).toBe(false)
  })
})

describe('looksUnfinished', () => {
  it('recognises a pause marker', () => {
    expect(looksUnfinished('WIP: deadzone handling')).toBe(true)
    expect(looksUnfinished('temp fix, do not merge')).toBe(true)
    expect(looksUnfinished('fixup! earlier commit')).toBe(true)
  })

  it('leaves a finished message alone', () => {
    expect(looksUnfinished('Add deadzone handling to the input system')).toBe(false)
  })

  it('does not fire on a word that merely contains wip', () => {
    expect(looksUnfinished('Add swipe gesture support')).toBe(false)
  })
})

describe('daysBetween', () => {
  it('floors, so 9.4 days reads as 9', () => {
    expect(daysBetween(T, T + 9.4 * DAY)).toBe(9)
  })

  it('is zero for the same day and never negative', () => {
    expect(daysBetween(T, T + HOUR)).toBe(0)
    expect(daysBetween(T + DAY, T)).toBe(0)
  })
})

describe('formatDuration', () => {
  it('picks the shortest accurate form', () => {
    expect(formatDuration(105 * MIN)).toBe('1h 45m')
    expect(formatDuration(22 * MIN)).toBe('22m')
    expect(formatDuration(2 * HOUR)).toBe('2h')
    expect(formatDuration(40_000)).toBe('40s')
    expect(formatDuration(0)).toBe('0s')
  })
})

describe('detectSignals', () => {
  const sitting = { start: T, end: T + HOUR, durationMs: HOUR, sessionCount: 1, notes: [], completed: false }

  it('notices the last copied thing was an error', () => {
    const s = detectSignals(input(), sitting, [clip('NullReferenceException at Move', T + MIN)], [])
    expect(s.map(x => x.kind)).toContain('stopped-mid-problem')
  })

  it('judges only the most recent copy, not any of them', () => {
    const s = detectSignals(input(), sitting, [
      clip('NullReferenceException at Move', T + MIN),
      clip('just some notes', T + 2 * MIN)
    ], [])
    expect(s.map(x => x.kind)).not.toContain('stopped-mid-problem')
  })

  it('notices an unfinished last commit', () => {
    const s = detectSignals(input(), sitting, [], [commit('WIP: deadzone', T + MIN)])
    expect(s.map(x => x.kind)).toContain('work-in-progress-commit')
  })

  it('notices a long stretch with nothing committed', () => {
    const s = detectSignals(input(), sitting, [], [])
    expect(s.map(x => x.kind)).toContain('nothing-committed')
  })

  it('stays quiet about commits for a short sitting', () => {
    const brief = { ...sitting, durationMs: 5 * MIN }
    const s = detectSignals(input(), brief, [], [])
    expect(s.map(x => x.kind)).not.toContain('nothing-committed')
  })

  it('counts unticked checklist items', () => {
    const withList = input({
      item: {
        id: 'card-1', title: 'A card', status: 'in_progress', updated_at: T,
        metadata: JSON.stringify({ checklist: [{ done: true }, { done: false }, { done: false }] })
      }
    })
    const s = detectSignals(withList, sitting, [], [])
    expect(s.find(x => x.kind === 'checklist-unfinished')?.text).toContain('2 checklist items')
  })

  it('calls a card stalled only when it is old and unfinished', () => {
    const old = input({ now: T + 30 * DAY })
    expect(detectSignals(old, sitting, [], []).map(x => x.kind)).toContain('stalled')

    const done = input({ now: T + 30 * DAY, item: { ...input().item, status: 'done' } })
    expect(detectSignals(done, sitting, [], []).map(x => x.kind)).not.toContain('stalled')
  })
})

describe('parseBoardMoves', () => {
  it('reads the card activity log out of metadata', () => {
    const meta = JSON.stringify({ activities: [{ id: 'a', text: 'Moved to Doing', createdAt: T }] })
    expect(parseBoardMoves(meta)).toEqual([{ text: 'Moved to Doing', createdAt: T }])
  })

  it('survives junk', () => {
    expect(parseBoardMoves(null)).toEqual([])
    expect(parseBoardMoves('{broken')).toEqual([])
    expect(parseBoardMoves(JSON.stringify({ activities: 'nope' }))).toEqual([])
    expect(parseBoardMoves(JSON.stringify({ activities: [{ text: 'no timestamp' }] }))).toEqual([])
  })
})

describe('buildRewind', () => {
  it('returns an empty result when the card was never focused on', () => {
    const r = buildRewind(input({ sessions: [] }))
    expect(r.sitting).toBeNull()
    expect(r.signals).toEqual([])
  })

  it('scopes clipboard and commits to the sitting', () => {
    const r = buildRewind(input({
      sessions: [session({ duration_ms: HOUR, completed_at: T })],
      clipboard: [clip('inside', T - 30 * MIN), clip('long before', T - 5 * DAY)],
      commits: [commit('inside', T - 20 * MIN), commit('long before', T - 5 * DAY)]
    }))
    expect(r.clipboard.map(c => c.content)).toEqual(['inside'])
    expect(r.commits.map(c => c.message)).toEqual(['inside'])
  })

  it('orders windows by time spent, because that is what you were doing', () => {
    const r = buildRewind(input({
      windows: [
        { windowTitle: 'brief', processName: 'a.exe', durationMs: 2 * MIN },
        { windowTitle: 'most of it', processName: 'b.exe', durationMs: 40 * MIN }
      ]
    }))
    expect(r.windows[0].windowTitle).toBe('most of it')
  })

  it('reports how long ago the sitting was', () => {
    const r = buildRewind(input({ now: T + 9 * DAY }))
    expect(r.daysSince).toBe(9)
  })

  it('puts the newest copy and commit first', () => {
    const r = buildRewind(input({
      sessions: [session({ duration_ms: HOUR, completed_at: T })],
      clipboard: [clip('older', T - 40 * MIN), clip('newer', T - 10 * MIN)],
      commits: [commit('older', T - 40 * MIN), commit('newer', T - 10 * MIN)]
    }))
    expect(r.clipboard[0].content).toBe('newer')
    expect(r.commits[0].message).toBe('newer')
  })
})

describe('SITTING_GAP_MS', () => {
  it('is long enough to survive a lunch break but not a new day', () => {
    expect(SITTING_GAP_MS).toBeGreaterThan(30 * MIN)
    expect(SITTING_GAP_MS).toBeLessThan(6 * HOUR)
  })
})
