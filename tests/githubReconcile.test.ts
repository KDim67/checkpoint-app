import { describe, expect, it } from 'vitest'
import { decide, type DecideInput } from '../src/main/connections/reconcile'

const base: DecideInput = { local: 'open', agreed: 'open', remote: 'open', remoteNewer: false, canWrite: true }
const run = (over: Partial<DecideInput>) => decide({ ...base, ...over })

describe('settling one issue', () => {
  it('brings in an open issue it has no card for, and not a closed one', () => {
    expect(run({ local: 'none', agreed: null, remote: 'open' })).toBe('import')
    expect(run({ local: 'none', agreed: null, remote: 'closed' })).toBe('none')
    expect(run({ local: 'none', agreed: null, remote: 'out-of-scope' })).toBe('none')
  })

  it('never brings back a card you deleted', () => {
    expect(run({ local: 'deleted', agreed: 'open', remote: 'open' })).toBe('ignore')
    expect(run({ local: 'none', agreed: 'ignored', remote: 'open' })).toBe('ignore')
  })

  it('follows GitHub when only GitHub moved', () => {
    expect(run({ local: 'open', agreed: 'open', remote: 'closed' })).toBe('pull')
    expect(run({ local: 'closed', agreed: 'closed', remote: 'open' })).toBe('pull')
  })

  it('tells GitHub when only the card moved, if the key may', () => {
    expect(run({ local: 'closed', agreed: 'open', remote: 'open' })).toBe('push')
    expect(run({ local: 'open', agreed: 'closed', remote: 'closed' })).toBe('push')
    expect(run({ local: 'closed', agreed: 'open', remote: 'open', canWrite: false })).toBe('pull')
  })

  it('just records agreement when both moved the same way, or already agree', () => {
    expect(run({ local: 'closed', agreed: 'open', remote: 'closed' })).toBe('settle')
    expect(run({ local: 'closed', agreed: null, remote: 'closed' })).toBe('settle')
    expect(run({ local: 'open', agreed: 'open', remote: 'open' })).toBe('none')
  })

  it('goes by which changed last for a card that arrived from another computer', () => {
    expect(run({ local: 'closed', agreed: null, remote: 'open', remoteNewer: false })).toBe('push')
    expect(run({ local: 'closed', agreed: null, remote: 'open', remoteNewer: true })).toBe('pull')
    expect(run({ local: 'closed', agreed: null, remote: 'open', canWrite: false })).toBe('pull')
  })

  it('marks a card whose issue no longer matches, without touching it', () => {
    expect(run({ local: 'open', agreed: 'open', remote: 'out-of-scope' })).toBe('gone')
  })
})
