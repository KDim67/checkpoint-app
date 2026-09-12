import { describe, it, expect } from 'vitest'
import {
  normalizeCollabMessage,
  normalizeRemoteMutation,
  normalizeSyncItem,
  normalizeSyncRelation,
  normalizeSyncTag
} from '../src/shared/collabProtocol'
import type { Item } from '../src/shared/types'

// Two things have to hold at once: a genuine peer's messages survive unchanged,
// and nothing that would corrupt a row gets through.

const item = (over: Partial<Item> = {}): Item => ({
  id: 'i1',
  type: 'card',
  context: 'work',
  title: 'A card',
  body: 'Body',
  status: 'doing',
  priority: 2,
  position: 1000,
  created_at: 1700000000000,
  updated_at: 1700000000001,
  due_at: null,
  metadata: '{}',
  ...over
})

describe('an item off the wire', () => {
  it('passes a genuine one through unchanged', () => {
    // The half that matters most: this runs on every mutation of a live
    // session, so anything it alters, it alters for real users.
    expect(normalizeSyncItem(item())).toEqual(item())
  })

  it('keeps a due date and real metadata', () => {
    const withDue = item({ due_at: 1800000000000, metadata: '{"pinned":true}' })
    expect(normalizeSyncItem(withDue)).toEqual(withDue)
  })

  it('refuses one with no id, workspace or kind', () => {
    // Each of these decides which row is replaced and where it lands, so a
    // wrong one overwrites something unrelated to the message.
    expect(normalizeSyncItem({ ...item(), id: '' })).toBeNull()
    expect(normalizeSyncItem({ ...item(), id: '   ' })).toBeNull()
    expect(normalizeSyncItem({ ...item(), context: undefined })).toBeNull()
    expect(normalizeSyncItem({ ...item(), type: 'spaceship' })).toBeNull()
  })

  it('refuses one whose position or timestamps are not numbers', () => {
    expect(normalizeSyncItem({ ...item(), position: '1000' })).toBeNull()
    expect(normalizeSyncItem({ ...item(), position: NaN })).toBeNull()
    expect(normalizeSyncItem({ ...item(), created_at: null })).toBeNull()
    expect(normalizeSyncItem({ ...item(), updated_at: 'yesterday' })).toBeNull()
  })

  it('refuses anything that is not an object at all', () => {
    for (const bad of [null, undefined, 'a string', 42, [], [item()]]) {
      expect(normalizeSyncItem(bad)).toBeNull()
    }
  })

  it('defaults the parts that are only decoration', () => {
    const sparse = normalizeSyncItem({ ...item(), title: undefined, body: null, status: 7 })
    expect(sparse).toMatchObject({ title: '', body: '', status: '' })
  })

  it('clamps a priority outside the range the column allows', () => {
    expect(normalizeSyncItem({ ...item(), priority: 99 })?.priority).toBe(0)
    expect(normalizeSyncItem({ ...item(), priority: -1 })?.priority).toBe(0)
    expect(normalizeSyncItem({ ...item(), priority: 'high' })?.priority).toBe(0)
    expect(normalizeSyncItem({ ...item(), priority: 3 })?.priority).toBe(3)
  })

  it('replaces metadata that is not a string', () => {
    // The column holds JSON text. An object written straight in becomes
    // "[object Object]" and breaks every reader of it.
    expect(normalizeSyncItem({ ...item(), metadata: { pinned: true } })?.metadata).toBe('{}')
  })

  it('treats a non-numeric due date as no due date', () => {
    expect(normalizeSyncItem({ ...item(), due_at: 'soon' })?.due_at).toBeNull()
  })
})

describe('a tag or relation off the wire', () => {
  it('passes genuine ones through', () => {
    const tag = { id: 't1', name: 'urgent', color: '#f00' }
    expect(normalizeSyncTag(tag)).toEqual(tag)

    const relation = { id: 'r1', from_id: 'a', to_id: 'b', type: 'blocks' as const }
    expect(normalizeSyncRelation(relation)).toEqual(relation)
  })

  it('refuses a relation whose kind is not one this build applies', () => {
    expect(normalizeSyncRelation({ id: 'r1', from_id: 'a', to_id: 'b', type: 'supersedes' })).toBeNull()
  })

  it('refuses a relation missing an end', () => {
    expect(normalizeSyncRelation({ id: 'r1', from_id: 'a', type: 'blocks' })).toBeNull()
  })

  it('lets a tag keep an empty name, which is only cosmetic', () => {
    expect(normalizeSyncTag({ id: 't1' })).toEqual({ id: 't1', name: '', color: '' })
  })
})

