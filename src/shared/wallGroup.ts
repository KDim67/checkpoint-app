/** groups: items that select, move and line up as one; membership is a shared id on each member */

import type { WallItem } from './wallModel'

export const newGroupId = (): string => `g-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`

/** arrows follow their ends, and a locked item moves with nothing */
const groupable = (item: WallItem): boolean => item.kind !== 'arrow' && !item.locked

const withoutGroup = (item: WallItem): WallItem => {
  const next = { ...item }
  delete next.group
  return next
}

const memberCounts = (items: WallItem[]): Map<string, number> => {
  const counts = new Map<string, number>()
  for (const i of items) if (i.group) counts.set(i.group, (counts.get(i.group) ?? 0) + 1)
  return counts
}

/** a group down to one member is no group; the same array when there's none to drop */
export function pruneGroups(items: WallItem[]): WallItem[] {
  const counts = memberCounts(items)
  if ([...counts.values()].every(n => n > 1)) return items
  return items.map(i => (i.group && (counts.get(i.group) ?? 0) < 2 ? withoutGroup(i) : i))
}

/** the picked items under one new id, out of whatever groups they were in; fewer than two leaves the wall alone */
export function groupItems(items: WallItem[], ids: Set<string>, id: string = newGroupId()): WallItem[] {
  if (items.filter(i => ids.has(i.id) && groupable(i)).length < 2) return items
  return pruneGroups(items.map(i => (ids.has(i.id) && groupable(i) ? { ...i, group: id } : i)))
}

/** one key for both: groups never nest, so a pick that's already one group can only mean ungroup */
export function toggleGroup(items: WallItem[], ids: Set<string>): WallItem[] {
  const { canGroup, canUngroup } = groupState(items, ids)
  if (canGroup) return groupItems(items, ids)
  return canUngroup ? ungroupItems(items, ids) : items
}

/** every group a picked item is in, members picked or not */
export function ungroupItems(items: WallItem[], ids: Set<string>): WallItem[] {
  const groups = new Set(items.filter(i => ids.has(i.id) && i.group).map(i => i.group))
  if (groups.size === 0) return items
  return items.map(i => (i.group && groups.has(i.group) ? withoutGroup(i) : i))
}

/** the whole group of every picked item, so a click or a sweep never takes half of one */
export function withGroups(items: WallItem[], ids: Set<string>): Set<string> {
  const groups = new Set(items.filter(i => ids.has(i.id) && i.group).map(i => i.group))
  if (groups.size === 0) return ids
  const out = new Set(ids)
  for (const i of items) if (i.group && groups.has(i.group) && !i.locked) out.add(i.id)
  return out
}

/** the pressed item and the rest of its group, itself alone when it has none */
export function groupOf(items: WallItem[], id: string): string[] {
  const group = items.find(i => i.id === id)?.group
  if (!group) return [id]
  return items.filter(i => i.id === id || (i.group === group && !i.locked)).map(i => i.id)
}

/** one fresh id per group and per mind map among the copies, so a copy never joins its original's */
export function regroupCopies(copies: WallItem[], newId: () => string = newGroupId): WallItem[] {
  const fresh = new Map<string, string>()
  const renamed = (id: string): string => {
    if (!fresh.has(id)) fresh.set(id, newId())
    return fresh.get(id) as string
  }
  return copies.map(copy => {
    if (!copy.group && !copy.map) return copy
    return { ...copy, ...(copy.group ? { group: renamed(copy.group) } : {}), ...(copy.map ? { map: renamed(`map:${copy.map}`) } : {}) }
  })
}

/** Group unless the pick is already one group; Ungroup when it touches a group with members to split */
export function groupState(items: WallItem[], ids: Set<string>): { canGroup: boolean; canUngroup: boolean } {
  const counts = memberCounts(items)
  const real = (group?: string): boolean => !!group && (counts.get(group) ?? 0) > 1
  const chosen = items.filter(i => ids.has(i.id) && groupable(i))
  const oneGroup = chosen.length > 0 && real(chosen[0].group) && chosen.every(i => i.group === chosen[0].group)
  return {
    canGroup: chosen.length >= 2 && !oneGroup,
    canUngroup: items.some(i => ids.has(i.id) && real(i.group))
  }
}
