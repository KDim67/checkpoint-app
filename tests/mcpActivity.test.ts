import { describe, it, expect } from 'vitest'
import {
  MCP_WRITE_TOOLS,
  isWriteTool,
  normalizeUndo,
  normalizeUndoAction,
  shorten
} from '../src/shared/mcpActivity'

describe('normalizeUndoAction', () => {
  it('accepts each supported action', () => {
    expect(normalizeUndoAction({ kind: 'delete_item', id: 'a' })).toEqual({ kind: 'delete_item', id: 'a' })
    expect(normalizeUndoAction({ kind: 'delete_tag', id: 't' })).toEqual({ kind: 'delete_tag', id: 't' })
    expect(normalizeUndoAction({ kind: 'delete_relation', id: 'r' })).toEqual({ kind: 'delete_relation', id: 'r' })
    expect(normalizeUndoAction({ kind: 'delete_note', title: 'N' })).toEqual({ kind: 'delete_note', title: 'N' })
    expect(normalizeUndoAction({ kind: 'restore_item', id: 'a', fields: { status: 'open' } }))
      .toEqual({ kind: 'restore_item', id: 'a', fields: { status: 'open' } })
    expect(normalizeUndoAction({ kind: 'board_ops', context: 'c', operations: [] }))
      .toEqual({ kind: 'board_ops', context: 'c', operations: [] })
  })

  it('treats an empty note body as legitimate but still demands a title', () => {
    expect(normalizeUndoAction({ kind: 'write_note', title: 'N' }))
      .toEqual({ kind: 'write_note', title: 'N', content: '' })
    expect(normalizeUndoAction({ kind: 'write_note', content: 'orphan' })).toBeNull()
  })

  it('rejects actions missing the field their replay depends on', () => {
    // would reach delete with an empty string
    expect(normalizeUndoAction({ kind: 'delete_item' })).toBeNull()
    expect(normalizeUndoAction({ kind: 'delete_item', id: '' })).toBeNull()
    expect(normalizeUndoAction({ kind: 'restore_item', id: 'a' })).toBeNull()
    expect(normalizeUndoAction({ kind: 'board_ops', context: 'c' })).toBeNull()
    expect(normalizeUndoAction({ kind: 'board_ops', operations: [] })).toBeNull()
  })

  it('rejects unknown kinds and non-objects', () => {
    expect(normalizeUndoAction({ kind: 'drop_database', id: 'x' })).toBeNull()
    expect(normalizeUndoAction(null)).toBeNull()
    expect(normalizeUndoAction('delete_item')).toBeNull()
    expect(normalizeUndoAction(5)).toBeNull()
  })
})

describe('normalizeUndo', () => {
  it('parses both an array and the JSON string it is stored as', () => {
    const actions = [{ kind: 'delete_item', id: 'a' }]
    expect(normalizeUndo(actions)).toHaveLength(1)
    expect(normalizeUndo(JSON.stringify(actions))).toHaveLength(1)
  })

  it('reads an absent or empty payload as not-undoable', () => {
    expect(normalizeUndo(null)).toBeNull()
    expect(normalizeUndo('')).toBeNull()
    expect(normalizeUndo('   ')).toBeNull()
    expect(normalizeUndo([])).toBeNull()
    expect(normalizeUndo('{not json')).toBeNull()
    expect(normalizeUndo({ kind: 'delete_item', id: 'a' })).toBeNull()
  })

  it('rejects the whole list when any single action is unusable', () => {
    // half a list leaves neither state
    const mixed = [{ kind: 'delete_item', id: 'a' }, { kind: 'delete_item' }]
    expect(normalizeUndo(mixed)).toBeNull()
  })

  it('preserves order, which matters when a rename deletes then restores', () => {
    const actions = [
      { kind: 'delete_note', title: 'New' },
      { kind: 'write_note', title: 'Old', content: 'body' }
    ]
    const out = normalizeUndo(actions)
    expect(out?.map(a => a.kind)).toEqual(['delete_note', 'write_note'])
  })
})

describe('isWriteTool', () => {
  it('recognises every write tool', () => {
    for (const tool of MCP_WRITE_TOOLS) expect(isWriteTool(tool)).toBe(true)
  })

  it('rejects read tools, which are never recorded', () => {
    for (const tool of ['get_board', 'search_items', 'list_notes', 'get_git_log']) {
      expect(isWriteTool(tool)).toBe(false)
    }
  })
})

describe('shorten', () => {
  it('leaves a short title alone', () => {
    expect(shorten('Fix the auth bug')).toBe('Fix the auth bug')
  })

  it('collapses whitespace so a multi-line title stays one line', () => {
    expect(shorten('Fix   the\n\nauth bug')).toBe('Fix the auth bug')
  })

  it('truncates with an ellipsis at the limit', () => {
    const out = shorten('x'.repeat(80), 20)
    expect(out).toHaveLength(20)
    expect(out.endsWith('…')).toBe(true)
  })
})
