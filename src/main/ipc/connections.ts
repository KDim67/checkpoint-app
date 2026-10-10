/** the Connections tab: what each service is doing, connecting and disconnecting, never a key back out */

import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { z } from 'zod'
import { IpcChannels } from '../../shared/ipcChannels'
import { getDb, readContextList, setSetting } from '../db'
import { getConnectionKey, removeConnectionKey, setConnectionKey } from '../connections/keys'
import { clearStatus, readStatus, writeStatus } from '../connections/status'
import { createGitHubClient } from '../connections/github/client'
import { setRepoChoice, workspaceRepos } from '../connections/github/repos'
import { createTodoistClient } from '../connections/todoist/client'
import { setProjectChoice, workspaceProjects } from '../connections/todoist/projects'
import { readTodoistState, SYNC_STATE_KEY as TODOIST_SYNC_STATE_KEY } from '../connections/todoist/sync'
import { createLinearClient } from '../connections/linear/client'
import { setTeamChoice, workspaceTeams } from '../connections/linear/teams'
import { readLinearState, SYNC_STATE_KEY as LINEAR_SYNC_STATE_KEY } from '../connections/linear/sync'
import { createJiraClient, readJiraCredentials } from '../connections/jira/client'
import { setJiraProjectChoice, workspaceJiraProjects } from '../connections/jira/projects'
import { JIRA_SYNC_STATE_KEY, readJiraState } from '../connections/jira/sync'
import { normalizeJiraSite } from '../../shared/jira'
import { createNotionClient } from '../connections/notion/client'
import { readNotionChoices, setNotionChoice } from '../connections/notion/databases'
import { NOTION_SYNC_STATE_KEY, readNotionState } from '../connections/notion/sync'
import { dateCandidates, doneCandidates, resolveColumns } from '../../shared/notion'
import { followedFolders, readFolderChoices, setFolderChoice } from '../connections/obsidian/folders'
import { OBSIDIAN_SYNC_STATE_KEY } from '../connections/obsidian/sync'
import { checkAll, checkService } from '../connections/scheduler'
import type { ConnectionResult, ConnectionService, GitHubStatusView, JiraStatusView, LinearStatusView, NotionStatusView, ObsidianStatusView, ServiceStatusView, TodoistStatusView } from '../../shared/connections'

// a GitHub key is a few dozen characters; anything far longer is a paste gone wrong
const KeyInput = z.string().trim().min(20).max(300)
// Todoist's token is forty letters and digits; this leaves room should that change, but not for spaces or a pasted sentence
const TokenInput = z.string().trim().min(20).max(200).regex(/^[A-Za-z0-9_-]+$/)
// a Linear key starts lin_api_ and runs to a few dozen letters and digits
const LinearKeyInput = z.string().trim().min(20).max(200).regex(/^lin_api_[A-Za-z0-9]+$/)
const JiraInput = z.object({
  site: z.string().max(300),
  email: z.string().trim().email().max(320),
  token: z.string().trim().min(10).max(500)
})
// an internal integration's secret: ntn_ now, secret_ for older ones
const NotionKeyInput = z.string().trim().min(20).max(200).regex(/^(ntn_|secret_)[A-Za-z0-9]+$/)
const SetNotionInput = z.object({
  slug: z.string().min(1).max(200),
  source: z.string().min(1).max(64).nullable(),
  done: z.string().min(1).max(80).nullable().optional(),
  date: z.string().min(1).max(80).nullable().optional()
})
const Service = z.enum(['github', 'todoist', 'linear', 'jira', 'notion', 'obsidian'])
const Slug = z.string().min(1).max(200)
const SetRepoInput = z.object({
  slug: z.string().min(1).max(200),
  repo: z.string().max(300).nullable(),
  scope: z.enum(['assigned', 'all'])
})
const SetProjectInput = z.object({
  slug: z.string().min(1).max(200),
  project: z.string().min(1).max(64).nullable()
})
const SetJiraProjectInput = z.object({
  slug: z.string().min(1).max(200),
  project: z.string().min(1).max(20).nullable(),
  scope: z.enum(['assigned', 'all'])
})
const SetTeamInput = z.object({
  slug: z.string().min(1).max(200),
  team: z.string().min(1).max(64).nullable(),
  scope: z.enum(['assigned', 'all'])
})

