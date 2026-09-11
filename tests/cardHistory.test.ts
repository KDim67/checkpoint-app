import { describe, it, expect } from 'vitest'
import {
  appendCardChanges,
  CARD_HISTORY_LIMIT,
  changeSentence,
  describeCardChanges,
  readCardHistory,
  visibleCardHistory,
  type CardChange
} from '../src/shared/cardHistory'
import type { CardSnapshot } from '../src/shared/cardDraft'
import { normalizeDisplayName, authorLabel, resolveAuthor, DISPLAY_NAME_MAX } from '../src/shared/identity'

const snap = (over: Partial<CardSnapshot> = {}): CardSnapshot => ({
  title: 'Design pass on the UI',
  body: 'Some notes.',
  priority: 2,
  status: 'in_review',
  due_at: null,
  metadata: '{}',
  tagIds: ['t1'],
  ...over
})

const NAMES: Record<string, string> = { in_review: 'In Review', done: 'Done', open: 'To Do' }
const columnName = (status: string): string => NAMES[status] ?? status

describe('describeCardChanges', () => {
  it('says nothing when nothing moved', () => {
    expect(describeCardChanges(snap(), snap(), columnName)).toEqual([])
  })

  it('names the column rather than printing its id', () => {
    // "moved to in_review" is not what anybody calls that column.
    expect(describeCardChanges(snap(), snap({ status: 'done' }), columnName))
      .toEqual(['Moved to Done'])
  })

  it('falls back to the id for a column that no longer exists', () => {
    expect(describeCardChanges(snap(), snap({ status: 'archive' }), columnName))
      .toEqual(['Moved to archive'])
  })

  it('reports a rename with the new name in it', () => {
    expect(describeCardChanges(snap(), snap({ title: 'Ship it' }), columnName))
      .toEqual(['Renamed the card to "Ship it"'])
  })

  it('ignores a rename that is only whitespace', () => {
    expect(describeCardChanges(snap(), snap({ title: '  Design pass on the UI ' }), columnName))
      .toEqual([])
  })

  it('tells writing a description from editing one', () => {
    expect(describeCardChanges(snap({ body: '' }), snap({ body: 'New' }), columnName))
      .toEqual(['Wrote the description'])
    expect(describeCardChanges(snap(), snap({ body: 'New' }), columnName))
      .toEqual(['Edited the description'])
  })

  it('names the priority instead of its number', () => {
    expect(describeCardChanges(snap(), snap({ priority: 3 }), columnName))
      .toEqual(['Set priority to High'])
    expect(describeCardChanges(snap(), snap({ priority: 0 }), columnName))
      .toEqual(['Set priority to None'])
  })

  it('separates setting a due date from clearing one', () => {
    const set = describeCardChanges(snap(), snap({ due_at: Date.UTC(2026, 8, 14, 12) }), columnName)
    expect(set[0]).toMatch(/^Set the due date to /)
    expect(describeCardChanges(snap({ due_at: 1 }), snap({ due_at: null }), columnName))
      .toEqual(['Cleared the due date'])
  })

  it('counts tags added and removed separately', () => {
    expect(describeCardChanges(snap(), snap({ tagIds: ['t1', 't2', 't3'] }), columnName))
      .toEqual(['Added 2 tags'])
    expect(describeCardChanges(snap(), snap({ tagIds: [] }), columnName))
      .toEqual(['Removed 1 tag'])
    expect(describeCardChanges(snap(), snap({ tagIds: ['t2'] }), columnName))
      .toEqual(['Added 1 tag', 'Removed 1 tag'])
  })

  it('reads the buffered half of metadata', () => {
    const before = snap({ metadata: '{}' })
    expect(describeCardChanges(before, snap({ metadata: '{"isTemplate":true}' }), columnName))
      .toEqual(['Made this a template'])
    expect(describeCardChanges(before, snap({ metadata: '{"cover":{"type":"color","value":"#f00"}}' }), columnName))
      .toEqual(['Set the cover colour to #f00'])
    expect(describeCardChanges(
      snap({ metadata: '{"cover":{"type":"color","value":"#f00"}}' }), before, columnName
    )).toEqual(['Removed the cover'])
  })

  it('ignores the half of metadata that saves as it happens', () => {
    // Comments, checklist items and attachments log themselves at the moment
    // they are written, so counting them here would record each one twice.
    const after = snap({ metadata: '{"comments":[{"id":"c1"}],"checklist":[{"id":"k1"}]}' })
    expect(describeCardChanges(snap(), after, columnName)).toEqual([])
  })

  it('survives metadata that is not JSON', () => {
    expect(describeCardChanges(snap({ metadata: 'not json' }), snap(), columnName)).toEqual([])
  })

  it('reports several changes from one save', () => {
    const changes = describeCardChanges(
      snap(), snap({ title: 'Ship it', status: 'done', priority: 3 }), columnName
    )
    expect(changes).toHaveLength(3)
  })
})

