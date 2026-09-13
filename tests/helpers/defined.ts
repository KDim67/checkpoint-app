/** fails with a clear message where a bare ! throws a TypeError somewhere later */
export function defined<T>(value: T): NonNullable<T> {
  if (value === null || value === undefined) {
    throw new Error(`Expected a value, got ${value}`)
  }
  return value
}
