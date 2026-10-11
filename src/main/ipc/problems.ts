/** the logs and the bug report: showing the files, filling the report, and what the window says when it fails */

import { ipcMain, shell } from 'electron'
import { existsSync, mkdirSync } from 'fs'
import { dirname } from 'path'
import { z } from 'zod'
import { IpcChannels } from '../../shared/ipcChannels'
import { appLog, appLogPath, createErrorGate } from '../appLog'
import { updateLogPath } from '../updateLog'
import { reportDraft } from '../reportProblem'
import { takeCrashNotice } from '../windowCrash'
import type { Log } from '../rotatingLog'

/** the file selected so it can be attached to a bug report; before anything was written, its empty folder */
async function showLogFile(file: string): Promise<void> {
  if (existsSync(file)) {
    shell.showItemInFolder(file)
    return
  }
  mkdirSync(dirname(file), { recursive: true })
  await shell.openPath(dirname(file))
}

const WindowErrorSchema = z.object({
  source: z.enum(['render', 'error', 'rejection']),
  message: z.string(),
  stack: z.string().optional(),
  componentStack: z.string().optional()
})

/** anything malformed is dropped, and a window throwing every frame is held to the gate's share */
export function logWindowError(raw: unknown, gate: (now: number) => { pass: boolean; dropped: number }, now: number, log: Log = appLog()): void {
  const parsed = WindowErrorSchema.safeParse(raw)
  if (!parsed.success) return
  const { pass, dropped } = gate(now)
  if (dropped > 0) log.warn(`[window] ${dropped} more errors in a minute were left out`)
  if (!pass) return
  const { source, message, stack, componentStack } = parsed.data
  // a stack starts with its own message, so it says it once
  const detail = stack?.includes(message) ? stack : [message, stack].filter(Boolean).join('\n')
  log.error(`[window] ${source}: ${detail}${componentStack ? `\nComponent stack:${componentStack}` : ''}`)
}

export function registerProblemHandlers(): void {
  ipcMain.handle(IpcChannels.APP_SHOW_UPDATE_LOG, () => showLogFile(updateLogPath()))
  ipcMain.handle(IpcChannels.APP_SHOW_APP_LOG, () => showLogFile(appLogPath()))
  ipcMain.handle(IpcChannels.APP_PROBLEM_REPORT, (_event, seed: unknown) => reportDraft(typeof seed === 'string' ? seed : ''))
  ipcMain.handle(IpcChannels.APP_CRASH_NOTICE, () => takeCrashNotice())

  const gate = createErrorGate()
  ipcMain.on(IpcChannels.APP_LOG_ERROR, (_event, raw: unknown) => logWindowError(raw, gate, Date.now()))
}
