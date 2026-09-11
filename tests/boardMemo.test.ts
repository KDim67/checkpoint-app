import { describe, it, expect } from 'vitest'
import {
  DEFAULT_CARD_DISPLAY,
  normalizeBoardConfig,
  sameCardDisplay,
  sameColumnConfig,
  type CardDisplay,
  type ColumnConfig
} from '../src/shared/boardModel'

// Both column components are memoised, and both comparators listed the fields
// they cared about by hand. Neither listed cardDisplay, so the Card Fields
// toggles updated their own checkboxes and nothing else: the board never
// re-rendered. collapsed, sort and description were missed the same way.

const column = (over: Partial<ColumnConfig> = {}): ColumnConfig => ({
  id: 'todo', name: 'To Do', wipLimit: null, ...over
})
const display = (over: Partial<CardDisplay> = {}): CardDisplay => ({
  ...DEFAULT_CARD_DISPLAY, ...over
})

describe('sameCardDisplay', () => {
  it('is true for the same switches', () => {
    expect(sameCardDisplay(display(), display())).toBe(true)
  })

  for (const key of Object.keys(DEFAULT_CARD_DISPLAY) as (keyof CardDisplay)[]) {
    it(`notices ${key} being switched off`, () => {
      expect(sameCardDisplay(display(), display({ [key]: false }))).toBe(false)
    })
  }

  it('covers every switch there is, including ones added later', () => {
    // Read off the defaults rather than written out, so a fifth toggle cannot
    // be added without this comparing it. That omission is the bug.
    const keys = Object.keys(DEFAULT_CARD_DISPLAY)
    expect(keys.length).toBeGreaterThan(0)
    for (const key of keys) {
      expect(sameCardDisplay(display(), { ...display(), [key]: false } as CardDisplay)).toBe(false)
    }
  })

  it('treats a missing value as the default', () => {
    expect(sameCardDisplay(undefined, DEFAULT_CARD_DISPLAY)).toBe(true)
    expect(sameCardDisplay(undefined, display({ tags: false }))).toBe(false)
  })
})

describe('sameColumnConfig', () => {
  it('is true for the same column', () => {
    expect(sameColumnConfig(column(), column())).toBe(true)
  })

  it('is true across a rebuilt object with the same values', () => {
    // Every config change rebuilds the array, so identity is never equal.
    expect(sameColumnConfig(column(), { ...column() })).toBe(true)
  })

  it('notices a rename, a WIP limit and a recolour', () => {
    expect(sameColumnConfig(column(), column({ name: 'Doing' }))).toBe(false)
    expect(sameColumnConfig(column(), column({ wipLimit: 3 }))).toBe(false)
    expect(sameColumnConfig(column(), column({ color: '#f00' }))).toBe(false)
    expect(sameColumnConfig(column(), column({ colorMode: 'full' }))).toBe(false)
  })

  it('notices the three that were being dropped', () => {
    expect(sameColumnConfig(column(), column({ collapsed: true }))).toBe(false)
    expect(sameColumnConfig(column(), column({ sort: 'priority' }))).toBe(false)
    expect(sameColumnConfig(column(), column({ description: 'ready to ship' }))).toBe(false)
  })

  it('notices a field going away as well as arriving', () => {
    expect(sameColumnConfig(column({ collapsed: true }), column())).toBe(false)
  })

  it('reads undefined and absent as the same thing', () => {
    // JSON off disk gives one, a fresh object the other.
    expect(sameColumnConfig(column(), column({ description: undefined }))).toBe(true)
  })
})

// The loader listed the four original switches by hand, so four more added to
// the type would have been dropped on every read and the toggles would have
// looked broken again the moment the app restarted.
describe('normalizeBoardConfig, card display', () => {
  it('keeps every switch the type has, not just the ones someone remembered', () => {
    const keys = Object.keys(DEFAULT_CARD_DISPLAY)
    const allOff = Object.fromEntries(keys.map(k => [k, false]))
    const out = normalizeBoardConfig({ cardDisplay: allOff }).cardDisplay
    for (const key of keys) {
      expect(out[key as keyof CardDisplay], `${key} survived the round trip`).toBe(false)
    }
  })

  it('defaults a switch the stored document has never heard of', () => {
    // A board saved before these existed has four keys, not eight.
    const out = normalizeBoardConfig({ cardDisplay: { priority: false } }).cardDisplay
    expect(out.priority).toBe(false)
    expect(out.cover).toBe(true)
    expect(out.doneCheckbox).toBe(true)
  })

  it('reads the strings a legacy settings row stores', () => {
    const out = normalizeBoardConfig({ cardDisplay: { checklist: 'false', template: 'true' } }).cardDisplay
    expect(out.checklist).toBe(false)
    expect(out.template).toBe(true)
  })

  it('falls back rather than switching something off on nonsense', () => {
    const out = normalizeBoardConfig({ cardDisplay: { cover: 'maybe', tags: 7 } }).cardDisplay
    expect(out.cover).toBe(true)
    expect(out.tags).toBe(true)
  })
})
