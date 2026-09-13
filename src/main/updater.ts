/** background pass stays quiet, installs on quit; the manual check reports; public repo so no token ships */

import { app, BrowserWindow } from 'electron'
import { errorMessage } from '../shared/errors'
import { IpcChannels } from '../shared/ipcChannels'
import type { UpdateCheckResult, UpdateProgress } from '../shared/types'

type Updater = typeof import('electron-updater').autoUpdater

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

function configure(autoUpdater: Updater): void {
  autoUpdater.autoDownload = true
  // on quit, not by restarting under someone
  autoUpdater.autoInstallOnAppQuit = true
  // electron-log isn't a dependency, console will do
  autoUpdater.logger = console
}

/** kept for the panel, a finished download has no events left to send */
let progress: UpdateProgress | null = null

export function currentUpdateProgress(): UpdateProgress | null {
  return progress
}

/** the event shape is a dependency's, undefined bytes would show NaN */
const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0)

/** titlebar indicator and About panel only, never a dialog or stolen focus */
function announce(next: UpdateProgress): void {
  progress = next
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(IpcChannels.APP_UPDATE_PROGRESS, next)
  }
}

let started = false

export async function initializeUpdater(): Promise<void> {
  if (!shouldCheckForUpdates()) return
  // whenReady can fire again on relaunch; two updaters would race one download
  if (started) return
  started = true

  try {
    const autoUpdater = await loadAutoUpdater()
    if (!autoUpdater) {
      console.error('[updater] electron-updater did not export autoUpdater')
      return
    }
    configure(autoUpdater)

    autoUpdater.on('error', err => {
      // unreachable update isn't the user's problem, try tomorrow
      console.error('[updater] check failed:', err)
    })
    // the download event has no version, remember it from update-available
    let downloading = ''
    autoUpdater.on('update-available', info => { downloading = info.version })
    autoUpdater.on('download-progress', p => {
      announce({
        phase: 'downloading',
        version: downloading,
        percent: Math.round(num(p.percent)),
        transferred: num(p.transferred),
        total: num(p.total),
        bytesPerSecond: num(p.bytesPerSecond)
      })
    })
    autoUpdater.on('update-downloaded', info => {
      console.log(`[updater] ${info.version} is ready and will install on quit`)
      announce({ phase: 'ready', version: info.version })
    })

    await autoUpdater.checkForUpdates()
  } catch (err) {
    console.error('[updater] could not start:', err)
  }
}

/** report rather than spin forever */
const MANUAL_CHECK_TIMEOUT_MS = 20_000

/** never rejects; answers from events since electron-updater already knows what counts as newer */
export async function checkForUpdatesNow(): Promise<UpdateCheckResult> {
  if (!shouldCheckForUpdates()) return { status: 'unsupported' }

  let autoUpdater: Updater | null
  try {
    autoUpdater = await loadAutoUpdater()
  } catch (err) {
    return { status: 'error', message: errorMessage(err, 'Could not load the updater.') }
  }
  if (!autoUpdater) {
    return { status: 'error', message: 'Could not load the updater.' }
  }
  const updater = autoUpdater
  configure(updater)

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
      MANUAL_CHECK_TIMEOUT_MS
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

    updater.checkForUpdates().catch(onError)
  })
}
