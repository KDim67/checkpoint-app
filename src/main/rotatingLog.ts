/** a log file that becomes its .old.log past a size and never throws: a log that can't be written must never stop the app */

import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync } from 'fs'
import { dirname } from 'path'

export type Level = 'info' | 'warn' | 'error' | 'debug'

/** electron-updater's logger shape, which the update log also is */
export interface Log {
  info(...parts: unknown[]): void
  warn(...parts: unknown[]): void
  error(...parts: unknown[]): void
  debug(...parts: unknown[]): void
}

/** enough for months of entries; past it the file becomes the .old one and a fresh one starts */
export const MAX_LOG_BYTES = 1024 * 1024

/** an error by its message and where it came from; anything else as the console would show it */
export const textOf = (part: unknown): string => {
  if (part instanceof Error) return part.stack ?? `${part.name}: ${part.message}`
  if (typeof part === 'string') return part
  try {
    return JSON.stringify(part) ?? String(part)
  } catch {
    return String(part)
  }
}

const olderOf = (file: string): string => file.replace(/\.log$/, '.old.log')

/** cut only after scrubbing, so a key on the cut can't leave a piece too short to recognise */
export function capped(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, max)} … (${text.length - max} more characters)`
}

export function createRotatingLog(
  file: string,
  { maxBytes = MAX_LOG_BYTES, echoPrefix, scrub = text => text, maxEntryChars = Infinity }: {
    maxBytes?: number
    echoPrefix?: string
    scrub?: (text: string) => string
    maxEntryChars?: number
  } = {}
): Log {
  const older = olderOf(file)
  const write = (level: Level, parts: unknown[]): void => {
    const text = capped(scrub(parts.map(textOf).join(' ')), maxEntryChars)
    if (echoPrefix) (level === 'debug' ? console.log : console[level])(`${echoPrefix} ${text}`)
    const line = `${new Date().toISOString()} ${level} ${text}\n`
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

/** the last lines written, reaching into the .old file when the fresh one is short; empty when there's nothing */
export function tailOf(file: string, lines: number): string[] {
  const read = (path: string): string[] => {
    try {
      return readFileSync(path, 'utf8').split('\n').filter(line => line !== '')
    } catch {
      return []
    }
  }
  const current = read(file)
  const all = current.length >= lines ? current : [...read(olderOf(file)), ...current]
  return all.slice(-lines)
}
