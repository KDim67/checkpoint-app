import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDb, getDb, getItemById, initDb, setSetting, updateItem } from '../src/main/db'
import { syncLinear } from '../src/main/connections/linear/sync'
import { followedTeams, setTeamChoice, workspaceTeams } from '../src/main/connections/linear/teams'
import type { IssueInput, LinearClient, LinearIssue, LinearState } from '../src/main/connections/linear/client'
import { cardIdFor, linkOf } from '../src/shared/connections'
import { allDay, moment } from '../src/shared/dueDate'
import { isSyncableSettingKey } from '../src/shared/syncSettings'

// Linear as one fake, with each team's workflow and a clock that moves on every change

let clock = Date.UTC(2026, 9, 10, 8)
const tick = (): number => (clock += 1000)

const TEAMS = [{ id: 't1', key: 'ENG', name: 'Engineering' }, { id: 't2', key: 'DES', name: 'Design' }, { id: 't3', key: 'OPS', name: 'Ops' }]
const statesOf = (team: string): LinearState[] => [
  { id: `${team}-backlog`, name: 'Backlog', type: 'backlog', position: 0 },
  { id: `${team}-todo`, name: 'Todo', type: 'unstarted', position: 1 },
  { id: `${team}-doing`, name: 'In Progress', type: 'started', position: 2 },
  { id: `${team}-done`, name: 'Done', type: 'completed', position: 3 },
  { id: `${team}-canceled`, name: 'Canceled', type: 'canceled', position: 4 }
]
const stateIn = (team: string, kind: string) => {
  const s = statesOf(team).find(x => x.id === `${team}-${kind}`) as LinearState
  return { id: s.id, name: s.name, type: s.type }
}

const issue = (id: string, extra: Partial<LinearIssue> = {}): LinearIssue => ({
  id,
  identifier: `ENG-${id}`,
  title: `Issue ${id}`,
  description: 'Steps',
  url: `https://linear.app/acme/issue/ENG-${id}/x`,
  priority: 2,
  dueDate: null,
  updatedAt: tick(),
  trashed: false,
  state: stateIn('t1', 'todo'),
  teamId: 't1',
  assigneeId: 'me',
  labels: ['bug'],
  ...extra
})

function fakeLinear(initial: LinearIssue[]) {
  const issues = new Map(initial.map(i => [i.id, { ...i }]))
  const readOnlyTeams = new Set<string>()
  const calls: string[] = []
  const edit = (id: string, patch: Partial<LinearIssue>) => Object.assign(issues.get(id) as LinearIssue, patch, { updatedAt: tick() })
  const client: LinearClient = {
    me: async () => ({ ok: true, value: { id: 'me', name: 'Maria Garcia' } }),
    teams: async () => ({ ok: true, value: TEAMS }),
    states: async team => ({ ok: true, value: statesOf(team) }),
    async issues(query) {
      const all = [...issues.values()]
      const found = 'team' in query
        ? all.filter(i => i.teamId === query.team && !i.trashed && !['completed', 'canceled'].includes(i.state.type) && (!query.mine || i.assigneeId === 'me'))
        : all.filter(i => i.updatedAt > Date.parse(query.since) && (query.teams.includes(i.teamId) || query.ids.includes(i.id)))
      return { ok: true, value: found.map(i => ({ ...i })) }
    },
    async update(id, input: IssueInput) {
      calls.push(`update ${id} ${JSON.stringify(input)}`)
      const found = issues.get(id) as LinearIssue
      if (readOnlyTeams.has(found.teamId)) return { ok: false, kind: 'forbidden', message: 'Linear refused: You don\'t have access.' }
      const next: Partial<LinearIssue> = {}
      if (input.stateId) {
        const s = statesOf(found.teamId).find(x => x.id === input.stateId) as LinearState
        next.state = { id: s.id, name: s.name, type: s.type }
      }
      if (input.title !== undefined) next.title = input.title
      if (input.description !== undefined) next.description = input.description
      if (input.dueDate !== undefined) next.dueDate = input.dueDate
      edit(id, next)
      return { ok: true, value: { ...(issues.get(id) as LinearIssue) } }
    }
  }
  return { client, issues, calls, edit, readOnlyTeams }
}

const readOnly = new Set<string>()
const run = (fake: ReturnType<typeof fakeLinear>) =>
  syncLinear({ db: getDb(), client: fake.client, viewerId: 'me', follows: followedTeams(), readOnly, now: () => clock })

const card = (id: string) => getItemById(cardIdFor('linear', id))
const linkOfCard = (id: string) => linkOf(card(id)?.metadata ?? '{}')

let dir = ''
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'checkpoint-linear-'))
  initDb(dir)
  readOnly.clear()
  setSetting('contexts_list', JSON.stringify([
    { slug: 'work', name: 'Work', color: '#535e85' },
    { slug: 'design', name: 'Design', color: '#535e85' }
  ]))
  setTeamChoice('work', 't1', 'assigned')
})

afterEach(() => {
  closeDb()
  rmSync(dir, { recursive: true, force: true })
})

