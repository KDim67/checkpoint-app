import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDb, getSetting, initDb, setSetting } from '../src/main/db'
import { clearObsidianFolder, connectGitHub, connectJira, connectLinear, connectNotion, connectTodoist, disconnectGitHub, disconnectJira, disconnectLinear, disconnectNotion, disconnectTodoist, githubView, jiraView, linearView, notionView, obsidianView, setJiraProject, setLinearTeam, setNotionDatabase, setTodoistProject, todoistView } from '../src/main/ipc/connections'
import { getConnectionKey } from '../src/main/connections/keys'
import { backoffMs, checkService, isDue } from '../src/main/connections/scheduler'
import { readStatus, type ServiceStatus } from '../src/main/connections/status'
import { setRepoChoice, workspaceRepos } from '../src/main/connections/github/repos'

const KEY = 'github_pat_11ABCDEFG0123456789_abcdefghijklmnop'
let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'checkpoint-conn-ipc-'))
  initDb(dir)
  setSetting('contexts_list', JSON.stringify([
    { slug: 'work', name: 'Work', color: '#535e85', gitPath: 'C:/code/work' },
    { slug: 'home', name: 'Home', color: '#535e85' }
  ]))
})

afterEach(() => {
  closeDb()
  rmSync(dir, { recursive: true, force: true })
})

const answering = (status: number, body: unknown): typeof fetch =>
  (async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })) as typeof fetch

describe('connecting GitHub', () => {
  it('checks the key with GitHub, keeps it in main, and never shows it again', async () => {
    const result = await connectGitHub(KEY, answering(200, { login: 'octo' }))
    expect(result).toMatchObject({ ok: true, value: { connected: true, login: 'octo' } })
    expect(getConnectionKey('github')).toBe(KEY)
    expect(JSON.stringify(await githubView())).not.toContain(KEY)
  })

  it('refuses a key GitHub turns down, saying why, and keeps nothing', async () => {
    expect(await connectGitHub(KEY, answering(401, { message: 'Bad credentials' })))
      .toStrictEqual({ ok: false, reason: 'Your GitHub key stopped working. Make a new one and connect again.' })
    expect(await connectGitHub('short', answering(200, { login: 'octo' }))).toMatchObject({ ok: false, reason: expect.stringContaining('github_pat_') })
    expect(getConnectionKey('github')).toBeNull()
  })

  it('forgets the key and the status on disconnect', async () => {
    await connectGitHub(KEY, answering(200, { login: 'octo' }))
    const view = await disconnectGitHub()
    expect(view).toMatchObject({ connected: false, login: null })
    expect(getConnectionKey('github')).toBeNull()
    expect(readStatus('github').login).toBeNull()
  })
})

describe('which repository a workspace follows', () => {
  it('comes from its folder\'s GitHub remote, unless one was picked here', async () => {
    const remote = async (folder: string) => (folder === 'C:/code/work' ? 'git@github.com:octo/work.git' : '')
    expect((await workspaceRepos([], remote)).map(r => [r.slug, r.repo, r.source, r.scope])).toStrictEqual([
      ['work', 'octo/work', 'folder', 'assigned'],
      ['home', null, null, 'assigned']
    ])
    expect(setRepoChoice('home', 'https://github.com/octo/home.git', 'all')).toStrictEqual({ ok: true })
    expect(setRepoChoice('work', 'not a repo', 'assigned')).toMatchObject({ ok: false })
    const repos = await workspaceRepos(['octo/home'], remote)
    expect(repos.find(r => r.slug === 'home')).toMatchObject({ repo: 'octo/home', source: 'chosen', scope: 'all', readOnly: true })
  })
})

describe('when to check', () => {
  const status = (over: Partial<ServiceStatus>): ServiceStatus => ({
    login: 'octo', expiresAt: null, lastOk: null, lastAttempt: null, error: null, failures: 0,
    rateResetAt: null, noticedExpiry: null, noticedFailure: false, readOnlyRepos: [], ...over
  })
  const now = Date.UTC(2026, 9, 10, 12)

  it('every five minutes, a minute after the window comes back, and whenever asked', () => {
    expect(isDue(status({}), now, 'timer')).toBe(true)
    expect(isDue(status({ lastAttempt: now - 4 * 60_000 }), now, 'timer')).toBe(false)
    expect(isDue(status({ lastAttempt: now - 5 * 60_000 }), now, 'timer')).toBe(true)
    expect(isDue(status({ lastAttempt: now - 61_000 }), now, 'focus')).toBe(true)
    expect(isDue(status({ lastAttempt: now - 1000 }), now, 'now')).toBe(true)
  })

  it('backs off after failures and never asks before a rate limit resets, even when asked', () => {
    expect([backoffMs(1), backoffMs(2), backoffMs(10)]).toStrictEqual([5 * 60_000, 10 * 60_000, 60 * 60_000])
    expect(isDue(status({ lastAttempt: now - 6 * 60_000, failures: 2 }), now, 'timer')).toBe(false)
    expect(isDue(status({ rateResetAt: now + 60_000 }), now, 'now')).toBe(false)
  })
})

