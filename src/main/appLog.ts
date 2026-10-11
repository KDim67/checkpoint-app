/** errors from every part of the app in one file a bug report can quote: main's console.error, window crashes and the window's own errors */

import { app } from 'electron'
import { join } from 'path'
import { createRotatingLog, type Log } from './rotatingLog'
import { redactSecrets } from '../shared/redactSecrets'

/** a stack trace fits whole; a dumped payload can't swamp the file */
export const MAX_ENTRY_CHARS = 4000

export function appLogPath(): string {
  return join(app.getPath('userData'), 'logs', 'app.log')
}

let shared: { file: string; log: Log } | null = null

/** made on first use, so nothing touches the disk until something goes wrong */
export function appLog(): Log {
  const file = appLogPath()
  // a profile moves userData early in startup, and an error before that mustn't pin the log to the default one
  if (shared?.file !== file) {
    // whatever an error carried, a key in it never reaches the file
    shared = { file, log: createRotatingLog(file, { scrub: redactSecrets, maxEntryChars: MAX_ENTRY_CHARS }) }
  }
  return shared.log
}

/** main already says what failed wherever it fails; this keeps it past the session. Returns the undo */
export function captureConsoleErrors(log: () => Log = appLog): () => void {
  const original = console.error
  const captured = (...parts: unknown[]): void => {
    original.apply(console, parts)
    log().error(...parts)
  }
  console.error = captured
  return () => {
    if (console.error === captured) console.error = original
  }
}

/** a render loop can throw every frame, so each minute holds this many and counts the rest */
export function createErrorGate(limit = 30, perMs = 60_000): (now: number) => { pass: boolean; dropped: number } {
  let start = -Infinity
  let count = 0
  let dropped = 0
  return now => {
    let reported = 0
    if (now - start >= perMs) {
      reported = dropped
      start = now
      count = 0
      dropped = 0
    }
    if (count < limit) {
      count++
      return { pass: true, dropped: reported }
    }
    dropped++
    return { pass: false, dropped: reported }
  }
}
