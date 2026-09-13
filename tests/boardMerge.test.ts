import { describe, it, expect } from 'vitest'
import {
  columnMap,
  describeImpact,
  describeMerge,
  mergeBoards,
  mergeImpact,
  mergeColumns,
  mergeItem,
  mergeMetadata,
  poolEntries,
  type BoardSide
} from '../src/shared/boardMerge'
import { normalizeBoardConfig, type ColumnConfig } from '../src/shared/boardModel'
import type { Item } from '../src/shared/types'

const column = (id: string, name: string): ColumnConfig => ({ id, name, wipLimit: null })

const card = (over: Partial<Item> & { id: string }): Item => ({
  type: 'card',
  context: 'shared',
  title: 'Card',
  body: '',
  status: 'open',
  priority: 0,
  position: 1000,
  created_at: 100,
  updated_at: 100,
  due_at: null,
  metadata: '{}',
  ...over
})

const side = (over: Partial<BoardSide> = {}): BoardSide => ({
  context: 'shared',
  items: [],
  tags: [],
  itemTags: [],
  relations: [],
  board: normalizeBoardConfig({ columns: [column('open', 'To Do'), column('done', 'Done')] }),
  ...over
})

describe('columnMap', () => {
  it('translates nothing when both copies came from the same board', () => {
    const cols = [column('open', 'To Do'), column('done', 'Done')]
    expect(columnMap(cols, cols).size).toBe(0)
  })

  // separately built boards both have To Do; unpaired, every column doubles
  it('pairs a column of the same name carrying a different id', () => {
    const map = columnMap([column('open', 'To Do')], [column('col-todo-1', 'to do')])
    expect(map.get('col-todo-1')).toBe('open')
  })

  it('leaves a column this board has never heard of alone', () => {
    expect(columnMap([column('open', 'To Do')], [column('blocked', 'Blocked')].concat()).size).toBe(0)
  })

  it('keeps this board\'s name for a column both sides have by id', () => {
    const map = columnMap([column('open', 'Inbox')], [column('open', 'To Do')])
    expect(map.size).toBe(0)
  })

  it('pairs against the first of two columns sharing a name', () => {
    const mine = [column('open', 'To Do'), column('spare', 'To Do')]
    expect(columnMap(mine, [column('theirs', 'To Do')]).get('theirs')).toBe('open')
  })
})

describe('mergeColumns', () => {
  it('keeps this board\'s columns in this board\'s order', () => {
    const mine = [column('open', 'To Do'), column('done', 'Done')]
    const merged = mergeColumns(mine, [column('done', 'Done'), column('open', 'To Do')], new Map())
    expect(merged.map(c => c.id)).toEqual(['open', 'done'])
  })

  it('appends a column only they have', () => {
    const merged = mergeColumns([column('open', 'To Do')], [column('blocked', 'Blocked')], new Map())
    expect(merged.map(c => c.id)).toEqual(['open', 'blocked'])
  })

  it('does not append a column that was paired by name', () => {
    const map = new Map([['col-todo-1', 'open']])
    const merged = mergeColumns([column('open', 'To Do')], [column('col-todo-1', 'To Do')], map)
    expect(merged.map(c => c.id)).toEqual(['open'])
  })
})

describe('poolEntries', () => {
  it('keeps both sides of a list', () => {
    const older = [{ id: 'a', text: 'first' }]
    const newer = [{ id: 'b', text: 'second' }]
    expect(poolEntries(older, newer)).toEqual([{ id: 'a', text: 'first' }, { id: 'b', text: 'second' }])
  })

  it('takes the newer side\'s version of an entry both have', () => {
    const older = [{ id: 'a', done: false }]
    const newer = [{ id: 'a', done: true }]
    expect(poolEntries(older, newer)).toEqual([{ id: 'a', done: true }])
  })

  it('keeps the older side\'s order', () => {
    const older = [{ id: 'a' }, { id: 'b' }]
    const newer = [{ id: 'b' }, { id: 'c' }, { id: 'a' }]
    expect((poolEntries(older, newer) as { id: string }[]).map(e => e.id)).toEqual(['a', 'b', 'c'])
  })

  it('does not duplicate an entry with no id that both sides have', () => {
    const entry = { text: 'written before these carried ids' }
    expect(poolEntries([entry], [{ ...entry }])).toEqual([entry])
  })
})

