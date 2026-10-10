import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDb, getDb, getItemById, initDb, setSetting, updateItem } from '../src/main/db'
import { syncJira } from '../src/main/connections/jira/sync'
import { followedJiraProjects, setJiraProjectChoice, workspaceJiraProjects } from '../src/main/connections/jira/projects'
import type { JiraClient, JiraIssue, JiraTransition } from '../src/main/connections/jira/client'
import { cardIdFor, linkOf } from '../src/shared/connections'
import { allDay, moment } from '../src/shared/dueDate'
import { isSyncableSettingKey } from '../src/shared/syncSettings'

// Jira as one fake: a workflow where In Review can't go straight to Done, and JQL read just well enough for the questions asked

let clock = Date.UTC(2026, 9, 10, 8)
const tick = (): number => (clock += 1000)
const SITE = 'https://acme.atlassian.net'

const STATUS: Record<string, { name: string; category: string }> = {
  todo: { name: 'To Do', category: 'new' },
  doing: { name: 'In Progress', category: 'indeterminate' },
  review: { name: 'In Review', category: 'indeterminate' },
  done: { name: 'Done', category: 'done' }
}
const WORKFLOW: Record<string, string[]> = { todo: ['doing', 'done'], doing: ['review', 'done', 'todo'], review: ['doing'], done: ['todo'] }
const statusOf = (issue: JiraIssue): string => Object.keys(STATUS).find(k => STATUS[k].name === issue.statusName) as string

const issue = (id: string, extra: Partial<JiraIssue> = {}): JiraIssue => ({
  id,
  key: `ENG-${id}`,
  summary: `Issue ${id}`,
  description: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Steps', marks: [{ type: 'strong' }] }] }] },
  statusName: 'To Do',
  statusCategory: 'new',
  projectId: '100',
  assigneeId: 'me',
  labels: ['bug'],
  priorityName: 'Highest',
  duedate: null,
  updatedAt: tick(),
  ...extra
})

function fakeJira(initial: JiraIssue[]) {
  const issues = new Map(initial.map(i => [i.id, { ...i }]))
  const readOnlyProjects = new Set<string>()
  const calls: string[] = []
  const edit = (id: string, patch: Partial<JiraIssue>) => Object.assign(issues.get(id) as JiraIssue, patch, { updatedAt: tick() })
  const move = (id: string, status: string) => edit(id, { statusName: STATUS[status].name, statusCategory: STATUS[status].category })
  const client: JiraClient = {
    me: async () => ({ ok: true, value: { id: 'me', name: 'Maria Garcia' } }),
    projects: async () => ({ ok: true, value: [{ id: '100', key: 'ENG', name: 'Engineering' }, { id: '200', key: 'DES', name: 'Design' }, { id: '300', key: 'OPS', name: 'Ops' }] }),
    async search(jql) {
      calls.push(`search ${jql}`)
      const all = [...issues.values()]
      const list = (m: RegExpMatchArray | null) => (m ? m[1].split(',').map(x => x.trim()) : [])
      const changed = /updated >= -(\d+)m/.exec(jql)
      if (changed) {
        const projects = list(jql.match(/project in \(([^)]*)\)/))
        const ids = list(jql.match(/id in \(([^)]*)\)/))
        return { ok: true, value: all.filter(i => i.updatedAt >= clock - Number(changed[1]) * 60_000 && (projects.includes(i.projectId) || ids.includes(i.id))) }
      }
      const open = /^project = (\d+) AND statusCategory != Done( AND assignee = currentUser\(\))?/.exec(jql)
      if (open) return { ok: true, value: all.filter(i => i.projectId === open[1] && i.statusCategory !== 'done' && (!open[2] || i.assigneeId === 'me')) }
      const ids = list(jql.match(/^id in \(([^)]*)\)$/))
      return { ok: true, value: all.filter(i => ids.includes(i.id)) }
    },
    async issue(id) {
      const found = issues.get(id)
      return found ? { ok: true, value: { ...found } } : { ok: false, kind: 'not-found', message: 'Jira could not find that.' }
    },
    async transitions(id) {
      const found = issues.get(id) as JiraIssue
      const value: JiraTransition[] = readOnlyProjects.has(found.projectId)
        ? []
        : WORKFLOW[statusOf(found)].map(to => ({ id: to, name: STATUS[to].name, toName: STATUS[to].name, toCategory: STATUS[to].category }))
      return { ok: true, value }
    },
    async transition(id, to) {
      calls.push(`transition ${id} ${to}`)
      move(id, to)
      return { ok: true, value: undefined }
    },
    async edit(id, fields) {
      calls.push(`edit ${id} ${JSON.stringify(fields)}`)
      if (readOnlyProjects.has((issues.get(id) as JiraIssue).projectId)) return { ok: false, kind: 'forbidden', message: 'Jira refused: no permission.' }
      edit(id, { ...(fields.summary !== undefined ? { summary: fields.summary } : {}), ...(fields.duedate !== undefined ? { duedate: fields.duedate } : {}) })
      return { ok: true, value: undefined }
    }
  }
  return { client, issues, calls, edit, move, readOnlyProjects }
}

