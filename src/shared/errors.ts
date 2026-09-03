/**
 * Turning a caught value into something worth showing a user.
 *
 * `catch (err: any)` was written 37 times across the codebase, almost always so
 * the body could reach `err.message`. Typing the catch as `any` to get at one
 * property switches off checking for the whole block, and the idiom it enabled, 
 * `err.message || String(err)`, has a quiet failure of its own: a thrown plain
 * object has no `message`, and `String({})` is `"[object Object]"`, which is
 * shown to the user as if it meant something.
 *
 * TypeScript types a caught value as `unknown`, which is correct: JavaScript can
 * throw anything. This narrows it in one place instead.
 */

export function errorMessage(err: unknown, fallback = 'Something went wrong.'): string {
  if (err instanceof Error && err.message) return err.message

  // Rejected promises and older APIs sometimes carry a bare string.
  if (typeof err === 'string' && err.trim()) return err

  // Some IPC and fetch failures arrive as a plain object with a message on it
  // rather than a real Error, worth reading before falling back.
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