describe('mergeMetadata', () => {
  it('pools the comments from both copies', () => {
    const older = JSON.stringify({ comments: [{ id: 'com-1', text: 'mine' }] })
    const newer = JSON.stringify({ comments: [{ id: 'com-2', text: 'theirs' }] })
    const out = JSON.parse(mergeMetadata(older, newer))
    expect(out.comments.map((c: { id: string }) => c.id)).toEqual(['com-1', 'com-2'])
  })

  it('pools the checklist and keeps a tick made on the newer side', () => {
    const older = JSON.stringify({ checklist: [{ id: 'chk-1', text: 'a', done: false }] })
    const newer = JSON.stringify({
      checklist: [{ id: 'chk-1', text: 'a', done: true }, { id: 'chk-2', text: 'b', done: false }]
    })
    const out = JSON.parse(mergeMetadata(older, newer))
    expect(out.checklist).toHaveLength(2)
    expect(out.checklist[0].done).toBe(true)
  })

  it('takes a single value from the newer side', () => {
    const out = JSON.parse(mergeMetadata(
      JSON.stringify({ cover: { type: 'color', value: '#f00' }, isTemplate: true }),
      JSON.stringify({ cover: { type: 'color', value: '#0f0' } })
    ))
    expect(out.cover.value).toBe('#0f0')
    // only the older side has it, so it survives
    expect(out.isTemplate).toBe(true)
  })

  it('survives metadata that will not parse', () => {
    expect(JSON.parse(mergeMetadata('not json', JSON.stringify({ isTemplate: true })))).toEqual({
      isTemplate: true
    })
    expect(JSON.parse(mergeMetadata('', ''))).toEqual({})
  })

  it('survives a list that is not a list', () => {
    const out = JSON.parse(mergeMetadata(
      JSON.stringify({ comments: [{ id: 'com-1' }] }),
      JSON.stringify({ comments: 'broken' })
    ))
    expect(out.comments).toBe('broken')
  })
})

describe('mergeItem', () => {
  it('takes every single value from the newer side', () => {
    const mine = card({ id: 'c1', title: 'Old', priority: 1, updated_at: 100 })
    const theirs = card({ id: 'c1', title: 'New', priority: 3, updated_at: 200 })
    const merged = mergeItem(mine, theirs)
    expect(merged.title).toBe('New')
    expect(merged.priority).toBe(3)
  })

  it('leaves this side alone when this side is the newer one', () => {
    const mine = card({ id: 'c1', title: 'Mine', updated_at: 300 })
    const theirs = card({ id: 'c1', title: 'Theirs', updated_at: 200 })
    expect(mergeItem(mine, theirs).title).toBe('Mine')
  })

  it('gives a tie to this side', () => {
    const mine = card({ id: 'c1', title: 'Mine', updated_at: 200 })
    const theirs = card({ id: 'c1', title: 'Theirs', updated_at: 200 })
    expect(mergeItem(mine, theirs).title).toBe('Mine')
  })

  it('keeps the earlier creation and the later edit', () => {
    const mine = card({ id: 'c1', created_at: 50, updated_at: 300 })
    const theirs = card({ id: 'c1', created_at: 10, updated_at: 200 })
    const merged = mergeItem(mine, theirs)
    expect(merged.created_at).toBe(10)
    expect(merged.updated_at).toBe(300)
  })

  // a comment on each side is two comments, the point of merging
  it('keeps a comment written on each side even though one card wins', () => {
    const mine = card({
      id: 'c1',
      updated_at: 100,
      metadata: JSON.stringify({ comments: [{ id: 'com-1', text: 'mine' }] })
    })
    const theirs = card({
      id: 'c1',
      updated_at: 200,
      metadata: JSON.stringify({ comments: [{ id: 'com-2', text: 'theirs' }] })
    })
    const out = JSON.parse(mergeItem(mine, theirs).metadata)
    expect(out.comments).toHaveLength(2)
  })

  // without an ancestor a no-op save beats a real rewrite; with one only double changes contest
  it('takes the side that changed it, whatever the stamps say', () => {
    const base = card({ id: 'c1', title: 'Base', updated_at: 100 })
    // saved later but unchanged since agreeing
    const mine = card({ id: 'c1', title: 'Base', updated_at: 900, metadata: '{}' })
    const theirs = card({ id: 'c1', title: 'Theirs wrote this', updated_at: 200 })
    expect(mergeItem(mine, theirs, { ...base, updated_at: 900 }).title).toBe('Theirs wrote this')
  })

  it('keeps this side when they are the ones who changed nothing', () => {
    const mine = card({ id: 'c1', title: 'Mine', updated_at: 200 })
    const theirs = card({ id: 'c1', title: 'Base', updated_at: 900, metadata: '{}' })
    expect(mergeItem(mine, theirs, { ...theirs }).title).toBe('Mine')
  })

  it('falls back to the later save when both sides changed it', () => {
    const base = card({ id: 'c1', title: 'Base', updated_at: 100 })
    const mine = card({ id: 'c1', title: 'Mine', updated_at: 200 })
    const theirs = card({ id: 'c1', title: 'Theirs', updated_at: 300 })
    expect(mergeItem(mine, theirs, base).title).toBe('Theirs')
  })

  it('never moves the card out of this workspace', () => {
    const mine = card({ id: 'c1', context: 'mine', updated_at: 100 })
    const theirs = card({ id: 'c1', context: 'theirs', updated_at: 900 })
    expect(mergeItem(mine, theirs).context).toBe('mine')
  })
})

