// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ProblemReport, WindowError } from '../src/shared/problemReport'

// Report a problem from the window's side: the dialog, how it opens, the crash notice, and errors reaching the log

const bridge = vi.hoisted(() => ({
  report: null as ProblemReport | null,
  failure: null as Error | null,
  notice: null as string | null,
  opened: [] as string[],
  logged: [] as WindowError[]
}))

vi.mock('../src/renderer/src/data/app', () => ({
  // main cleans the seed; marked here so a test can tell the dialog showed main's text, not its own
  problemReport: vi.fn(async (seed = '') => {
    if (bridge.failure) throw bridge.failure
    return { ...bridge.report, what: seed ? `${seed} (cleaned)` : '' }
  }),
  crashNotice: vi.fn(async () => {
    const notice = bridge.notice
    bridge.notice = null
    return notice
  }),
  openExternal: vi.fn(async (url: string) => { bridge.opened.push(url) }),
  showAppLog: vi.fn(async () => {}),
  logError: vi.fn((error: WindowError) => { bridge.logged.push(error) })
}))

import ReportProblemDialog from '../src/renderer/src/components/ReportProblemDialog'
import ProblemReporter from '../src/renderer/src/components/ProblemReporter'
import ErrorBoundary from '../src/renderer/src/components/ui/ErrorBoundary'
import { ToastProvider } from '../src/renderer/src/components/ui/Toast'
import { forwardWindowErrors } from '../src/renderer/src/lib/windowErrors'
import { REPORT_PROBLEM_EVENT } from '../src/renderer/src/lib/reportProblem'
import { buildCommands, type CommandContext } from '../src/renderer/src/lib/commands'

const fields = (url: string): Record<string, string> => Object.fromEntries(new URL(url).searchParams)

const writeText = vi.fn(async () => {})

beforeEach(() => {
  bridge.report = { version: '1.2.0', system: 'Windows 11 (build 26300)', log: '2026-10-11T10:00:00.000Z error [db] Failed to save: disk full' }
  bridge.failure = null
  bridge.notice = null
  bridge.opened = []
  bridge.logged = []
  writeText.mockClear()
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
})

afterEach(() => {
  cleanup()
})

const openDialog = async (initialWhat = '', onClose = vi.fn()) => {
  render(<ToastProvider><ReportProblemDialog initialWhat={initialWhat} onClose={onClose} /></ToastProvider>)
  await screen.findByText('Windows 11 (build 26300)')
  return onClose
}

describe('the report dialog', () => {
  it('shows the version, the system and the recent errors before anything leaves', async () => {
    await openDialog()
    expect(screen.getByText('1.2.0')).toBeTruthy()
    expect((screen.getByLabelText('Recent errors') as HTMLTextAreaElement).value).toContain('[db] Failed to save: disk full')
  })

  it('opens the prefilled GitHub form with what was written and the log as edited, then closes', async () => {
    const onClose = await openDialog()
    fireEvent.change(screen.getByLabelText('What happened'), { target: { value: 'Saving a card fails' } })
    fireEvent.change(screen.getByLabelText('Recent errors'), { target: { value: 'only this line' } })
    fireEvent.click(screen.getByRole('button', { name: 'Open on GitHub' }))
    expect(bridge.opened).toHaveLength(1)
    expect(fields(bridge.opened[0])).toMatchObject({ version: '1.2.0', what: 'Saving a card fails', console: 'only this line' })
    expect(onClose).toHaveBeenCalled()
  })

  it('starts what happened from whoever opened it', async () => {
    await openDialog('The window crashed (oom) and was reloaded.')
    expect((screen.getByLabelText('What happened') as HTMLTextAreaElement).value).toBe('The window crashed (oom) and was reloaded. (cleaned)')
  })

  it('copies the whole report, nothing trimmed', async () => {
    await openDialog('It broke')
    fireEvent.click(screen.getByRole('button', { name: 'Copy report' }))
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('Checkpoint 1.2.0 on Windows 11 (build 26300)'))
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('[db] Failed to save: disk full'))
    expect(await screen.findByText('Report copied')).toBeTruthy()
  })

  it('says when the log is too long for a link, and that Copy keeps it all', async () => {
    bridge.report = { version: '1.2.0', system: 'Windows 11 (build 26300)', log: Array.from({ length: 300 }, (_, i) => `line ${i} ${'x'.repeat(80)}`).join('\n') }
    await openDialog()
    expect(screen.getByText(/Too long for a link/)).toBeTruthy()
  })

  it('redacts the text it was started with itself when main cannot clean it', async () => {
    bridge.failure = new Error('EACCES')
    // built at runtime so repo secret scanners don't cry wolf
    const key = 'ghp_' + 'abcdefghijklmnopqrstuvwxyz0123456789'
    render(<ToastProvider><ReportProblemDialog initialWhat={`Board hit an error: bad key ${key}`} onClose={vi.fn()} /></ToastProvider>)
    await screen.findByText(/The app log couldn't be read/)
    expect((screen.getByLabelText('What happened') as HTMLTextAreaElement).value).toBe('Board hit an error: bad key [redacted]')
  })

  it('still lets a report go when the log cannot be read, saying why', async () => {
    bridge.failure = new Error('EACCES')
    render(<ToastProvider><ReportProblemDialog onClose={vi.fn()} /></ToastProvider>)
    expect(await screen.findByText(/The app log couldn't be read: EACCES/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Open on GitHub' }))
    expect(bridge.opened).toHaveLength(1)
  })
})