describe('appendCardChanges', () => {
  const now = 1_700_000_000_000

  it('puts the newest first', () => {
    const existing: CardChange[] = [{ id: 'old', at: 1, by: 'Kostas', what: 'Moved to Done' }]
    const next = appendCardChanges(existing, ['Renamed the card to "X"'], 'Dimitris', now)
    expect(next[0].what).toBe('Renamed the card to "X"')
    expect(next[1].id).toBe('old')
  })

  it('keeps only the last five', () => {
    const existing: CardChange[] = Array.from({ length: 5 }, (_, i) => (
      { id: `e${i}`, at: i, by: '', what: `Change ${i}` }
    ))
    const next = appendCardChanges(existing, ['Newest'], 'Dimitris', now)
    expect(next).toHaveLength(CARD_HISTORY_LIMIT)
    expect(next[0].what).toBe('Newest')
    expect(next.map(c => c.what)).not.toContain('Change 4')
  })

  it('caps even when one save produces more entries than the limit', () => {
    const phrases = ['a', 'b', 'c', 'd', 'e', 'f', 'g']
    expect(appendCardChanges([], phrases, 'Dimitris', now)).toHaveLength(CARD_HISTORY_LIMIT)
  })

  it('gives every entry from one save a distinct id', () => {
    // They share a millisecond, so the timestamp alone is not unique.
    const next = appendCardChanges([], ['a', 'b', 'c'], 'Dimitris', now)
    expect(new Set(next.map(c => c.id)).size).toBe(3)
  })

  it('hands back the same list when there is nothing to record', () => {
    const existing: CardChange[] = [{ id: 'e', at: 1, by: '', what: 'Change' }]
    expect(appendCardChanges(existing, [], 'Dimitris', now)).toBe(existing)
  })

  it('records an empty author rather than inventing one', () => {
    expect(appendCardChanges([], ['Change'], '   ', now)[0].by).toBe('')
  })
})

describe('readCardHistory', () => {
  it('reads nothing out of a card that has no history', () => {
    expect(readCardHistory(undefined)).toEqual([])
    expect(readCardHistory('nonsense')).toEqual([])
  })

  it('drops entries with nothing to say', () => {
    expect(readCardHistory([{ what: '' }, { what: 'Moved to Done' }])).toHaveLength(1)
  })

  it('fills in what a hand-edited row is missing', () => {
    const [entry] = readCardHistory([{ what: 'Moved to Done' }])
    expect(entry.by).toBe('')
    expect(entry.at).toBe(0)
    expect(entry.id).toBeTruthy()
  })

  it('keeps everything it can parse, so opening a card destroys nothing', () => {
    // It used to trim here, and the next comment wrote the trimmed list back:
    // opening a card built before the cap and then touching anything lost the
    // rest of its history.
    const raw = Array.from({ length: 20 }, (_, i) => ({ id: `e${i}`, at: i, by: '', what: `c${i}` }))
    expect(readCardHistory(raw)).toHaveLength(20)
  })

  it('shows only the newest five of them', () => {
    const raw = Array.from({ length: 20 }, (_, i) => ({ id: `e${i}`, at: i, by: '', what: `c${i}` }))
    const shown = visibleCardHistory(readCardHistory(raw))
    expect(shown).toHaveLength(CARD_HISTORY_LIMIT)
    expect(shown[0].what).toBe('c0')
  })

  it('reads entries written before this feature existed', () => {
    // Older cards store { text, createdAt } and no author. Throwing that away
    // on first open would lose history the user can still see today.
    const [entry] = readCardHistory([{ id: 'act-1', text: 'Added a comment', createdAt: 1234 }])
    expect(entry.what).toBe('Added a comment')
    expect(entry.at).toBe(1234)
    expect(entry.by).toBe('')
  })
})

describe('changeSentence', () => {
  it('leads with the name', () => {
    expect(changeSentence({ id: 'a', at: 0, by: 'Dimitris', what: 'Moved to Done' }))
      .toBe('Dimitris moved to Done')
  })

  it('stands alone when nobody is named', () => {
    expect(changeSentence({ id: 'a', at: 0, by: '', what: 'Moved to Done' }))
      .toBe('Moved to Done')
  })
})

describe('normalizeDisplayName', () => {
  it('collapses whitespace, because this is rendered inline', () => {
    expect(normalizeDisplayName('  Dimitris   K  ')).toBe('Dimitris K')
  })

  it('is empty for anything that is not a string', () => {
    expect(normalizeDisplayName(null)).toBe('')
    expect(normalizeDisplayName(42)).toBe('')
  })

  it('caps the length so one entry cannot swallow the panel', () => {
    expect(normalizeDisplayName('x'.repeat(100))).toHaveLength(DISPLAY_NAME_MAX)
  })

  it('falls back to something readable rather than to nothing', () => {
    expect(authorLabel('')).toBe('Someone')
    expect(authorLabel('Dimitris')).toBe('Dimitris')
  })
})

describe('resolveAuthor', () => {
  it('prefers the name that was typed', () => {
    expect(resolveAuthor('Dimitris', 'dimit')).toBe('Dimitris')
  })

  it('falls back to the account name when the field was left alone', () => {
    // Two people sharing a board and both credited to "Someone" is as useless
    // as no attribution at all.
    expect(resolveAuthor('', 'dimit')).toBe('dimit')
    expect(resolveAuthor('   ', 'dimit')).toBe('dimit')
    expect(resolveAuthor(null, 'dimit')).toBe('dimit')
  })

  it('is empty when there is no name anywhere', () => {
    // A locked-down account with no passwd entry. An entry with no author
    // still reads as a sentence, so this is not worth inventing a name for.
    expect(resolveAuthor('', '')).toBe('')
    expect(resolveAuthor(null, undefined)).toBe('')
  })

  it('normalises the account name the same way as a typed one', () => {
    expect(resolveAuthor('', '  dimit  ')).toBe('dimit')
    expect(resolveAuthor('', 'x'.repeat(100))).toHaveLength(DISPLAY_NAME_MAX)
  })
})
