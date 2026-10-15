import { afterAll, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { rmSync } from 'node:fs'
import { dirname } from 'node:path'
import type { BrowserWindow } from 'electron'
import { recentCrashes, takeCrashNotice, watchForCrashes, type CrashChoice } from '../src/main/windowCrash'
import { appLogPath } from '../src/main/appLog'
import { tailOf } from '../src/main/rotatingLog'
import { beginQuit } from '../src/main/windows'

// a crashed page comes back on its own, three in a minute stop and ask, and quitting is no crash

afterAll(() => {
  rmSync(dirname(appLogPath()), { recursive: true, force: true })
})

function fakeWindow(): { win: BrowserWindow; reload: ReturnType<typeof vi.fn>; crash: (reason?: string) => void; destroy: () => void } {
  let destroyed = false
  const reload = vi.fn()
  const webContents = Object.assign(new EventEmitter(), { reload })
  const win = Object.assign(new EventEmitter(), { webContents, isDestroyed: () => destroyed })
  return {
    win: win as unknown as BrowserWindow,
    reload,
    crash: (reason = 'crashed') => { webContents.emit('render-process-gone', {}, { reason, exitCode: 9 }) },
    destroy: () => { destroyed = true }
  }
}

const settle = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))

/** a clock the test moves, and a dialog that answers as told */
function setup(answer: CrashChoice = 'retry') {
  let now = 1_000_000
  const ask = vi.fn(async () => answer)
  const report = vi.fn()
  const quit = vi.fn()
  const window = fakeWindow()
  watchForCrashes(window.win, { now: () => now, ask, report, quit })
  return { ...window, ask, report, quit, advance: (ms: number) => { now += ms } }
}

describe('counting crashes', () => {
  it('keeps only those inside the last minute', () => {
    expect(recentCrashes([0, 30_000, 59_999, 60_000], 120_000)).toEqual([])
    expect(recentCrashes([0, 70_000, 100_000], 120_000)).toEqual([70_000, 100_000])
  })
})

describe('a crashed window', () => {
  it('reloads, and hands the reloaded page its notice exactly once', () => {
    const { crash, reload } = setup()
    takeCrashNotice()
    crash('oom')
    expect(reload).toHaveBeenCalledTimes(1)
    expect(takeCrashNotice()).toBe('oom')
    expect(takeCrashNotice()).toBeNull()
  })

  it('writes the crash to the app log', () => {
    const { crash } = setup()
    crash('crashed')
    expect(tailOf(appLogPath(), 5).some(line => /error \[window\] the page's process ended \(crashed, exit code 9\)/.test(line))).toBe(true)
  })

  it('does nothing for a page that ended cleanly, or a window already gone', () => {
    const clean = setup()
    clean.crash('clean-exit')
    expect(clean.reload).not.toHaveBeenCalled()

    const gone = setup()
    gone.destroy()
    gone.crash()
    expect(gone.reload).not.toHaveBeenCalled()
  })

  it('keeps reloading crashes spread over more than a minute', async () => {
    const { crash, reload, ask, advance } = setup()
    for (let i = 0; i < 4; i++) {
      crash()
      advance(31_000)
    }
    await settle()
    expect(reload).toHaveBeenCalledTimes(4)
    expect(ask).not.toHaveBeenCalled()
  })
})

describe('a window that keeps crashing', () => {
  it('asks on the third crash in a minute instead of reloading into it again', async () => {
    const { crash, reload, ask } = setup('retry')
    crash()
    crash()
    expect(reload).toHaveBeenCalledTimes(2)
    crash()
    expect(ask).toHaveBeenCalledWith(3)
    expect(reload).toHaveBeenCalledTimes(2)
    await settle()
    expect(reload).toHaveBeenCalledTimes(3)
  })

  it('starts counting again after asking, so the next crash just reloads', async () => {
    const { crash, reload, ask } = setup('retry')
    crash(); crash(); crash()
    await settle()
    crash()
    expect(ask).toHaveBeenCalledTimes(1)
    expect(reload).toHaveBeenCalledTimes(4)
  })

  it('opens a report saying so when asked to, then tries again', async () => {
    const { crash, reload, report } = setup('report')
    crash('crashed'); crash('crashed'); crash('crashed')
    await settle()
    expect(report).toHaveBeenCalledWith('The window kept crashing (crashed).')
    expect(reload).toHaveBeenCalledTimes(3)
  })

  it('quits when asked to, without reloading', async () => {
    const { crash, reload, quit } = setup('quit')
    crash(); crash(); crash()
    await settle()
    expect(quit).toHaveBeenCalledTimes(1)
    expect(reload).toHaveBeenCalledTimes(2)
  })
})

describe('quitting', () => {
  // last: the quitting flag only ever turns on
  it('is no crash, so the page ending then is left alone', () => {
    const { crash, reload } = setup()
    beginQuit()
    crash('killed')
    expect(reload).not.toHaveBeenCalled()
  })
})
