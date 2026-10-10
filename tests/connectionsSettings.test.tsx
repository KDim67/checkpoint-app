// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { ServiceStatusView } from '../src/shared/connections'

const bridge = vi.hoisted(() => ({
  views: [] as ServiceStatusView[],
  connected: null as ServiceStatusView | null,
  connectCalls: [] as [string, unknown][],
  repoCalls: [] as [string, string | null, string][],
  projectCalls: [] as [string, string | null][],
  teamCalls: [] as [string, string | null, string][],
  notionCalls: [] as [string, string | null, string | null, string | null][],
  folderCalls: [] as [string, string][],
  opened: [] as string[]
}))

vi.mock('../src/renderer/src/data/connections', () => ({
  list: vi.fn(async () => bridge.views),
  connect: vi.fn(async (service: string, key: unknown) => {
    bridge.connectCalls.push([service, key])
    return bridge.connected ? { ok: true, value: bridge.connected } : { ok: false, reason: 'Your GitHub key stopped working. Make a new one and connect again.' }
  }),
  disconnect: vi.fn(async () => ({ ...bridge.views[0], connected: false })),
  syncNow: vi.fn(async () => bridge.views[0]),
  setRepo: vi.fn(async (slug: string, repo: string | null, scope: string) => {
    bridge.repoCalls.push([slug, repo, scope])
    return { ok: true, value: bridge.views[0] }
  }),
  setProject: vi.fn(async (slug: string, project: string | null) => {
    bridge.projectCalls.push([slug, project])
    return { ok: true, value: bridge.views[bridge.views.length - 1] }
  }),
  pickFolder: vi.fn(async (slug: string) => {
    bridge.folderCalls.push(['pick', slug])
    return { ok: true, value: bridge.views[bridge.views.length - 1] }
  }),
  clearFolder: vi.fn(async (slug: string) => {
    bridge.folderCalls.push(['clear', slug])
    return bridge.views[bridge.views.length - 1]
  }),
  setNotionDatabase: vi.fn(async (slug: string, source: string | null, done?: string | null, date?: string | null) => {
    bridge.notionCalls.push([slug, source, done ?? null, date ?? null])
    return { ok: true, value: bridge.views[bridge.views.length - 1] }
  }),
  setJiraProject: vi.fn(async (slug: string, project: string | null, scope: string) => {
    bridge.teamCalls.push([slug, project, scope])
    return { ok: true, value: bridge.views[bridge.views.length - 1] }
  }),
  setTeam: vi.fn(async (slug: string, team: string | null, scope: string) => {
    bridge.teamCalls.push([slug, team, scope])
    return { ok: true, value: bridge.views[bridge.views.length - 1] }
  }),
  onChanged: () => () => {}
}))
vi.mock('../src/renderer/src/data/app', () => ({ openExternal: vi.fn(async (url: string) => { bridge.opened.push(url) }) }))
vi.mock('../src/renderer/src/components/ui/ConfirmDialog', () => ({ useConfirm: () => async () => true }))

import ConnectionsSettings from '../src/renderer/src/components/settings/ConnectionsSettings'
import { ToastProvider } from '../src/renderer/src/components/ui/Toast'

const disconnected: ServiceStatusView = { service: 'github', connected: false, login: null, expiresAt: null, lastOk: null, problem: null, repos: [] }
const connected: ServiceStatusView = {
  service: 'github', connected: true, login: 'octo', expiresAt: Date.UTC(2026, 10, 10), lastOk: Date.now(), problem: null,
  repos: [
    { slug: 'work', name: 'Work', repo: 'octo/work', source: 'folder', scope: 'assigned', readOnly: false },
    { slug: 'home', name: 'Home', repo: null, source: null, scope: 'assigned', readOnly: false }
  ]
}

async function show(): Promise<void> {
  await act(async () => {
    render(<ToastProvider><ConnectionsSettings /></ToastProvider>)
  })
}

beforeEach(() => {
  bridge.views = [disconnected]
  bridge.connected = null
  bridge.connectCalls = []
  bridge.repoCalls = []
  bridge.projectCalls = []
  bridge.teamCalls = []
  bridge.notionCalls = []
  bridge.folderCalls = []
  bridge.opened = []
})
afterEach(cleanup)

