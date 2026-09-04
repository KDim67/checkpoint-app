/**
 * Turns a caught value into something worth showing a user.
 *
 * Replaces the `catch (err: any)` + `err.message || String(err)` idiom, which
 * printed "[object Object]" whenever something other than an Error was thrown.
 */

export function errorMessage(err: unknown, fallback = 'Something went wrong.'): string {
  if (err instanceof Error && err.message) return err.message

  // Rejected promises and older APIs sometimes carry a bare string.
  if (typeof err === 'string' && err.trim()) return err

  // IPC and fetch failures often arrive as a plain object with a message.
  if (err && typeof err === 'object') {
    const maybe = (err as { message?: unknown }).message
    if (typeof maybe === 'string' && maybe.trim()) return maybe
  }

  // Numbers and symbols stringify usefully; objects and null do not.
  if (typeof err === 'number' || typeof err === 'boolean') return String(err)

  return fallback
}

/** True when the failure is a user-initiated abort rather than a fault. */
export function isAbortError(err: unknown): boolean {
  if (err instanceof Error && err.name === 'AbortError') return true
  return errorMessage(err, '').toLowerCase().includes('abort')
}
