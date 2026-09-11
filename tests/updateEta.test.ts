import { describe, it, expect } from 'vitest'
import {
  describeUpdateProgress,
  etaPhrase,
  etaSeconds,
  etaShort,
  formatBytes
} from '../src/shared/updateEta'
import type { UpdateProgress } from '../src/shared/types'

const downloading = (over: Partial<Extract<UpdateProgress, { phase: 'downloading' }>> = {}): UpdateProgress => ({
  phase: 'downloading',
  version: '1.0.2',
  percent: 50,
  transferred: 50_000_000,
  total: 100_000_000,
  bytesPerSecond: 1_000_000,
  ...over
})

describe('etaSeconds', () => {
  it('divides what is left by the rate', () => {
    expect(etaSeconds(downloading())).toBe(50)
  })

  it('has nothing to say about a download that has finished', () => {
    expect(etaSeconds({ phase: 'ready', version: '1.0.2' })).toBeNull()
  })

  it('refuses to divide by a rate of zero', () => {
    // The first event of every download arrives before there is a rate.
    expect(etaSeconds(downloading({ bytesPerSecond: 0 }))).toBeNull()
  })

  it('refuses figures that are not numbers', () => {
    expect(etaSeconds(downloading({ bytesPerSecond: NaN }))).toBeNull()
    expect(etaSeconds(downloading({ total: NaN }))).toBeNull()
    expect(etaSeconds(downloading({ transferred: NaN }))).toBeNull()
  })

  it('reads a transfer past the total as done rather than as negative time', () => {
    expect(etaSeconds(downloading({ transferred: 120_000_000 }))).toBe(0)
  })
})

describe('etaShort', () => {
  it('says nothing when there is no estimate', () => {
    expect(etaShort(null)).toBe('')
    expect(etaShort(NaN)).toBe('')
  })

  it('rounds seconds up to the nearest five', () => {
    // A figure jumping 41, 38, 44 reads as broken even when the download is fine.
    expect(etaShort(41)).toBe('45 sec')
    expect(etaShort(44)).toBe('45 sec')
    expect(etaShort(45)).toBe('45 sec')
  })

  it('never counts down past five seconds', () => {
    expect(etaShort(0)).toBe('5 sec')
    expect(etaShort(2)).toBe('5 sec')
  })

  it('switches to minutes at a minute', () => {
    // 56 rounds up to 60, and "60 sec" is not what anybody says.
    expect(etaShort(56)).toBe('1 min')
    expect(etaShort(59)).toBe('1 min')
    expect(etaShort(60)).toBe('1 min')
    expect(etaShort(61)).toBe('2 min')
    expect(etaShort(3599)).toBe('60 min')
  })

  it('switches to hours at an hour, and gets the plural right', () => {
    expect(etaShort(3600)).toBe('1 hour')
    expect(etaShort(3601)).toBe('2 hours')
  })
})

describe('etaPhrase', () => {
  it('finishes the sentence', () => {
    expect(etaPhrase(120)).toBe('2 min left')
  })

  it('stays empty rather than saying " left" on its own', () => {
    expect(etaPhrase(null)).toBe('')
  })
})

describe('formatBytes', () => {
  it('uses KB below a megabyte and MB above it', () => {
    expect(formatBytes(500_000)).toBe('488 KB')
    expect(formatBytes(12_500_000)).toBe('11.9 MB')
  })

  it('does not print a negative or nonsense size', () => {
    expect(formatBytes(0)).toBe('0 KB')
    expect(formatBytes(-1)).toBe('0 KB')
    expect(formatBytes(NaN)).toBe('0 KB')
  })
})

describe('describeUpdateProgress', () => {
  it('says what a finished download is waiting for', () => {
    expect(describeUpdateProgress({ phase: 'ready', version: '1.0.2' }))
      .toBe('Version 1.0.2 is ready. It installs the next time you close Checkpoint.')
  })

  it('gives the version, the percentage, the size and the time left', () => {
    expect(describeUpdateProgress(downloading()))
      .toBe('Downloading version 1.0.2, 50%. 47.7 MB of 95.4 MB. 50 sec left.')
  })

  it('leaves out the version when the event naming it has not arrived', () => {
    // The download starts on update-available; a restart mid-download has no name for it.
    expect(describeUpdateProgress(downloading({ version: '' })))
      .toBe('Downloading, 50%. 47.7 MB of 95.4 MB. 50 sec left.')
  })

  it('leaves out the estimate rather than guessing at one', () => {
    expect(describeUpdateProgress(downloading({ bytesPerSecond: 0 })))
      .toBe('Downloading version 1.0.2, 50%. 47.7 MB of 95.4 MB.')
  })

  it('leaves out the size when the total is unknown', () => {
    expect(describeUpdateProgress(downloading({ total: 0, bytesPerSecond: 0 })))
      .toBe('Downloading version 1.0.2, 50%.')
  })
})
