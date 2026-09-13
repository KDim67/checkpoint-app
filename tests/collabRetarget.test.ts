import { describe, it, expect } from 'vitest'
import { normalizeCollabMessage, retargetMutation } from '../src/shared/collabProtocol'
import type { Item, Tag } from '../src/shared/types'

// copies hold the board under another slug, translated at the wire only

const item = (context: string): Item => ({
  id: 'i1', type: 'card', context, title: 'A card', body: '', status: 'open',
  priority: 2, position: 1, created_at: 1, updated_at: 1, due_at: null, metadata: '{}'
})
const tag: Tag = { id: 't1', name: 'bug', color: '#f00' }

describe('retargetMutation', () => {
  it('moves a created item to the target workspace', () => {
    const out = retargetMutation({ type: 'createItem', item: item('domimorfi') }, 'domimorfi-shared')
    expect(out).toMatchObject({ type: 'createItem', item: { context: 'domimorfi-shared' } })
  })

  it('moves an updated item too, and keeps its tags', () => {
    const out = retargetMutation(
      { type: 'updateItem', item: item('domimorfi'), tagIds: ['t1'] },
      'domimorfi-shared'
    )
    expect(out).toMatchObject({ item: { context: 'domimorfi-shared' }, tagIds: ['t1'] })
  })

  it('does not touch anything else on the item', () => {
    const before = item('domimorfi')
    const out = retargetMutation({ type: 'createItem', item: before }, 'copy')
    expect(out.type === 'createItem' && out.item).toMatchObject({
      id: 'i1', title: 'A card', priority: 2, position: 1
    })
  })

  it('leaves the original alone', () => {
    // the caller still holds it
    const original = item('domimorfi')
    retargetMutation({ type: 'createItem', item: original }, 'copy')
    expect(original.context).toBe('domimorfi')
  })

  it('hands back the very same object when it is already addressed right', () => {
    // identity, the host path never retargets
    const mutation = { type: 'createItem' as const, item: item('domimorfi') }
    expect(retargetMutation(mutation, 'domimorfi')).toBe(mutation)
  })

  it('retargets a position rebalance, which names the workspace directly', () => {
    const out = retargetMutation(
      { type: 'rebalancePositions', context: 'domimorfi', status: 'open' },
      'domimorfi-shared'
    )
    expect(out).toEqual({ type: 'rebalancePositions', context: 'domimorfi-shared', status: 'open' })
  })

  it('retargets a bulk edit that moves cards between workspaces', () => {
    // the missed carrier: untranslated it moves peer cards into this side's copy name
    const out = retargetMutation(
      { type: 'bulkUpdateItems', payload: { ids: ['i1', 'i2'], patch: { context: 'domimorfi-shared' } } },
      'domimorfi'
    )
    expect(out).toEqual({
      type: 'bulkUpdateItems',
      payload: { ids: ['i1', 'i2'], patch: { context: 'domimorfi' } }
    })
  })

  it('leaves a bulk edit that names no workspace exactly as it was', () => {
    const mutation = {
      type: 'bulkUpdateItems' as const,
      payload: { ids: ['i1'], patch: { status: 'done' } }
    }
    expect(retargetMutation(mutation, 'somewhere-else')).toBe(mutation)
  })

  for (const mutation of [
    { type: 'deleteItem' as const, id: 'i1' },
    { type: 'createTag' as const, tag },
    { type: 'updateTag' as const, tag },
    { type: 'deleteTag' as const, id: 't1' },
    { type: 'deleteRelation' as const, id: 'r1' },
    { type: 'bulkDeleteItems' as const, ids: ['i1', 'i2'] }
  ]) {
    it(`passes ${mutation.type} through untouched`, () => {
      // ids are shared, they resolve in either workspace
      expect(retargetMutation(mutation, 'somewhere-else')).toBe(mutation)
    })
  }
})

