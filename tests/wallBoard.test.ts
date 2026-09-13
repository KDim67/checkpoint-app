import { describe, it, expect } from 'vitest'
import {
  appendPosition,
  cardMatches,
  decodeWallDrag,
  encodeWallDrag,
  filterGroups,
  groupCardsByColumn,
  planHandoff,
  ORPHAN_COLUMN_ID,
  WALL_DRAG_MIME
} from '../src/shared/wallBoard'
import type { Item } from '../src/shared/types'
import type { ColumnConfig } from '../src/shared/boardModel'

const col = (id: string, name = id): ColumnConfig => ({ id, name, wipLimit: null })

const card = (over: Partial<Item> = {}): Item => ({
  id: 'c1',
  type: 'card',
  context: 'work',
  title: 'A card',
  body: '',
  status: 'todo',
  priority: 1,
  position: 1000,
  created_at: 0,
  updated_at: 0,
  due_at: null,
  metadata: '',
  ...over
})

describe('the drag payload', () => {
  it('uses a type of its own, so foreign drops cannot look like cards', () => {
    expect(WALL_DRAG_MIME).toBe('application/x-checkpoint-wall-item')
  })

  it('survives a round trip', () => {
    expect(decodeWallDrag(encodeWallDrag({ kind: 'card', ref: 'abc' }))).toEqual({ kind: 'card', ref: 'abc' })
    expect(decodeWallDrag(encodeWallDrag({ kind: 'doc', ref: 'Ideas' }))).toEqual({ kind: 'doc', ref: 'Ideas' })
  })

  it('refuses anything it did not write', () => {
    // the source may not be this app
    expect(decodeWallDrag(null)).toBeNull()
    expect(decodeWallDrag('')).toBeNull()
    expect(decodeWallDrag('not json')).toBeNull()
    expect(decodeWallDrag('[]')).toBeNull()
    expect(decodeWallDrag('"a string"')).toBeNull()
    expect(decodeWallDrag('{"kind":"image","ref":"x"}')).toBeNull()
    expect(decodeWallDrag('{"kind":"card"}')).toBeNull()
    expect(decodeWallDrag('{"kind":"card","ref":"   "}')).toBeNull()
    expect(decodeWallDrag('{"ref":"abc"}')).toBeNull()
  })

  it('trims a reference rather than placing an item that resolves to nothing', () => {
    expect(decodeWallDrag('{"kind":"card","ref":"  abc  "}')).toEqual({ kind: 'card', ref: 'abc' })
  })
})

describe('grouping cards into columns', () => {
  const columns = [col('todo', 'To do'), col('doing', 'Doing'), col('done', 'Done')]

  it('follows column order, not card order', () => {
    const groups = groupCardsByColumn([card({ id: 'a', status: 'done' })], columns)
    expect(groups.map(g => g.column.id)).toEqual(['todo', 'doing', 'done'])
  })

  it('sorts a column by position, the way the board does', () => {
    const cards = [
      card({ id: 'b', position: 3000 }),
      card({ id: 'a', position: 1000 }),
      card({ id: 'c', position: 2000 })
    ]
    expect(groupCardsByColumn(cards, columns)[0].cards.map(c => c.id)).toEqual(['a', 'c', 'b'])
  })

  it('leaves archived cards out', () => {
    const groups = groupCardsByColumn([card({ id: 'a', status: 'archived' })], columns)
    expect(groups.flatMap(g => g.cards)).toEqual([])
  })

  it('keeps a column with nothing in it, so the board still reads as the board', () => {
    expect(groupCardsByColumn([], columns)).toHaveLength(3)
  })

  it('shows cards whose column was deleted rather than dropping them', () => {
    // invisible on the board, the rail is the only place
    const groups = groupCardsByColumn([card({ id: 'a', status: 'gone-column' })], columns)
    const orphans = groups.find(g => g.column.id === ORPHAN_COLUMN_ID)
    expect(orphans?.cards.map(c => c.id)).toEqual(['a'])
  })

  it('gathers orphans from several vanished columns into one group, in position order', () => {
    const cards = [
      card({ id: 'a', status: 'gone-a', position: 2000 }),
      card({ id: 'b', status: 'gone-b', position: 1000 })
    ]
    const groups = groupCardsByColumn(cards, columns)
    expect(groups.filter(g => g.column.id === ORPHAN_COLUMN_ID)).toHaveLength(1)
    expect(groups[groups.length - 1].cards.map(c => c.id)).toEqual(['b', 'a'])
  })

  it('adds no orphan group when every card has a column', () => {
    const groups = groupCardsByColumn([card({ id: 'a', status: 'todo' })], columns)
    expect(groups.some(g => g.column.id === ORPHAN_COLUMN_ID)).toBe(false)
  })
})