describe('mergeBoards', () => {
  it('keeps a card only this side has', () => {
    const merged = mergeBoards(side({ items: [card({ id: 'c1' })] }), side())
    expect(merged.items.map(i => i.id)).toEqual(['c1'])
    expect(merged.summary.cardsAdded).toBe(0)
  })

  it('brings in a card only they have', () => {
    const merged = mergeBoards(side(), side({ items: [card({ id: 'c2' })] }))
    expect(merged.items.map(i => i.id)).toEqual(['c2'])
    expect(merged.summary.cardsAdded).toBe(1)
  })

  it('takes an incoming card into this workspace', () => {
    const theirs = side({ context: 'theirs', items: [card({ id: 'c2', context: 'theirs' })] })
    expect(mergeBoards(side(), theirs).items[0].context).toBe('shared')
  })

  it('counts a card their copy had edited more recently', () => {
    const merged = mergeBoards(
      side({ items: [card({ id: 'c1', title: 'Old', updated_at: 100 })] }),
      side({ items: [card({ id: 'c1', title: 'New', updated_at: 200 })] })
    )
    expect(merged.items).toHaveLength(1)
    expect(merged.items[0].title).toBe('New')
    expect(merged.summary.cardsUpdated).toBe(1)
  })

  it('does not count a card this side had edited more recently', () => {
    const merged = mergeBoards(
      side({ items: [card({ id: 'c1', updated_at: 300 })] }),
      side({ items: [card({ id: 'c1', updated_at: 200 })] })
    )
    expect(merged.summary.cardsUpdated).toBe(0)
  })

  // reviving every deleted card isn't a merge; the tombstone proves intent
  it('leaves a card deleted here deleted', () => {
    const merged = mergeBoards(
      side(),
      side({ items: [card({ id: 'c2' })] }),
      new Set(['c2'])
    )
    expect(merged.items).toHaveLength(0)
    expect(merged.summary.cardsLeftDeleted).toBe(1)
  })

  it('points an incoming card at this board\'s column of the same name', () => {
    const mine = side({ board: normalizeBoardConfig({ columns: [column('open', 'To Do')] }) })
    const theirs = side({
      board: normalizeBoardConfig({ columns: [column('col-todo-1', 'To Do')] }),
      items: [card({ id: 'c2', status: 'col-todo-1' })]
    })
    const merged = mergeBoards(mine, theirs)
    expect(merged.board.columns.map(c => c.id)).toEqual(['open'])
    expect(merged.items[0].status).toBe('open')
  })

  it('adds a column only they have, with its cards still pointing at it', () => {
    const theirs = side({
      board: normalizeBoardConfig({ columns: [column('open', 'To Do'), column('blocked', 'Blocked')] }),
      items: [card({ id: 'c2', status: 'blocked' })]
    })
    const merged = mergeBoards(side(), theirs)
    expect(merged.board.columns.map(c => c.id)).toEqual(['open', 'done', 'blocked'])
    expect(merged.items[0].status).toBe('blocked')
    expect(merged.summary.columnsAdded).toBe(1)
  })

  it('keeps this side\'s tag rather than renaming it to theirs', () => {
    const merged = mergeBoards(
      side({ tags: [{ id: 't1', name: 'Bug', color: '#f00' }] }),
      side({ tags: [{ id: 't1', name: 'Defect', color: '#0f0' }] })
    )
    expect(merged.tags).toEqual([{ id: 't1', name: 'Bug', color: '#f00' }])
    expect(merged.summary.tagsAdded).toBe(0)
  })

  it('brings in a tag only they have', () => {
    const merged = mergeBoards(side(), side({ tags: [{ id: 't2', name: 'Later', color: '#00f' }] }))
    expect(merged.tags.map(t => t.id)).toEqual(['t2'])
    expect(merged.summary.tagsAdded).toBe(1)
  })

  it('pools the tags on a card and drops a link to nothing', () => {
    const mine = side({
      items: [card({ id: 'c1' })],
      tags: [{ id: 't1', name: 'Bug', color: '#f00' }],
      itemTags: [{ item_id: 'c1', tag_id: 't1' }]
    })
    const theirs = side({
      items: [card({ id: 'c1' })],
      tags: [{ id: 't2', name: 'Later', color: '#00f' }],
      itemTags: [
        { item_id: 'c1', tag_id: 't2' },
        { item_id: 'c1', tag_id: 't1' },
        { item_id: 'gone', tag_id: 't2' }
      ]
    })
    const merged = mergeBoards(mine, theirs)
    expect(merged.itemTags).toEqual([
      { item_id: 'c1', tag_id: 't1' },
      { item_id: 'c1', tag_id: 't2' }
    ])
  })

  it('pools relations and drops one with neither end on the board', () => {
    const mine = side({
      items: [card({ id: 'c1' })],
      relations: [{ id: 'r1', from_id: 'c1', to_id: 'elsewhere', type: 'blocks' }]
    })
    const theirs = side({
      items: [card({ id: 'c1' })],
      relations: [
        { id: 'r1', from_id: 'c1', to_id: 'elsewhere', type: 'blocks' },
        { id: 'r2', from_id: 'nowhere', to_id: 'nothing', type: 'blocks' }
      ]
    })
    expect(mergeBoards(mine, theirs).relations.map(r => r.id)).toEqual(['r1'])
  })

  it('keeps this side\'s background, swimlanes and card face', () => {
    const mine = side({
      board: normalizeBoardConfig({
        columns: [column('open', 'To Do')],
        background: 'cosmic',
        swimlanes: true,
        cardDisplay: { tags: false }
      })
    })
    const theirs = side({
      board: normalizeBoardConfig({ columns: [column('open', 'To Do')], background: 'ruby' })
    })
    const merged = mergeBoards(mine, theirs)
    expect(merged.board.background).toBe('cosmic')
    expect(merged.board.swimlanes).toBe(true)
    expect(merged.board.cardDisplay.tags).toBe(false)
  })

  it('does not leave a column both archived and on the board', () => {
    const mine = side({
      board: normalizeBoardConfig({ columns: [column('open', 'To Do'), column('blocked', 'Blocked')] })
    })
    const theirs = side({
      board: normalizeBoardConfig({
        columns: [column('open', 'To Do')],
        archivedColumns: [column('blocked', 'Blocked')]
      })
    })
    const merged = mergeBoards(mine, theirs)
    expect(merged.board.columns.map(c => c.id)).toContain('blocked')
    expect(merged.board.archivedColumns).toEqual([])
  })

  it('changes nothing when both copies are already the same', () => {
    const one = side({ items: [card({ id: 'c1' })], tags: [{ id: 't1', name: 'Bug', color: '#f00' }] })
    const merged = mergeBoards(one, side({ ...one }))
    expect(merged.items.map(i => i.id)).toEqual(['c1'])
    expect(merged.summary).toEqual({
      columnsAdded: 0,
      cardsAdded: 0,
      cardsUpdated: 0,
      tagsAdded: 0,
      cardsLeftDeleted: 0,
      cardsTakenAway: 0
    })
  })

  // their deletions count now, baselines used to carry no tombstones
  it('takes away a card they deleted after this side last touched it', () => {
    const merged = mergeBoards(
      side({ items: [card({ id: 'c1', updated_at: 100 })] }),
      side(),
      new Set(),
      new Map([['c1', 200]])
    )
    expect(merged.items).toEqual([])
    expect(merged.summary.cardsTakenAway).toBe(1)
  })

  // silently undoing work done after someone else's delete is worse
  it('keeps a card they deleted before this side edited it', () => {
    const merged = mergeBoards(
      side({ items: [card({ id: 'c1', updated_at: 300 })] }),
      side(),
      new Set(),
      new Map([['c1', 200]])
    )
    expect(merged.items.map(i => i.id)).toEqual(['c1'])
    expect(merged.summary.cardsTakenAway).toBe(0)
  })

  it('does not touch the boards it was handed', () => {
    const mine = side({ items: [card({ id: 'c1', title: 'Mine', updated_at: 100 })] })
    const theirs = side({ items: [card({ id: 'c1', title: 'Theirs', updated_at: 200 })] })
    mergeBoards(mine, theirs)
    expect(mine.items[0].title).toBe('Mine')
    expect(mine.board.columns).toHaveLength(2)
  })
})

