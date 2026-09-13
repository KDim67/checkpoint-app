import { execFile } from 'child_process'

/** rejects on non-zero exit, spawn failure or timeout */
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

/** resolves '' instead, for optional tools where not installed = returned nothing */
export function execFileQuiet(file: string, args: string[], timeoutMs: number): Promise<string> {
  return execFileAsync(file, args, timeoutMs).catch(() => '')
}
