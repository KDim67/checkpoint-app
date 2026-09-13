// per-key queue: concurrent read-modify-write created duplicate columns and cards

const locks = new Map<string, Promise<unknown>>()

export function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = locks.get(key) || Promise.resolve()
  // after the previous holder settles either way, so a rejection can't jam the queue
  const result = previous.then(fn, fn)
  // stored only for sequencing; swallowed so rejections aren't unhandled, callers still get the error
  locks.set(key, result.catch(() => undefined))
  return result
}