const workspaceExists = (slug: string): boolean => (readContextList(getDb()) ?? []).some(entry => entry.slug === slug)

export async function githubView(): Promise<GitHubStatusView> {
  const status = readStatus('github')
  const connected = getConnectionKey('github') !== null
  return {
    service: 'github',
    connected,
    login: connected ? status.login : null,
    expiresAt: connected ? status.expiresAt : null,
    lastOk: connected ? status.lastOk : null,
    problem: connected ? status.error : null,
    repos: await workspaceRepos(status.readOnlyRepos)
  }
}

export function todoistView(): TodoistStatusView {
  const status = readStatus('todoist')
  const connected = getConnectionKey('todoist') !== null
  const projects = Object.entries(readTodoistState().projects)
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name))
  return {
    service: 'todoist',
    connected,
    login: connected ? status.login : null,
    expiresAt: null,
    lastOk: connected ? status.lastOk : null,
    problem: connected ? status.error : null,
    workspaces: workspaceProjects(),
    projects
  }
}

export function linearView(): LinearStatusView {
  const status = readStatus('linear')
  const connected = getConnectionKey('linear') !== null
  const teams = Object.entries(readLinearState().teams)
    .map(([id, t]) => ({ id, key: t.key, name: t.name }))
    .sort((a, b) => a.name.localeCompare(b.name))
  return {
    service: 'linear',
    connected,
    login: connected ? status.login : null,
    expiresAt: null,
    lastOk: connected ? status.lastOk : null,
    problem: connected ? status.error : null,
    workspaces: workspaceTeams(),
    teams
  }
}

export function jiraView(): JiraStatusView {
  const status = readStatus('jira')
  const stored = getConnectionKey('jira')
  const creds = stored ? readJiraCredentials(stored) : null
  const projects = Object.entries(readJiraState().projects)
    .map(([id, p]) => ({ id, key: p.key, name: p.name }))
    .sort((a, b) => a.name.localeCompare(b.name))
  return {
    service: 'jira',
    connected: stored !== null,
    site: creds?.site ?? null,
    login: stored ? status.login : null,
    expiresAt: null,
    lastOk: stored ? status.lastOk : null,
    problem: stored ? status.error : null,
    workspaces: workspaceJiraProjects(),
    projects
  }
}

export function notionView(): NotionStatusView {
  const status = readStatus('notion')
  const connected = getConnectionKey('notion') !== null
  const state = readNotionState()
  const choices = readNotionChoices()
  const workspaces = (readContextList(getDb()) ?? []).map(entry => {
    const choice = choices[entry.slug]
    const schema = choice ? state.sources[choice.source]?.schema ?? [] : []
    const cols = schema.length > 0 ? resolveColumns(schema, choice) : null
    return {
      slug: entry.slug,
      name: typeof entry.name === 'string' && entry.name ? entry.name : entry.slug,
      source: choice?.source ?? null,
      done: cols?.done?.id ?? null,
      date: cols?.date?.id ?? null,
      doneOptions: doneCandidates(schema).map(p => ({ id: p.id, name: p.name })),
      dateOptions: dateCandidates(schema).map(p => ({ id: p.id, name: p.name })),
      problem: cols && !cols.done ? 'This database has no Status or checkbox column to mean done, so it can\'t be followed.' : null
    }
  })
  return {
    service: 'notion',
    connected,
    login: connected ? status.login : null,
    expiresAt: null,
    lastOk: connected ? status.lastOk : null,
    problem: connected ? status.error : null,
    sources: Object.entries(state.names).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
    workspaces
  }
}

export function obsidianView(): ObsidianStatusView {
  const status = readStatus('obsidian')
  const choices = readFolderChoices()
  const connected = followedFolders().size > 0
  return {
    service: 'obsidian',
    connected,
    login: null,
    expiresAt: null,
    lastOk: connected ? status.lastOk : null,
    problem: connected ? status.error : null,
    workspaces: (readContextList(getDb()) ?? []).map(entry => ({
      slug: entry.slug,
      name: typeof entry.name === 'string' && entry.name ? entry.name : entry.slug,
      folder: choices[entry.slug] ?? null
    }))
  }
}