// statuses are column ids; without the host's columns cards render nowhere
describe('board-baseline board config', () => {
  const baseline = (over: Record<string, unknown> = {}): unknown => ({
    type: 'board-baseline',
    context: 'domimorfi',
    items: [],
    tags: [],
    itemTags: [],
    relations: [],
    mode: 'collaborative',
    ...over
  })

  it('carries the host columns through', () => {
    const msg = normalizeCollabMessage(baseline({
      board: { version: 1, columns: [{ id: 'triage', name: 'Triage', wipLimit: null }] }
    }))
    expect(msg?.type).toBe('board-baseline')
    if (msg?.type !== 'board-baseline') return
    expect(msg.board?.columns.map(c => c.id)).toEqual(['triage'])
  })

  it('leaves the board undefined when an older peer sent none', () => {
    // undefined, so "none sent" differs from "the default four"
    const msg = normalizeCollabMessage(baseline())
    if (msg?.type !== 'board-baseline') throw new Error('expected a baseline')
    expect(msg.board).toBeUndefined()
  })

  it('degrades a corrupt board rather than dropping the whole baseline', () => {
    const msg = normalizeCollabMessage(baseline({ board: 'not an object' }))
    if (msg?.type !== 'board-baseline') throw new Error('expected a baseline')
    expect(msg.board?.columns.length).toBeGreaterThan(0)
  })
})

// crashes send nothing, this means they chose to leave
describe('peer-leaving', () => {
  it('carries the name through', () => {
    const msg = normalizeCollabMessage({ type: 'peer-leaving', by: 'Dimitris' })
    expect(msg).toEqual({ type: 'peer-leaving', by: 'Dimitris' })
  })

  it('is still a valid goodbye with no name on it', () => {
    // the leaving matters, the name is decoration
    expect(normalizeCollabMessage({ type: 'peer-leaving' })).toEqual({ type: 'peer-leaving', by: '' })
    expect(normalizeCollabMessage({ type: 'peer-leaving', by: 42 })).toEqual({ type: 'peer-leaving', by: '' })
  })

  it('is dropped whole when the type is one this build does not know', () => {
    expect(normalizeCollabMessage({ type: 'peer-waving', by: 'Dimitris' })).toBeNull()
  })
})

// the host can't decide about a guest it can't name
describe('peer-hello', () => {
  it('carries the name through', () => {
    expect(normalizeCollabMessage({ type: 'peer-hello', by: 'Dim67' }))
      .toEqual({ type: 'peer-hello', by: 'Dim67' })
  })

  it('is still an introduction with no name on it', () => {
    // older builds say nothing, the host still has to see them
    expect(normalizeCollabMessage({ type: 'peer-hello' })).toEqual({ type: 'peer-hello', by: '' })
    expect(normalizeCollabMessage({ type: 'peer-hello', by: { name: 'x' } }))
      .toEqual({ type: 'peer-hello', by: '' })
  })
})

// being removed reads nothing like leaving
describe('peer-removed', () => {
  it('carries who did it', () => {
    expect(normalizeCollabMessage({ type: 'peer-removed', by: 'Dimitris' }))
      .toEqual({ type: 'peer-removed', by: 'Dimitris' })
  })

  it('still means removed with nobody named', () => {
    expect(normalizeCollabMessage({ type: 'peer-removed' })).toEqual({ type: 'peer-removed', by: '' })
  })
})

