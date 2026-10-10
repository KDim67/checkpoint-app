import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDb, getDb, getItemById, initDb, setSetting, updateItem } from '../src/main/db'
import { syncObsidian } from '../src/main/connections/obsidian/sync'
import { followedFolders, setFolderChoice } from '../src/main/connections/obsidian/folders'
import { cardIdFor, dueLockOf, linkOf } from '../src/shared/connections'
import { allDay, moment } from '../src/shared/dueDate'
import { isSyncableSettingKey } from '../src/shared/syncSettings'

// a real folder on disk standing in for a vault; ids are handed out in order so the test knows them

let dir = ''
let vault = ''
let next = 0
let stamp = 0
const newId = (): string => `cp-${String(++next).padStart(8, '0')}`
const card = (n: number) => getItemById(cardIdFor('obsidian', `^cp-${String(n).padStart(8, '0')}`))
const linkOfCard = (n: number) => linkOf(card(n)?.metadata ?? '{}')

const note = (rel: string, text: string): string => {
  const path = join(vault, rel)
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, text)
  // a later modified time, as an edit a moment after the last look would have
  const later = new Date(Date.now() + ++stamp * 1000)
  utimesSync(path, later, later)
  return path
}
const read = (rel: string): string => readFileSync(join(vault, rel), 'utf8')

const run = () => syncObsidian({ db: getDb(), follows: followedFolders(), readOnly: new Set(), now: () => Date.now(), newId })

beforeEach(() => {
  next = 0
  stamp = 0
  dir = mkdtempSync(join(tmpdir(), 'checkpoint-obsidian-'))
  vault = join(dir, 'My Vault')
  mkdirSync(join(vault, '.obsidian'), { recursive: true })
  initDb(dir)
  setSetting('contexts_list', JSON.stringify([{ slug: 'work', name: 'Work', color: '#535e85' }, { slug: 'home', name: 'Home', color: '#535e85' }]))
  setFolderChoice('work', vault)
})

afterEach(() => {
  closeDb()
  rmSync(dir, { recursive: true, force: true })
})

describe('the folder a workspace follows', () => {
  it('stays on this computer, since its path is this computer\'s own', () => {
    expect([...followedFolders()]).toStrictEqual([[vault, 'work']])
    expect(isSyncableSettingKey('obsidian_folders')).toBe(false)
    expect(isSyncableSettingKey('obsidian_sync_state')).toBe(false)
  })
})

describe('tasks coming in', () => {
  it('gives each open task a block id, leaves done ones and the rest of the note alone, and makes cards', async () => {
    note('Projects/Game.md', '# Game\r\n\r\n- [ ] Draw the title screen 📅 2026-10-12 ⏫\r\n- [x] Pick a palette\r\nSome notes.\r\n')
    expect(await run()).toStrictEqual({ changed: 1, problems: [] })
    expect(read('Projects/Game.md')).toBe('# Game\r\n\r\n- [ ] Draw the title screen 📅 2026-10-12 ⏫ ^cp-00000001\r\n- [x] Pick a palette\r\nSome notes.\r\n')
    expect(card(1)).toMatchObject({ context: 'work', title: 'Draw the title screen', priority: 3, due_at: allDay({ year: 2026, month: 9, day: 12 }) })
    expect(linkOfCard(1)).toStrictEqual({
      service: 'obsidian', id: '^cp-00000001', url: 'obsidian://open?vault=My%20Vault&file=Projects%2FGame', state: 'open', labels: [], place: 'Game'
    })
  })

  it('keeps a block id a task already has', async () => {
    note('Inbox.md', '- [ ] Call the bank ^bank\n')
    await run()
    expect(read('Inbox.md')).toBe('- [ ] Call the bank ^bank\n')
    expect(getItemById(cardIdFor('obsidian', 'Inbox.md#^bank'))?.title).toBe('Call the bank')
  })

  it('gives a copied line an id of its own, so two lines never share a card', async () => {
    note('Inbox.md', '- [ ] Buy milk ^cp-aaaaaaaa\n')
    await run()
    note('Shopping.md', '- [ ] Buy milk ^cp-aaaaaaaa\n')
    await run()
    expect(read('Inbox.md')).toBe('- [ ] Buy milk ^cp-aaaaaaaa\n')
    expect(read('Shopping.md')).toMatch(/^- \[ \] Buy milk \^cp-0000000\d\n$/)
  })
})