/** a workspace stops following its folder; the notes stay as they are, the cards stop following them */
export function clearObsidianFolder(slug: unknown): ObsidianStatusView {
  const parsed = Slug.safeParse(slug)
  if (parsed.success) setFolderChoice(parsed.data, null)
  // nothing followed any more: what was seen is forgotten, so a folder followed later is read afresh
  if (followedFolders().size === 0) {
    setSetting(OBSIDIAN_SYNC_STATE_KEY, {})
    clearStatus('obsidian')
  }
  return obsidianView()
}

async function viewOf(service: ConnectionService): Promise<ServiceStatusView> {
  if (service === 'github') return githubView()
  if (service === 'obsidian') return obsidianView()
  if (service === 'jira') return jiraView()
  if (service === 'notion') return notionView()
  return service === 'todoist' ? todoistView() : linearView()
}

export async function connectGitHub(key: unknown, fetchImpl: typeof fetch = (input, init) => fetch(input, init)): Promise<ConnectionResult<GitHubStatusView>> {
  const parsed = KeyInput.safeParse(key)
  if (!parsed.success) return { ok: false, reason: 'Paste the whole key from GitHub; it starts with github_pat_.' }
  const me = await createGitHubClient(parsed.data, { fetch: fetchImpl, now: () => Date.now() }).me()
  if (!me.ok) return { ok: false, reason: me.message }
  setConnectionKey('github', parsed.data)
  clearStatus('github')
  writeStatus('github', { login: me.value.login, expiresAt: me.value.expiresAt })
  return { ok: true, value: await githubView() }
}

export async function connectTodoist(key: unknown, fetchImpl: typeof fetch = (input, init) => fetch(input, init)): Promise<ConnectionResult<TodoistStatusView>> {
  const parsed = TokenInput.safeParse(key)
  if (!parsed.success) return { ok: false, reason: 'Paste the whole API token from Todoist; it is forty letters and digits.' }
  const me = await createTodoistClient(parsed.data, { fetch: fetchImpl, now: () => Date.now() }).me()
  if (!me.ok) return { ok: false, reason: me.message }
  setConnectionKey('todoist', parsed.data)
  clearStatus('todoist')
  writeStatus('todoist', { login: me.value.name })
  return { ok: true, value: todoistView() }
}

export async function connectLinear(key: unknown, fetchImpl: typeof fetch = (input, init) => fetch(input, init)): Promise<ConnectionResult<LinearStatusView>> {
  const parsed = LinearKeyInput.safeParse(key)
  if (!parsed.success) return { ok: false, reason: 'Paste the whole key from Linear; it starts with lin_api_.' }
  const me = await createLinearClient(parsed.data, { fetch: fetchImpl, now: () => Date.now() }).me()
  if (!me.ok) return { ok: false, reason: me.message }
  setConnectionKey('linear', parsed.data)
  clearStatus('linear')
  writeStatus('linear', { login: me.value.name })
  return { ok: true, value: linearView() }
}

export async function connectJira(input: unknown, fetchImpl: typeof fetch = (url, init) => fetch(url, init)): Promise<ConnectionResult<JiraStatusView>> {
  const parsed = JiraInput.safeParse(input)
  if (!parsed.success) return { ok: false, reason: 'Fill in your Jira address, the email you sign in to Atlassian with, and an API token.' }
  const site = normalizeJiraSite(parsed.data.site)
  if (!site) return { ok: false, reason: 'That isn\'t a Jira Cloud address; it looks like yourname.atlassian.net.' }
  const creds = { site, email: parsed.data.email, token: parsed.data.token }
  const me = await createJiraClient(creds, { fetch: fetchImpl, now: () => Date.now() }).me()
  if (!me.ok) return { ok: false, reason: me.message }
  setConnectionKey('jira', JSON.stringify(creds))
  clearStatus('jira')
  writeStatus('jira', { login: me.value.name })
  return { ok: true, value: jiraView() }
}

export async function connectNotion(key: unknown, fetchImpl: typeof fetch = (url, init) => fetch(url, init)): Promise<ConnectionResult<NotionStatusView>> {
  const parsed = NotionKeyInput.safeParse(key)
  if (!parsed.success) return { ok: false, reason: 'Paste the integration\'s whole secret from Notion; it starts with ntn_.' }
  const me = await createNotionClient(parsed.data, { fetch: fetchImpl, now: () => Date.now() }).me()
  if (!me.ok) return { ok: false, reason: me.message }
  setConnectionKey('notion', parsed.data)
  clearStatus('notion')
  writeStatus('notion', { login: me.value.name })
  return { ok: true, value: notionView() }
}

