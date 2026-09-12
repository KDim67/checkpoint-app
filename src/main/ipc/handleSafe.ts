/**
 * Wraps an IPC action in a result object rather than letting it throw over the
 * bridge. A rejected invoke arrives in the renderer as a string with the main
 * process stack in it, which is neither readable nor catchable per call site.
 */
export async function handleSafe<T>(fn: () => T | Promise<T>) {
  try {
    const data = await fn()
    return { success: true, data }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    console.error('IPC Database error:', err)
    return { success: false, error: errorMessage }
  }
}
