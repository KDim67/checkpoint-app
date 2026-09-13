/** a rejected invoke reaches the renderer as a string with main's stack, so return a result instead */
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