describe('a mutation off the wire', () => {
  it('passes each kind a peer actually sends', () => {
    expect(normalizeRemoteMutation({ type: 'createItem', item: item() })).toEqual({
      type: 'createItem', item: item()
    })
    expect(normalizeRemoteMutation({ type: 'deleteItem', id: 'i1' })).toEqual({ type: 'deleteItem', id: 'i1' })
    expect(normalizeRemoteMutation({ type: 'deleteTag', id: 't1' })).toEqual({ type: 'deleteTag', id: 't1' })
    expect(normalizeRemoteMutation({ type: 'bulkDeleteItems', ids: ['a', 'b'] })).toEqual({
      type: 'bulkDeleteItems', ids: ['a', 'b']
    })
    expect(normalizeRemoteMutation({ type: 'rebalancePositions', context: 'work', status: 'doing' })).toEqual({
      type: 'rebalancePositions', context: 'work', status: 'doing'
    })
  })

  it('tells absent tags from empty tags', () => {
    // Absent leaves the row's tags alone; empty clears them. Collapsing the two
    // turns an ordinary edit into a silent untagging.
    expect(normalizeRemoteMutation({ type: 'updateItem', item: item() })).not.toHaveProperty('tagIds')
    expect(normalizeRemoteMutation({ type: 'updateItem', item: item(), tagIds: [] })).toHaveProperty('tagIds', [])
    expect(normalizeRemoteMutation({ type: 'updateItem', item: item(), tagIds: ['t1'] }))
      .toHaveProperty('tagIds', ['t1'])
  })

  it('drops junk out of a tag list rather than the whole mutation', () => {
    expect(normalizeRemoteMutation({ type: 'createItem', item: item(), tagIds: ['t1', '', null, 7, 't2'] }))
      .toHaveProperty('tagIds', ['t1', 't2'])
  })

  it('refuses a create carrying an item that cannot be written', () => {
    expect(normalizeRemoteMutation({ type: 'createItem', item: { id: 'i1' } })).toBeNull()
    expect(normalizeRemoteMutation({ type: 'createItem' })).toBeNull()
  })

  it('refuses a delete with no target, which would be a DELETE with a null id', () => {
    expect(normalizeRemoteMutation({ type: 'deleteItem' })).toBeNull()
    expect(normalizeRemoteMutation({ type: 'deleteItem', id: '' })).toBeNull()
    expect(normalizeRemoteMutation({ type: 'deleteRelation', id: null })).toBeNull()
  })

  it('refuses an empty bulk delete rather than running a no-op transaction', () => {
    expect(normalizeRemoteMutation({ type: 'bulkDeleteItems', ids: [] })).toBeNull()
    expect(normalizeRemoteMutation({ type: 'bulkDeleteItems', ids: 'everything' })).toBeNull()
  })

  it('accepts the bulk payload the app actually broadcasts', () => {
    // The union used to declare `{ updates: [{ id, position, status }] }` here,
    // which nothing has ever sent. The receiving end read `payload.updates`,
    // got undefined and threw, so every bulk edit in a shared session failed on
    // the peer while succeeding locally.
    const payload = { ids: ['a', 'b'], patch: { status: 'done' } }
    expect(normalizeRemoteMutation({ type: 'bulkUpdateItems', payload }))
      .toEqual({ type: 'bulkUpdateItems', payload })
  })

  it('takes each of the three fields a bulk edit can set', () => {
    const got = normalizeRemoteMutation({
      type: 'bulkUpdateItems',
      payload: { ids: ['a'], patch: { status: 'done', priority: 3, context: 'work' } }
    })
    expect(got).toHaveProperty('payload.patch', { status: 'done', priority: 3, context: 'work' })
  })

  it('leaves out a patch field the local edit cannot set either', () => {
    const got = normalizeRemoteMutation({
      type: 'bulkUpdateItems',
      payload: { ids: ['a'], patch: { status: 'done', title: 'renamed', metadata: '{}' } }
    })
    expect(got).toHaveProperty('payload.patch', { status: 'done' })
  })

  it('refuses a bulk update with no rows or nothing to set', () => {
    // An empty patch means an UPDATE with an empty SET clause, which is a
    // syntax error rather than a no-op.
    expect(normalizeRemoteMutation({ type: 'bulkUpdateItems', payload: { ids: [], patch: { status: 'done' } } })).toBeNull()
    expect(normalizeRemoteMutation({ type: 'bulkUpdateItems', payload: { ids: ['a'], patch: {} } })).toBeNull()
    expect(normalizeRemoteMutation({ type: 'bulkUpdateItems', payload: { ids: ['a'] } })).toBeNull()
    expect(normalizeRemoteMutation({ type: 'bulkUpdateItems' })).toBeNull()
  })

  it('refuses a priority outside the range the column allows', () => {
    const got = normalizeRemoteMutation({
      type: 'bulkUpdateItems',
      payload: { ids: ['a'], patch: { priority: 9 } }
    })
    expect(got).toBeNull()
  })

  it('drops a kind it has never heard of instead of guessing', () => {
    expect(normalizeRemoteMutation({ type: 'dropDatabase' })).toBeNull()
    expect(normalizeRemoteMutation({ type: 'createItem ' })).toBeNull()
    expect(normalizeRemoteMutation(null)).toBeNull()
    expect(normalizeRemoteMutation('createItem')).toBeNull()
  })
})

