import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  initDb,
  closeDb,
  getDb,
  createItem,
  getItemById,
  updateItem,
  createTag,
  getAllTags,
  getSetting,
  setSetting
} from '../src/main/db'
import { listMcpActivity, recordMcpActivity, undoMcpActivity } from '../src/main/mcpActivity'

// record, list and undo against a real db: wrong ids or double runs are the risk

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'checkpoint-mcp-'))
  initDb(dir)
})

afterEach(() => {
  closeDb()
  rmSync(dir, { recursive: true, force: true })
})

const card = (title: string, over: Record<string, unknown> = {}) =>
  createItem(getDb(), {
    type: 'card',
    context: 'test',
    title,
    body: '',
    status: 'open',
    priority: 2,
    position: 0,
    due_at: null,
    metadata: '{}',
    ...over
  } as Parameters<typeof createItem>[1])

describe('recording', () => {
  it('stores an entry that comes back parsed', () => {
    const item = card('Probe')
    recordMcpActivity('create_item', 'test', 'Created card "Probe"', [
      { kind: 'delete_item', id: item.id }
    ])

    const entries = listMcpActivity()
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      tool: 'create_item',
      context: 'test',
      summary: 'Created card "Probe"',
      undoneAt: null
    })
    expect(entries[0].undo).toEqual([{ kind: 'delete_item', id: item.id }])
  })

  it('records a null undo for a change that cannot be reversed', () => {
    recordMcpActivity('configure_board', 'test', 'Board changed', null)
    expect(listMcpActivity()[0].undo).toBeNull()
  })

  it('returns newest first', () => {
    recordMcpActivity('create_tag', null, 'first', null)
    recordMcpActivity('create_tag', null, 'second', null)
    expect(listMcpActivity().map(e => e.summary)).toEqual(['second', 'first'])
  })
})

describe('undoing', () => {
  it('deletes an item the agent created', () => {
    const item = card('Probe')
    recordMcpActivity('create_item', 'test', 'Created card "Probe"', [
      { kind: 'delete_item', id: item.id }
    ])

    const entry = listMcpActivity()[0]
    expect(undoMcpActivity(entry.id)).toEqual({ ok: true })
    expect(getItemById(item.id)).toBeNull()
  })

  it('restores the exact prior values an update overwrote', () => {
    const item = card('Before', { priority: 1, status: 'open' })
    recordMcpActivity('update_item', 'test', 'Updated', [
      { kind: 'restore_item', id: item.id, fields: { title: 'Before', priority: 1, status: 'open' } }
    ])
    updateItem(getDb(), item.id, { title: 'After', priority: 3, status: 'done' })

    expect(undoMcpActivity(listMcpActivity()[0].id)).toEqual({ ok: true })
    expect(getItemById(item.id)).toMatchObject({ title: 'Before', priority: 1, status: 'open' })
  })

  it('restores an archived item to the status it actually had', () => {
    const item = card('Archived one', { status: 'in_review' })
    recordMcpActivity('archive_item', 'test', 'Archived', [
      { kind: 'restore_item', id: item.id, fields: { status: 'in_review' } }
    ])
    updateItem(getDb(), item.id, { status: 'archived' })

    expect(undoMcpActivity(listMcpActivity()[0].id)).toEqual({ ok: true })
    expect(getItemById(item.id)?.status).toBe('in_review')
  })

  it('deletes a tag the agent created', () => {
    const tag = createTag({ name: 'agent-made', color: '#535e85' })
    recordMcpActivity('create_tag', null, 'Created tag', [{ kind: 'delete_tag', id: tag.id }])

    expect(undoMcpActivity(listMcpActivity()[0].id)).toEqual({ ok: true })
    expect(getAllTags().some(t => t.id === tag.id)).toBe(false)
  })

  it('marks the entry undone and strikes it from the list', () => {
    const item = card('Probe')
    recordMcpActivity('create_item', 'test', 'Created', [{ kind: 'delete_item', id: item.id }])
    undoMcpActivity(listMcpActivity()[0].id)

    expect(listMcpActivity()[0].undoneAt).toBeTypeOf('number')
  })
})

describe('undo refuses to run twice', () => {
  it('rejects a second undo rather than replaying the actions', () => {
    // replaying delete_item onto a reused id is the one that matters
    const item = card('Probe')
    recordMcpActivity('create_item', 'test', 'Created', [{ kind: 'delete_item', id: item.id }])
    const id = listMcpActivity()[0].id

    expect(undoMcpActivity(id)).toEqual({ ok: true })
    const second = undoMcpActivity(id)
    expect(second.ok).toBe(false)
    expect('reason' in second && second.reason).toMatch(/already undone/i)
  })

  it('refuses an entry that carries no undo payload', () => {
    recordMcpActivity('write_note', null, 'Wrote a note', null)
    const result = undoMcpActivity(listMcpActivity()[0].id)
    expect(result.ok).toBe(false)
    expect('reason' in result && result.reason).toMatch(/cannot be undone/i)
  })

  it('refuses an id that is not in the log', () => {
    const result = undoMcpActivity('no-such-entry')
    expect(result.ok).toBe(false)
    expect('reason' in result && result.reason).toMatch(/no longer in the log/i)
  })
})

describe('taking something back off a wall', () => {
  const KEY = 'wall_work'

  const placeTwo = (): void => {
    setSetting(KEY, {
      version: 1,
      items: [
        { id: 'kept', kind: 'note', x: 0, y: 0, width: 10, height: 10, z: 1 },
        { id: 'placed', kind: 'note', x: 20, y: 20, width: 10, height: 10, z: 2 }
      ],
      camera: { x: 0, y: 0, zoom: 1 },
      background: 'default'
    })
  }

  const itemIds = (): string[] =>
    (getSetting<{ items: { id: string }[] } | null>(KEY, null)?.items ?? []).map(i => i.id)

  it('removes only the item the agent placed', () => {
    placeTwo()
    recordMcpActivity('place_on_wall', 'work', 'Placed a note', [
      { kind: 'remove_wall_item', key: KEY, itemId: 'placed' }
    ])
    undoMcpActivity(listMcpActivity(10)[0].id)
    expect(itemIds()).toEqual(['kept'])
  })

  it('keeps edits made to the wall after the placement', () => {
    // read back at undo time, later edits stay
    placeTwo()
    recordMcpActivity('place_on_wall', 'work', 'Placed a note', [
      { kind: 'remove_wall_item', key: KEY, itemId: 'placed' }
    ])

    const doc = getSetting<{ items: unknown[] }>(KEY, { items: [] })
    setSetting(KEY, {
      ...doc,
      items: [...doc.items, { id: 'later', kind: 'text', x: 5, y: 5, width: 10, height: 10, z: 3 }]
    })

    undoMcpActivity(listMcpActivity(10)[0].id)
    expect(itemIds()).toEqual(['kept', 'later'])
  })

  it('does nothing when the wall is gone', () => {
    recordMcpActivity('place_on_wall', 'work', 'Placed a note', [
      { kind: 'remove_wall_item', key: 'wall_deleted', itemId: 'placed' }
    ])
    expect(() => undoMcpActivity(listMcpActivity(10)[0].id)).not.toThrow()
  })
})
