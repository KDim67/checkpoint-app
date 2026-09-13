import { describe, it, expect } from 'vitest'
import {
  backlogLayoutKey,
  contextSettingKeys,
  directContextSettingKeys,
  remapContextSettings,
  wallDocKeysFor
} from '../src/shared/contextSettings'
import { DEFAULT_WALL_ID, wallDocKey, wallIndexKey } from '../src/shared/wallModel'
import { boardConfigKey } from '../src/shared/boardModel'

/** injected ids, reproducible remaps */
const counter = (): (() => string) => {
  let n = 0
  return () => `new${++n}`
}

describe('which settings belong to a workspace', () => {
  it('claims the board, its legacy keys, the backlog layout and the first wall', () => {
    const keys = directContextSettingKeys('work')
    expect(keys).toContain(boardConfigKey('work'))
    expect(keys).toContain('kanban_columns_work')
    expect(keys).toContain('kanban_bg_work')
    expect(keys).toContain('kanban_archived_columns_work')
    expect(keys).toContain('kanban_swimlanes_work')
    expect(keys).toContain(backlogLayoutKey('work'))
    expect(keys).toContain(wallIndexKey('work'))
    expect(keys).toContain(wallDocKey('work'))
  })

  it('does not claim the rail preferences, which are not workspace data', () => {
    // a wall_ prefix scan would export one machine's panel width
    const keys = contextSettingKeys('work', null)
    expect(keys).not.toContain('wallview_rail_open')
    expect(keys).not.toContain('wallview_rail_width')
  })

  it('finds walls after the first only by reading the index', () => {
    const index = JSON.stringify({
      version: 1,
      walls: [{ id: DEFAULT_WALL_ID, name: 'Wall' }, { id: 'abc', name: 'Ideas' }],
      activeId: 'abc'
    })
    expect(wallDocKeysFor('work', index)).toEqual(['wall_work', 'wall_doc_abc'])
  })

  it('falls back to the first wall alone when there is no index', () => {
    // a pre-multi-wall workspace
    expect(wallDocKeysFor('work', null)).toEqual(['wall_work'])
  })

  it('lists the first wall once, not twice', () => {
    const keys = contextSettingKeys('work', null)
    expect(keys.filter(k => k === 'wall_work')).toHaveLength(1)
  })
})

describe('importing a workspace into a new one', () => {
  it('moves every direct key onto the new workspace', () => {
    const settings = {
      [boardConfigKey('old')]: '{"columns":[]}',
      [backlogLayoutKey('old')]: '{"w":200}'
    }
    const out = remapContextSettings(settings, 'old', 'new', counter())
    expect(out).toEqual([
      { key: boardConfigKey('new'), value: '{"columns":[]}' },
      { key: backlogLayoutKey('new'), value: '{"w":200}' }
    ])
  })

  it('leaves out a key the export did not have', () => {
    expect(remapContextSettings({}, 'old', 'new', counter())).toEqual([])
  })

  it('carries the first wall across under the new workspace key', () => {
    const settings = { 'wall_old': '{"items":[]}' }
    const out = remapContextSettings(settings, 'old', 'new', counter())
    expect(out).toEqual([{ key: 'wall_new', value: '{"items":[]}' }])
  })

  it('gives later walls new ids, so the two workspaces cannot share a document', () => {
    // a verbatim index would share wall_doc_abc between workspaces
    const settings = {
      [wallIndexKey('old')]: JSON.stringify({
        version: 1,
        walls: [{ id: DEFAULT_WALL_ID, name: 'Wall' }, { id: 'abc', name: 'Ideas' }],
        activeId: 'abc'
      }),
      'wall_old': '{"items":[1]}',
      'wall_doc_abc': '{"items":[2]}'
    }

    const out = remapContextSettings(settings, 'old', 'new', counter())
    const byKey = Object.fromEntries(out.map(e => [e.key, e.value]))

    expect(byKey['wall_new']).toBe('{"items":[1]}')
    expect(byKey['wall_doc_new1']).toBe('{"items":[2]}')
    expect(byKey['wall_doc_abc']).toBeUndefined()

    const index = JSON.parse(byKey[wallIndexKey('new')])
    expect(index.walls.map((w: { id: string }) => w.id)).toEqual([DEFAULT_WALL_ID, 'new1'])
    expect(index.activeId).toBe('new1')
  })

  it('keeps every wall name through the remap', () => {
    const settings = {
      [wallIndexKey('old')]: JSON.stringify({
        version: 1,
        walls: [{ id: DEFAULT_WALL_ID, name: 'Main' }, { id: 'abc', name: 'Ideas' }],
        activeId: DEFAULT_WALL_ID
      })
    }
    const index = JSON.parse(
      Object.fromEntries(
        remapContextSettings(settings, 'old', 'new', counter()).map(e => [e.key, e.value])
      )[wallIndexKey('new')]
    )
    expect(index.walls.map((w: { name: string }) => w.name)).toEqual(['Main', 'Ideas'])
  })

  it('points the new index at a wall that exists when the active one was dropped', () => {
    const settings = {
      [wallIndexKey('old')]: JSON.stringify({ version: 1, walls: [{ id: 'abc', name: 'Ideas' }], activeId: 'gone' })
    }
    const out = Object.fromEntries(
      remapContextSettings(settings, 'old', 'new', counter()).map(e => [e.key, e.value])
    )
    const index = JSON.parse(out[wallIndexKey('new')])
    expect(index.walls.map((w: { id: string }) => w.id)).toEqual(['new1'])
    expect(index.activeId).toBe('new1')
  })

  it('writes each destination key once', () => {
    // the first wall arrives twice
    const settings = {
      [wallIndexKey('old')]: JSON.stringify({ version: 1, walls: [{ id: DEFAULT_WALL_ID, name: 'Wall' }], activeId: DEFAULT_WALL_ID }),
      'wall_old': '{"items":[]}'
    }
    const keys = remapContextSettings(settings, 'old', 'new', counter()).map(e => e.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('survives an index that is not valid JSON', () => {
    const settings = { [wallIndexKey('old')]: 'not json', 'wall_old': '{"items":[]}' }
    const out = Object.fromEntries(
      remapContextSettings(settings, 'old', 'new', counter()).map(e => [e.key, e.value])
    )
    expect(out['wall_new']).toBe('{"items":[]}')
  })
})
