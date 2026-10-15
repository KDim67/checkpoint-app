/** a window whose page crashes comes back on its own; one that keeps crashing stops looping and asks what to do */

import { app, dialog, type BrowserWindow } from 'electron'
import { appLog } from './appLog'
import { openReport } from './reportProblem'
import { isQuitting } from './windows'

export const CRASH_WINDOW_MS = 60_000
/** reloading a page that crashes on load only loops, so this many in a minute stops it */
export const CRASHES_BEFORE_ASKING = 3

/** the crashes still inside the last minute */
export function recentCrashes(times: number[], now: number, windowMs = CRASH_WINDOW_MS): number[] {
  return times.filter(time => now - time < windowMs)
}

let notice: string | null = null

/** why the window was last reloaded after a crash, given once; the reloaded page asks for it to say so */
export function takeCrashNotice(): string | null {
  const reason = notice
  notice = null
  return reason
}

export type CrashChoice = 'report' | 'retry' | 'quit'

export interface CrashDeps {
  now?: () => number
  ask?: (crashes: number) => Promise<CrashChoice>
  report?: (what: string) => void
  quit?: () => void
}

const askByDialog = async (crashes: number): Promise<CrashChoice> => {
  const { response } = await dialog.showMessageBox({
    type: 'error',
    title: 'Checkpoint',
    message: "Checkpoint's window keeps crashing",
    detail: `It crashed ${crashes} times in a minute, so it wasn't reloaded again. The app log has what went wrong.`,
    buttons: ['Report the problem', 'Try again', 'Quit'],
    defaultId: 1,
    cancelId: 1,
    noLink: true
  })
  return (['report', 'retry', 'quit'] as const)[response] ?? 'retry'
}

export function watchForCrashes(win: BrowserWindow, deps: CrashDeps = {}): void {
  const now = deps.now ?? Date.now
  let crashes: number[] = []

  const reload = (reason: string): void => {
    if (win.isDestroyed()) return
    notice = reason
    win.webContents.reload()
  }

  win.webContents.on('render-process-gone', (_event, details) => {
    // quitting ends the page too, and that's no crash
    if (details.reason === 'clean-exit' || isQuitting() || win.isDestroyed()) return
    appLog().error(`[window] the page's process ended (${details.reason}, exit code ${details.exitCode})`)
    crashes = recentCrashes([...crashes, now()], now())
    if (crashes.length < CRASHES_BEFORE_ASKING) {
      reload(details.reason)
      return
    }
    const count = crashes.length
    crashes = []
    void (deps.ask ?? askByDialog)(count).then(choice => {
      if (choice === 'quit') {
        (deps.quit ?? (() => app.quit()))()
        return
      }
      if (choice === 'report') (deps.report ?? openReport)(`The window kept crashing (${details.reason}).`)
      reload(details.reason)
    })
  })

  win.on('unresponsive', () => appLog().warn('[window] stopped responding'))
  win.on('responsive', () => appLog().info('[window] responding again'))
}
