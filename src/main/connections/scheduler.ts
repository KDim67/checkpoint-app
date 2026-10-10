/** checks each connected service on a timer, when the window comes back and on request; one check at a time per service, each backing off after its own failures and waiting out its own rate limits */

import { getDb } from '../db'
import { notify } from '../notificationService'
import { sendToWindow } from '../windows'
import { IpcChannels } from '../../shared/ipcChannels'
import { CONNECTION_SERVICES, SERVICES, type ConnectionService } from '../../shared/connections'
import { getConnectionKey } from './keys'
import { readStatus, writeStatus, type ServiceStatus } from './status'
import { fail, type ClientDeps, type Result } from './result'
import type { SyncProblem, SyncReport } from './engine'
import { createGitHubClient } from './github/client'
import { syncGitHub } from './github/sync'
import { gitOrigin, workspaceRepos, type ReadRemote } from './github/repos'
import { createTodoistClient } from './todoist/client'
import { syncTodoist } from './todoist/sync'
import { followedProjects } from './todoist/projects'
import { createLinearClient } from './linear/client'
import { syncLinear } from './linear/sync'
import { followedTeams } from './linear/teams'
import { createJiraClient, readJiraCredentials } from './jira/client'
import { syncJira } from './jira/sync'
import { followedJiraProjects } from './jira/projects'
import { createNotionClient } from './notion/client'
import { syncNotion } from './notion/sync'
import { followedNotionSources } from './notion/databases'
import { syncObsidian } from './obsidian/sync'
import { followedFolders } from './obsidian/folders'

const EVERY_MS = 5 * 60_000
// coming back to the window checks again, but not on every alt-tab
const FOCUS_GAP_MS = 60_000
const MAX_BACKOFF_MS = 60 * 60_000
const EXPIRY_WARNING_MS = 7 * 24 * 60 * 60_000
// often enough for a folder on this computer; a service's own pace is decided in isDue
const TICK_MS = 30_000
// notes on this computer are cheap to look at, so they are looked at often
const LOCAL_EVERY_MS = 30_000
// after startup settles, so a check never slows the first paint
const FIRST_CHECK_MS = 15_000

export type CheckReason = 'timer' | 'focus' | 'now'

export interface CheckDeps {
  fetch: ClientDeps['fetch']
  readRemote: ReadRemote
  now: () => number
}

const realDeps: CheckDeps = { fetch: (input, init) => fetch(input, init), readRemote: gitOrigin, now: () => Date.now() }

interface Identity {
  login: string
  expiresAt: number | null
  /** the service's own id for the key's user, where whose items are yours depends on it */
  id?: string
}

/** what differs between services: who the key belongs to, and one sync */
interface Runner {
  /** nothing to connect, such as folders on this computer; runs while active says so */
  keyless?: { active: () => boolean }
  /** how often the timer checks, when not every five minutes */
  everyMs?: number
  /** what the service calls it, in notices */
  keyWord: string
  /** how to get a working one again */
  renew: string
  identify(key: string, deps: CheckDeps): Promise<Result<Identity>>
  sync(key: string, me: Identity, status: ServiceStatus, deps: CheckDeps): Promise<{ report: SyncReport; readOnly: string[] }>
}

