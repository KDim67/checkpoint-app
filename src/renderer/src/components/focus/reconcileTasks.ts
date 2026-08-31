import type { Item } from '../../../../shared/types'

/**
 * Reconciles the focus session's selected tasks against what is actually in the
 * database.
 *
 * The selection is a snapshot of whole `Item` objects taken when the user picks
 * tasks, and it lives in the global store so a running session survives
 * navigating away. Nothing used to reconcile it, so deleting one of those cards
 * from the Kanban board left it sitting in the session list: clicking it called
 * updateItem on an id that no longer existed, which throws `Item not found`, so
 * the task could never be ticked off and never went away.
 *
 * Dropping vanished tasks and refreshing the survivors' fields is the whole
 * repair, kept pure so it can be tested without a database or a React tree.
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
