import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import {
  askForUpdate,
  CHECK_EVERY_MS,
  currentUpdateProgress,
  restartToUpdate,
  shouldCheckForUpdates,
  watchForUpdates
} from '../src/main/updater'

// two startup paths reach it; it must never run in dev or start twice

describe('when the updater runs at all', () => {
  it('stays out of the way in development', () => {
    // the stub is unpackaged, like a dev run
    expect(shouldCheckForUpdates()).toBe(false)
  })
})

/** electron-updater's autoUpdater as far as the app uses it: events out, checks and installs in */
class StandIn extends EventEmitter {
  autoDownload = false
  autoInstallOnAppQuit = false
  logger: unknown = null
  checkForUpdates = vi.fn(async () => null)
  quitAndInstall = vi.fn()
}

const MINUTE = 60_000

describe('watching for updates', () => {
  let updater: StandIn
  let stop: () => void

  beforeEach(() => {
    vi.useFakeTimers()
    updater = new StandIn()
    stop = watchForUpdates(updater as never)
  })
  afterEach(() => {
    stop()
    vi.useRealTimers()
  })

  it('downloads by itself, installs on quit, and logs somewhere it can be found', () => {
    expect(updater.autoDownload).toBe(true)
    expect(updater.autoInstallOnAppQuit).toBe(true)
    expect(updater.logger).not.toBeNull()
  })

  it('checks at once, then every four hours while the app stays open', () => {
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(CHECK_EVERY_MS)
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2)
    vi.advanceTimersByTime(CHECK_EVERY_MS)
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(3)
  })

  it('tries a failed check again after 5, 15 and 60 minutes, then waits for the regular one', () => {
    const fail = (): void => { updater.emit('error', new Error('offline')) }
    fail()
    vi.advanceTimersByTime(5 * MINUTE)
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2)
    fail()
    vi.advanceTimersByTime(15 * MINUTE)
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(3)
    fail()
    vi.advanceTimersByTime(60 * MINUTE)
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(4)
    fail()
    // 80 minutes in; nothing more until the four-hour check
    vi.advanceTimersByTime(80 * MINUTE)
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(4)
    vi.advanceTimersByTime(80 * MINUTE)
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(5)
  })

  it('starts the back-off over once a check gets through', () => {
    updater.emit('error', new Error('offline'))
    vi.advanceTimersByTime(5 * MINUTE)
    updater.emit('update-not-available', { version: '1.1.1' })
    updater.emit('error', new Error('offline again'))
    vi.advanceTimersByTime(5 * MINUTE)
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(3)
  })

  it('shows the download, then says it is ready and leaves the restart to the person', () => {
    updater.emit('update-available', { version: '1.2.0' })
    updater.emit('download-progress', { percent: 50.4, transferred: 5, total: 10, bytesPerSecond: 2 })
    expect(currentUpdateProgress()).toStrictEqual({ phase: 'downloading', version: '1.2.0', percent: 50, transferred: 5, total: 10, bytesPerSecond: 2 })

    updater.emit('update-downloaded', { version: '1.2.0' })
    expect(currentUpdateProgress()).toStrictEqual({ phase: 'ready', version: '1.2.0' })
    vi.advanceTimersByTime(60 * MINUTE)
    expect(updater.quitAndInstall).not.toHaveBeenCalled()
  })

  it('stops checking while a download runs and once an update is waiting', () => {
    updater.emit('update-available', { version: '1.2.0' })
    updater.emit('download-progress', { percent: 10, transferred: 1, total: 10, bytesPerSecond: 1 })
    vi.advanceTimersByTime(CHECK_EVERY_MS)
    updater.emit('update-downloaded', { version: '1.2.0' })
    vi.advanceTimersByTime(2 * CHECK_EVERY_MS)
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1)
  })

  it('clears a download that failed, and the next check starts it again', () => {
    updater.emit('update-available', { version: '1.2.0' })
    updater.emit('download-progress', { percent: 40, transferred: 4, total: 10, bytesPerSecond: 1 })
    updater.emit('error', new Error('connection reset'))
    expect(currentUpdateProgress()).toBeNull()
    vi.advanceTimersByTime(5 * MINUTE)
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2)
  })

  it('restarts to install only once the update is in, and only when asked', () => {
    restartToUpdate(updater as never)
    expect(updater.quitAndInstall).not.toHaveBeenCalled()
    updater.emit('update-downloaded', { version: '1.2.0' })
    restartToUpdate(updater as never)
    expect(updater.quitAndInstall).toHaveBeenCalledWith(false, true)
  })

  it('leaves nothing running once stopped', () => {
    stop()
    vi.advanceTimersByTime(3 * CHECK_EVERY_MS)
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1)
    expect(updater.listenerCount('error')).toBe(0)
  })
})

describe('checking from About', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('answers from the updater\'s own verdict and cleans up after itself', async () => {
    const updater = new StandIn()
    const asked = askForUpdate(updater as never, 1000)
    updater.emit('update-not-available', { version: '1.1.1' })
    await expect(asked).resolves.toStrictEqual({ status: 'current', version: '1.1.1' })
    expect(updater.listenerCount('update-available') + updater.listenerCount('update-not-available') + updater.listenerCount('error')).toBe(0)
  })

  it('gives up with a message rather than spinning forever', async () => {
    const updater = new StandIn()
    const asked = askForUpdate(updater as never, 1000)
    vi.advanceTimersByTime(1000)
    await expect(asked).resolves.toStrictEqual({ status: 'error', message: 'The check timed out.' })
    expect(updater.listenerCount('error')).toBe(0)
  })
})
