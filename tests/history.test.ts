import { describe, it, expect } from 'vitest'
import {
  canRedo,
  canUndo,
  HISTORY_LIMIT,
  initHistory,
  pushHistory,
  redo,
  replacePresent,
  undo
} from '../src/shared/history'

describe('history', () => {
  it('starts with nothing to undo or redo', () => {
    const h = initHistory('a')
    expect(canUndo(h)).toBe(false)
    expect(canRedo(h)).toBe(false)
    expect(h.present).toBe('a')
  })

  it('steps back and forward through edits', () => {
    let h = initHistory('a')
    h = pushHistory(h, 'b')
    h = pushHistory(h, 'c')

    h = undo(h)
    expect(h.present).toBe('b')
    h = undo(h)
    expect(h.present).toBe('a')
    h = redo(h)
    expect(h.present).toBe('b')
  })

  it('does nothing at either end rather than throwing', () => {
    const h = initHistory('a')
    expect(undo(h)).toBe(h)
    expect(redo(h)).toBe(h)
  })

  it('discards the future when a new edit lands', () => {
    // Every tool the user has ever used behaves this way; branching would be
    // surprising rather than powerful.
    let h = initHistory('a')
    h = pushHistory(h, 'b')
    h = undo(h)
    h = pushHistory(h, 'c')
    expect(canRedo(h)).toBe(false)
    expect(h.present).toBe('c')
  })

  it('skips a no-op edit when told how to compare', () => {
    // Dragging an item and putting it back should not cost an undo step.
    let h = initHistory({ x: 1 })
    const same = { x: 1 }
    h = pushHistory(h, same, (a, b) => a.x === b.x)
    expect(canUndo(h)).toBe(false)
  })

  it('records an edit that only looks similar', () => {
    let h = initHistory({ x: 1 })
    h = pushHistory(h, { x: 2 }, (a, b) => a.x === b.x)
    expect(canUndo(h)).toBe(true)
  })

  it('caps the stack, since each state can hold a whole canvas', () => {
    let h = initHistory(0)
    for (let i = 1; i <= HISTORY_LIMIT + 20; i++) h = pushHistory(h, i)
    expect(h.past.length).toBe(HISTORY_LIMIT)
    // The oldest states are the ones dropped, so recent history survives.
    expect(h.past[h.past.length - 1]).toBe(HISTORY_LIMIT + 19)
  })

  it('replaces the present without making it undoable', () => {
    // A document arriving from disk is not something the user can "undo".
    let h = initHistory('a')
    h = replacePresent(h, 'from disk')
    expect(h.present).toBe('from disk')
    expect(canUndo(h)).toBe(false)
  })

  it('never mutates the history it was given', () => {
    const h = initHistory('a')
    const next = pushHistory(h, 'b')
    expect(h.present).toBe('a')
    expect(h.past).toEqual([])
    expect(next).not.toBe(h)
  })
})
