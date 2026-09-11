import { describe, it, expect } from 'vitest'
import { normalizeCollabMessage, retargetMutation } from '../src/shared/collabProtocol'
import type { Item, Tag } from '../src/shared/types'

// Joining a shared board as a copy holds it under a different slug from the
// host's. Both sides still have to agree which board a change is about, so the
// slug is translated at the wire and nowhere else.

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
    // The caller still holds it; a mutated argument would rewrite local state.
    const original = item('domimorfi')
    retargetMutation({ type: 'createItem', item: original }, 'copy')
    expect(original.context).toBe('domimorfi')
  })

  it('hands back the very same object when it is already addressed right', () => {
    // Identity, so the host path costs nothing: it never retargets anything.
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
    // The least obvious carrier of a workspace name, and the one that was
    // missed: sent untranslated it moves the peer's cards into a workspace
    // named after this side's copy.
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
      // Addressed by id. Ids are shared across the baseline, so they resolve
      // in either workspace without a slug.
      expect(retargetMutation(mutation, 'somewhere-else')).toBe(mutation)
    })
  }
})

// A card's status is a column id. Without the host's columns, every card in a
// column the host renamed or added renders in no column at all.
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
    // Undefined, not a default board: the joiner has to be able to tell "no
    // columns were sent" from "the host really does have the default four",
    // and keep its own in the first case.
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