// offered, so it needs an answer path
describe('merge-proposal', () => {
  const proposal = {
    type: 'merge-proposal',
    by: 'Dim67',
    context: 'work',
    items: [],
    tags: [],
    itemTags: [],
    relations: [],
    board: { columns: [{ id: 'open', name: 'To Do', wipLimit: null }] }
  }

  it('carries the board through', () => {
    const msg = normalizeCollabMessage(proposal)
    if (msg?.type !== 'merge-proposal') throw new Error('expected a proposal')
    expect(msg.by).toBe('Dim67')
    expect(msg.context).toBe('work')
    expect(msg.board.columns.map(c => c.id)).toEqual(['open'])
  })

  // the named workspace is the one being overwritten
  it('refuses a proposal with no workspace on it', () => {
    expect(normalizeCollabMessage({ ...proposal, context: '' })).toBeNull()
    expect(normalizeCollabMessage({ ...proposal, context: null })).toBeNull()
  })

  it('drops a corrupt card rather than the whole merge', () => {
    const msg = normalizeCollabMessage({ ...proposal, items: [{ nonsense: true }] })
    if (msg?.type !== 'merge-proposal') throw new Error('expected a proposal')
    expect(msg.items).toEqual([])
  })
})

// told, not asked: they're live on the host's board
describe('board-reset', () => {
  const reset = {
    type: 'board-reset',
    by: 'Dim67',
    context: 'work',
    items: [],
    tags: [],
    itemTags: [],
    relations: [],
    board: { columns: [{ id: 'open', name: 'To Do', wipLimit: null }] }
  }

  it('carries the board through', () => {
    const msg = normalizeCollabMessage(reset)
    if (msg?.type !== 'board-reset') throw new Error('expected a reset')
    expect(msg.by).toBe('Dim67')
    expect(msg.context).toBe('work')
    expect(msg.board.columns.map(c => c.id)).toEqual(['open'])
  })

  it('refuses a reset with no workspace on it', () => {
    expect(normalizeCollabMessage({ ...reset, context: '' })).toBeNull()
    expect(normalizeCollabMessage({ ...reset, context: null })).toBeNull()
  })

  it('drops a corrupt card rather than the whole board', () => {
    const msg = normalizeCollabMessage({ ...reset, items: [{ nonsense: true }] })
    if (msg?.type !== 'board-reset') throw new Error('expected a reset')
    expect(msg.items).toEqual([])
  })
})

describe('merge-answer', () => {
  it('carries a yes and a no', () => {
    expect(normalizeCollabMessage({ type: 'merge-answer', accepted: true, by: 'Dimitris' }))
      .toEqual({ type: 'merge-answer', accepted: true, by: 'Dimitris', reason: '' })
    expect(normalizeCollabMessage({ type: 'merge-answer', accepted: false, by: '' }))
      .toEqual({ type: 'merge-answer', accepted: false, by: '', reason: '' })
  })

  // host said no vs nobody asked
  it('carries a reason when the app answered rather than a person', () => {
    expect(normalizeCollabMessage({
      type: 'merge-answer',
      accepted: false,
      by: 'Dimitris',
      reason: 'another merge was being decided'
    })).toMatchObject({ reason: 'another merge was being decided' })
  })

  // only an explicit yes
  it('reads anything but a real yes as a no', () => {
    for (const bad of [undefined, null, 'true', 1, {}]) {
      expect(normalizeCollabMessage({ type: 'merge-answer', accepted: bad }))
        .toMatchObject({ accepted: false })
    }
  })
})

// guests only know each other through the host
describe('roster', () => {
  it('carries the members through', () => {
    expect(normalizeCollabMessage({ type: 'roster', members: [{ id: 'p1', name: 'Dim67' }] }))
      .toEqual({ type: 'roster', members: [{ id: 'p1', name: 'Dim67' }] })
  })

  it('keeps a member who has not said their name', () => {
    expect(normalizeCollabMessage({ type: 'roster', members: [{ id: 'p1' }] }))
      .toEqual({ type: 'roster', members: [{ id: 'p1', name: '' }] })
  })

  it('drops a member with no id, and reads an empty room as empty', () => {
    expect(normalizeCollabMessage({ type: 'roster', members: [{ name: 'ghost' }] }))
      .toEqual({ type: 'roster', members: [] })
    expect(normalizeCollabMessage({ type: 'roster' })).toEqual({ type: 'roster', members: [] })
  })
})

