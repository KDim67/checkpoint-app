import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createUpdateLog } from '../src/main/updateLog'

const dirs: string[] = []
const scratch = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'update-log-'))
  dirs.push(dir)
  return dir
}
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

describe('the update log', () => {
  it('writes each line with its time and level, and makes its folder', () => {
    const file = join(scratch(), 'logs', 'updater.log')
    const log = createUpdateLog(file, { echo: false })
    log.info('Checking for update')
    log.error(new Error('net::ERR_INTERNET_DISCONNECTED'))
    const lines = readFileSync(file, 'utf8').trim().split('\n')
    expect(lines[0]).toMatch(/^\d{4}-\d\d-\d\dT[\d:.]+Z info Checking for update$/)
    expect(lines[1]).toMatch(/Z error Error: net::ERR_INTERNET_DISCONNECTED/)
  })

  it('keeps one older file once it grows past its cap, so it never fills the disk', () => {
    const file = join(scratch(), 'updater.log')
    const log = createUpdateLog(file, { echo: false, maxBytes: 200 })
    for (let i = 0; i < 20; i++) log.info(`line ${i} ${'x'.repeat(20)}`)
    const older = file.replace(/\.log$/, '.old.log')
    expect(existsSync(older)).toBe(true)
    expect(readFileSync(file, 'utf8')).toContain('line 19')
    expect(readFileSync(file, 'utf8').length).toBeLessThanOrEqual(200)
  })

  it('never throws, because a log that can\'t be written must not stop an update', () => {
    // a file where the folder should be
    const blocker = join(scratch(), 'blocked')
    writeFileSync(blocker, '')
    const log = createUpdateLog(join(blocker, 'updater.log'), { echo: false })
    expect(() => log.warn('anything')).not.toThrow()
  })
})
