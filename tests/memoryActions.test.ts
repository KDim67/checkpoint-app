import { describe, it, expect } from 'vitest'
import { normalizeMemoryAction, normalizeMemoryActions } from '../src/shared/memoryActions'

// These actions delete and rewrite rows in the memory store, and they come out
// of a language model. What survives normalisation is what gets to touch the
// database.

describe('an action the model returned', () => {
  it('keeps a well-formed save', () => {
    expect(normalizeMemoryAction({
      action: 'save', category: 'semantic', memory_key: 'Likes Tea', content: 'prefers tea'
    })).toEqual({ action: 'save', memory_key: 'likes tea', category: 'semantic', content: 'prefers tea' })
  })

  it('keeps a delete, which needs no content', () => {
    expect(normalizeMemoryAction({ action: 'delete', memory_key: 'stale' }))
      .toEqual({ action: 'delete', memory_key: 'stale' })
  })

  it('drops an action nobody recognises', () => {
    // A hallucinated verb must not fall through to a branch by accident.
    expect(normalizeMemoryAction({ action: 'drop_table', memory_key: 'x' })).toBeNull()
    expect(normalizeMemoryAction({ action: '', memory_key: 'x' })).toBeNull()
  })

  it('drops a delete with no key, which would otherwise throw mid-loop', () => {
    expect(normalizeMemoryAction({ action: 'delete' })).toBeNull()
    expect(normalizeMemoryAction({ action: 'delete', memory_key: '   ' })).toBeNull()
  })

  it('drops a save with nothing to save', () => {
    // Saving an empty string would blank a memory rather than write one.
    expect(normalizeMemoryAction({ action: 'save', memory_key: 'k' })).toBeNull()
    expect(normalizeMemoryAction({ action: 'save', memory_key: 'k', content: '   ' })).toBeNull()
    expect(normalizeMemoryAction({ action: 'update', memory_key: 'k', content: '' })).toBeNull()
  })

  it('drops a category it does not have rather than storing it', () => {
    const action = normalizeMemoryAction({
      action: 'save', memory_key: 'k', content: 'c', category: 'whatever'
    })
    expect(action?.category).toBeUndefined()
  })

  it('caps a key and its content instead of trusting their length', () => {
    const action = normalizeMemoryAction({
      action: 'save', memory_key: 'k'.repeat(500), content: 'c'.repeat(9000)
    })!
    expect(action.memory_key).toHaveLength(120)
    expect(action.content).toHaveLength(2000)
  })

  it('refuses anything that is not an object', () => {
    for (const raw of [null, undefined, 'delete everything', 42, [], true]) {
      expect(normalizeMemoryAction(raw)).toBeNull()
    }
  })
})

describe('a whole reply from the model', () => {
  it('keeps the good entries and drops the rest, in order', () => {
    const actions = normalizeMemoryActions([
      { action: 'save', memory_key: 'a', content: 'one' },
      'not an object',
      { action: 'nonsense', memory_key: 'b' },
      { action: 'delete', memory_key: 'c' }
    ])
    expect(actions.map(a => a.memory_key)).toEqual(['a', 'c'])
  })

  it('is empty for a reply that is not a list at all', () => {
    expect(normalizeMemoryActions({ action: 'save' })).toEqual([])
    expect(normalizeMemoryActions('sorry, I cannot help with that')).toEqual([])
    expect(normalizeMemoryActions(null)).toEqual([])
  })

  it('is empty rather than throwing on a list of rubbish', () => {
    expect(normalizeMemoryActions([null, 1, [], {}])).toEqual([])
  })
})
