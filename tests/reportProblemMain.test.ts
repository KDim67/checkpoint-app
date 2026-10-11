import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname } from 'node:path'
import { shell } from 'electron'

// the report as main builds it: nothing shaped like a key in the file or the report, and no unread log in a link

const opened = vi.hoisted(() => [] as string[])
vi.mock('../src/main/openExternal', () => ({ openExternalSafely: (url: string) => { opened.push(url) } }))

import { appLog, appLogPath } from '../src/main/appLog'
import { currentReport, openReport, reportDraft } from '../src/main/reportProblem'

// built at runtime so repo secret scanners don't cry wolf
const key = 'ghp_' + 'abcdefghijklmnopqrstuvwxyz0123456789'

afterEach(() => {
  opened.length = 0
  rmSync(dirname(appLogPath()), { recursive: true, force: true })
})

describe('the app log file', () => {
  it('never holds a key an error carried', () => {
    appLog().error('[connections] GitHub said no to', key, 'at https://api.github.com/user?access_token=abc')
    const written = readFileSync(appLogPath(), 'utf8')
    expect(written).not.toContain(key)
    expect(written).not.toContain('access_token=abc')
    expect(written).toContain('[connections] GitHub said no to [redacted] at https://api.github.com/user?[query removed]')
  })
})

describe('the report main builds', () => {
  it('redacts and hides the home folder in whatever reached the file another way', () => {
    mkdirSync(dirname(appLogPath()), { recursive: true })
    writeFileSync(appLogPath(), `2026-10-11T10:00:00.000Z error failed at ${homedir()}/notes with ${key}\n`)
    const { log, version } = currentReport()
    expect(version).toBe('0.0.0-test')
    expect(log).toBe('2026-10-11T10:00:00.000Z error failed at ~/notes with [redacted]')
  })

  it('cleans the error message a report starts from, like the log', () => {
    const { what } = reportDraft(`Board hit an error: ENOENT ${homedir()}\\notes\\a.md with ${key}`)
    expect(what).toBe('Board hit an error: ENOENT ~\\notes\\a.md with [redacted]')
  })

  it('keeps the unread log out of the crash dialog\'s link and shows the file instead', () => {
    appLog().error('something private went wrong')
    const shown = vi.spyOn(shell, 'showItemInFolder')
    openReport('The window kept crashing (crashed).')
    expect(opened).toHaveLength(1)
    const fields = Object.fromEntries(new URL(opened[0]).searchParams)
    expect(fields.what).toBe('The window kept crashing (crashed).')
    expect(fields.console).toBeUndefined()
    expect(opened[0]).not.toContain('private')
    expect(shown).toHaveBeenCalledWith(appLogPath())
    shown.mockRestore()
  })
})
