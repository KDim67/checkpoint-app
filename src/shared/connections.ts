/** what a connected card carries, and what the Connections tab is shown; never a key */

import { v5 as uuidv5 } from 'uuid'
import { opensJira } from './jira'
import { opensNotion } from './notion'

export type ConnectionService = 'github' | 'todoist' | 'linear' | 'jira' | 'notion' | 'obsidian'

export const CONNECTION_SERVICES: readonly ConnectionService[] = ['github', 'todoist', 'linear', 'jira', 'notion', 'obsidian']

export interface ServiceInfo {
  name: string
  /** whether a card's link may open this address: only a page on the service's own site */
  opens: (url: string) => boolean
  /** "on GitHub", "in Todoist" */
  where: string
  /** what moving a card to Done does there */
  closeVerb: string
  /** the state Done stands for there */
  closedWord: string
  /** what an item is called, when its id means nothing to a person; null to show the id */
  noun: string | null
  /** what the service keeps, so the card only shows it */
  owns: { title: boolean; body: boolean }
  /** the short text on a card's badge */
  shortRef: (id: string) => string
}

export const SERVICES: Record<ConnectionService, ServiceInfo> = {
  github: {
    name: 'GitHub',
    opens: url => url.startsWith('https://github.com/'),
    where: 'on GitHub',
    closeVerb: 'close',
    closedWord: 'closed',
    noun: null,
    owns: { title: true, body: true },
    shortRef: id => id.slice(id.lastIndexOf('#'))
  },
  todoist: {
    name: 'Todoist',
    opens: url => url.startsWith('https://app.todoist.com/'),
    where: 'in Todoist',
    closeVerb: 'complete',
    closedWord: 'completed',
    noun: 'task',
    owns: { title: false, body: false },
    shortRef: () => ''
  },
  linear: {
    name: 'Linear',
    opens: url => url.startsWith('https://linear.app/'),
    where: 'in Linear',
    closeVerb: 'mark it done',
    closedWord: 'done',
    noun: 'issue',
    owns: { title: false, body: false },
    shortRef: () => ''
  },
  jira: {
    name: 'Jira',
    opens: opensJira,
    where: 'in Jira',
    closeVerb: 'move it to Done',
    closedWord: 'done',
    noun: 'issue',
    // Jira keeps descriptions in its own document format, so they are shown here and changed there
    owns: { title: false, body: true },
    shortRef: () => ''
  },
  notion: {
    name: 'Notion',
    opens: opensNotion,
    where: 'in Notion',
    closeVerb: 'mark it done',
    closedWord: 'done',
    noun: 'page',
    owns: { title: false, body: false },
    shortRef: () => ''
  },
  obsidian: {
    name: 'Obsidian',
    // only the open action, naming a vault and a note: nothing that runs a command
    opens: url => /^obsidian:\/\/open\?vault=[^&\s]+&file=[^&\s]+$/.test(url),
    where: 'in Obsidian',
    closeVerb: 'tick it',
    closedWord: 'done',
    noun: 'task',
    owns: { title: false, body: false },
    shortRef: () => ''
  }
}

export const isConnectionService = (value: unknown): value is ConnectionService =>
  typeof value === 'string' && (CONNECTION_SERVICES as readonly string[]).includes(value)

// fixed forever: change it and every computer would import every item again as a new card
const CARD_NAMESPACE = '5b2c6f4e-8a3d-4f61-9c2e-7d1a0b3e9f42'

/** the same outside item becomes the same card on every computer, so sync merges it instead of doubling it */
export const cardIdFor = (service: ConnectionService, remoteId: string): string => uuidv5(`${service}:${remoteId}`, CARD_NAMESPACE)

export type ConnectionResult<T> = { ok: true; value: T } | { ok: false; reason: string }

export type LinkState = 'open' | 'closed' | 'gone'

/** display only: main keeps what both sides last agreed on in its own table */
export interface ConnectionLink {
  service: ConnectionService
  /** owner/repo#123, or the service's own id */
  id: string
  url: string
  state: LinkState
  labels: string[]
  /** the list it is in, such as a Todoist project, when the id doesn't say */
  place?: string
  /** the service's own short name for it, such as ENG-123, when the id is not one a person reads */
  ref?: string
  /** the service's own word for its state, such as In Review or Canceled */
  stateName?: string
  /** something about this card in words, such as a close still waiting */
  problem?: string
}

const STATES: readonly LinkState[] = ['open', 'closed', 'gone']

function metaOf(metadata: string): Record<string, unknown> | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(metadata || '{}')
  } catch {
    return null
  }
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null
}

