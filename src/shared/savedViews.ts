/**
 * Named filters over the task list.
 *
 * The one decision that matters: a view stores **intent, not resolved dates**.
 * "Overdue" saved on Monday has to still mean overdue on Friday, so the due
 * filter is kept as a word and turned into a range at query time. Storing the
 * computed timestamps would produce a view that silently rots, still returning
 * results, just the wrong ones, which is the worst kind of wrong.
 *
 * Pure, and in shared/, because both the renderer and the MCP server need to
 * turn a view into the same query.
 */

import type { TaskQueryParams } from './types'

export type DueFilter = 'any' | 'overdue' | 'today' | 'week' | 'none'

export const DUE_FILTERS: { id: DueFilter; label: string }[] = [
  { id: 'any', label: 'Any due date' },
  { id: 'overdue', label: 'Overdue' },
  { id: 'today', label: 'Due today' },
  { id: 'week', label: 'Due this week' },
  { id: 'none', label: 'No due date' }
]

export interface SavedView {
  id: string
  name: string
  /** Whether the view is pinned to one workspace or follows the active one. */
  scope: 'current' | 'all'
  query?: string
  status?: string[]
  priority?: number[]
  tagIds?: string[]
  due: DueFilter
  untagged?: boolean
  /** Built-ins ship with the app and cannot be renamed or deleted. */
  builtIn?: boolean
}

const startOfDay = (now: number): number => {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

const endOfDay = (now: number): number => {
  const d = new Date(now)
  d.setHours(23, 59, 59, 999)
  return d.getTime()
}

/**
 * Turns a due filter into a concrete range for the given moment.
 *
 * Returns the fields to merge into a query. `overdue` deliberately excludes
 * today's not-yet-passed work by ending at the current instant rather than at
 * midnight, something due at 5pm is not overdue at 9am.
 */
export function resolveDueRange(
  due: DueFilter,
  now: number
): Pick<TaskQueryParams, 'dueStart' | 'dueEnd' | 'noDueDate'> {
  switch (due) {
    case 'overdue':
      return { dueEnd: now }
    case 'today':
      return { dueStart: startOfDay(now), dueEnd: endOfDay(now) }
    case 'week':
      // From now to the end of the seventh day, so "this week" is a rolling
      // window rather than one that empties out every Sunday night.
      return { dueStart: startOfDay(now), dueEnd: endOfDay(now + 6 * 86_400_000) }
    case 'none':
      return { noDueDate: true }
    default:
      return {}
  }
}

/** Builds the query for a view at a given moment. */
export function toQueryParams(view: SavedView, now: number): TaskQueryParams {
  return {
    ...(view.query ? { query: view.query } : {}),
    ...(view.status && view.status.length > 0 ? { status: view.status } : {}),
    ...(view.priority && view.priority.length > 0 ? { priority: view.priority } : {}),
    ...(view.tagIds && view.tagIds.length > 0 ? { tagIds: view.tagIds } : {}),
    ...(view.untagged ? { untagged: true } : {}),
    ...resolveDueRange(view.due, now)
  }
}

const PRIORITY_LABELS: Record<number, string> = { 0: 'none', 1: 'low', 2: 'medium', 3: 'high' }

/** A sentence describing what a view selects, for the UI and for MCP output. */
export function describeView(view: SavedView): string {
  const parts: string[] = []
  if (view.priority && view.priority.length > 0) {
    parts.push(`${view.priority.map(p => PRIORITY_LABELS[p] ?? p).join('/')} priority`)
  }
  if (view.status && view.status.length > 0) parts.push(`status ${view.status.join('/')}`)
  if (view.due !== 'any') {
    parts.push(DUE_FILTERS.find(d => d.id === view.due)?.label.toLowerCase() ?? view.due)
  }
  if (view.untagged) parts.push('untagged')
  else if (view.tagIds && view.tagIds.length > 0) parts.push(`${view.tagIds.length} tag filter(s)`)
  if (view.query) parts.push(`matching "${view.query}"`)

  const scope = view.scope === 'all' ? 'all workspaces' : 'this workspace'
  return parts.length === 0 ? `Everything in ${scope}` : `${parts.join(', ')}, ${scope}`
}

const asStringArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length > 0) : []

/**
 * Coerces one stored view, or null if it has no usable identity.
 *
 * Filters that cannot be read are dropped rather than defaulted, because a view
 * that quietly widened its own filter would return more than its name promises.
 */
export function normalizeSavedView(raw: unknown): SavedView | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const id = typeof o.id === 'string' ? o.id.trim() : ''
  const name = typeof o.name === 'string' ? o.name.trim() : ''
  if (!id || !name) return null

  const due = DUE_FILTERS.some(d => d.id === o.due) ? (o.due as DueFilter) : 'any'
  const priority = Array.isArray(o.priority)
    ? [...new Set(o.priority.map(p => Math.floor(Number(p))).filter(p => p >= 0 && p <= 3))].sort()
    : []

  return {
    id,
    name,
    scope: o.scope === 'all' ? 'all' : 'current',
    due,
    ...(typeof o.query === 'string' && o.query.trim() ? { query: o.query.trim() } : {}),
    ...(asStringArray(o.status).length > 0 ? { status: asStringArray(o.status) } : {}),
    ...(priority.length > 0 ? { priority } : {}),
    ...(asStringArray(o.tagIds).length > 0 ? { tagIds: asStringArray(o.tagIds) } : {}),
    ...(o.untagged === true ? { untagged: true } : {}),
    ...(o.builtIn === true ? { builtIn: true as const } : {})
  }
}

export function normalizeSavedViews(raw: unknown): SavedView[] {
  let parsed: unknown = raw
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw)
    } catch {
      return []
    }
  }
  if (!Array.isArray(parsed)) return []

  const seen = new Set<string>()
  const out: SavedView[] = []
  for (const entry of parsed) {
    const view = normalizeSavedView(entry)
    if (view && !seen.has(view.id)) {
      seen.add(view.id)
      out.push(view)
    }
  }
  return out
}

/**
 * The views that ship with the app.
 *
 * These are the questions worth a single keystroke, and each is one the filter
 * dimensions already supported but nothing named.
 */
export const BUILT_IN_VIEWS: SavedView[] = [
  { id: 'view-overdue', name: 'Overdue', scope: 'current', due: 'overdue', builtIn: true },
  { id: 'view-today', name: 'Due today', scope: 'current', due: 'today', builtIn: true },
  { id: 'view-week', name: 'Due this week', scope: 'current', due: 'week', builtIn: true },
  { id: 'view-high', name: 'High priority', scope: 'current', due: 'any', priority: [3], builtIn: true },
  { id: 'view-untagged', name: 'Untagged', scope: 'current', due: 'any', untagged: true, builtIn: true },
  { id: 'view-no-due', name: 'No due date', scope: 'current', due: 'none', builtIn: true }
]

/** Validates a new view and gives it an id. */
export function createSavedView(
  name: string,
  base: Omit<SavedView, 'id' | 'name' | 'builtIn'>,
  existing: SavedView[],
  now: number
): { view: SavedView } | { error: string } {
  const trimmed = name.trim()
  if (!trimmed) return { error: 'Give the view a name.' }
  if (trimmed.length > 40) return { error: 'View names are limited to 40 characters.' }
  if (existing.some(v => v.name.toLowerCase() === trimmed.toLowerCase())) {
    return { error: `A view named "${trimmed}" already exists.` }
  }

  let id = `view-${now}`
  let n = 2
  while (existing.some(v => v.id === id)) id = `view-${now}-${n++}`

  return { view: { ...base, id, name: trimmed } }
}
