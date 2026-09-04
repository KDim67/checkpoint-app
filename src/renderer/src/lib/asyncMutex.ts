// A minimal per-key async mutex for the renderer.
//
// Column bootstrapping and the AI's create_column / create_card blocks both run
// read-modify-write against the same key. Run concurrently, both read the same
// starting state, both decide nothing exists, and both insert: duplicate
// columns with the same name, or duplicate cards.
//
// withLock() queues callers per key so each cycle finishes before the next reads.

const locks = new Map<string, Promise<unknown>>()

export function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = locks.get(key) || Promise.resolve()
  // Run `fn` only after the previous holder of this key settles (success or
  // failure), so a rejected operation doesn't permanently jam the queue.
  const result = previous.then(fn, fn)
  // What we store is only used for sequencing the *next* caller. Swallow
  // rejections here so they don't surface as unhandled promise warnings;
  // the actual error still propagates to whoever awaited `result`.
  locks.set(key, result.catch(() => undefined))
  return result
}
