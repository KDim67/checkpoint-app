import type { Item } from '../../../../shared/types'

/** deleted cards stayed in the session and threw Item not found; drop vanished, refresh survivors */
export function reconcileSelectedTasks(selected: Item[], live: Item[]): Item[] {
  if (selected.length === 0) return selected

  const byId = new Map(live.map(item => [item.id, item]))
  const reconciled: Item[] = []
  for (const task of selected) {
    const current = byId.get(task.id)
    // gone from the live set means deleted, every write to it would fail
    if (!current) continue
    reconciled.push(current)
  }

  // same array when unchanged, so no re-render on every board mutation
  if (reconciled.length === selected.length && reconciled.every((t, i) => t === selected[i])) {
    return selected
  }
  return reconciled
}
