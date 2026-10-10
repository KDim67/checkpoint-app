import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDb, deleteItem, getAgreed, getDb, getItemById, initDb, setSetting, updateItem } from '../src/main/db'
import { syncGitHub } from '../src/main/connections/github/sync'
import type { FailureKind, GitHubClient, RemoteIssue } from '../src/main/connections/github/client'
import { SyncService } from '../src/main/syncService'
import { issueCardId } from '../src/shared/github'
import { linkOf, type WorkspaceRepoView } from '../src/shared/connections'
import { allDay } from '../src/shared/dueDate'

// two computers, each its own database; GitHub is one fake both talk to

const dirs: Record<'A' | 'B', string> = { A: '', B: '' }
const on = (machine: 'A' | 'B'): void => {
  closeDb()
  initDb(dirs[machine])
}

let clock = Date.now()
const tick = (): number => (clock += 1000)

const remote = (number: number, extra: Partial<RemoteIssue> = {}): RemoteIssue => ({
  number,
  title: `Issue ${number}`,
  body: 'Steps to reproduce',
  state: 'open',
  updatedAt: tick(),
  assignees: ['octo'],
  labels: ['bug'],
  url: `https://github.com/octo/repo/issues/${number}`,
  milestoneDue: null,
  ...extra
})

function fakeGitHub(initial: RemoteIssue[]) {
  const issues = new Map(initial.map(i => [i.number, { ...i }]))
  const writes: [number, string][] = []
  let failing: FailureKind | null = null
  const client: GitHubClient = {
    me: async () => ({ ok: true, value: { login: 'octo', expiresAt: null } }),
    issues: async (_repo, query) => {
      let list = [...issues.values()]
      if (query.state === 'open') list = list.filter(i => i.state === 'open')
      if (query.assignee) list = list.filter(i => i.assignees.includes(query.assignee as string))
      if (query.since) list = list.filter(i => i.updatedAt >= Date.parse(query.since as string))
      return { ok: true, value: { issues: list.map(i => ({ ...i })), etag: null } }
    },
    setState: async (_repo, number, state) => {
      writes.push([number, state])
      if (failing) return { ok: false, kind: failing, message: failing === 'forbidden' ? 'GitHub refused: Resource not accessible by personal access token.' : "Couldn't reach GitHub: offline." }
      const issue = issues.get(number) as RemoteIssue
      Object.assign(issue, { state, updatedAt: tick() })
      return { ok: true, value: { ...issue } }
    }
  }
  return {
    client,
    issues,
    writes,
    edit: (number: number, patch: Partial<RemoteIssue>) => Object.assign(issues.get(number) as RemoteIssue, patch, { updatedAt: tick() }),
    fail: (kind: FailureKind | null) => { failing = kind }
  }
}

const workspace = (scope: 'assigned' | 'all' = 'assigned'): WorkspaceRepoView[] =>
  [{ slug: 'work', name: 'Work', repo: 'octo/repo', source: 'chosen', scope, readOnly: false }]

const run = (fake: ReturnType<typeof fakeGitHub>, scope: 'assigned' | 'all' = 'assigned', readOnly = new Set<string>()) =>
  syncGitHub({ db: getDb(), client: fake.client, login: 'octo', repos: workspace(scope), readOnly, now: () => Date.now() })

const card = (number: number) => getItemById(issueCardId('octo/repo', number))
const linkOfCard = (number: number) => linkOf(card(number)?.metadata ?? '{}')

beforeEach(() => {
  dirs.A = mkdtempSync(join(tmpdir(), 'checkpoint-gh-a-'))
  dirs.B = mkdtempSync(join(tmpdir(), 'checkpoint-gh-b-'))
  on('A')
  setSetting('contexts_list', JSON.stringify([{ slug: 'work', name: 'Work', color: '#535e85' }]))
})

afterEach(() => {
  closeDb()
  for (const dir of Object.values(dirs)) rmSync(dir, { recursive: true, force: true })
})

describe('issues coming in', () => {
  it('brings open issues assigned to you in as cards in the first column, with the link and the milestone date', async () => {
    const fake = fakeGitHub([
      remote(1, { milestoneDue: '2026-10-31T07:00:00Z' }),
      remote(2, { assignees: ['someone-else'] }),
      remote(3, { state: 'closed' })
    ])
    const report = await run(fake)
    expect(report).toStrictEqual({ changed: 1, problems: [] })
    expect(card(1)).toMatchObject({ context: 'work', type: 'card', status: 'open', title: 'Issue 1', due_at: allDay({ year: 2026, month: 9, day: 31 }) })
    expect(linkOfCard(1)).toStrictEqual({ service: 'github', id: 'octo/repo#1', url: 'https://github.com/octo/repo/issues/1', state: 'open', labels: ['bug'] })
    expect(card(2)).toBeNull()
    expect(card(3)).toBeNull()
  })

  it('brings in every open issue when the workspace asks for all of them', async () => {
    await run(fakeGitHub([remote(1), remote(2, { assignees: [] })]), 'all')
    expect(card(2)?.title).toBe('Issue 2')
  })

  it('keeps cards to GitHub\'s title, text and milestone, but leaves your own date when there is no milestone', async () => {
    const fake = fakeGitHub([remote(1)])
    await run(fake)
    updateItem(getDb(), issueCardId('octo/repo', 1), { due_at: allDay({ year: 2026, month: 11, day: 1 }) })
    fake.edit(1, { title: 'Renamed', body: 'New text' })
    await run(fake)
    expect(card(1)).toMatchObject({ title: 'Renamed', body: 'New text', due_at: allDay({ year: 2026, month: 11, day: 1 }) })
    fake.edit(1, { milestoneDue: '2026-11-15T00:00:00Z' })
    await run(fake)
    expect(card(1)?.due_at).toBe(allDay({ year: 2026, month: 10, day: 15 }))
  })
})