const RUNNERS: Record<ConnectionService, Runner> = {
  github: {
    keyWord: 'key',
    renew: 'Make a new one and connect it in Settings, Connections.',
    identify: (key, deps) => createGitHubClient(key, deps).me(),
    async sync(key, me, status, deps) {
      const readOnly = new Set(status.readOnlyRepos)
      const repos = await workspaceRepos(status.readOnlyRepos, deps.readRemote)
      const report = await syncGitHub({ db: getDb(), client: createGitHubClient(key, deps), login: me.login, repos, readOnly, now: deps.now })
      return { report, readOnly: [...readOnly] }
    }
  },
  todoist: {
    keyWord: 'token',
    renew: 'Copy it again from Todoist and connect it in Settings, Connections.',
    async identify(key, deps) {
      const me = await createTodoistClient(key, deps).me()
      return me.ok ? { ok: true, value: { login: me.value.name, expiresAt: null } } : me
    },
    async sync(key, _me, _status, deps) {
      const report = await syncTodoist({ db: getDb(), client: createTodoistClient(key, deps), follows: followedProjects(), now: deps.now })
      return { report, readOnly: [] }
    }
  },
  linear: {
    keyWord: 'key',
    renew: 'Make a new one and connect it in Settings, Connections.',
    async identify(key, deps) {
      const me = await createLinearClient(key, deps).me()
      return me.ok ? { ok: true, value: { login: me.value.name, expiresAt: null, id: me.value.id } } : me
    },
    async sync(key, me, status, deps) {
      const readOnly = new Set(status.readOnlyRepos)
      const report = await syncLinear({
        db: getDb(), client: createLinearClient(key, deps), viewerId: me.id ?? '', follows: followedTeams(), readOnly, now: deps.now
      })
      return { report, readOnly: [...readOnly] }
    }
  },
  jira: {
    keyWord: 'token',
    renew: 'Make a new one on your Atlassian account and connect it in Settings, Connections.',
    async identify(key, deps) {
      const creds = readJiraCredentials(key)
      if (!creds) return fail('auth', 'The Jira details kept on this computer are damaged. Connect again.')
      const me = await createJiraClient(creds, deps).me()
      return me.ok ? { ok: true, value: { login: me.value.name, expiresAt: null, id: me.value.id } } : me
    },
    async sync(key, me, status, deps) {
      const readOnly = new Set(status.readOnlyRepos)
      const creds = readJiraCredentials(key)
      if (!creds) return { report: { changed: 0, problems: [] }, readOnly: [...readOnly] }
      const report = await syncJira({
        db: getDb(), client: createJiraClient(creds, deps), site: creds.site, viewerId: me.id ?? '', follows: followedJiraProjects(), readOnly, now: deps.now
      })
      return { report, readOnly: [...readOnly] }
    }
  },
  notion: {
    keyWord: 'secret',
    renew: 'Copy the integration\'s secret again and connect it in Settings, Connections.',
    async identify(key, deps) {
      const me = await createNotionClient(key, deps).me()
      return me.ok ? { ok: true, value: { login: me.value.name, expiresAt: null } } : me
    },
    async sync(key, _me, status, deps) {
      const readOnly = new Set(status.readOnlyRepos)
      const report = await syncNotion({ db: getDb(), client: createNotionClient(key, deps), follows: followedNotionSources(), readOnly, now: deps.now })
      return { report, readOnly: [...readOnly] }
    }
  },
  obsidian: {
    keyless: { active: () => followedFolders().size > 0 },
    everyMs: LOCAL_EVERY_MS,
    keyWord: 'folder',
    renew: 'Pick the folder again in Settings, Connections.',
    identify: async () => ({ ok: true, value: { login: 'This computer', expiresAt: null } }),
    async sync(_key, _me, status, deps) {
      const readOnly = new Set(status.readOnlyRepos)
      const report = await syncObsidian({ db: getDb(), follows: followedFolders(), readOnly, now: deps.now })
      return { report, readOnly: [...readOnly] }
    }
  }
}

/** five minutes, doubling after each failure, never more than an hour */
export function backoffMs(failures: number): number {
  if (failures <= 0) return 0
  return Math.min(MAX_BACKOFF_MS, EVERY_MS * 2 ** (failures - 1))
}

export function isDue(status: ServiceStatus, now: number, reason: CheckReason, everyMs: number = EVERY_MS): boolean {
  // nothing is asked of a service before its limit resets, not even on request
  if (status.rateResetAt !== null && now < status.rateResetAt) return false
  if (reason === 'now' || status.lastAttempt === null) return true
  if (status.failures > 0) return now - status.lastAttempt >= backoffMs(status.failures)
  return now - status.lastAttempt >= (reason === 'focus' ? Math.min(FOCUS_GAP_MS, everyMs) : everyMs)
}

const timeOf = (at: number): string => new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

/** one problem in words; a repository's or list's own trouble names it */
function describe(service: ConnectionService, problem: SyncProblem): string {
  const { name } = SERVICES[service]
  if (problem.kind === 'rate' && problem.resetAt) return `${name}'s limit for this ${RUNNERS[service].keyWord} was reached. Checking again at ${timeOf(problem.resetAt)}.`
  if (problem.kind === 'auth' || problem.kind === 'rate' || problem.kind === 'network') return problem.message
  return problem.where ? `${problem.where}: ${problem.message}` : problem.message
}

