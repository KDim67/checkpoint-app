/** what the updater did on someone's machine, kept where they can find it and send it: checks, downloads, installs and errors */

import { app } from 'electron'
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from 'fs'
import { dirname, join } from 'path'

type Level = 'info' | 'warn' | 'error' | 'debug'

/** electron-updater's logger, which this also is */
export interface UpdateLog {
  info(...parts: unknown[]): void
  warn(...parts: unknown[]): void
  error(...parts: unknown[]): void
  debug(...parts: unknown[]): void
}

/** enough for months of checks; past it the file becomes the .old one and a fresh one starts */
const MAX_BYTES = 1024 * 1024

export function updateLogPath(): string {
  return join(app.getPath('userData'), 'logs', 'updater.log')
}

/** an error by its message and where it came from; anything else as the console would show it */
const textOf = (part: unknown): string => {
  if (part instanceof Error) return part.stack ?? `${part.name}: ${part.message}`
  if (typeof part === 'string') return part
  try {
    return JSON.stringify(part)
  } catch {
    return String(part)
  }
}

export function createUpdateLog(file: string, { maxBytes = MAX_BYTES, echo = true }: { maxBytes?: number; echo?: boolean } = {}): UpdateLog {
  const older = file.replace(/\.log$/, '.old.log')
  const write = (level: Level, parts: unknown[]): void => {
    const line = `${new Date().toISOString()} ${level} ${parts.map(textOf).join(' ')}\n`
    if (echo) (level === 'debug' ? console.log : console[level])(`[updater] ${parts.map(textOf).join(' ')}`)
    // a log that can't be written must never stop an update
    try {
      mkdirSync(dirname(file), { recursive: true })
      if (existsSync(file) && statSync(file).size + Buffer.byteLength(line) > maxBytes) {
        if (existsSync(older)) unlinkSync(older)
        renameSync(file, older)
      }
      appendFileSync(file, line)
    } catch {
      // nowhere to write, the console still has it
    }
  }
  return {
    info: (...parts) => write('info', parts),
    warn: (...parts) => write('warn', parts),
    error: (...parts) => write('error', parts),
    debug: (...parts) => write('debug', parts)
  }
}

let shared: UpdateLog | null = null

/** made on first use, so nothing touches the disk in a dev run that never updates */
export function updateLog(): UpdateLog {
  shared ??= createUpdateLog(updateLogPath())
  return shared
}
