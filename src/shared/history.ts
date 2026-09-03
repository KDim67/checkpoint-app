/**
 * A bounded undo/redo stack.
 *
 * Written generically because the Wall is not the only thing that will want
 * one, and because keeping it separate from the Wall's model means the history
 * rules can be tested without constructing a canvas.
 *
 * Two decisions worth stating:
 *
 * **A new edit clears the future.** Branching histories are a research project;
 * every tool the user has ever used discards the redo stack on a fresh edit, so
 * doing anything cleverer would be surprising rather than powerful.
 *
 * **The stack is capped.** A canvas edit holds every item, so an uncapped
 * history of a large wall is a slow memory leak that only shows up after an
 * hour of work, which is exactly when losing it hurts most.
 */

export interface History<T> {
  past: T[]
  present: T
  future: T[]
}

/** Deep enough for a long session, shallow enough not to hoard a big canvas. */
export const HISTORY_LIMIT = 50

export function initHistory<T>(present: T): History<T> {
  return { past: [], present, future: [] }
}

/**
 * Records a new state.
 *
 * `equals` lets the caller skip no-op edits, dragging an item and putting it
 * back should not cost an undo step, and without this every pointer-move frame
 * would become one.
 */
export function pushHistory<T>(
  history: History<T>,
  next: T,
  equals?: (a: T, b: T) => boolean
): History<T> {
  if (equals?.(history.present, next)) return history

  const past = [...history.past, history.present]
  return {
    past: past.length > HISTORY_LIMIT ? past.slice(past.length - HISTORY_LIMIT) : past,
    present: next,
    future: []
  }
}

export function canUndo<T>(history: History<T>): boolean {
  return history.past.length > 0
}

export function canRedo<T>(history: History<T>): boolean {
  return history.future.length > 0
}

export function undo<T>(history: History<T>): History<T> {
  if (!canUndo(history)) return history
  const previous = history.past[history.past.length - 1]
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future]
  }
}

export function redo<T>(history: History<T>): History<T> {
  if (!canRedo(history)) return history
  const [next, ...rest] = history.future
  return {
    past: [...history.past, history.present],
    present: next,
    future: rest
  }
}

/**
 * Replaces the present without recording a step.
 *
 * For changes that are not the user's edits, a document arriving from disk, or
 * a card being renamed elsewhere, which should not become something the user
 * can "undo".
 */
export function replacePresent<T>(history: History<T>, present: T): History<T> {
  return { ...history, present }
}
