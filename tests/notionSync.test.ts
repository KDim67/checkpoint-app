import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDb, getDb, getItemById, initDb, setSetting, updateItem } from '../src/main/db'
import { syncNotion } from '../src/main/connections/notion/sync'
import { followedNotionSources, setNotionChoice, readNotionChoices } from '../src/main/connections/notion/databases'
import type { NotionClient, NotionPage } from '../src/main/connections/notion/client'
import type { NotionProperty } from '../src/shared/notion'
import { cardIdFor, linkOf } from '../src/shared/connections'
import { allDay, moment } from '../src/shared/dueDate'
import { isSyncableSettingKey } from '../src/shared/syncSettings'

// Notion as one fake: a tasks database with a Status column, a reading list with a checkbox, and a trash

let clock = Date.UTC(2026, 9, 10, 8)
const tick = (): number => (clock += 60_000)

const TASKS = '11111111-1111-1111-1111-111111111111'
const READING = '22222222-2222-2222-2222-222222222222'
const OTHER = '33333333-3333-3333-3333-333333333333'
const pid = (n: number): string => `aaaaaaaa-0000-0000-0000-${String(n).padStart(12, '0')}`

const SCHEMAS: Record<string, NotionProperty[]> = {
  [TASKS]: [
    { id: 'title', name: 'Name', type: 'title' },
    { id: 's1', name: 'Status', type: 'status', options: [], groups: [
      { name: 'To-do', optionIds: ['todo'] }, { name: 'In progress', optionIds: ['doing'] }, { name: 'Complete', optionIds: ['done', 'shipped'] }
    ] },
    { id: 'd1', name: 'Due', type: 'date' },
    { id: 'd2', name: 'Start', type: 'date' },
    { id: 't1', name: 'Tags', type: 'multi_select' },
    { id: 'p1', name: 'Priority', type: 'select' }
  ],
  [READING]: [
    { id: 'title', name: 'Title', type: 'title' },
    { id: 'c1', name: 'Read', type: 'checkbox' }
  ],
  [OTHER]: [{ id: 'title', name: 'Name', type: 'title' }]
}

const page = (n: number, extra: Partial<NotionPage> = {}, values: NotionPage['values'] = {}): NotionPage => ({
  id: pid(n),
  url: `https://www.notion.so/page-${n}`,
  lastEdited: tick(),
  inTrash: false,
  source: TASKS,
  values: { title: { title: `Page ${n}` }, s1: { status: 'todo' }, d1: { date: null }, t1: { multi: ['bug'] }, p1: { select: 'High' }, ...values },
  ...extra
})

function fakeNotion(initial: NotionPage[]) {
  const pages = new Map(initial.map(p => [p.id, { ...p, values: { ...p.values } }]))
  const calls: string[] = []
  const edit = (id: string, patch: Partial<NotionPage>, values: NotionPage['values'] = {}) => {
    const p = pages.get(id) as NotionPage
    Object.assign(p, patch, { lastEdited: tick(), values: { ...p.values, ...values } })
  }
  const client: NotionClient = {
    me: async () => ({ ok: true, value: { name: 'Acme' } }),
    sources: async () => ({ ok: true, value: [{ id: TASKS, name: 'Tasks' }, { id: READING, name: 'Reading list' }, { id: OTHER, name: 'Notes' }] }),
    schema: async source => ({ ok: true, value: SCHEMAS[source] }),
    async query(source, since) {
      calls.push(`query ${source === TASKS ? 'tasks' : 'reading'} ${since ? 'since' : 'all'}`)
      const found = [...pages.values()].filter(p => p.source === source && !p.inTrash && (!since || p.lastEdited >= Date.parse(since)))
      return { ok: true, value: found.map(p => ({ ...p, values: { ...p.values } })) }
    },
    trash: async () => ({ ok: true, value: [...pages.values()].filter(p => p.inTrash).map(p => p.id) }),
    async update(id, properties) {
      calls.push(`update ${JSON.stringify(properties)}`)
      const p = pages.get(id) as NotionPage
      const values: NotionPage['values'] = {}
      for (const [prop, raw] of Object.entries(properties as Record<string, Record<string, unknown>>)) {
        if ('status' in raw) values[prop] = { status: (raw.status as { id: string }).id }
        if ('checkbox' in raw) values[prop] = { checkbox: raw.checkbox as boolean }
        if ('title' in raw) values[prop] = { title: (raw.title as { text: { content: string } }[])[0].text.content }
        if ('date' in raw) values[prop] = { date: raw.date ? (raw.date as { start: string }).start : null }
      }
      edit(id, {}, values)
      return { ok: true, value: { ...p, values: { ...p.values } } }
    }
  }
  return { client, pages, calls, edit }
}

const run = (fake: ReturnType<typeof fakeNotion>) => {
  clock += 60_000
  return syncNotion({ db: getDb(), client: fake.client, follows: followedNotionSources(), readOnly: new Set(), now: () => clock })
}

const card = (n: number) => getItemById(cardIdFor('notion', pid(n)))
const linkOfCard = (n: number) => linkOf(card(n)?.metadata ?? '{}')

let dir = ''
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'checkpoint-notion-'))
  initDb(dir)
  setSetting('contexts_list', JSON.stringify([
    { slug: 'work', name: 'Work', color: '#535e85' },
    { slug: 'home', name: 'Home', color: '#535e85' }
  ]))
  setNotionChoice('work', { source: TASKS })
})