describe('the Connections tab', () => {
  it('sends you to make a key, then connects with the one you paste and clears the field', async () => {
    await show()
    fireEvent.click(screen.getByRole('button', { name: 'Make a key' }))
    expect(bridge.opened).toStrictEqual(['https://github.com/settings/personal-access-tokens/new'])

    bridge.connected = connected
    const field = screen.getByLabelText('GitHub key') as HTMLInputElement
    fireEvent.change(field, { target: { value: 'github_pat_abc123' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Connect' })) })
    expect(bridge.connectCalls).toStrictEqual([['github', 'github_pat_abc123']])
    expect(screen.getByText('@octo')).toBeTruthy()
    expect(screen.queryByLabelText('GitHub key')).toBeNull()
  })

  it('says in words why a key was refused, and keeps what you typed', async () => {
    await show()
    const field = screen.getByLabelText('GitHub key') as HTMLInputElement
    fireEvent.change(field, { target: { value: 'github_pat_old' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Connect' })) })
    expect(screen.getByRole('alert').textContent).toContain('stopped working')
    expect(field.value).toBe('github_pat_old')
  })

  it('shows where each workspace\'s repository comes from, and changes which issues it follows', async () => {
    bridge.views = [connected]
    await show()
    expect((screen.getByLabelText('Repository for Work') as HTMLInputElement).placeholder).toBe('octo/work')
    expect(screen.getByText('From the workspace\'s folder.')).toBeTruthy()
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Which issues for Work'), { target: { value: 'all' } })
    })
    const home = screen.getByLabelText('Repository for Home')
    fireEvent.change(home, { target: { value: 'octo/home' } })
    await act(async () => { fireEvent.blur(home) })
    expect(bridge.repoCalls).toStrictEqual([['work', null, 'all'], ['home', 'octo/home', 'assigned']])
  })
})

const todoistOff: ServiceStatusView = { service: 'todoist', connected: false, login: null, expiresAt: null, lastOk: null, problem: null, workspaces: [], projects: [] }
const todoistOn: ServiceStatusView = {
  service: 'todoist', connected: true, login: 'Maria Garcia', expiresAt: null, lastOk: Date.now(), problem: null,
  workspaces: [{ slug: 'work', name: 'Work', project: 'p1' }, { slug: 'home', name: 'Home', project: 'p9' }],
  projects: [{ id: 'p2', name: 'Chores' }, { id: 'p1', name: 'Groceries' }]
}

describe('Todoist on the Connections tab', () => {
  it('sends you to copy the API token, then connects with the one you paste', async () => {
    bridge.views = [disconnected, todoistOff]
    await show()
    const row = within(screen.getByRole('group', { name: 'Todoist' }))
    fireEvent.click(row.getByRole('button', { name: 'Open Todoist' }))
    expect(bridge.opened).toStrictEqual(['https://app.todoist.com/app/settings/integrations/developer'])
    bridge.connected = todoistOn
    fireEvent.change(row.getByLabelText('Todoist API token'), { target: { value: '0123456789abcdef0123456789abcdef01234567' } })
    await act(async () => { fireEvent.click(row.getByRole('button', { name: 'Connect' })) })
    expect(bridge.connectCalls).toStrictEqual([['todoist', '0123456789abcdef0123456789abcdef01234567']])
    expect(row.getByText('Maria Garcia')).toBeTruthy()
  })

  it('picks a project per workspace from the ones Todoist has, and says when one isn\'t known here', async () => {
    bridge.views = [connected, todoistOn]
    await show()
    const row = within(screen.getByRole('group', { name: 'Todoist' }))
    const work = row.getByLabelText('Todoist project for Work') as HTMLSelectElement
    expect([...work.options].map(o => o.textContent)).toStrictEqual(['Not following', 'Chores', 'Groceries'])
    expect(work.value).toBe('p1')
    const home = row.getByLabelText('Todoist project for Home') as HTMLSelectElement
    expect(home.selectedOptions[0].textContent).toBe('A project this computer hasn\'t seen')
    await act(async () => { fireEvent.change(work, { target: { value: 'p2' } }) })
    await act(async () => { fireEvent.change(home, { target: { value: '' } }) })
    expect(bridge.projectCalls).toStrictEqual([['work', 'p2'], ['home', null]])
  })
})

const linearOn: ServiceStatusView = {
  service: 'linear', connected: true, login: 'Maria Garcia', expiresAt: null, lastOk: Date.now(), problem: null,
  workspaces: [{ slug: 'work', name: 'Work', team: 't1', scope: 'assigned' }, { slug: 'home', name: 'Home', team: null, scope: 'assigned' }],
  teams: [{ id: 't2', key: 'DES', name: 'Design' }, { id: 't1', key: 'ENG', name: 'Engineering' }]
}

describe('Linear on the Connections tab', () => {
  it('sends you to make a key, then picks a team and whose issues for each workspace', async () => {
    bridge.views = [connected, { ...linearOn, connected: false, login: null, workspaces: [], teams: [] }]
    await show()
    fireEvent.click(within(screen.getByRole('group', { name: 'Linear' })).getByRole('button', { name: 'Make a key' }))
    expect(bridge.opened).toStrictEqual(['https://linear.app/settings/account/security'])
    cleanup()

    bridge.views = [connected, linearOn]
    await show()
    const row = within(screen.getByRole('group', { name: 'Linear' }))
    const work = row.getByLabelText('Linear team for Work') as HTMLSelectElement
    expect([...work.options].map(o => o.textContent)).toStrictEqual(['Not following', 'Design', 'Engineering'])
    expect((row.getByLabelText('Which issues for Home') as HTMLSelectElement).disabled).toBe(true)
    await act(async () => { fireEvent.change(row.getByLabelText('Which issues for Work'), { target: { value: 'all' } }) })
    await act(async () => { fireEvent.change(row.getByLabelText('Linear team for Home'), { target: { value: 't2' } }) })
    expect(bridge.teamCalls).toStrictEqual([['work', 't1', 'all'], ['home', 't2', 'assigned']])
  })
})

describe('Jira on the Connections tab', () => {
  it('asks for the address, the email and the token together, and names the site once connected', async () => {
    const jiraOff: ServiceStatusView = { service: 'jira', connected: false, site: null, login: null, expiresAt: null, lastOk: null, problem: null, workspaces: [], projects: [] }
    const jiraOn: ServiceStatusView = {
      ...jiraOff, connected: true, site: 'https://acme.atlassian.net', login: 'Maria Garcia', lastOk: Date.now(),
      workspaces: [{ slug: 'work', name: 'Work', project: null, scope: 'assigned' }], projects: [{ id: '100', key: 'ENG', name: 'Engineering' }]
    }
    bridge.views = [disconnected, jiraOff]
    await show()
    const row = within(screen.getByRole('group', { name: 'Jira' }))
    const connectButton = row.getByRole('button', { name: 'Connect' }) as HTMLButtonElement
    fireEvent.change(row.getByLabelText('Jira address'), { target: { value: 'acme' } })
    fireEvent.change(row.getByLabelText('Atlassian email'), { target: { value: 'maria@example.com' } })
    expect(connectButton.disabled).toBe(true)
    fireEvent.change(row.getByLabelText('Jira API token'), { target: { value: 'ATATT-token' } })
    bridge.connected = jiraOn
    await act(async () => { fireEvent.click(connectButton) })
    expect(bridge.connectCalls).toStrictEqual([['jira', { site: 'acme', email: 'maria@example.com', token: 'ATATT-token' }]])
    expect(row.getByText(/on acme\.atlassian\.net/)).toBeTruthy()
    await act(async () => { fireEvent.change(row.getByLabelText('Jira project for Work'), { target: { value: '100' } }) })
    expect(bridge.teamCalls).toStrictEqual([['work', '100', 'assigned']])
  })
})

describe('Notion on the Connections tab', () => {
  const DS = '11111111-1111-1111-1111-111111111111'
  const notionOn: ServiceStatusView = {
    service: 'notion', connected: true, login: 'Acme', expiresAt: null, lastOk: Date.now(), problem: null,
    sources: [{ id: DS, name: 'Tasks' }],
    workspaces: [
      { slug: 'work', name: 'Work', source: DS, done: 's1', date: 'd1', doneOptions: [{ id: 's1', name: 'Status' }, { id: 'c1', name: 'Shipped' }], dateOptions: [{ id: 'd1', name: 'Due' }], problem: null },
      { slug: 'home', name: 'Home', source: null, done: null, date: null, doneOptions: [], dateOptions: [], problem: null }
    ]
  }

  it('picks a database per workspace, and a column only where there is a choice to make', async () => {
    bridge.views = [connected, notionOn]
    await show()
    const row = within(screen.getByRole('group', { name: 'Notion' }))
    expect(row.getByLabelText('Done column for Work')).toBeTruthy()
    expect(row.queryByLabelText('Date column for Work')).toBeNull()
    await act(async () => { fireEvent.change(row.getByLabelText('Done column for Work'), { target: { value: 'c1' } }) })
    await act(async () => { fireEvent.change(row.getByLabelText('Notion database for Home'), { target: { value: DS } }) })
    expect(bridge.notionCalls).toStrictEqual([['work', DS, 'c1', 'd1'], ['home', DS, null, null]])
  })

  it('says what it found when there is nothing to choose, and why a database can\'t be followed', async () => {
    bridge.views = [connected, { ...notionOn, workspaces: [
      { ...(notionOn as { workspaces: object[] }).workspaces[0], doneOptions: [{ id: 's1', name: 'Status' }] },
      { slug: 'home', name: 'Home', source: DS, done: null, date: null, doneOptions: [], dateOptions: [], problem: 'This database has no Status or checkbox column to mean done, so it can\'t be followed.' }
    ] } as ServiceStatusView]
    await show()
    const row = within(screen.getByRole('group', { name: 'Notion' }))
    expect(row.getByText('Done is Status, the date is Due.')).toBeTruthy()
    expect(row.getByText(/no Status or checkbox column/)).toBeTruthy()
  })
})

describe('Obsidian on the Connections tab', () => {
  it('asks for no key, and chooses or stops following a folder per workspace', async () => {
    bridge.views = [disconnected, {
      service: 'obsidian', connected: true, login: null, expiresAt: null, lastOk: Date.now(), problem: null,
      workspaces: [{ slug: 'work', name: 'Work', folder: 'C:\Vaults\Game' }, { slug: 'home', name: 'Home', folder: null }]
    }]
    await show()
    const row = within(screen.getByRole('group', { name: 'Obsidian' }))
    expect(row.queryByRole('textbox')).toBeNull()
    expect(row.getByText('Following one folder on this computer.', { exact: false })).toBeTruthy()
    await act(async () => { fireEvent.click(row.getByRole('button', { name: 'Choose a folder for Home' })) })
    await act(async () => { fireEvent.click(row.getByRole('button', { name: 'Stop following Work\'s folder' })) })
    expect(bridge.folderCalls).toStrictEqual([['pick', 'home'], ['clear', 'work']])
  })
})
