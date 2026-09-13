import { describe, it, expect } from 'vitest'
import {
  interleave,
  mergeSearchHits,
  kindLabel,
  snippet,
  PER_SOURCE_LIMIT,
  type SearchHit
} from '../src/shared/searchResults'

const hit = (id: string, kind: SearchHit['kind'] = 'card'): SearchHit => ({ id, kind, title: id })

describe('interleave', () => {
  it('takes one from each group in turn', () => {
    expect(interleave([['a1', 'a2'], ['b1', 'b2']], 10)).toEqual(['a1', 'b1', 'a2', 'b2'])
  })

  it('keeps drawing from the survivors once a group runs dry', () => {
    // or a single-source search stops early
    expect(interleave([['a1'], ['b1', 'b2', 'b3']], 10)).toEqual(['a1', 'b1', 'b2', 'b3'])
  })

  it('ignores empty groups rather than leaving gaps', () => {
    expect(interleave([[], ['b1'], [], ['d1']], 10)).toEqual(['b1', 'd1'])
  })

  it('honours the limit', () => {
    expect(interleave([['a1', 'a2', 'a3'], ['b1', 'b2', 'b3']], 3)).toEqual(['a1', 'b1', 'a2'])
  })

  it('returns nothing for no groups, and terminates', () => {
    expect(interleave([], 10)).toEqual([])
    expect(interleave([[], []], 10)).toEqual([])
  })

  it('preserves each source order, which carries its own relevance', () => {
    const out = interleave([['a1', 'a2', 'a3']], 10)
    expect(out).toEqual(['a1', 'a2', 'a3'])
  })
})

describe('mergeSearchHits', () => {
  it('stops one source from crowding out the rest', () => {
    const many = Array.from({ length: 20 }, (_, i) => hit(`card-${i}`))
    const out = mergeSearchHits([many, [hit('note-1', 'note')]], 12)
    expect(out.filter(h => h.kind === 'card')).toHaveLength(PER_SOURCE_LIMIT)
    expect(out.some(h => h.id === 'note-1')).toBe(true)
  })

  it('puts the single note high enough to be seen', () => {
    const many = Array.from({ length: 20 }, (_, i) => hit(`card-${i}`))
    const out = mergeSearchHits([many, [hit('note-1', 'note')]], 12)
    expect(out.findIndex(h => h.id === 'note-1')).toBeLessThan(3)
  })

  it('drops a duplicate id rather than spending two slots on it', () => {
    const out = mergeSearchHits([[hit('same')], [hit('same')]], 12)
    expect(out).toHaveLength(1)
  })

  it('lets the first group claim a contested id', () => {
    const out = mergeSearchHits([[{ ...hit('same'), title: 'first' }], [{ ...hit('same'), title: 'second' }]], 12)
    expect(out[0].title).toBe('first')
  })

  it('honours the overall limit', () => {
    const a = Array.from({ length: 5 }, (_, i) => hit(`a-${i}`))
    const b = Array.from({ length: 5 }, (_, i) => hit(`b-${i}`, 'note'))
    expect(mergeSearchHits([a, b], 4)).toHaveLength(4)
  })

  it('returns nothing when every source is empty', () => {
    expect(mergeSearchHits([[], [], []], 12)).toEqual([])
  })
})

describe('snippet', () => {
  it('flattens the newlines a document match arrives with', () => {
    expect(snippet('line one\n\n  line   two')).toBe('line one line two')
  })

  it('truncates with an ellipsis at the limit', () => {
    const out = snippet('x'.repeat(200), 20)
    expect(out).toHaveLength(20)
    expect(out.endsWith('…')).toBe(true)
  })

  it('leaves a short snippet alone', () => {
    expect(snippet('short')).toBe('short')
  })
})

describe('kindLabel', () => {
  it('names every kind', () => {
    for (const kind of ['card', 'task', 'log', 'note', 'cheatsheet'] as const) {
      expect(kindLabel(kind)).toBeTruthy()
    }
  })
})