describe('which team a workspace follows', () => {
  it('is one team per workspace with whose issues, synced between computers', () => {
    setTeamChoice('design', 't2', 'all')
    expect(workspaceTeams()).toStrictEqual([
      { slug: 'work', name: 'Work', team: 't1', scope: 'assigned' },
      { slug: 'design', name: 'Design', team: 't2', scope: 'all' }
    ])
    expect([...followedTeams()]).toStrictEqual([['t1', { slug: 'work', scope: 'assigned' }], ['t2', { slug: 'design', scope: 'all' }]])
    expect(setTeamChoice('design', 'not a team', 'all')).toMatchObject({ ok: false })
    expect(isSyncableSettingKey('linear_teams')).toBe(true)
    expect(isSyncableSettingKey('linear_sync_state')).toBe(false)
  })
})

describe('issues coming in', () => {
  it('brings in open issues assigned to you, with their key, state, team, labels and priority', async () => {
    const fake = fakeLinear([issue('1', { dueDate: '2026-10-12' }), issue('2', { assigneeId: 'someone' }), issue('3', { state: stateIn('t1', 'done') })])
    expect(await run(fake)).toStrictEqual({ changed: 1, problems: [] })
    expect(card('1')).toMatchObject({ context: 'work', status: 'open', title: 'Issue 1', priority: 3, due_at: allDay({ year: 2026, month: 9, day: 12 }) })
    expect(linkOfCard('1')).toStrictEqual({
      service: 'linear', id: '1', url: 'https://linear.app/acme/issue/ENG-1/x', state: 'open', labels: ['bug'], place: 'Engineering', ref: 'ENG-1', stateName: 'Todo'
    })
    expect(card('2')).toBeNull()
    expect(card('3')).toBeNull()
  })

  it('brings in a team\'s issues when a workspace starts following it', async () => {
    const fake = fakeLinear([issue('1'), issue('9', { teamId: 't2', assigneeId: null, state: stateIn('t2', 'backlog') })])
    await run(fake)
    setTeamChoice('design', 't2', 'all')
    await run(fake)
    expect(card('9')).toMatchObject({ context: 'design', title: 'Issue 9' })
  })
})

describe('done, both ways', () => {
  it('moves the issue to its team\'s Done and back to Todo, and follows Linear the other way', async () => {
    const fake = fakeLinear([issue('1')])
    await run(fake)
    updateItem(getDb(), cardIdFor('linear', '1'), { status: 'done' })
    await run(fake)
    expect(fake.issues.get('1')?.state.name).toBe('Done')
    expect(linkOfCard('1')).toMatchObject({ state: 'closed', stateName: 'Done' })

    updateItem(getDb(), cardIdFor('linear', '1'), { status: 'open' })
    await run(fake)
    expect(fake.issues.get('1')?.state.name).toBe('Todo')

    fake.edit('1', { state: stateIn('t1', 'doing') })
    await run(fake)
    expect(card('1')?.status).toBe('open')
    expect(linkOfCard('1')?.stateName).toBe('In Progress')
    fake.edit('1', { state: stateIn('t1', 'canceled') })
    await run(fake)
    expect(card('1')?.status).toBe('done')
    expect(linkOfCard('1')?.stateName).toBe('Canceled')
  })

  it('lets Linear keep its state when the key can only read the team, and says so', async () => {
    const fake = fakeLinear([issue('1')])
    await run(fake)
    fake.readOnlyTeams.add('t1')
    updateItem(getDb(), cardIdFor('linear', '1'), { status: 'done' })
    await run(fake)
    expect(card('1')?.status).toBe('open')
    expect(linkOfCard('1')?.problem).toBe('This key can only read Engineering\'s issues, so Linear kept it open.')
    expect([...readOnly]).toStrictEqual(['t1'])
  })
})

describe('title, description and date, both ways', () => {
  it('takes Linear\'s changes and sends the card\'s, keeping dates as whole days', async () => {
    const fake = fakeLinear([issue('1')])
    await run(fake)
    fake.edit('1', { title: 'Fix the login page' })
    await run(fake)
    expect(card('1')?.title).toBe('Fix the login page')

    updateItem(getDb(), cardIdFor('linear', '1'), { body: 'Repro attached', due_at: moment(new Date(2026, 9, 14, 15, 30)) })
    await run(fake)
    expect(fake.calls.at(-1)).toBe('update 1 {"description":"Repro attached","dueDate":"2026-10-14"}')
    expect(card('1')?.due_at).toBe(allDay({ year: 2026, month: 9, day: 14 }))
    fake.calls.length = 0
    await run(fake)
    expect(fake.calls).toStrictEqual([])
  })
})

describe('leaving', () => {
  it('marks the card of an issue deleted, unassigned or moved to a team nobody follows, and moves it to one somebody does', async () => {
    setTeamChoice('design', 't2', 'all')
    const fake = fakeLinear([issue('1'), issue('2'), issue('3')])
    await run(fake)
    fake.edit('1', { trashed: true })
    fake.edit('2', { assigneeId: 'someone' })
    fake.edit('3', { teamId: 't2', identifier: 'DES-4', state: stateIn('t2', 'todo') })
    await run(fake)
    expect(linkOfCard('1')?.state).toBe('gone')
    expect(linkOfCard('2')?.state).toBe('gone')
    expect(card('3')?.context).toBe('design')
    expect(linkOfCard('3')).toMatchObject({ ref: 'DES-4', place: 'Design', state: 'open' })

    fake.edit('3', { teamId: 't3', state: stateIn('t3', 'todo') })
    await run(fake)
    expect(linkOfCard('3')?.state).toBe('gone')
  })
})
