import { describe, it, expect } from 'vitest'
import { cardEdit, type CardSnapshot } from '../src/shared/cardDraft'

const snap = (over: Partial<CardSnapshot> = {}): CardSnapshot => ({
  title: 'Design pass on the UI',
  body: 'Some notes.',
  priority: 2,
  status: 'open',
  due_at: null,
  metadata: '{"checklist":[]}',
  tagIds: ['t1', 't2'],
  ...over
})

describe('cardEdit', () => {
  it('is not dirty when nothing moved', () => {
    const result = cardEdit(snap(), snap())
    expect(result.dirty).toBe(false)
    expect(result.patch).toEqual({})
    expect(result.tagIds).toBeUndefined()
  })

  it('sends only the fields that changed', () => {
    const result = cardEdit(snap(), snap({ priority: 4 }))
    expect(result.patch).toEqual({ priority: 4 })
    expect(result.dirty).toBe(true)
  })

  it('carries a cleared due date, which is a value and not an absence', () => {
    const result = cardEdit(snap({ due_at: 1_700_000_000_000 }), snap({ due_at: null }))
    expect(result.patch).toEqual({ due_at: null })
    expect(result.dirty).toBe(true)
  })

  it('trims the title', () => {
    expect(cardEdit(snap(), snap({ title: '  Renamed  ' })).patch).toEqual({ title: 'Renamed' })
  })

  it('does not count whitespace around an unchanged title as an edit', () => {
    expect(cardEdit(snap(), snap({ title: '  Design pass on the UI  ' })).dirty).toBe(false)
  })

  it('refuses to blank a title', () => {
    // Emptying the field and saving should leave the card named, not untitled.
    const result = cardEdit(snap(), snap({ title: '   ' }))
    expect(result.patch).toEqual({})
    expect(result.dirty).toBe(false)
  })

  it('allows an empty body, which is a real thing to want', () => {
    const result = cardEdit(snap(), snap({ body: '' }))
    expect(result.patch).toEqual({ body: '' })
    expect(result.dirty).toBe(true)
  })

  it('sends the tags only when they were touched', () => {
    expect(cardEdit(snap(), snap({ tagIds: ['t1'] })).tagIds).toEqual(['t1'])
    expect(cardEdit(snap(), snap()).tagIds).toBeUndefined()
  })

  it('reads a reordered tag list as no change', () => {
    // Passing tags rewrites the join table, so a false positive is a pointless write.
    const result = cardEdit(snap(), snap({ tagIds: ['t2', 't1'] }))
    expect(result.dirty).toBe(false)
    expect(result.tagIds).toBeUndefined()
  })

  it('notices every tag being removed', () => {
    const result = cardEdit(snap(), snap({ tagIds: [] }))
    expect(result.dirty).toBe(true)
    expect(result.tagIds).toEqual([])
  })

  it('notices a swap that keeps the count the same', () => {
    const result = cardEdit(snap(), snap({ tagIds: ['t1', 't3'] }))
    expect(result.dirty).toBe(true)
    expect(result.tagIds).toEqual(['t1', 't3'])
  })

  it('carries metadata, which holds the cover and the template flag', () => {
    const result = cardEdit(snap(), snap({ metadata: '{"isTemplate":true}' }))
    expect(result.patch).toEqual({ metadata: '{"isTemplate":true}' })
  })

  it('collects several changes into one write', () => {
    const result = cardEdit(snap(), snap({ title: 'New', status: 'done', tagIds: [] }))
    expect(result.patch).toEqual({ title: 'New', status: 'done' })
    expect(result.tagIds).toEqual([])
    expect(result.dirty).toBe(true)
  })
})
