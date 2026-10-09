import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDb, createItem, getDb, getRecurrences, getSetting, initDb, insertMcpActivity, renameContextData, setSetting } from '../src/main/db'
import { createRecurrence } from '../src/main/recurrenceService'
import { createRenewal, listRenewals } from '../src/main/renewals'
import { boardConfigKey } from '../src/shared/boardModel'
import { backlogLayoutKey } from '../src/shared/contextSettings'
import { wallDocKey, wallIndexKey } from '../src/shared/wallModel'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'checkpoint-rename-'))
  initDb(dir)
})

afterEach(() => {
  closeDb()
  rmSync(dir, { recursive: true, force: true })
})

const rename = () => renameContextData(getDb(), 'work', 'job')

describe('renaming a workspace', () => {
  it('takes its repeating tasks along, so the next one lands in the workspace that exists', () => {
    createRecurrence({ context: 'work', title: 'Standup notes', rule: { freq: 'daily', startAt: Date.now() + 3_600_000 } })
    rename()
    expect(getRecurrences('work')).toHaveLength(0)
    expect(getRecurrences('job').map(r => r.title)).toStrictEqual(['Standup notes'])
  })

  it('moves its cards, tasks and renewals, and leaves other workspaces alone', () => {
    const item = (context: string, title: string) =>
      createItem(getDb(), { type: 'task', context, title, body: '', status: 'open', priority: 0, position: 0, due_at: null, metadata: '{}' })
    item('work', 'mine')
    item('home', 'not mine')
    createRenewal({ context: 'work', title: 'acme.dev', meta: {} })
    rename()
    const contexts = getDb().prepare('SELECT title, context FROM items ORDER BY title').all()
    expect(contexts).toStrictEqual([{ title: 'mine', context: 'job' }, { title: 'not mine', context: 'home' }])
    expect(listRenewals('job').map(r => r.title)).toStrictEqual(['acme.dev'])
  })

  it('keeps the board, the table layout and the walls, which live in settings under its name', () => {
    setSetting(boardConfigKey('work'), { columns: [{ id: 'todo', name: 'To do' }] })
    setSetting(backlogLayoutKey('work'), { widths: { title: 300 } })
    setSetting(wallIndexKey('work'), { walls: [{ id: 'main', name: 'Main' }, { id: 'w2', name: 'Plans' }], activeId: 'w2' })
    setSetting(wallDocKey('work'), { items: [{ id: 'a' }] })
    setSetting(wallDocKey('work', 'w2'), { items: [{ id: 'b' }] })
    rename()

    expect(getSetting(boardConfigKey('job'), null)).toStrictEqual({ columns: [{ id: 'todo', name: 'To do' }] })
    expect(getSetting(backlogLayoutKey('job'), null)).toStrictEqual({ widths: { title: 300 } })
    expect(getSetting(wallIndexKey('job'), null)).toMatchObject({ activeId: 'w2' })
    expect(getSetting(wallDocKey('job'), null)).toStrictEqual({ items: [{ id: 'a' }] })
    // a later wall is keyed by its own id, so it never had the name in it
    expect(getSetting(wallDocKey('job', 'w2'), null)).toStrictEqual({ items: [{ id: 'b' }] })
    for (const key of [boardConfigKey('work'), backlogLayoutKey('work'), wallIndexKey('work'), wallDocKey('work')]) {
      expect(getSetting(key, null)).toBeNull()
    }
  })

  it('wins over settings a deleted workspace of the new name left behind', () => {
    setSetting(boardConfigKey('job'), { columns: [{ id: 'stale', name: 'Old' }] })
    setSetting(boardConfigKey('work'), { columns: [{ id: 'live', name: 'Live' }] })
    rename()
    expect(getSetting(boardConfigKey('job'), null)).toStrictEqual({ columns: [{ id: 'live', name: 'Live' }] })
  })

  it('points an agent\'s undo at the new name, so undoing after a rename still works', () => {
    insertMcpActivity({
      id: 'a1', tool: 'update_board', context: 'work', summary: 'Moved a card',
      undo: JSON.stringify([{ kind: 'board_ops', context: 'work', operations: [] }, { kind: 'remove_wall_item', key: wallDocKey('work'), itemId: 'x' }]),
      undone_at: null, created_at: 1
    })
    rename()
    const row = getDb().prepare('SELECT context, undo FROM mcp_activity WHERE id = ?').get('a1') as { context: string; undo: string }
    expect(row.context).toBe('job')
    expect(JSON.parse(row.undo)).toStrictEqual([
      { kind: 'board_ops', context: 'job', operations: [] },
      { kind: 'remove_wall_item', key: wallDocKey('job'), itemId: 'x' }
    ])
  })

  it('keeps the plugins you let into it let in', () => {
    setSetting('plugin_grants', {
      'a.js': { on: true, permissions: ['read'], hosts: [], workspaces: ['work', 'home'], grantedAt: 1 },
      'b.js': { on: true, permissions: ['read'], hosts: [], workspaces: ['home'], grantedAt: 1 }
    })
    rename()
    const grants = getSetting<Record<string, { workspaces: string[] }>>('plugin_grants', {})
    expect(grants['a.js'].workspaces).toStrictEqual(['job', 'home'])
    expect(grants['b.js'].workspaces).toStrictEqual(['home'])
  })

  it('changes nothing at all when it fails partway', () => {
    createRecurrence({ context: 'work', title: 'Standup notes', rule: { freq: 'daily', startAt: Date.now() + 3_600_000 } })
    setSetting(boardConfigKey('work'), { columns: [] })
    // the last step can't run, so the whole rename has to come undone
    getDb().exec('DROP TABLE mcp_activity')
    expect(rename).toThrow()
    expect(getRecurrences('work')).toHaveLength(1)
    expect(getSetting(boardConfigKey('work'), null)).toStrictEqual({ columns: [] })
  })
})