/** the cards stay, they just stop following GitHub; this computer forgets where it had read up to */
export async function disconnectGitHub(): Promise<GitHubStatusView> {
  removeConnectionKey('github')
  clearStatus('github')
  setSetting('github_sync_state', {})
  return githubView()
}

/** the cards stay, they just stop following Todoist; another account's token would not understand where this one read up to */
export function disconnectTodoist(): TodoistStatusView {
  removeConnectionKey('todoist')
  clearStatus('todoist')
  setSetting(TODOIST_SYNC_STATE_KEY, {})
  return todoistView()
}

/** the cards stay, they just stop following Linear; this computer forgets where it had read up to */
export function disconnectLinear(): LinearStatusView {
  removeConnectionKey('linear')
  clearStatus('linear')
  setSetting(LINEAR_SYNC_STATE_KEY, {})
  return linearView()
}

/** the cards stay, they just stop following Jira; this computer forgets where it had read up to */
export function disconnectJira(): JiraStatusView {
  removeConnectionKey('jira')
  clearStatus('jira')
  setSetting(JIRA_SYNC_STATE_KEY, {})
  return jiraView()
}

export function setJiraProject(input: unknown): ConnectionResult<JiraStatusView> {
  const parsed = SetJiraProjectInput.safeParse(input)
  if (!parsed.success) return { ok: false, reason: 'That change could not be read.' }
  const { slug, project, scope } = parsed.data
  if (!workspaceExists(slug)) return { ok: false, reason: 'That workspace no longer exists.' }
  const saved = setJiraProjectChoice(slug, project, scope)
  if (!saved.ok) return saved
  return { ok: true, value: jiraView() }
}

/** the cards stay, they just stop following Notion; this computer forgets where it had read up to */
export function disconnectNotion(): NotionStatusView {
  removeConnectionKey('notion')
  clearStatus('notion')
  setSetting(NOTION_SYNC_STATE_KEY, {})
  return notionView()
}

export function setNotionDatabase(input: unknown): ConnectionResult<NotionStatusView> {
  const parsed = SetNotionInput.safeParse(input)
  if (!parsed.success) return { ok: false, reason: 'That change could not be read.' }
  const { slug, source, done, date } = parsed.data
  if (!workspaceExists(slug)) return { ok: false, reason: 'That workspace no longer exists.' }
  const saved = setNotionChoice(slug, { source, done, date })
  if (!saved.ok) return saved
  return { ok: true, value: notionView() }
}

export function setLinearTeam(input: unknown): ConnectionResult<LinearStatusView> {
  const parsed = SetTeamInput.safeParse(input)
  if (!parsed.success) return { ok: false, reason: 'That change could not be read.' }
  const { slug, team, scope } = parsed.data
  if (!workspaceExists(slug)) return { ok: false, reason: 'That workspace no longer exists.' }
  const saved = setTeamChoice(slug, team, scope)
  if (!saved.ok) return saved
  return { ok: true, value: linearView() }
}

export function setTodoistProject(input: unknown): ConnectionResult<TodoistStatusView> {
  const parsed = SetProjectInput.safeParse(input)
  if (!parsed.success) return { ok: false, reason: 'That change could not be read.' }
  const { slug, project } = parsed.data
  if (!workspaceExists(slug)) return { ok: false, reason: 'That workspace no longer exists.' }
  const saved = setProjectChoice(slug, project)
  if (!saved.ok) return saved
  return { ok: true, value: todoistView() }
}

