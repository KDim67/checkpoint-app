/**
 * A value the test has reason to believe is there.
 *
 * Fails the test with a message saying so when it is not, where a bare `!`
 * would fail it with a TypeError from wherever the value was next touched.
 */
export function defined<T>(value: T): NonNullable<T> {
  if (value === null || value === undefined) {
    throw new Error(`Expected a value, got ${value}`)
  }
  return value
}