function noticeExpiry(service: ConnectionService, status: ServiceStatus, now: number): void {
  if (status.expiresAt === null || status.expiresAt - now > EXPIRY_WARNING_MS || status.noticedExpiry === status.expiresAt) return
  const { name } = SERVICES[service]
  const runner = RUNNERS[service]
  const shown = notify({
    category: 'connections',
    title: `Your ${name} ${runner.keyWord} expires soon`,
    body: `It stops working on ${new Date(status.expiresAt).toLocaleDateString(undefined, { day: 'numeric', month: 'long' })}. ${runner.renew}`,
    view: 'settings:connections'
  })
  // held back by quiet hours: said again on a later check
  if (shown) writeStatus(service, { noticedExpiry: status.expiresAt })
}

function noticeStopped(service: ConnectionService, status: ServiceStatus): void {
  if (status.noticedFailure) return
  const { name } = SERVICES[service]
  const runner = RUNNERS[service]
  const shown = notify({
    category: 'connections',
    title: `${name} stopped syncing`,
    body: `Your ${name} ${runner.keyWord} stopped working. ${runner.renew}`,
    view: 'settings:connections'
  })
  if (shown) writeStatus(service, { noticedFailure: true })
}

const running = new Map<ConnectionService, Promise<void>>()

async function check(service: ConnectionService, reason: CheckReason, deps: CheckDeps): Promise<void> {
  const runner = RUNNERS[service]
  const key = runner.keyless ? '' : getConnectionKey(service) ?? ''
  if (runner.keyless ? !runner.keyless.active() : !key) return
  const now = deps.now()
  const status = readStatus(service)
  if (!isDue(status, now, reason, runner.everyMs)) return
  writeStatus(service, { lastAttempt: now })

  const me = await runner.identify(key, deps)
  if (!me.ok) {
    const failed = writeStatus(service, {
      error: describe(service, { where: null, kind: me.kind, message: me.message, resetAt: me.resetAt }),
      failures: me.kind === 'rate' ? status.failures : status.failures + 1,
      rateResetAt: me.kind === 'rate' ? me.resetAt ?? null : null
    })
    if (me.kind === 'auth') noticeStopped(service, failed)
    sendToWindow(IpcChannels.CONNECTIONS_CHANGED)
    return
  }

  const { report, readOnly } = await runner.sync(key, me.value, status, deps)
  // a repository or list the key doesn't cover is said, but doesn't slow the others down
  const blocking = report.problems.find(p => p.kind === 'auth' || p.kind === 'rate' || p.kind === 'network')
  const shown = blocking ?? report.problems[0]
  const next = writeStatus(service, {
    login: me.value.login,
    expiresAt: me.value.expiresAt,
    readOnlyRepos: readOnly,
    error: shown ? describe(service, shown) : null,
    failures: blocking && blocking.kind !== 'rate' ? status.failures + 1 : 0,
    rateResetAt: blocking?.kind === 'rate' ? blocking.resetAt ?? null : null,
    ...(blocking ? {} : { lastOk: deps.now(), noticedFailure: false })
  })
  if (blocking?.kind === 'auth') noticeStopped(service, next)
  else noticeExpiry(service, next, deps.now())
  if (report.changed > 0) sendToWindow(IpcChannels.MCP_DATA_CHANGED)
  sendToWindow(IpcChannels.CONNECTIONS_CHANGED)
}

/** one at a time per service: a second request while one runs waits for it rather than starting another */
export function checkService(service: ConnectionService, reason: CheckReason, deps: CheckDeps = realDeps): Promise<void> {
  const current = running.get(service)
  if (current) return current
  const started = check(service, reason, deps)
    .catch(err => {
      console.error(`[connections] ${SERVICES[service].name} check failed:`, err)
      writeStatus(service, { error: `The check stopped: ${err instanceof Error ? err.message : String(err)}` })
    })
    .finally(() => { running.delete(service) })
  running.set(service, started)
  return started
}

/** every service side by side; one stuck on its network never holds up another */
export async function checkAll(reason: CheckReason, deps: CheckDeps = realDeps): Promise<void> {
  await Promise.all(CONNECTION_SERVICES.map(service => checkService(service, reason, deps)))
}

let ticker: NodeJS.Timeout | null = null
let first: NodeJS.Timeout | null = null

/** the timer only asks; whether a check is due is decided each time */
export function startConnections(): void {
  if (ticker) return
  first = setTimeout(() => { void checkAll('timer') }, FIRST_CHECK_MS)
  ticker = setInterval(() => { void checkAll('timer') }, TICK_MS)
}

export function stopConnections(): void {
  if (first) clearTimeout(first)
  if (ticker) clearInterval(ticker)
  first = null
  ticker = null
}