describe('mergeImpact', () => {
  it('counts what is new', () => {
    const impact = mergeImpact([card({ id: 'c1' })], [card({ id: 'c1' }), card({ id: 'c2' })])
    expect(impact).toEqual({ cardsAdded: 1, cardsChanged: 0, cardsReturning: 0, cardsRemoved: 0 })
  })

  it('counts a card that has moved on', () => {
    const impact = mergeImpact(
      [card({ id: 'c1', updated_at: 100 })],
      [card({ id: 'c1', updated_at: 200 })]
    )
    expect(impact.cardsChanged).toBe(1)
  })

  it('counts a card whose metadata grew even though the stamp did not', () => {
    // a pooled comment is a change the stamp alone would miss
    const impact = mergeImpact(
      [card({ id: 'c1', metadata: '{}' })],
      [card({ id: 'c1', metadata: JSON.stringify({ comments: [{ id: 'com-1' }] }) })]
    )
    expect(impact.cardsChanged).toBe(1)
  })

  it('says nothing changed when nothing did', () => {
    const one = card({ id: 'c1' })
    expect(mergeImpact([one], [{ ...one }]))
      .toEqual({ cardsAdded: 0, cardsChanged: 0, cardsReturning: 0, cardsRemoved: 0 })
  })

  // the one to warn about, it undoes something meant
  it('separates a card coming back from a card arriving', () => {
    const impact = mergeImpact([], [card({ id: 'c1' }), card({ id: 'c2' })], new Set(['c2']))
    expect(impact).toEqual({ cardsAdded: 1, cardsChanged: 0, cardsReturning: 1, cardsRemoved: 0 })
  })

  // missing from the proposal means deleted there; used to go uncounted
  it('counts a card of this side the proposal does not have', () => {
    const impact = mergeImpact([card({ id: 'c1' }), card({ id: 'c2' })], [card({ id: 'c1' })])
    expect(impact).toEqual({ cardsAdded: 0, cardsChanged: 0, cardsReturning: 0, cardsRemoved: 1 })
  })

  it('counts removals alongside everything else', () => {
    const impact = mergeImpact(
      [card({ id: 'c1' }), card({ id: 'gone' })],
      [card({ id: 'c1', updated_at: 9 }), card({ id: 'new' })]
    )
    expect(impact).toEqual({ cardsAdded: 1, cardsChanged: 1, cardsReturning: 0, cardsRemoved: 1 })
  })
})