// board config used to arrive once, so new columns stranded cards
describe('board-config', () => {
  it('carries the board through', () => {
    const msg = normalizeCollabMessage({
      type: 'board-config',
      context: 'work',
      board: { columns: [{ id: 'blocked', name: 'Blocked', wipLimit: null }] }
    })
    if (msg?.type !== 'board-config') throw new Error('expected a board-config')
    expect(msg.board.columns.map(c => c.id)).toEqual(['blocked'])
  })

  it('refuses one with no workspace on it', () => {
    expect(normalizeCollabMessage({ type: 'board-config', board: {} })).toBeNull()
  })

  it('degrades a board it cannot read to the defaults rather than refusing', () => {
    const msg = normalizeCollabMessage({ type: 'board-config', context: 'work', board: 'nonsense' })
    if (msg?.type !== 'board-config') throw new Error('expected a board-config')
    expect(msg.board.columns.length).toBeGreaterThan(0)
  })
})

describe('baseline tombstones', () => {
  const baseline = { type: 'board-baseline', context: 'work' }

  it('carries the deletions the sender remembers', () => {
    const msg = normalizeCollabMessage({
      ...baseline,
      tombstones: [{ id: 'c1', table_name: 'items', deleted_at: 5 }]
    })
    if (msg?.type !== 'board-baseline') throw new Error('expected a baseline')
    expect(msg.tombstones).toEqual([{ id: 'c1', table_name: 'items', deleted_at: 5 }])
  })

  // note tombstones hold filenames, which could shadow a card id
  it('keeps only the tables whose tombstone id is a row id', () => {
    const msg = normalizeCollabMessage({
      ...baseline,
      tombstones: [
        { id: 'n1', table_name: 'notes', deleted_at: 5 },
        { id: 't1', table_name: 'tags', deleted_at: 5 }
      ]
    })
    if (msg?.type !== 'board-baseline') throw new Error('expected a baseline')
    expect(msg.tombstones?.map(t => t.id)).toEqual(['t1'])
  })

  it('leaves them undefined when an older peer sends none', () => {
    const msg = normalizeCollabMessage(baseline)
    if (msg?.type !== 'board-baseline') throw new Error('expected a baseline')
    expect(msg.tombstones).toBeUndefined()
  })
})

// so a merge reads this pair's ancestor, not a same-named board's
describe('baseline install id', () => {
  const baseline = { type: 'board-baseline', context: 'work' }

  it('carries the host install through', () => {
    const msg = normalizeCollabMessage({ ...baseline, install: 'abc123de-9f8g7h6i5j' })
    if (msg?.type !== 'board-baseline') throw new Error('expected a baseline')
    expect(msg.install).toBe('abc123de-9f8g7h6i5j')
  })

  // both mean no peer, the ancestor keys on the name
  it('is empty from an older host and from one that will not read', () => {
    for (const raw of [baseline, { ...baseline, install: 'UPPER' }, { ...baseline, install: 42 }]) {
      const msg = normalizeCollabMessage(raw)
      if (msg?.type !== 'board-baseline') throw new Error('expected a baseline')
      expect(msg.install).toBe('')
    }
  })
})

describe('mode-change', () => {
  it('carries either mode through', () => {
    expect(normalizeCollabMessage({ type: 'mode-change', mode: 'readonly' }))
      .toEqual({ type: 'mode-change', mode: 'readonly' })
    expect(normalizeCollabMessage({ type: 'mode-change', mode: 'collaborative' }))
      .toEqual({ type: 'mode-change', mode: 'collaborative' })
  })

  // the one field refused, not defaulted: a garbled mode mustn't grant write access
  it('refuses a mode it cannot read rather than guessing at one', () => {
    for (const bad of [undefined, null, '', 'admin', 'Collaborative', 1, true, {}]) {
      expect(normalizeCollabMessage({ type: 'mode-change', mode: bad })).toBeNull()
    }
  })
})