const TOKEN = '0123456789abcdef0123456789abcdef01234567'

/** api.todoist.com and api.github.com answered by path, so one check can talk to both */
const routes = (table: Record<string, () => Response>): typeof fetch =>
  (async (input: string | URL | Request) => {
    const url = String(input)
    const hit = Object.keys(table).find(prefix => url.startsWith(prefix))
    if (!hit) throw new Error(`unexpected ${url}`)
    return table[hit]()
  }) as typeof fetch

const okJson = (body: unknown) => () => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })

describe('connecting Todoist', () => {
  it('checks the token with Todoist, keeps it in main, and shows the name, not the token', async () => {
    const result = await connectTodoist(TOKEN, answering(200, { full_name: 'Maria Garcia', email: 'maria@example.com' }))
    expect(result).toMatchObject({ ok: true, value: { service: 'todoist', connected: true, login: 'Maria Garcia', expiresAt: null } })
    expect(getConnectionKey('todoist')).toBe(TOKEN)
    const shown = JSON.stringify(todoistView())
    expect(shown).not.toContain(TOKEN)
    expect(shown).not.toContain('maria@example.com')
  })

  it('refuses a token Todoist turns down, or one that isn\'t whole, saying why', async () => {
    expect(await connectTodoist(TOKEN, answering(401, {}))).toMatchObject({ ok: false, reason: expect.stringContaining('stopped working') })
    expect(await connectTodoist('abc', answering(200, { full_name: 'Maria' }))).toMatchObject({ ok: false, reason: expect.stringContaining('API token') })
    expect(getConnectionKey('todoist')).toBeNull()
  })

  it('forgets the token, the status and where it had read up to on disconnect', async () => {
    await connectTodoist(TOKEN, answering(200, { full_name: 'Maria Garcia' }))
    setSetting('todoist_sync_state', { token: 'abc', followed: [], projects: { p1: 'Groceries' }, taskProjects: {} })
    expect(disconnectTodoist()).toMatchObject({ connected: false, login: null, projects: [] })
    expect(getConnectionKey('todoist')).toBeNull()
    expect(readStatus('todoist').login).toBeNull()
  })
})

describe('which Todoist project a workspace follows', () => {
  it('can be picked and cleared, lists the projects last seen by name, and refuses an unknown workspace', async () => {
    setSetting('todoist_sync_state', { token: 'abc', followed: [], projects: { p2: 'Chores', p1: 'Groceries' }, taskProjects: {} })
    expect(setTodoistProject({ slug: 'home', project: 'p1' })).toMatchObject({ ok: true })
    expect(todoistView().workspaces).toStrictEqual([
      { slug: 'work', name: 'Work', project: null },
      { slug: 'home', name: 'Home', project: 'p1' }
    ])
    expect(todoistView().projects).toStrictEqual([{ id: 'p2', name: 'Chores' }, { id: 'p1', name: 'Groceries' }])
    expect(setTodoistProject({ slug: 'home', project: null })).toMatchObject({ ok: true })
    expect(todoistView().workspaces[1].project).toBeNull()
    expect(setTodoistProject({ slug: 'nowhere', project: 'p1' })).toMatchObject({ ok: false, reason: expect.stringContaining('no longer exists') })
  })
})

