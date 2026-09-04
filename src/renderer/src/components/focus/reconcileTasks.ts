import type { Item } from '../../../../shared/types'

/**
 * Reconciles a focus session's selected tasks against the database.
 *
 * The selection is a snapshot of whole `Item` objects held in the store, and
 * nothing used to reconcile it. Deleting one of those cards left it in the
 * session list, where clicking it threw `Item not found`, so it could never be
 * ticked off and never went away.
 *
 * Dropping the vanished and refreshing the survivors is the whole repair.
 */
export function reconcileSelectedTasks(selected: Item[], live: Item[]): Item[] {
  if (selected.length === 0) return selected

  const byId = new Map(live.map(item => [item.id, item]))
  const reconciled: Item[] = []
  for (const task of selected) {
    const current = byId.get(task.id)
    // Absent from the live set means deleted; drop it rather than carry a
    // reference that every subsequent write will reject.
    if (!current) continue
    reconciled.push(current)
  }

  // Returning the original array when nothing changed keeps referential
  // equality, so this can run on every board mutation without forcing a
  // re-render of the session UI.
  if (reconciled.length === selected.length && reconciled.every((t, i) => t === selected[i])) {
    return selected
  }
  return reconciled
}

/** True when reconciliation would change the selection. */
export function selectionNeedsUpdate(selected: Item[], live: Item[]): boolean {
  return reconcileSelectedTasks(selected, live) !== selected
}
