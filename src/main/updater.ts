/** checks quietly and often, downloads by itself, and installs on quit or when asked, never by restarting under someone; public repo so no token ships */

import { app, BrowserWindow } from 'electron'
import { errorMessage } from '../shared/errors'
import { IpcChannels } from '../shared/ipcChannels'
import type { UpdateCheckResult, UpdateProgress } from '../shared/types'
import { updateLog } from './updateLog'
import { beginQuit } from './windows'

type Updater = typeof import('electron-updater').autoUpdater

/** an app left open for days, or living in the tray from login, would otherwise never hear of an update */
export const CHECK_EVERY_MS = 4 * 60 * 60 * 1000

/** sooner than the regular check after a failure, since the network is often not up yet at login */
const RETRY_AFTER_MS = [5, 15, 60].map(minutes => minutes * 60 * 1000)

/** packaged only, dev would hit GitHub every launch */
export function shouldCheckForUpdates(): boolean {
  return app.isPackaged
}

/** CJS bundled into ESM puts exports under .default depending on interop, so read both */
async function loadAutoUpdater(): Promise<Updater | null> {
  const mod = await import('electron-updater')
  const interop = mod as unknown as { autoUpdater?: Updater; default?: { autoUpdater?: Updater } }
  return interop.autoUpdater ?? interop.default?.autoUpdater ?? null
}

function configure(updater: Updater): void {
  updater.autoDownload = true
  // the app's own quit ends in app.exit(0), which still fires the quit this hangs off
  updater.autoInstallOnAppQuit = true
  updater.logger = updateLog()
}

/** kept for the panel, a finished download has no events left to send */
let progress: UpdateProgress | null = null

export function currentUpdateProgress(): UpdateProgress | null {
  return progress
}

/** the event shape is a dependency's, undefined bytes would show NaN */
const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0)

/** titlebar indicator and About panel only, never a dialog or stolen focus; null clears them */
function announce(next: UpdateProgress | null): void {
  progress = next
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(IpcChannels.APP_UPDATE_PROGRESS, next)
  }
}

/** checks now and every few hours, retrying failures sooner; returns what stops it all */
export function watchForUpdates(updater: Updater): () => void {
  configure(updater)
  progress = null
  let failures = 0
  let retry: ReturnType<typeof setTimeout> | null = null
  // the download event has no version, remember it from update-available
  let downloading = ''

  const cancelRetry = (): void => {
    if (retry) clearTimeout(retry)
    retry = null
  }
  const check = (): void => {
    // one download at a time, and a waiting update needs no second look
    if (progress) return
    updater.checkForUpdates()?.catch(() => {
      // reported through the error event as well, which schedules the retry
    })
  }

  const onError = (err: unknown): void => {
    updateLog().error('Update check or download failed:', err)
    // a broken download starts over on the next check
    if (progress?.phase === 'downloading') announce(null)
    if (progress?.phase === 'ready') return
    failures++
    cancelRetry()
    const wait = RETRY_AFTER_MS[failures - 1]
    if (wait !== undefined) retry = setTimeout(check, wait)
  }
  const onReached = (): void => {
    failures = 0
    cancelRetry()
  }
  const onAvailable = (info: { version: string }): void => {
    onReached()
    downloading = info.version
  }
  const onProgress = (p: { percent?: unknown; transferred?: unknown; total?: unknown; bytesPerSecond?: unknown }): void => {
    announce({
      phase: 'downloading',
      version: downloading,
      percent: Math.round(num(p.percent)),
      transferred: num(p.transferred),
      total: num(p.total),
      bytesPerSecond: num(p.bytesPerSecond)
    })
  }
  const onDownloaded = (info: { version: string }): void => {
    updateLog().info(`${info.version} is ready; it installs on quit or when restarted from the title bar`)
    cancelRetry()
    announce({ phase: 'ready', version: info.version })
  }

  updater.on('error', onError)
  updater.on('update-not-available', onReached)
  updater.on('update-available', onAvailable)
  updater.on('download-progress', onProgress)
  updater.on('update-downloaded', onDownloaded)
  const regular = setInterval(check, CHECK_EVERY_MS)
  check()

  return () => {
    clearInterval(regular)
    cancelRetry()
    updater.removeListener('error', onError)
    updater.removeListener('update-not-available', onReached)
    updater.removeListener('update-available', onAvailable)
    updater.removeListener('download-progress', onProgress)
    updater.removeListener('update-downloaded', onDownloaded)
  }
}

let started = false

export async function initializeUpdater(): Promise<void> {
  if (!shouldCheckForUpdates()) return
  // whenReady can fire again on relaunch; two updaters would race one download
  if (started) return
  started = true

  try {
    const updater = await loadAutoUpdater()
    if (!updater) {
      console.error('[updater] electron-updater did not export autoUpdater')
      return
    }
    watchForUpdates(updater)
  } catch (err) {
    updateLog().error('The updater could not start:', err)
  }
}

/** only with an update downloaded; otherwise there'd be a quit flagged with nothing to install */
export function restartToUpdate(updater: Updater): void {
  if (progress?.phase !== 'ready') return
  beginQuit()
  updater.quitAndInstall(false, true)
}

export async function installUpdateAndRestart(): Promise<void> {
  if (!shouldCheckForUpdates()) return
  try {
    const updater = await loadAutoUpdater()
    if (updater) restartToUpdate(updater)
  } catch (err) {
    updateLog().error('Could not restart to install the update:', err)
  }
}

/** report rather than spin forever */
const MANUAL_CHECK_TIMEOUT_MS = 20_000

/** never rejects; answers from events since electron-updater already knows what counts as newer */
export function askForUpdate(updater: Updater, timeoutMs = MANUAL_CHECK_TIMEOUT_MS): Promise<UpdateCheckResult> {
  return new Promise<UpdateCheckResult>(resolve => {
    let settled = false

    const onAvailable = (info: { version: string }): void =>
      finish({ status: 'available', version: info.version })
    const onNotAvailable = (info: { version: string }): void =>
      finish({ status: 'current', version: info.version })
    const onError = (err: unknown): void =>
      finish({ status: 'error', message: errorMessage(err, 'Could not reach GitHub.') })

    const timer = setTimeout(
      () => finish({ status: 'error', message: 'The check timed out.' }),
      timeoutMs
    )

    function finish(result: UpdateCheckResult): void {
      if (settled) return
      settled = true
      clearTimeout(timer)
      // once listeners but only one fires, remove the other two by hand
      updater.removeListener('update-available', onAvailable)
      updater.removeListener('update-not-available', onNotAvailable)
      updater.removeListener('error', onError)
      resolve(result)
    }

    updater.once('update-available', onAvailable)
    updater.once('update-not-available', onNotAvailable)
    updater.once('error', onError)

    updater.checkForUpdates()?.catch(onError)
  })
}

export async function checkForUpdatesNow(): Promise<UpdateCheckResult> {
  if (!shouldCheckForUpdates()) return { status: 'unsupported' }
  let updater: Updater | null
  try {
    updater = await loadAutoUpdater()
  } catch (err) {
    return { status: 'error', message: errorMessage(err, 'Could not load the updater.') }
  }
  if (!updater) return { status: 'error', message: 'Could not load the updater.' }
  configure(updater)
  return askForUpdate(updater)
}