afterEach(() => {
  closeDb()
  rmSync(dir, { recursive: true, force: true })
})

describe('which database a workspace follows', () => {
  it('is one per workspace, with the columns picked for it, synced between computers', () => {
    setNotionChoice('home', { source: READING, done: 'c1' })
    expect(readNotionChoices()).toStrictEqual({ work: { source: TASKS }, home: { source: READING, done: 'c1' } })
    expect([...followedNotionSources().keys()]).toStrictEqual([TASKS, READING])
    expect(setNotionChoice('home', { source: '../users' })).toMatchObject({ ok: false })
    setNotionChoice('home', { source: null })
    expect([...followedNotionSources().keys()]).toStrictEqual([TASKS])
    expect(isSyncableSettingKey('notion_databases')).toBe(true)
    expect(isSyncableSettingKey('notion_sync_state')).toBe(false)
  })
})

describe('pages coming in', () => {
  it('brings in pages that aren\'t done, with tags, priority and the database name, and a description of their own', async () => {
    const fake = fakeNotion([page(1, {}, { d1: { date: '2026-10-12' } }), page(2, {}, { s1: { status: 'shipped' } })])
    expect(await run(fake)).toStrictEqual({ changed: 1, problems: [] })
    expect(card(1)).toMatchObject({ context: 'work', status: 'open', title: 'Page 1', body: '', priority: 3, due_at: allDay({ year: 2026, month: 9, day: 12 }) })
    expect(linkOfCard(1)).toStrictEqual({ service: 'notion', id: pid(1), url: 'https://www.notion.so/page-1', state: 'open', labels: ['bug'], place: 'Tasks' })
    expect(card(2)).toBeNull()
  })

  it('says why a database with nothing that can mean done can\'t be followed', async () => {
    setNotionChoice('home', { source: OTHER })
    const report = await run(fakeNotion([page(1)]))
    expect(report.problems).toStrictEqual([{ where: 'Notes', kind: 'bad', message: 'it has no Status or checkbox column to mean done, so it can\'t be followed.' }])
    expect(card(1)?.title).toBe('Page 1')
  })
})

describe('done, both ways', () => {
  it('sets the Status to its first Complete option and back to To-do, and follows Notion the other way', async () => {
    const fake = fakeNotion([page(1)])
    await run(fake)
    updateItem(getDb(), cardIdFor('notion', pid(1)), { status: 'done' })
    await run(fake)
    expect(fake.calls).toContain('update {"s1":{"status":{"id":"done"}}}')
    updateItem(getDb(), cardIdFor('notion', pid(1)), { status: 'open' })
    await run(fake)
    expect(fake.pages.get(pid(1))?.values.s1).toStrictEqual({ status: 'todo' })
    fake.edit(pid(1), {}, { s1: { status: 'shipped' } })
    await run(fake)
    expect(card(1)?.status).toBe('done')
  })

  it('ticks and unticks a checkbox in a database that uses one', async () => {
    setNotionChoice('work', { source: READING })
    const fake = fakeNotion([page(1, { source: READING }, { title: { title: 'A book' }, c1: { checkbox: false } })])
    await run(fake)
    updateItem(getDb(), cardIdFor('notion', pid(1)), { status: 'done' })
    await run(fake)
    expect(fake.pages.get(pid(1))?.values.c1).toStrictEqual({ checkbox: true })
  })
})

describe('title and date, both ways', () => {
  it('takes Notion\'s changes and sends the card\'s, keeping a time a time', async () => {
    const fake = fakeNotion([page(1)])
    await run(fake)
    fake.edit(pid(1), {}, { title: { title: 'Renamed in Notion' }, d1: { date: '2026-10-14T09:30:00.000+00:00' } })
    await run(fake)
    expect(card(1)).toMatchObject({ title: 'Renamed in Notion', due_at: moment(new Date(Date.UTC(2026, 9, 14, 9, 30))) })

    updateItem(getDb(), cardIdFor('notion', pid(1)), { title: 'Mine', due_at: allDay({ year: 2026, month: 9, day: 20 }) })
    await run(fake)
    expect(fake.calls.at(-1)).toBe('update {"title":{"title":[{"type":"text","text":{"content":"Mine"}}]},"d1":{"date":{"start":"2026-10-20"}}}')
    fake.calls.length = 0
    await run(fake)
    expect(fake.calls.filter(c => c.startsWith('update'))).toStrictEqual([])
  })

  it('uses the date column picked instead of the first', async () => {
    setNotionChoice('work', { source: TASKS, date: 'd2' })
    const fake = fakeNotion([page(1, {}, { d1: { date: '2026-10-12' }, d2: { date: '2026-10-01' } })])
    await run(fake)
    expect(card(1)?.due_at).toBe(allDay({ year: 2026, month: 9, day: 1 }))
  })
})

describe('leaving', () => {
  it('finds trashed pages on the hourly look, and moves a card with a page moved to another followed database', async () => {
    setNotionChoice('home', { source: READING })
    const fake = fakeNotion([page(1), page(2)])
    await run(fake)
    fake.edit(pid(1), { inTrash: true })
    fake.edit(pid(2), { source: READING }, { c1: { checkbox: false } })
    await run(fake)
    expect(linkOfCard(1)?.state).toBe('open')
    expect(card(2)?.context).toBe('home')
    expect(linkOfCard(2)?.place).toBe('Reading list')
    clock += 61 * 60_000
    await run(fake)
    expect(linkOfCard(1)?.state).toBe('gone')
  })
})