describe('filtering', () => {
  const columns = [col('todo'), col('done')]

  it('matches on the title, and on a tag name', () => {
    const tagged = card({ tags: [{ id: 't', name: 'urgent', color: '#fff' }] })
    expect(cardMatches(tagged, ['urgent'])).toBe(true)
    expect(cardMatches(tagged, ['a', 'card'])).toBe(true)
    expect(cardMatches(tagged, ['a', 'missing'])).toBe(false)
  })

  it('wants every word, not any of them', () => {
    expect(cardMatches(card({ title: 'Fix the login bug' }), ['login', 'bug'])).toBe(true)
    expect(cardMatches(card({ title: 'Fix the login bug' }), ['login', 'crash'])).toBe(false)
  })

  it('leaves the groups alone when nothing was typed', () => {
    const groups = groupCardsByColumn([card()], columns)
    expect(filterGroups(groups, '   ')).toBe(groups)
  })

  it('drops the columns a query empties, since an empty column is not structure', () => {
    const groups = groupCardsByColumn(
      [card({ id: 'a', title: 'Ship it', status: 'todo' }), card({ id: 'b', title: 'Other', status: 'done' })],
      columns
    )
    const filtered = filterGroups(groups, 'ship')
    expect(filtered).toHaveLength(1)
    expect(filtered[0].cards.map(c => c.id)).toEqual(['a'])
  })
})

describe('handing a card back to a column', () => {
  it('lands at the end, which is where the board puts the same gesture', () => {
    expect(appendPosition([])).toBe(1000)
    expect(appendPosition([card({ position: 1000 }), card({ position: 5000 })])).toBe(6000)
  })

  it('is not confused by a column that is out of order', () => {
    // the last element would give 2000, landing mid-column
    expect(appendPosition([card({ position: 9000 }), card({ position: 2000 })])).toBe(10000)
  })

  it('moves a card to the dropped-on column', () => {
    const cards = [card({ id: 'a', status: 'todo' }), card({ id: 'b', status: 'done', position: 4000 })]
    expect(planHandoff(['a'], 'done', cards)).toEqual([{ id: 'a', status: 'done', position: 5000 }])
  })

  it('skips a card that is already there, rather than counting a move that did not happen', () => {
    const cards = [card({ id: 'a', status: 'done' })]
    expect(planHandoff(['a'], 'done', cards)).toEqual([])
  })

  it('ignores references to things that are not cards on this board', () => {
    expect(planHandoff(['ghost'], 'done', [card({ id: 'a' })])).toEqual([])
  })

  it('spaces a multi-card hand-off so the order it was picked up in survives', () => {
    const cards = [
      card({ id: 'a', status: 'todo' }),
      card({ id: 'b', status: 'todo' }),
      card({ id: 'c', status: 'done', position: 1000 })
    ]
    expect(planHandoff(['a', 'b'], 'done', cards)).toEqual([
      { id: 'a', status: 'done', position: 2000 },
      { id: 'b', status: 'done', position: 3000 }
    ])
  })

  it('places the first of a hand-off after everything already in the column', () => {
    const cards = [card({ id: 'a', status: 'todo' }), card({ id: 'b', status: 'done', position: 7000 })]
    expect(planHandoff(['a'], 'done', cards)[0].position).toBeGreaterThan(7000)
  })
})