describe('describeImpact', () => {
  const none = { cardsAdded: 0, cardsChanged: 0, cardsReturning: 0, cardsRemoved: 0 }

  it('says nothing when it would do nothing', () => {
    expect(describeImpact(none)).toBe(null)
  })

  it('counts in the singular and the plural', () => {
    expect(describeImpact({ ...none, cardsAdded: 1 })).toBe('1 card added')
    expect(describeImpact({ ...none, cardsAdded: 4, cardsChanged: 2, cardsReturning: 1 }))
      .toBe('4 cards added, 2 changed, 1 you had deleted put back')
  })

  it('says what would be taken away', () => {
    expect(describeImpact({ ...none, cardsRemoved: 2 })).toBe('2 of yours taken away')
    expect(describeImpact({ ...none, cardsAdded: 1, cardsRemoved: 1 }))
      .toBe('1 card added, 1 of yours taken away')
  })
})

describe('describeMerge', () => {
  const nothing = {
    columnsAdded: 0,
    cardsAdded: 0,
    cardsUpdated: 0,
    tagsAdded: 0,
    cardsLeftDeleted: 0,
    cardsTakenAway: 0
  }

  it('says nothing when nothing happened', () => {
    expect(describeMerge(nothing)).toBe(null)
  })

  it('counts in the singular', () => {
    expect(describeMerge({ ...nothing, cardsAdded: 1, columnsAdded: 1, tagsAdded: 1 }))
      .toBe('1 card added, 1 column added, 1 tag added')
  })

  it('counts in the plural', () => {
    expect(describeMerge({ ...nothing, cardsAdded: 4, cardsUpdated: 2 }))
      .toBe('4 cards added, 2 updated')
  })

  it('mentions both kinds of deletion it honoured', () => {
    expect(describeMerge({ ...nothing, cardsLeftDeleted: 3 }))
      .toBe('3 you had deleted not brought back')
    expect(describeMerge({ ...nothing, cardsTakenAway: 2 })).toBe('2 they had deleted removed')
  })
})
