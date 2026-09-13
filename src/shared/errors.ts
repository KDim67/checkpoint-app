/** replaces err.message || String(err), which printed "[object Object]" */

export function errorMessage(err: unknown, fallback = 'Something went wrong.'): string {
  if (err instanceof Error && err.message) return err.message

  // bare strings from rejections and older APIs
  if (typeof err === 'string' && err.trim()) return err

  // IPC and fetch failures, plain objects
  if (err && typeof err === 'object') {
    const maybe = (err as { message?: unknown }).message
    if (typeof maybe === 'string' && maybe.trim()) return maybe

    // RTCErrorEvent keeps its text on .error; read by hand so a self-reference can't spin
    const inner = (err as { error?: unknown }).error
    if (inner instanceof Error && inner.message) return inner.message
    if (inner && typeof inner === 'object') {
      const nested = (inner as { message?: unknown }).message
      if (typeof nested === 'string' && nested.trim()) return nested
    }
  }

  // numbers and booleans stringify usefully
  if (typeof err === 'number' || typeof err === 'boolean') return String(err)

  return fallback
}

/** user aborts, not faults */
export function isAbortError(err: unknown): boolean {
  if (err instanceof Error && err.name === 'AbortError') return true
  return errorMessage(err, '').toLowerCase().includes('abort')
}
