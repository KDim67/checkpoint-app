import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { captureConsoleErrors, createErrorGate } from '../src/main/appLog'
import { createRotatingLog, tailOf, type Log } from '../src/main/rotatingLog'
import { logWindowError } from '../src/main/ipc/problems'
import { redactSecrets } from '../src/shared/redactSecrets'

// the app log: what reaches it, how much, and what a bug report reads back

let dir = ''
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'checkpoint-applog-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

/** a log that only remembers, for checking what was written and at which level */
const recorder = (): Log & { lines: string[] } => {
  const lines: string[] = []
  const at = (level: string) => (...parts: unknown[]) => lines.push(`${level} ${parts.join(' ')}`)
  return { lines, info: at('info'), warn: at('warn'), error: at('error'), debug: at('debug') }
}

describe('reading the end of a log back', () => {
  it('gives the last lines, reaching into the .old file when the fresh one is short', () => {
    const file = join(dir, 'app.log')
    writeFileSync(join(dir, 'app.old.log'), 'old 1\nold 2\nold 3\n')
    writeFileSync(file, 'new 1\nnew 2\n')
    expect(tailOf(file, 4)).toEqual(['old 2', 'old 3', 'new 1', 'new 2'])
    expect(tailOf(file, 2)).toEqual(['new 1', 'new 2'])
  })

  it('gives nothing, rather than throwing, when there is no log yet', () => {
    expect(tailOf(join(dir, 'never-written.log'), 50)).toEqual([])
  })

  it('reads back what the writer wrote, across a rotation', () => {
    const file = join(dir, 'app.log')
    const log = createRotatingLog(file, { maxBytes: 120 })
    for (let i = 0; i < 6; i++) log.error(`failure ${i}`)
    const tail = tailOf(file, 3)
    expect(tail).toHaveLength(3)
    expect(tail[2]).toMatch(/ error failure 5$/)
  })
})

describe('what one entry may hold', () => {
  it('keeps a stack whole and cuts a dumped payload, saying how much went', () => {
    const file = join(dir, 'app.log')
    const log = createRotatingLog(file, { maxEntryChars: 200 })
    log.error('[db] save failed:', new Error('disk full'))
    log.error('x'.repeat(700))
    const written = readFileSync(file, 'utf8')
    expect(written).toContain('Error: disk full\n    at')
    expect(written).toMatch(/x{200} … \(500 more characters\)\n$/)
  })

  it('redacts before cutting, so a key right on the cut leaves no piece of itself', () => {
    const file = join(dir, 'app.log')
    const log = createRotatingLog(file, { scrub: redactSecrets, maxEntryChars: 200 })
    // built at runtime so repo secret scanners don't cry wolf
    const key = 'ghp_' + 'abcdefghijklmnopqrstuvwxyz0123456789'
    // raw, the cut lands 14 characters into the key; redacted first, the whole line fits
    log.error(`${'x'.repeat(185)} ${key}`)
    const written = readFileSync(file, 'utf8')
    expect(written).not.toContain('ghp_')
    expect(written).toContain('[redacted]')
  })
})

describe('main errors reaching the log', () => {
  it('writes every console.error to the log and still prints it', () => {
    const log = recorder()
    const printed = vi.spyOn(console, 'error').mockImplementation(() => {})
    const release = captureConsoleErrors(() => log)
    try {
      console.error('[sync] could not reach the other computer:', new Error('ECONNREFUSED'))
    } finally {
      release()
    }
    expect(printed).toHaveBeenCalledTimes(1)
    expect(log.lines).toHaveLength(1)
    expect(log.lines[0]).toMatch(/^error \[sync\] could not reach the other computer: Error: ECONNREFUSED/)
    printed.mockRestore()
  })

  it('stops writing once released', () => {
    const log = recorder()
    const printed = vi.spyOn(console, 'error').mockImplementation(() => {})
    captureConsoleErrors(() => log)()
    console.error('after release')
    expect(log.lines).toEqual([])
    printed.mockRestore()
  })
})

describe('the gate on what the window sends', () => {
  it('lets a minute hold its share, then counts the rest and says so in the next minute', () => {
    const gate = createErrorGate(3, 60_000)
    expect([gate(0), gate(10), gate(20)].every(r => r.pass)).toBe(true)
    expect(gate(30)).toEqual({ pass: false, dropped: 0 })
    expect(gate(40)).toEqual({ pass: false, dropped: 0 })
    expect(gate(60_000)).toEqual({ pass: true, dropped: 2 })
    expect(gate(60_010)).toEqual({ pass: true, dropped: 0 })
  })
})

describe('an error the window reports', () => {
  const open = () => ({ pass: true, dropped: 0 })

  it('is written once with its stack, which already starts with the message', () => {
    const log = recorder()
    logWindowError({ source: 'error', message: 'x is undefined', stack: 'TypeError: x is undefined\n    at App (App.tsx:3)' }, open, 0, log)
    expect(log.lines).toEqual(['error [window] error: TypeError: x is undefined\n    at App (App.tsx:3)'])
  })

  it('keeps the message when the stack does not carry it, and the component stack after', () => {
    const log = recorder()
    logWindowError({ source: 'render', message: 'Board hit an error: boom', stack: 'at Board', componentStack: '\n    at Board' }, open, 0, log)
    expect(log.lines[0]).toBe('error [window] render: Board hit an error: boom\nat Board\nComponent stack:\n    at Board')
  })

  it('drops anything that is not a window error, whatever the window sent', () => {
    const log = recorder()
    for (const raw of [null, 'boom', { source: 'nope', message: 'x' }, { source: 'error' }, { source: 'error', message: 5 }]) {
      logWindowError(raw, open, 0, log)
    }
    expect(log.lines).toEqual([])
  })

  it('says how many the gate held back, and writes nothing for a held one', () => {
    const log = recorder()
    logWindowError({ source: 'rejection', message: 'late' }, () => ({ pass: false, dropped: 0 }), 0, log)
    expect(log.lines).toEqual([])
    logWindowError({ source: 'rejection', message: 'next minute' }, () => ({ pass: true, dropped: 7 }), 0, log)
    expect(log.lines).toEqual(['warn [window] 7 more errors in a minute were left out', 'error [window] rejection: next minute'])
  })
})
