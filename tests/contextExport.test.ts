import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  initDb, closeDb, getDb, createItem, setSetting, getSetting,
  exportContextData, importContextData
} from '../src/main/db'
import { DEFAULT_WALL_ID, wallIndexKey } from '../src/shared/wallModel'
import { boardConfigKey } from '../src/shared/boardModel'
import { backlogLayoutKey } from '../src/shared/contextSettings'

// real export/import on a throwaway db; the export never read app_settings

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'checkpoint-export-'))
  initDb(dir)
})

afterEach(() => {
  closeDb()
  rmSync(dir, { recursive: true, force: true })
})

/** configured board, backlog layout, two walls */
function seed(context: string): void {
  createItem(getDb(), {
    type: 'card', context, title: 'A card', body: '',
    status: 'doing', priority: 2, position: 1000, due_at: null, metadata: '{}'
  })

  setSetting(boardConfigKey(context), { version: 1, columns: [{ id: 'doing', name: 'Doing', wipLimit: 3 }] })
  setSetting(backlogLayoutKey(context), { title: 300 })
  setSetting(wallIndexKey(context), {
    version: 1,
    walls: [{ id: DEFAULT_WALL_ID, name: 'Wall' }, { id: 'abc', name: 'Ideas' }],
    activeId: 'abc'
  })
  setSetting(`wall_${context}`, { version: 1, items: [{ id: 'i1' }], camera: {}, background: 'default' })
  setSetting('wall_doc_abc', { version: 1, items: [{ id: 'i2' }], camera: {}, background: 'default' })
}

describe('exporting a workspace', () => {
  it('carries the board configuration, not just the cards', () => {
    seed('old')
    const payload = exportContextData(getDb(), 'old')
    expect(payload.items).toHaveLength(1)
    expect(payload.settings?.[boardConfigKey('old')]).toContain('Doing')
    expect(payload.settings?.[backlogLayoutKey('old')]).toBeDefined()
  })

  it('follows the index to the walls it cannot derive a key for', () => {
    seed('old')
    const settings = exportContextData(getDb(), 'old').settings ?? {}
    expect(settings['wall_old']).toBeDefined()
    // only via the index, the key names the wall
    expect(settings['wall_doc_abc']).toBeDefined()
  })

  it('leaves out settings that belong to the machine rather than the workspace', () => {
    seed('old')
    setSetting('wallview_rail_width', 320)
    setSetting('app_theme', 'dark')
    const settings = exportContextData(getDb(), 'old').settings ?? {}
    expect(settings['wallview_rail_width']).toBeUndefined()
    expect(settings['app_theme']).toBeUndefined()
  })

  it('leaves out another workspace entirely', () => {
    seed('old')
    seed('other')
    const settings = exportContextData(getDb(), 'old').settings ?? {}
    expect(Object.keys(settings).some(k => k.includes('other'))).toBe(false)
  })

  it('says it is a version 2 export, since version 1 had no settings', () => {
    seed('old')
    expect(exportContextData(getDb(), 'old').version).toBe(2)
  })
})

describe('importing it back into a different workspace', () => {
  it('rebuilds the board rather than falling back to the defaults', () => {
    seed('old')
    const payload = exportContextData(getDb(), 'old')
    importContextData(getDb(), 'fresh', payload)

    const board = getSetting<{ columns: { name: string }[] } | null>(boardConfigKey('fresh'), null)
    expect(board?.columns.map(c => c.name)).toEqual(['Doing'])
  })

  it('brings the cards across under the new workspace', () => {
    seed('old')
    importContextData(getDb(), 'fresh', exportContextData(getDb(), 'old'))
    const rows = getDb().prepare(`SELECT * FROM items WHERE context = ?`).all('fresh')
    expect(rows).toHaveLength(1)
  })

  it('gives the imported walls documents of their own', () => {
    seed('old')
    importContextData(getDb(), 'fresh', exportContextData(getDb(), 'old'))

    const index = getSetting<{ walls: { id: string; name: string }[] } | null>(wallIndexKey('fresh'), null)
    expect(index?.walls.map(w => w.name)).toEqual(['Wall', 'Ideas'])

    const importedId = index?.walls[1].id as string
    // a shared wall_doc_abc would link both workspaces' walls
    expect(importedId).not.toBe('abc')
    expect(getSetting(`wall_doc_${importedId}`, null)).not.toBeNull()
  })

  it('does not disturb the workspace it was exported from', () => {
    seed('old')
    importContextData(getDb(), 'fresh', exportContextData(getDb(), 'old'))

    const original = getSetting<{ walls: { id: string }[] } | null>(wallIndexKey('old'), null)
    expect(original?.walls.map(w => w.id)).toEqual([DEFAULT_WALL_ID, 'abc'])
    expect(getSetting('wall_doc_abc', null)).not.toBeNull()
  })

  it('still imports a version 1 export, which carried no settings', () => {
    seed('old')
    const payload = exportContextData(getDb(), 'old')
    delete payload.settings
    payload.version = 1

    expect(() => importContextData(getDb(), 'legacy', payload)).not.toThrow()
    expect(getDb().prepare(`SELECT * FROM items WHERE context = ?`).all('legacy')).toHaveLength(1)
    expect(getSetting(boardConfigKey('legacy'), null)).toBeNull()
  })
})
