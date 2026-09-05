/**
 * Checking GitHub Releases for a newer build.
 *
 * Deliberately quiet. Checkpoint sits open all day beside Unity and JetBrains,
 * so an updater that steals focus or interrupts is worse than one that never
 * runs. Nothing is shown while it works: the download happens in the
 * background and the new version is swapped in the next time the app quits.
 *
 * This needs no token because the repository is public. Against a private one,
 * electron-updater would want a `GH_TOKEN` compiled into the shipped app,
 * which would hand every installer read access to the source.
 */

import { app } from 'electron'

/** Only the packaged app updates. A dev run would hit GitHub on every launch. */
export function shouldCheckForUpdates(): boolean {
  return app.isPackaged
}

let started = false

export async function initializeUpdater(): Promise<void> {
  if (!shouldCheckForUpdates()) return
  // whenReady can fire more than once across a relaunch, and two updaters
  // would race each other over the same partial download.
  if (started) return
  started = true

  try {
    // electron-updater is CommonJS. Bundled into an ESM main process its
    // exports arrive under .default, so destructuring the namespace directly
    // yields undefined and every line below it throws. Both shapes are read,
    // because which one turns up depends on the bundler's interop.
    const mod = await import('electron-updater')
    const interop = mod as unknown as { autoUpdater?: typeof mod.autoUpdater; default?: { autoUpdater?: typeof mod.autoUpdater } }
    const autoUpdater = interop.autoUpdater ?? interop.default?.autoUpdater
    if (!autoUpdater) {
      console.error('[updater] electron-updater did not export autoUpdater')
      return
    }

    autoUpdater.autoDownload = true
    // Applied on quit rather than by restarting underneath someone.
    autoUpdater.autoInstallOnAppQuit = true
    // The default logger writes to electron-log, which is not a dependency
    // here; console keeps the messages somewhere without adding one.
    autoUpdater.logger = console

    autoUpdater.on('error', err => {
      // An update that cannot be reached is not a problem the user has. No
      // network, GitHub down, a rate limit: all of them mean "try tomorrow".
      console.error('[updater] check failed:', err)
    })
    autoUpdater.on('update-downloaded', info => {
      console.log(`[updater] ${info.version} is ready and will install on quit`)
    })

    await autoUpdater.checkForUpdates()
  } catch (err) {
    console.error('[updater] could not start:', err)
  }
}
