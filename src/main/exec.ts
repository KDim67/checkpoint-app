import { execFile } from 'child_process'

/**
 * Runs an executable and returns trimmed stdout, aborted after timeoutMs.
 * Rejects on non-zero exit, spawn failure, or timeout.
 */
export function execFileAsync(file: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const controller = new AbortController()
    const timeout = setTimeout(() => {
      controller.abort()
      reject(new Error(`Exec timeout after ${timeoutMs}ms`))
    }, timeoutMs)

    execFile(file, args, { signal: controller.signal }, (error, stdout) => {
      clearTimeout(timeout)
      if (error) {
        reject(error)
      } else {
        resolve(stdout.trim())
      }
    })
  })
}

/**
 * Same, but resolves to '' instead of rejecting. For probing optional tooling
 * where "not installed" and "returned nothing" are the same answer.
 */
export function execFileQuiet(file: string, args: string[], timeoutMs: number): Promise<string> {
  return execFileAsync(file, args, timeoutMs).catch(() => '')
}
