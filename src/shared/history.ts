/**
 * A bounded undo/redo stack. Generic so it can be tested without a canvas.
 *
 * A new edit clears the redo stack, like every tool anyone has used. Capped
 * because each canvas entry holds every item. Uncapped is a slow leak.
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

/** `equals` skips no-op edits, so a drag does not cost an undo step per frame. */
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

/** For changes the user did not make. A load, or a rename from elsewhere. */
export function replacePresent<T>(history: History<T>, present: T): History<T> {
  return { ...history, present }
}
