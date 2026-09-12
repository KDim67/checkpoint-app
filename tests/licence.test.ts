import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  COPYRIGHT_FROM, COPYRIGHT_HOLDER, copyrightYears, copyrightLine
} from '../src/shared/licence'
import { defined } from './helpers/defined'

// The About panel used to spell the copyright out by hand, and said 2025 for a
// project whose first commit is from 2026, under a holder LICENSE does not
// name. These keep the one remaining copy honest.

describe('the copyright years shown in the app', () => {
  it('shows one year until there is a range to show', () => {
    expect(copyrightYears(COPYRIGHT_FROM)).toBe(String(COPYRIGHT_FROM))
  })

  it('grows into a range as the years pass', () => {
    expect(copyrightYears(COPYRIGHT_FROM + 2)).toBe(`${COPYRIGHT_FROM}-${COPYRIGHT_FROM + 2}`)
  })

  it('never claims a year before the first release', () => {
    // A machine with a wrong clock, or someone testing in the past.
    expect(copyrightYears(1999)).toBe(String(COPYRIGHT_FROM))
  })

  it('copes with a clock that returns nothing usable', () => {
    expect(copyrightYears(NaN)).toBe(String(COPYRIGHT_FROM))
  })

  it('reads as a whole line', () => {
    expect(copyrightLine(COPYRIGHT_FROM)).toBe(`Copyright (c) ${COPYRIGHT_FROM} ${COPYRIGHT_HOLDER}.`)
  })
})

describe('agreement with the LICENSE file', () => {
  const licence = readFileSync('LICENSE', 'utf8')

  it('names the same holder the licence does', () => {
    expect(licence).toContain(COPYRIGHT_HOLDER)
  })

  it('starts from the same year the licence does', () => {
    expect(licence).toContain(`Copyright (c) ${COPYRIGHT_FROM} ${COPYRIGHT_HOLDER}`)
  })

  it('is still the MIT licence the app claims to be', () => {
    expect(licence).toContain('MIT License')
    expect(licence).toContain('WITHOUT WARRANTY OF ANY KIND')
  })
})

describe('agreement with what ships in the installer', () => {
  // This used to check the year alone, which is how the config came to name
  // "Checkpoint" as the copyright holder while LICENSE, the About panel and
  // the licence module all named a person. The holder was the half that went
  // wrong, so it is the half worth asserting.
  it('names the same holder in the packaged metadata', () => {
    // electron-builder bakes this into the exe properties, where nobody looks
    // until it is wrong.
    const match = /^copyright:\s*"(.+)"$/m.exec(readFileSync('electron-builder.yml', 'utf8'))
    expect(match, 'electron-builder.yml has no copyright line').not.toBeNull()
    expect(defined(match)[1]).toContain(COPYRIGHT_HOLDER)
  })

  it('starts from the same year in the packaged metadata', () => {
    const match = /^copyright:\s*"(.+)"$/m.exec(readFileSync('electron-builder.yml', 'utf8'))
    expect(defined(match)[1]).toContain(String(COPYRIGHT_FROM))
  })
})