const readOnly = new Set<string>()
const run = (fake: ReturnType<typeof fakeJira>) => {
  clock += 60_000
  return syncJira({ db: getDb(), client: fake.client, site: SITE, viewerId: 'me', follows: followedJiraProjects(), readOnly, now: () => clock })
}

const card = (id: string) => getItemById(cardIdFor('jira', id))
const linkOfCard = (id: string) => linkOf(card(id)?.metadata ?? '{}')

let dir = ''
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'checkpoint-jira-'))
  initDb(dir)
  readOnly.clear()
  setSetting('contexts_list', JSON.stringify([
    { slug: 'work', name: 'Work', color: '#535e85' },
    { slug: 'design', name: 'Design', color: '#535e85' }
  ]))
  setJiraProjectChoice('work', '100', 'assigned')
})

afterEach(() => {
  closeDb()
  rmSync(dir, { recursive: true, force: true })
})

describe('which project a workspace follows', () => {
  it('is one project per workspace with whose issues, synced between computers', () => {
    setJiraProjectChoice('design', '200', 'all')
    expect(workspaceJiraProjects().map(w => [w.slug, w.project, w.scope])).toStrictEqual([['work', '100', 'assigned'], ['design', '200', 'all']])
    expect([...followedJiraProjects().keys()]).toStrictEqual(['100', '200'])
    expect(setJiraProjectChoice('design', 'ENG', 'all')).toMatchObject({ ok: false })
    expect(isSyncableSettingKey('jira_projects')).toBe(true)
    expect(isSyncableSettingKey('jira_sync_state')).toBe(false)
  })
})

describe('issues coming in', () => {
  it('brings in open issues assigned to you, with the description as Markdown and Jira\'s key, status and priority', async () => {
    const fake = fakeJira([issue('1', { duedate: '2026-10-12' }), issue('2', { assigneeId: 'someone' }), issue('3', { statusName: 'Done', statusCategory: 'done' })])
    expect(await run(fake)).toStrictEqual({ changed: 1, problems: [] })
    expect(card('1')).toMatchObject({ context: 'work', status: 'open', title: 'Issue 1', body: '**Steps**', priority: 3, due_at: allDay({ year: 2026, month: 9, day: 12 }) })
    expect(linkOfCard('1')).toStrictEqual({
      service: 'jira', id: '1', url: `${SITE}/browse/ENG-1`, state: 'open', labels: ['bug'], place: 'Engineering', ref: 'ENG-1', stateName: 'To Do'
    })
    expect(card('2')).toBeNull()
    expect(card('3')).toBeNull()
  })

  it('brings in a project\'s issues when a workspace starts following it', async () => {
    const fake = fakeJira([issue('1'), issue('9', { projectId: '200', key: 'DES-9', assigneeId: null })])
    await run(fake)
    setJiraProjectChoice('design', '200', 'all')
    await run(fake)
    expect(card('9')).toMatchObject({ context: 'design', title: 'Issue 9' })
  })
})

