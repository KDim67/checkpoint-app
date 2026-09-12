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

    // An RTCErrorEvent is an Event, not an Error, and keeps its text one level
    // down on `.error`. Without this every WebRTC failure read as the fallback,
    // which is how a session that died reported nothing about why. Read by hand
    // rather than by recursing, so a value pointing at itself cannot spin.
    const inner = (err as { error?: unknown }).error
    if (inner instanceof Error && inner.message) return inner.message
    if (inner && typeof inner === 'object') {
      const nested = (inner as { message?: unknown }).message
      if (typeof nested === 'string' && nested.trim()) return nested
    }
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