/** from a card's metadata; null for a card that isn't linked, or a link that isn't well formed */
export function linkOf(metadata: string): ConnectionLink | null {
  const raw = metaOf(metadata)?.link
  if (!raw || typeof raw !== 'object') return null
  const l = raw as Record<string, unknown>
  if (!isConnectionService(l.service) || typeof l.id !== 'string' || typeof l.url !== 'string') return null
  // opened from the card, so only a page on that service's own site
  if (!SERVICES[l.service].opens(l.url)) return null
  if (typeof l.state !== 'string' || !STATES.includes(l.state as LinkState)) return null
  const labels = Array.isArray(l.labels) ? l.labels.filter((x): x is string => typeof x === 'string') : []
  return {
    service: l.service,
    id: l.id,
    url: l.url,
    state: l.state as LinkState,
    labels,
    ...(typeof l.place === 'string' && l.place ? { place: l.place } : {}),
    ...(typeof l.ref === 'string' && l.ref ? { ref: l.ref.slice(0, 50) } : {}),
    ...(typeof l.stateName === 'string' && l.stateName ? { stateName: l.stateName.slice(0, 80) } : {}),
    ...(typeof l.problem === 'string' && l.problem ? { problem: l.problem } : {})
  }
}

/** why a card's date can only be changed where it lives, as the sentence to show; null when it is the card's to change */
export function dueLockOf(metadata: string): string | null {
  const value = metaOf(metadata)?.dueLocked
  return typeof value === 'string' && value ? value.slice(0, 300) : null
}

export interface WorkspaceRepoView {
  slug: string
  name: string
  /** owner/repo, or null when none is known */
  repo: string | null
  /** from the workspace's folder, or picked here */
  source: 'folder' | 'chosen' | null
  scope: 'assigned' | 'all'
  /** the key turned out able only to read this repository's issues */
  readOnly: boolean
}

export interface WorkspaceProjectView {
  slug: string
  name: string
  /** the Todoist project id it follows, or null */
  project: string | null
}

export interface TodoistProject {
  id: string
  name: string
}

interface StatusViewBase {
  connected: boolean
  /** who the key belongs to, as the service names them */
  login: string | null
  expiresAt: number | null
  lastOk: number | null
  /** in words, for the row */
  problem: string | null
}

export interface GitHubStatusView extends StatusViewBase {
  service: 'github'
  repos: WorkspaceRepoView[]
}

export interface TodoistStatusView extends StatusViewBase {
  service: 'todoist'
  workspaces: WorkspaceProjectView[]
  /** as of the last check; empty before the first */
  projects: TodoistProject[]
}

export interface WorkspaceTeamView {
  slug: string
  name: string
  /** the Linear team id it follows, or null */
  team: string | null
  scope: 'assigned' | 'all'
}

export interface LinearTeam {
  id: string
  /** the short prefix of its issues, such as ENG */
  key: string
  name: string
}

export interface LinearStatusView extends StatusViewBase {
  service: 'linear'
  workspaces: WorkspaceTeamView[]
  /** as of the last check; empty before the first */
  teams: LinearTeam[]
}

export interface WorkspaceJiraView {
  slug: string
  name: string
  /** the Jira project id it follows, or null */
  project: string | null
  scope: 'assigned' | 'all'
}

export interface JiraProjectView {
  id: string
  /** the prefix of its issue keys, such as ENG */
  key: string
  name: string
}

export interface JiraStatusView extends StatusViewBase {
  service: 'jira'
  /** https://name.atlassian.net, or null when not connected */
  site: string | null
  workspaces: WorkspaceJiraView[]
  /** as of the last check; empty before the first */
  projects: JiraProjectView[]
}

export interface NotionColumnView {
  id: string
  name: string
}

export interface WorkspaceNotionView {
  slug: string
  name: string
  /** the data source it follows, or null */
  source: string | null
  /** the columns in use, picked here or found */
  done: string | null
  date: string | null
  /** what could be picked instead, for a database with more than one */
  doneOptions: NotionColumnView[]
  dateOptions: NotionColumnView[]
  /** in words, when this database can't be followed as it is */
  problem: string | null
}

export interface NotionStatusView extends StatusViewBase {
  service: 'notion'
  /** databases shared with the integration, as of the last check */
  sources: { id: string; name: string }[]
  workspaces: WorkspaceNotionView[]
}

export interface WorkspaceFolderView {
  slug: string
  name: string
  /** the folder it follows on this computer, or null */
  folder: string | null
}

export interface ObsidianStatusView extends StatusViewBase {
  service: 'obsidian'
  workspaces: WorkspaceFolderView[]
}

export type ServiceStatusView = GitHubStatusView | TodoistStatusView | LinearStatusView | JiraStatusView | NotionStatusView | ObsidianStatusView
