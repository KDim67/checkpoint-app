import { describe, expect, it } from 'vitest'
import { BIN_DAYS, binRemoved, restorable, restoreEntry } from '../src/shared/wallBin'
import { normalizeWallDoc, type WallBinEntry, type WallItem } from '../src/shared/wallModel'

const DAY = 86_400_000

const item = (id: string, over: Partial<WallItem> = {}): WallItem =>
  ({ id, kind: 'note', x: 0, y: 0, width: 100, height: 100, z: 0, ...over })

const entry = (id: string, at: number, items: WallItem[]): WallBinEntry => ({ id, at, items })

describe('binRemoved', () => {
  it('puts a deletion first, and skips a call that removed nothing', () => {
    const old = entry('old', 1000, [item('x')])
    expect(binRemoved([old], [item('a')], [], 2000, 'new').map(e => e.id)).toStrictEqual(['new', 'old'])
    expect(binRemoved([old], [], [], 2000, 'new').map(e => e.id)).toStrictEqual(['old'])
  })

  it('forgets entries that are back on the wall and ones past the keeping time', () => {
    const undone = entry('undone', 1000, [item('back')])
    const stale = entry('stale', 0, [item('gone')])
    const now = BIN_DAYS * DAY + 1
    expect(binRemoved([undone, stale], [item('a')], [item('back')], now, 'new').map(e => e.id)).toStrictEqual(['new'])
  })

  it('keeps the newest deletion however big, and drops older ones past the limits', () => {
    const many = Array.from({ length: 600 }, (_, i) => item(`m${i}`))
    expect(binRemoved([entry('old', 1, [item('x')])], many, [], 2, 'big').map(e => e.id)).toStrictEqual(['big'])

    const full = Array.from({ length: 40 }, (_, i) => entry(`e${i}`, 1, [item(`i${i}`)]))
    expect(binRemoved(full, [item('a')], [], 2, 'new')).toHaveLength(30)
  })
})

describe('restorable', () => {
  it('lists only the items still missing from the wall', () => {
    const bin = [entry('e', 1, [item('a'), item('b')]), entry('f', 1, [item('c')])]
    expect(restorable(bin, [item('a'), item('c')])).toStrictEqual([entry('e', 1, [item('b')])])
  })
})

describe('restoreEntry', () => {
  it('puts the items back above everything and drops the entry', () => {
    const wall = [item('keep', { z: 7 })]
    const bin = [entry('e', 1, [item('a', { z: 1 }), item('line', { kind: 'arrow', from: 'a', to: 'keep', z: 2 })])]
    const result = restoreEntry(bin, wall, 'e')

    expect(result?.items.map(i => [i.id, i.z])).toStrictEqual([['keep', 7], ['a', 8], ['line', 9]])
    expect(result?.bin).toStrictEqual([])
    expect(result?.restored.map(i => i.id)).toStrictEqual(['a', 'line'])
  })

  it('leaves out a connector whose other end is gone, and finds nothing for an unknown entry', () => {
    const bin = [entry('e', 1, [item('a'), item('line', { kind: 'arrow', from: 'a', to: 'elsewhere' })])]
    expect(restoreEntry(bin, [], 'e')?.items.map(i => i.id)).toStrictEqual(['a'])
    expect(restoreEntry(bin, [], 'nope')).toBeNull()
  })
})

describe('a stored bin', () => {
  it('keeps whole entries and drops junk', () => {
    const doc = normalizeWallDoc({
      items: [],
      bin: [{ id: 'e', at: 5, items: [{ id: 'a', kind: 'note' }] }, { id: 'bad', at: 'x', items: [] }, 'junk']
    })
    expect(doc.bin?.map(e => e.id)).toStrictEqual(['e'])
    expect(normalizeWallDoc({ items: [] })).not.toHaveProperty('bin')
  })
})