describe('checking each service', () => {
  it('keeps one service\'s trouble out of another\'s', async () => {
    await connectGitHub(KEY, answering(200, { login: 'octo' }))
    await connectTodoist(TOKEN, answering(200, { full_name: 'Maria Garcia' }))
    const fetchBoth = routes({
      'https://api.github.com/': () => new Response(JSON.stringify({ message: 'Bad credentials' }), { status: 401 }),
      'https://api.todoist.com/api/v1/user': okJson({ full_name: 'Maria Garcia' }),
      'https://api.todoist.com/api/v1/sync': okJson({ sync_token: 't1', full_sync: true, items: [], projects: [{ id: 'p1', name: 'Groceries' }] })
    })
    const deps = { fetch: fetchBoth, readRemote: async () => '', now: () => Date.now() }
    await checkService('github', 'now', deps)
    await checkService('todoist', 'now', deps)
    expect(readStatus('github')).toMatchObject({ failures: 1, error: expect.stringContaining('stopped working') })
    expect(readStatus('todoist')).toMatchObject({ failures: 0, error: null, login: 'Maria Garcia' })
    expect(readStatus('todoist').lastOk).not.toBeNull()
    expect(todoistView().projects).toStrictEqual([{ id: 'p1', name: 'Groceries' }])
  })
})

const LINEAR_KEY = 'lin_api_0123456789abcdefABCDEF0123456789abcdef'

describe('connecting Linear', () => {
  it('checks the key with Linear, keeps it in main, and shows the name, not the key', async () => {
    const result = await connectLinear(LINEAR_KEY, answering(200, { data: { viewer: { id: 'u1', name: 'Maria Garcia' } } }))
    expect(result).toMatchObject({ ok: true, value: { service: 'linear', connected: true, login: 'Maria Garcia' } })
    expect(getConnectionKey('linear')).toBe(LINEAR_KEY)
    expect(JSON.stringify(linearView())).not.toContain(LINEAR_KEY)
  })

  it('refuses a key Linear turns down, or one that isn\'t a Linear key, saying why', async () => {
    expect(await connectLinear(LINEAR_KEY, answering(400, { errors: [{ message: 'Authentication required', extensions: { code: 'AUTHENTICATION_ERROR' } }] })))
      .toMatchObject({ ok: false, reason: expect.stringContaining('stopped working') })
    expect(await connectLinear(KEY, answering(200, {}))).toMatchObject({ ok: false, reason: expect.stringContaining('lin_api_') })
    expect(getConnectionKey('linear')).toBeNull()
  })

  it('picks a team and whose issues per workspace, forgets everything on disconnect, and refuses an unknown workspace', async () => {
    await connectLinear(LINEAR_KEY, answering(200, { data: { viewer: { id: 'u1', name: 'Maria Garcia' } } }))
    setSetting('linear_sync_state', { cursor: null, followed: [], teams: { t2: { key: 'DES', name: 'Design' }, t1: { key: 'ENG', name: 'Engineering' } }, issueTeams: {} })
    expect(setLinearTeam({ slug: 'work', team: 't1', scope: 'all' })).toMatchObject({ ok: true })
    expect(linearView().workspaces[0]).toStrictEqual({ slug: 'work', name: 'Work', team: 't1', scope: 'all' })
    expect(linearView().teams.map(t => t.name)).toStrictEqual(['Design', 'Engineering'])
    expect(setLinearTeam({ slug: 'nowhere', team: 't1', scope: 'all' })).toMatchObject({ ok: false })
    expect(disconnectLinear()).toMatchObject({ connected: false, teams: [] })
    expect(getConnectionKey('linear')).toBeNull()
  })
})

describe('connecting Jira', () => {
  const details = { site: 'acme', email: 'maria@example.com', token: 'ATATT-test-token-123' }

  it('checks the details with that site, keeps them in main, and shows the name and site, never the token', async () => {
    const result = await connectJira(details, answering(200, { accountId: 'acc-1', displayName: 'Maria Garcia' }))
    expect(result).toMatchObject({ ok: true, value: { service: 'jira', connected: true, login: 'Maria Garcia', site: 'https://acme.atlassian.net' } })
    expect(JSON.parse(getConnectionKey('jira') ?? '{}')).toStrictEqual({ site: 'https://acme.atlassian.net', email: 'maria@example.com', token: 'ATATT-test-token-123' })
    expect(JSON.stringify(jiraView())).not.toContain('ATATT')
  })

  it('refuses an address that isn\'t Jira Cloud, missing details, or ones Jira turns down, saying why', async () => {
    expect(await connectJira({ ...details, site: 'jira.mycompany.com' }, answering(200, {}))).toMatchObject({ ok: false, reason: expect.stringContaining('atlassian.net') })
    expect(await connectJira({ ...details, email: '' }, answering(200, {}))).toMatchObject({ ok: false, reason: expect.stringContaining('email') })
    expect(await connectJira(details, answering(401, {}))).toMatchObject({ ok: false, reason: expect.stringContaining('stopped working') })
    expect(getConnectionKey('jira')).toBeNull()
  })

  it('picks a project and whose issues per workspace, and forgets everything on disconnect', async () => {
    await connectJira(details, answering(200, { accountId: 'acc-1', displayName: 'Maria Garcia' }))
    setSetting('jira_sync_state', { projects: { '200': { key: 'DES', name: 'Design' }, '100': { key: 'ENG', name: 'Engineering' } }, issues: {} })
    expect(setJiraProject({ slug: 'home', project: '100', scope: 'all' })).toMatchObject({ ok: true })
    expect(jiraView().workspaces[1]).toStrictEqual({ slug: 'home', name: 'Home', project: '100', scope: 'all' })
    expect(jiraView().projects.map(p => p.name)).toStrictEqual(['Design', 'Engineering'])
    expect(setJiraProject({ slug: 'home', project: 'ENG', scope: 'all' })).toMatchObject({ ok: false })
    expect(disconnectJira()).toMatchObject({ connected: false, site: null, projects: [] })
    expect(getConnectionKey('jira')).toBeNull()
  })
})