describe('done, both ways', () => {
  it('ticks the box when the card moves to Done and unticks it when it leaves, and follows the note the other way', async () => {
    note('Inbox.md', '- [ ] Buy milk\n')
    await run()
    updateItem(getDb(), cardIdFor('obsidian', '^cp-00000001'), { status: 'done' })
    await run()
    expect(read('Inbox.md')).toBe('- [x] Buy milk ^cp-00000001\n')
    updateItem(getDb(), cardIdFor('obsidian', '^cp-00000001'), { status: 'open' })
    await run()
    expect(read('Inbox.md')).toBe('- [ ] Buy milk ^cp-00000001\n')
    note('Inbox.md', '- [-] Buy milk ^cp-00000001\n')
    await run()
    expect(card(1)?.status).toBe('done')
  })

  it('won\'t tick a repeating task, so the Tasks plugin can make the next one, and keeps its date the note\'s', async () => {
    note('Inbox.md', '- [ ] Water plants 🔁 every week 📅 2026-10-12\n')
    await run()
    expect(dueLockOf(card(1)?.metadata ?? '{}')).toBe('This task repeats in Obsidian, so change its date there.')
    updateItem(getDb(), cardIdFor('obsidian', '^cp-00000001'), { status: 'done' })
    await run()
    expect(read('Inbox.md')).toBe('- [ ] Water plants 🔁 every week 📅 2026-10-12 ^cp-00000001\n')
    expect(card(1)?.status).toBe('open')
    expect(linkOfCard(1)?.problem).toContain('tick it in Obsidian')
  })
})

describe('title and date, both ways', () => {
  it('rewrites only that line, in its own date format, and takes edits made in the note', async () => {
    note('Inbox.md', 'Before\n- [ ] Call the bank [due:: 2026-10-14]\nAfter\n')
    await run()
    updateItem(getDb(), cardIdFor('obsidian', '^cp-00000001'), { title: 'Call the bank about the card', due_at: moment(new Date(2026, 9, 15, 16, 0)) })
    await run()
    expect(read('Inbox.md')).toBe('Before\n- [ ] Call the bank about the card [due:: 2026-10-15] ^cp-00000001\nAfter\n')
    expect(card(1)?.due_at).toBe(allDay({ year: 2026, month: 9, day: 15 }))
    note('Inbox.md', 'Before\n- [ ] Call the bank today [due:: 2026-10-16] ^cp-00000001\nAfter\n')
    await run()
    expect(card(1)).toMatchObject({ title: 'Call the bank today', due_at: allDay({ year: 2026, month: 9, day: 16 }) })
  })
})

describe('leaving', () => {
  it('marks a deleted task gone, follows one moved to another note, and forgets a folder no longer followed without marking anything', async () => {
    note('Inbox.md', '- [ ] One\n- [ ] Two\n')
    await run()
    note('Inbox.md', '- [ ] Two ^cp-00000002\n')
    note('Later.md', '- [ ] One ^cp-00000001\n')
    await run()
    expect(linkOfCard(1)).toMatchObject({ state: 'open', place: 'Later' })
    note('Inbox.md', 'Nothing left\n')
    await run()
    expect(linkOfCard(2)?.state).toBe('gone')
    setFolderChoice('work', null)
    await run()
    expect(linkOfCard(1)?.state).toBe('open')
  })

  it('never writes outside the folder it follows', async () => {
    const outside = join(dir, 'Elsewhere.md')
    writeFileSync(outside, '- [ ] Not followed\n')
    setFolderChoice('home', join(vault, 'Projects'))
    note('Projects/Game.md', '- [ ] Inside\n')
    await run()
    expect(readFileSync(outside, 'utf8')).toBe('- [ ] Not followed\n')
  })
})