describe('open and closed, both ways', () => {
  it('moves the card to Done when the issue closes on GitHub, and back when it reopens', async () => {
    const fake = fakeGitHub([remote(1)])
    await run(fake)
    fake.edit(1, { state: 'closed' })
    await run(fake)
    expect([card(1)?.status, linkOfCard(1)?.state]).toStrictEqual(['done', 'closed'])
    fake.edit(1, { state: 'open' })
    await run(fake)
    expect([card(1)?.status, linkOfCard(1)?.state]).toStrictEqual(['open', 'open'])
    expect(fake.writes).toStrictEqual([])
  })

  it('closes the issue when the card moves to Done, and reopens it when the card leaves Done', async () => {
    const fake = fakeGitHub([remote(1)])
    await run(fake)
    updateItem(getDb(), issueCardId('octo/repo', 1), { status: 'done' })
    await run(fake)
    expect(fake.writes).toStrictEqual([[1, 'closed']])
    expect(getAgreed(getDb(), 'github', 'octo/repo#1')?.agreed).toBe('closed')
    updateItem(getDb(), issueCardId('octo/repo', 1), { status: 'in_progress' })
    await run(fake)
    expect(fake.writes).toStrictEqual([[1, 'closed'], [1, 'open']])
    expect(card(1)?.status).toBe('in_progress')
  })

  it('lets GitHub keep its state when the key can only read, and says so on the card', async () => {
    const fake = fakeGitHub([remote(1)])
    await run(fake)
    fake.fail('forbidden')
    updateItem(getDb(), issueCardId('octo/repo', 1), { status: 'done' })
    const readOnly = new Set<string>()
    await run(fake, 'assigned', readOnly)
    expect(card(1)?.status).toBe('open')
    expect(linkOfCard(1)?.problem).toContain('can only read')
    expect([...readOnly]).toStrictEqual(['octo/repo'])
  })

  it('keeps the card where you put it when GitHub can\'t be reached, and closes the issue on a later check', async () => {
    const fake = fakeGitHub([remote(1)])
    await run(fake)
    fake.fail('network')
    updateItem(getDb(), issueCardId('octo/repo', 1), { status: 'done' })
    const report = await run(fake)
    expect(card(1)?.status).toBe('done')
    expect(linkOfCard(1)?.problem).toContain('Waiting to close')
    expect(report.problems).toHaveLength(1)
    fake.fail(null)
    await run(fake)
    expect(fake.issues.get(1)?.state).toBe('closed')
    expect(linkOfCard(1)?.problem).toBeUndefined()
  })
})

describe('leaving', () => {
  it('never brings back a card you deleted', async () => {
    const fake = fakeGitHub([remote(1)])
    await run(fake)
    deleteItem(issueCardId('octo/repo', 1))
    await run(fake)
    fake.edit(1, { title: 'Still open' })
    await run(fake)
    expect(card(1)).toBeNull()
    expect(getAgreed(getDb(), 'github', 'octo/repo#1')?.agreed).toBe('ignored')
  })

  it('marks a card whose issue is no longer yours, and keeps it', async () => {
    const fake = fakeGitHub([remote(1)])
    await run(fake)
    fake.edit(1, { assignees: [] })
    await run(fake)
    expect(card(1)?.status).toBe('open')
    expect(linkOfCard(1)?.state).toBe('gone')
  })
})

describe('two computers', () => {
  it('make the same card for the same issue, so syncing never doubles it', async () => {
    const fake = fakeGitHub([remote(1)])
    await run(fake)
    const service = new SyncService()
    const fromA = service.getDatabasePayload()
    on('B')
    service.applyDatabasePayload(fromA)
    await run(fake)
    const titles = getDb().prepare('SELECT id FROM items WHERE title = ?').all('Issue 1') as { id: string }[]
    expect(titles).toStrictEqual([{ id: issueCardId('octo/repo', 1) }])
    expect(getAgreed(getDb(), 'github', 'octo/repo#1')?.agreed).toBe('open')
  })
})