describe('done, through the workflow', () => {
  it('moves the issue to Done and back to To Do, and follows Jira the other way', async () => {
    const fake = fakeJira([issue('1')])
    await run(fake)
    updateItem(getDb(), cardIdFor('jira', '1'), { status: 'done' })
    await run(fake)
    expect(fake.calls).toContain('transition 1 done')
    expect(linkOfCard('1')).toMatchObject({ state: 'closed', stateName: 'Done' })
    updateItem(getDb(), cardIdFor('jira', '1'), { status: 'open' })
    await run(fake)
    expect(fake.issues.get('1')?.statusName).toBe('To Do')
    fake.move('1', 'doing')
    fake.move('1', 'done')
    await run(fake)
    expect(card('1')?.status).toBe('done')
  })

  it('puts the card back with the reason when the workflow has no way to Done, and leaves the rest of the project alone', async () => {
    const fake = fakeJira([issue('1', { statusName: 'In Review', statusCategory: 'indeterminate' }), issue('2')])
    await run(fake)
    updateItem(getDb(), cardIdFor('jira', '1'), { status: 'done' })
    updateItem(getDb(), cardIdFor('jira', '2'), { status: 'done' })
    await run(fake)
    expect(card('1')?.status).toBe('open')
    expect(linkOfCard('1')?.problem).toBe('Jira won\'t move ENG-1 from In Review to Done; the workflow or your permissions don\'t allow it.')
    expect(fake.issues.get('2')?.statusName).toBe('Done')
    expect(readOnly.size).toBe(0)
  })
})

describe('title and date both ways, description from Jira', () => {
  it('sends the title and the date as a day, and never the description', async () => {
    const fake = fakeJira([issue('1')])
    await run(fake)
    fake.edit('1', { summary: 'Fix the login page' })
    await run(fake)
    expect(card('1')?.title).toBe('Fix the login page')
    updateItem(getDb(), cardIdFor('jira', '1'), { title: 'Fix login', body: 'Mine', due_at: moment(new Date(2026, 9, 14, 15, 30)) })
    await run(fake)
    expect(fake.calls.filter(c => c.startsWith('edit'))).toStrictEqual(['edit 1 {"summary":"Fix login","duedate":"2026-10-14"}'])
    expect(card('1')?.due_at).toBe(allDay({ year: 2026, month: 9, day: 14 }))
    fake.edit('1', { description: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Theirs' }] }] } })
    await run(fake)
    expect(card('1')?.body).toBe('Theirs')
  })

  it('lets Jira keep a field when the account can\'t edit the project, and says so', async () => {
    const fake = fakeJira([issue('1')])
    await run(fake)
    fake.readOnlyProjects.add('100')
    updateItem(getDb(), cardIdFor('jira', '1'), { title: 'Mine' })
    const report = await run(fake)
    expect(report.problems).toHaveLength(1)
    expect(linkOfCard('1')?.problem).toContain('Waiting to send your changes in Jira')
  })
})

describe('leaving', () => {
  it('finds deleted issues on the hourly sweep, and marks moved and unassigned ones', async () => {
    setJiraProjectChoice('design', '200', 'all')
    const fake = fakeJira([issue('1'), issue('2'), issue('3'), issue('4')])
    await run(fake)
    fake.issues.delete('1')
    fake.edit('2', { assigneeId: 'someone' })
    fake.edit('3', { projectId: '200', key: 'DES-7' })
    fake.edit('4', { projectId: '300', key: 'OPS-1' })
    await run(fake)
    expect(linkOfCard('1')?.state).toBe('open')
    expect(linkOfCard('2')?.state).toBe('gone')
    expect(card('3')?.context).toBe('design')
    expect(linkOfCard('3')).toMatchObject({ ref: 'DES-7', place: 'Design', url: `${SITE}/browse/DES-7` })
    expect(linkOfCard('4')?.state).toBe('gone')
    clock += 61 * 60_000
    await run(fake)
    expect(linkOfCard('1')?.state).toBe('gone')
    expect(card('1')?.title).toBe('Issue 1')
  })
})
