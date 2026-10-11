/** what the updater did on someone's machine, kept where they can find it and send it: checks, downloads, installs and errors */

import { app } from 'electron'
import { join } from 'path'
import { createRotatingLog, MAX_LOG_BYTES, type Log } from './rotatingLog'

/** electron-updater's logger, which this also is */
export type UpdateLog = Log

export function updateLogPath(): string {
  return join(app.getPath('userData'), 'logs', 'updater.log')
}

export function createUpdateLog(file: string, { maxBytes = MAX_LOG_BYTES, echo = true }: { maxBytes?: number; echo?: boolean } = {}): UpdateLog {
  return createRotatingLog(file, { maxBytes, echoPrefix: echo ? '[updater]' : undefined })
}

let shared: UpdateLog | null = null

/** made on first use, so nothing touches the disk in a dev run that never updates */
export function updateLog(): UpdateLog {
  shared ??= createUpdateLog(updateLogPath())
  return shared
}
