/**
 * Checking GitHub Releases for a newer build.
 *
 * The automatic pass is deliberately quiet. Checkpoint sits open all day beside
 * Unity and JetBrains, so an updater that steals focus or interrupts is worse
 * than one that never runs. It never opens a dialog: the download happens in
 * the background and the new version is swapped in the next time the app quits.
 * A small titlebar indicator says it is happening, which is a thing you can
 * ignore, unlike a prompt.
 *
 * The manual check in Settings is the opposite, and has to be. Someone who
 * presses a button expects an answer, so that path reports what it found.
 *
 * This needs no token because the repository is public. Against a private one,
 * electron-updater would want a `GH_TOKEN` compiled into the shipped app,
 * which would hand every installer read access to the source.
 */

import { app, BrowserWindow } from 'electron'
import { errorMessage } from '../shared/errors'
import { IpcChannels } from '../shared/ipcChannels'
import type { UpdateCheckResult, UpdateProgress } from '../shared/types'

type Updater = typeof import('electron-updater').autoUpdater

/** Only the packaged app updates. A dev run would hit GitHub on every launch. */
export function shouldCheckForUpdates(): boolean {
  return app.isPackaged
}

/**
 * electron-updater is CommonJS. Bundled into an ESM main process its exports
 * arrive under .default, so destructuring the namespace directly yields
 * undefined and every line below it throws. Both shapes are read, because which
 * one turns up depends on the bundler's interop.
 */
async function loadAutoUpdater(): Promise<Updater | null> {
  const mod = await import('electron-updater')
  const interop = mod as unknown as { autoUpdater?: Updater; default?: { autoUpdater?: Updater } }
  return interop.autoUpdater ?? interop.default?.autoUpdater ?? null
}

function configure(autoUpdater: Updater): void {
  autoUpdater.autoDownload = true
  // Applied on quit rather than by restarting underneath someone.
  autoUpdater.autoInstallOnAppQuit = true
  // The default logger writes to electron-log, which is not a dependency here;
  // console keeps the messages somewhere without adding one.
  autoUpdater.logger = console
}

/**
 * The last thing the background download said about itself.
 *
 * Kept because the panel that shows it is usually not open when it happens. A
 * download that finished an hour ago has no more events to send, and without
 * this the panel would have nothing to say about a version already sitting on
 * disk waiting for a restart.
 */
let progress: UpdateProgress | null = null

export function currentUpdateProgress(): UpdateProgress | null {
  return progress
}

/**
 * A number that is safe to divide by. The event shape comes from a dependency,
 * and an undefined byte count would turn the estimate into NaN on screen.
 */
const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0)

/**
 * Tells every window: the titlebar indicator and the About panel. Still no
 * dialog, no toast and no focus stolen. The quiet stance is about not
 * interrupting, not about withholding.
 */
function announce(next: UpdateProgress): void {
  progress = next
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(IpcChannels.APP_UPDATE_PROGRESS, next)
  }
}

let started = false

export async function initializeUpdater(): Promise<void> {
  if (!shouldCheckForUpdates()) return
  // whenReady can fire more than once across a relaunch, and two updaters
  // would race each other over the same partial download.
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
      // An update that cannot be reached is not a problem the user has. No
      // network, GitHub down, a rate limit: all of them mean "try tomorrow".
      console.error('[updater] check failed:', err)
    })
    // The download carries no version of its own, so it is remembered from the
    // event that announced there was one to fetch.
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

/** A check that cannot finish is reported rather than left spinning. */
const MANUAL_CHECK_TIMEOUT_MS = 20_000

/**
 * The Settings button. Resolves with what the check found instead of staying
 * silent, and never rejects: every failure is a result the panel can render.
 *
 * Answered from the events rather than by comparing version strings here,
 * because electron-updater already knows what counts as newer and a second
 * opinion in this file would only be a way for the two to disagree.
 */
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
      // Removed by hand: these are `once` listeners, but only one of the three
      // fires, and the other two would sit on the emitter until the next check
      // resolved them against a promise nobody is holding any more.
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