export function registerConnectionsHandlers(): void {
  ipcMain.handle(IpcChannels.CONNECTIONS_LIST, async (): Promise<ServiceStatusView[]> => [await githubView(), todoistView(), linearView(), jiraView(), notionView(), obsidianView()])

  ipcMain.handle(IpcChannels.CONNECTIONS_CONNECT, async (_event, service: unknown, key: unknown): Promise<ConnectionResult<ServiceStatusView>> => {
    const which = Service.safeParse(service)
    if (!which.success) return { ok: false, reason: 'Checkpoint does not connect to that.' }
    if (which.data === 'obsidian') return { ok: false, reason: 'Obsidian needs no key; choose a folder for a workspace instead.' }
    const connectors = { github: connectGitHub, todoist: connectTodoist, linear: connectLinear, jira: connectJira, notion: connectNotion }
    const result: ConnectionResult<ServiceStatusView> = await connectors[which.data](key)
    // the first check runs on its own, so the tab says connected straight away
    if (result.ok) void checkService(which.data, 'now')
    return result
  })

  ipcMain.handle(IpcChannels.CONNECTIONS_DISCONNECT, async (_event, service: unknown): Promise<ServiceStatusView> => {
    const which = Service.parse(service)
    if (which === 'github') return disconnectGitHub()
    if (which === 'jira') return disconnectJira()
    if (which === 'notion') return disconnectNotion()
    if (which === 'obsidian') {
      for (const slug of Object.keys(readFolderChoices())) setFolderChoice(slug, null)
      return clearObsidianFolder(null)
    }
    return which === 'todoist' ? disconnectTodoist() : disconnectLinear()
  })

  ipcMain.handle(IpcChannels.CONNECTIONS_SYNC_NOW, async (_event, service: unknown): Promise<ServiceStatusView> => {
    const which = Service.parse(service)
    await checkService(which, 'now')
    return viewOf(which)
  })

  ipcMain.handle(IpcChannels.CONNECTIONS_SET_REPO, async (_event, input: unknown): Promise<ConnectionResult<ServiceStatusView>> => {
    const parsed = SetRepoInput.safeParse(input)
    if (!parsed.success) return { ok: false, reason: 'That change could not be read.' }
    const { slug, repo, scope } = parsed.data
    if (!workspaceExists(slug)) return { ok: false, reason: 'That workspace no longer exists.' }
    const saved = setRepoChoice(slug, repo, scope)
    if (!saved.ok) return saved
    void checkService('github', 'now')
    return { ok: true, value: await githubView() }
  })

  ipcMain.handle(IpcChannels.CONNECTIONS_SET_PROJECT, async (_event, input: unknown): Promise<ConnectionResult<ServiceStatusView>> => {
    const result = setTodoistProject(input)
    if (result.ok) void checkService('todoist', 'now')
    return result
  })

  ipcMain.handle(IpcChannels.CONNECTIONS_SET_TEAM, async (_event, input: unknown): Promise<ConnectionResult<ServiceStatusView>> => {
    const result = setLinearTeam(input)
    if (result.ok) void checkService('linear', 'now')
    return result
  })

  ipcMain.handle(IpcChannels.CONNECTIONS_SET_JIRA_PROJECT, async (_event, input: unknown): Promise<ConnectionResult<ServiceStatusView>> => {
    const result = setJiraProject(input)
    if (result.ok) void checkService('jira', 'now')
    return result
  })

  ipcMain.handle(IpcChannels.CONNECTIONS_SET_NOTION_DATABASE, async (_event, input: unknown): Promise<ConnectionResult<ServiceStatusView>> => {
    const result = setNotionDatabase(input)
    if (result.ok) void checkService('notion', 'now')
    return result
  })

  ipcMain.handle(IpcChannels.CONNECTIONS_PICK_FOLDER, async (_event, slug: unknown): Promise<ConnectionResult<ServiceStatusView>> => {
    const parsed = Slug.safeParse(slug)
    if (!parsed.success || !workspaceExists(parsed.data)) return { ok: false, reason: 'That workspace no longer exists.' }
    const window = BrowserWindow.getFocusedWindow()
    const options = { title: 'Choose a vault, or a folder inside one', properties: ['openDirectory' as const] }
    const { canceled, filePaths } = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options)
    if (canceled || filePaths.length === 0) return { ok: true, value: obsidianView() }
    setFolderChoice(parsed.data, filePaths[0])
    void checkService('obsidian', 'now')
    return { ok: true, value: obsidianView() }
  })

  ipcMain.handle(IpcChannels.CONNECTIONS_CLEAR_FOLDER, async (_event, slug: unknown): Promise<ServiceStatusView> => clearObsidianFolder(slug))

  // coming back to Checkpoint is when cards are most likely to be looked at
  app.on('browser-window-focus', () => { void checkAll('focus') })
}
