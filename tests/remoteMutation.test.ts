import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  initDb, closeDb, getDb, createItem, getItemById, applyRemoteMutationTx
} from '../src/main/db'
import { normalizeRemoteMutation } from '../src/shared/collabProtocol'
import type { Item } from '../src/shared/types'

// a peer mutation against a real db, what actually lands

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'checkpoint-remote-'))
  initDb(dir)
})

afterEach(() => {
  closeDb()
  rmSync(dir, { recursive: true, force: true })
})

const seedCard = (over: Partial<Item> = {}): Item =>
  createItem(getDb(), {
    type: 'card', context: 'work', title: 'A card', body: '',
    status: 'todo', priority: 1, position: 1000, due_at: null, metadata: '{}',
    ...over
  })

/** validated then applied, like a real message */
const apply = (raw: unknown): void => {
  const mutation = normalizeRemoteMutation(raw)
  if (mutation) applyRemoteMutationTx(mutation)
}

describe('a bulk edit arriving from a peer', () => {
  it('applies the payload the app actually broadcasts', () => {
    // regression: { updates } was declared but { ids, patch } sent, so shared bulk edits threw
    const a = seedCard()
    const b = seedCard()

    apply({ type: 'bulkUpdateItems', payload: { ids: [a.id, b.id], patch: { status: 'done' } } })

    expect(getItemById(a.id)?.status).toBe('done')
    expect(getItemById(b.id)?.status).toBe('done')
  })

  it('sets priority and workspace as well as status', () => {
    const card = seedCard()
    apply({ type: 'bulkUpdateItems', payload: { ids: [card.id], patch: { priority: 3, context: 'other' } } })

    const after = getItemById(card.id)
    expect(after?.priority).toBe(3)
    expect(after?.context).toBe('other')
  })

  it('leaves the fields the patch did not name alone', () => {
    // a fixed SET clause would null positions on a bulk status change
    const card = seedCard({ title: 'Keep me', position: 4200 })
    apply({ type: 'bulkUpdateItems', payload: { ids: [card.id], patch: { status: 'done' } } })

    const after = getItemById(card.id)
    expect(after?.title).toBe('Keep me')
    expect(after?.position).toBe(4200)
    expect(after?.priority).toBe(1)
  })

  it('touches nothing when the patch has nothing to set', () => {
    const card = seedCard()
    apply({ type: 'bulkUpdateItems', payload: { ids: [card.id], patch: {} } })
    expect(getItemById(card.id)?.status).toBe('todo')
  })
})

describe('the other mutations a peer sends', () => {
  it('creates and updates an item', () => {
    const card = seedCard()
    apply({ type: 'updateItem', item: { ...card, title: 'Renamed' } })
    expect(getItemById(card.id)?.title).toBe('Renamed')
  })

  it('deletes one', () => {
    const card = seedCard()
    apply({ type: 'deleteItem', id: card.id })
    expect(getItemById(card.id)).toBeFalsy()
  })

  it('deletes several', () => {
    const a = seedCard()
    const b = seedCard()
    apply({ type: 'bulkDeleteItems', ids: [a.id, b.id] })
    expect(getItemById(a.id)).toBeFalsy()
    expect(getItemById(b.id)).toBeFalsy()
  })
})

describe('what the validator keeps out of the database', () => {
  it('writes nothing for a mutation with no target', () => {
    const card = seedCard()
    // this used to reach DELETE with undefined
    apply({ type: 'deleteItem' })
    expect(getItemById(card.id)).toBeTruthy()
  })

  it('writes nothing for an item that is missing its identity', () => {
    apply({ type: 'createItem', item: { id: 'ghost', title: 'No context or type' } })
    expect(getItemById('ghost')).toBeFalsy()
  })

  it('writes nothing for a kind this build does not have', () => {
    const card = seedCard()
    apply({ type: 'truncateEverything', context: 'work' })
    expect(getItemById(card.id)).toBeTruthy()
  })

  it('stores metadata as text even when a peer sends an object', () => {
    const card = seedCard()
    apply({ type: 'updateItem', item: { ...card, metadata: { pinned: true } } })
    // not "[object Object]", which broke every reader
    expect(getItemById(card.id)?.metadata).toBe('{}')
  })
})