describe('a message off the wire', () => {
  const baseline = {
    type: 'board-baseline',
    context: 'work',
    items: [item()],
    tags: [{ id: 't1', name: 'urgent', color: '#f00' }],
    itemTags: [{ item_id: 'i1', tag_id: 't1' }],
    relations: [{ id: 'r1', from_id: 'i1', to_id: 'i2', type: 'blocks' }],
    mode: 'collaborative'
  }

  it('passes a genuine baseline through', () => {
    // The install id is the host's, and a baseline without one reads as having
    // no peer to file the board under rather than as a bad message.
    expect(normalizeCollabMessage(baseline)).toEqual({ ...baseline, install: '' })
  })

  it('drops the rows it cannot write, keeping the board', () => {
    // One corrupt card should cost the user that card, not the board they are
    // in the middle of joining.
    const got = normalizeCollabMessage({
      ...baseline,
      items: [item(), { id: 'broken' }, null],
      relations: [{ id: 'r1', from_id: 'i1', to_id: 'i2', type: 'nonsense' }]
    })
    expect(got).toMatchObject({ type: 'board-baseline' })
    expect((got as { items: Item[] }).items).toHaveLength(1)
    expect((got as { relations: unknown[] }).relations).toHaveLength(0)
  })

  it('falls back to read-only when the mode is missing or unknown', () => {
    // Collaborative starts this end broadcasting its own writes back. Guessing
    // it is the wrong way to be wrong.
    expect(normalizeCollabMessage({ ...baseline, mode: undefined })).toMatchObject({ mode: 'readonly' })
    expect(normalizeCollabMessage({ ...baseline, mode: 'admin' })).toMatchObject({ mode: 'readonly' })
  })

  it('refuses a baseline with no workspace, which would wipe an unnamed one', () => {
    expect(normalizeCollabMessage({ ...baseline, context: '' })).toBeNull()
    expect(normalizeCollabMessage({ ...baseline, context: null })).toBeNull()
  })

  it('reads missing row arrays as empty rather than refusing the join', () => {
    const got = normalizeCollabMessage({ type: 'board-baseline', context: 'work' })
    expect(got).toEqual({
      type: 'board-baseline', context: 'work',
      items: [], tags: [], itemTags: [], relations: [], mode: 'readonly', install: ''
    })
  })

  it('carries a mutation through, and refuses one that is unusable', () => {
    expect(normalizeCollabMessage({ type: 'db-mutation-event', mutation: { type: 'deleteItem', id: 'i1' } }))
      .toEqual({ type: 'db-mutation-event', mutation: { type: 'deleteItem', id: 'i1' } })
    expect(normalizeCollabMessage({ type: 'db-mutation-event', mutation: { type: 'deleteItem' } })).toBeNull()
    expect(normalizeCollabMessage({ type: 'db-mutation-event' })).toBeNull()
  })

  it('refuses a message this build has no case for', () => {
    for (const bad of [{ type: 'take-over' }, {}, null, 'board-baseline', [], 42]) {
      expect(normalizeCollabMessage(bad)).toBeNull()
    }
  })
})