describe('connecting Notion', () => {
  const SECRET = 'ntn_1234567890abcdefghijklmnopqrstuvwxyzABCD'
  const DS = '11111111-1111-1111-1111-111111111111'

  it('checks the secret with Notion, keeps it in main, and shows the workspace, never the secret', async () => {
    const result = await connectNotion(SECRET, answering(200, { object: 'user', type: 'bot', name: 'Checkpoint', bot: { workspace_name: 'Acme' } }))
    expect(result).toMatchObject({ ok: true, value: { service: 'notion', connected: true, login: 'Acme' } })
    expect(getConnectionKey('notion')).toBe(SECRET)
    expect(JSON.stringify(notionView())).not.toContain(SECRET)
    expect(await connectNotion('github_pat_nope_nope_nope', answering(200, {}))).toMatchObject({ ok: false, reason: expect.stringContaining('ntn_') })
  })

  it('shows the columns found for a workspace\'s database, offers a choice only when there is one, and says when it can\'t be followed', async () => {
    setSetting('notion_sync_state', {
      names: { [DS]: 'Tasks' },
      sources: { [DS]: { cursor: null, schema: [
        { id: 'title', name: 'Name', type: 'title' },
        { id: 's1', name: 'Status', type: 'status', groups: [{ name: 'To-do', optionIds: ['a'] }, { name: 'Complete', optionIds: ['b'] }] },
        { id: 'c1', name: 'Done', type: 'checkbox' },
        { id: 'd1', name: 'Due', type: 'date' }
      ] } },
      pages: {}
    })
    expect(setNotionDatabase({ slug: 'work', source: DS })).toMatchObject({ ok: true })
    expect(notionView().workspaces[0]).toStrictEqual({
      slug: 'work', name: 'Work', source: DS, done: 's1', date: 'd1',
      doneOptions: [{ id: 's1', name: 'Status' }, { id: 'c1', name: 'Done' }], dateOptions: [{ id: 'd1', name: 'Due' }], problem: null
    })
    expect(setNotionDatabase({ slug: 'work', source: DS, done: 'c1' })).toMatchObject({ ok: true, value: { workspaces: [{ done: 'c1' }, {}] } })
    expect(notionView().sources).toStrictEqual([{ id: DS, name: 'Tasks' }])
    expect(setNotionDatabase({ slug: 'nowhere', source: DS })).toMatchObject({ ok: false })
    expect(disconnectNotion()).toMatchObject({ connected: false, sources: [] })
  })
})

describe('following an Obsidian folder', () => {
  it('shows each workspace\'s folder, follows nothing until one is chosen, and forgets what it saw once none is followed', async () => {
    expect(obsidianView()).toMatchObject({ service: 'obsidian', connected: false, workspaces: [{ slug: 'work', folder: null }, { slug: 'home', folder: null }] })
    setSetting('obsidian_folders', { work: 'C:/Vault' })
    setSetting('obsidian_sync_state', { files: { 'C:/Vault/Inbox.md': { mtime: 1, size: 1 } }, tasks: {} })
    expect(obsidianView()).toMatchObject({ connected: true, workspaces: [{ slug: 'work', folder: 'C:/Vault' }, { slug: 'home', folder: null }] })
    expect(clearObsidianFolder('work')).toMatchObject({ connected: false })
    expect(getSetting('obsidian_sync_state', null)).toStrictEqual({})
  })
})
