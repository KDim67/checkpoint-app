/** the workspace list's edits as plain functions, so the page and its tests share one meaning of each */

import { WORKSPACE_COLORS, type WorkspaceEntry } from './createWorkspace'

/** one place up or down; the same list at either end, so nothing is written */
export function movedBy(list: WorkspaceEntry[], slug: string, by: -1 | 1): WorkspaceEntry[] {
  const from = list.findIndex(entry => entry.slug === slug)
  const to = from + by
  if (from < 0 || to < 0 || to >= list.length) return list
  return movedTo(list, from, to)
}

/** taken out and put back at another place, as a drag drops it */
export function movedTo(list: WorkspaceEntry[], from: number, to: number): WorkspaceEntry[] {
  if (from === to || from < 0 || from >= list.length || to < 0 || to >= list.length) return list
  const next = [...list]
  const [entry] = next.splice(from, 1)
  next.splice(to, 0, entry)
  return next
}

export function replaced(list: WorkspaceEntry[], slug: string, entry: WorkspaceEntry): WorkspaceEntry[] {
  return list.map(existing => (existing.slug === slug ? entry : existing))
}

/** where it was, so Undo puts it back in the same place */
export function hidden(list: WorkspaceEntry[], slug: string): { list: WorkspaceEntry[]; index: number } {
  const index = list.findIndex(entry => entry.slug === slug)
  return index < 0 ? { list, index } : { list: list.filter(entry => entry.slug !== slug), index }
}

export function restored(list: WorkspaceEntry[], entry: WorkspaceEntry, index: number): WorkspaceEntry[] {
  if (list.some(existing => existing.slug === entry.slug)) return list
  const next = [...list]
  next.splice(Math.min(Math.max(index, 0), next.length), 0, entry)
  return next
}

/** the colours go round in order, so the next one is rarely the last one's */
export const nextColor = (list: WorkspaceEntry[]): string => WORKSPACE_COLORS[list.length % WORKSPACE_COLORS.length]

/** by name or slug, any case, ignoring the spaces around what was typed */
export function matching(list: WorkspaceEntry[], query: string): WorkspaceEntry[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return list
  return list.filter(entry => entry.name.toLowerCase().includes(needle) || entry.slug.includes(needle))
}
