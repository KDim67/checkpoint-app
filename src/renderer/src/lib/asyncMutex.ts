// A minimal per-key async mutex for the renderer process.
//
// Several independent pieces of UI (the Kanban board's own column
// bootstrapping, and the AI's create_column / create_card / batch action
// blocks) all perform "read settings -> modify -> write settings" or
// "check for an existing card by title -> create if missing" sequences
// against the *same* underlying key. Without serialization, two of these
// running concurrently can both read the same starting state, both decide
// nothing exists yet, and both write/insert, producing duplicate columns
// (same name, different id) or duplicate cards.
//
// withLock() queues callers for the same key so each one's read-modify-write
// fully completes before the next one starts reading.

const locks = new Map<string, Promise<unknown>>()

export function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = locks.get(key) || Promise.resolve()
  // Run `fn` only after the previous holder of this key settles (success or
  // failure), so a rejected operation doesn't permanently jam the queue.
  const result = previous.then(fn, fn)
  // What we store is only used for sequencing the *next* caller, swallow
  // rejections here so they don't surface as unhandled promise warnings;
  // the actual error still propagates to whoever awaited `result`.
  locks.set(key, result.catch(() => undefined))
  return result
}