describe('opening it from anywhere', () => {
  it('opens on its window event, started with what the opener knew', async () => {
    render(<ToastProvider><ProblemReporter /></ToastProvider>)
    expect(screen.queryByRole('dialog')).toBeNull()
    act(() => { window.dispatchEvent(new CustomEvent(REPORT_PROBLEM_EVENT, { detail: 'Board hit an error: boom' })) })
    await screen.findByText('Windows 11 (build 26300)')
    expect((screen.getByLabelText('What happened') as HTMLTextAreaElement).value).toBe('Board hit an error: boom (cleaned)')
  })

  it('says the window came back from a crash, with Report opening the dialog about it', async () => {
    bridge.notice = 'oom'
    render(<ToastProvider><ProblemReporter /></ToastProvider>)
    expect(await screen.findByText('The window crashed and was reloaded.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Report' }))
    await screen.findByText('Windows 11 (build 26300)')
    expect((screen.getByLabelText('What happened') as HTMLTextAreaElement).value).toBe('The window crashed (oom) and was reloaded. (cleaned)')
  })

  it('shows no notice after an ordinary start', async () => {
    render(<ToastProvider><ProblemReporter /></ToastProvider>)
    await act(async () => { await Promise.resolve() })
    expect(screen.queryByText('The window crashed and was reloaded.')).toBeNull()
  })

  it('is in the command palette', () => {
    const ctx = { workspaces: [], activeWorkspace: '', enabledViews: {}, aiEnabled: false, savedViews: [] } as unknown as CommandContext
    const report = buildCommands(ctx).find(command => command.id === 'help:report')
    expect(report?.label).toBe('Report a problem')
    const heard = vi.fn()
    window.addEventListener(REPORT_PROBLEM_EVENT, heard)
    void report?.run()
    window.removeEventListener(REPORT_PROBLEM_EVENT, heard)
    expect(heard).toHaveBeenCalledTimes(1)
  })
})

describe('the window failing on its own', () => {
  function Broken(): React.JSX.Element {
    throw new Error('boom')
  }

  it('sends a view that broke to the log, and offers Report a problem about it', () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<ErrorBoundary label="Board"><Broken /></ErrorBoundary>)
    quiet.mockRestore()
    expect(bridge.logged).toEqual([expect.objectContaining({ source: 'render', message: 'boom' })])
    expect(bridge.logged[0].componentStack).toContain('Broken')

    const heard = vi.fn()
    window.addEventListener(REPORT_PROBLEM_EVENT, heard)
    fireEvent.click(screen.getByRole('button', { name: 'Report a problem' }))
    window.removeEventListener(REPORT_PROBLEM_EVENT, heard)
    expect((heard.mock.calls[0][0] as CustomEvent<string>).detail).toBe('Board hit an error: boom')
  })

  it('sends errors and rejections nothing caught, skips the harmless resize one, and stops when undone', () => {
    const undo = forwardWindowErrors(window)
    window.dispatchEvent(new ErrorEvent('error', { message: 'x is undefined', error: new TypeError('x is undefined') }))
    window.dispatchEvent(new ErrorEvent('error', { message: 'ResizeObserver loop completed with undelivered notifications.' }))
    window.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason: 'sync refused' }))
    undo()
    window.dispatchEvent(new ErrorEvent('error', { message: 'after undo' }))

    expect(bridge.logged.map(e => [e.source, e.message])).toEqual([['error', 'x is undefined'], ['rejection', 'sync refused']])
    expect(bridge.logged[0].stack).toContain('TypeError: x is undefined')
  })
})
