/** finds plugins, keeps your approvals, and runs each approved one in its own sandbox; it never runs plugin code itself */

import { app, ipcMain, type IpcMainEvent } from 'electron'
import { join } from 'path'
import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import type { PluginInfo, PluginLogLine } from '../shared/types'
import { getPluginsDir, ensureDir } from './paths'
import { isSafePluginFilename, parsePluginMetadata } from '../shared/pluginMetadata'
import {
  grantCovers,
  normalizeRequest,
  sameRequest,
  type PluginGrant,
  type PluginRequest,
  type PluginStatus
} from '../shared/pluginPermissions'
import { onPluginEvent, type PluginEventName } from './pluginEvents'
import {
  checkValue,
  normalizeSettingFields,
  pluginSettingsKey,
  type PluginSettingField,
  type PluginSettingState,
  type PluginSettingValue
} from '../shared/pluginSettings'
import { createItem, getDb, getItemById, getItemsPaginated, getSetting, readContextList, setSetting, deleteSetting, updateItem } from './db'
import { notify } from './notificationService'
import { notifyRenderer, readBoardConfig } from './mcp/toolKit'
import { dispatch, EVENT_NAMES, Limiter, PluginCallError, type BridgeContext, type BridgeDeps } from './plugins/bridge'
import { pluginFetch } from './plugins/pluginFetch'
import { getGrant, loadGrants, saveGrant } from './plugins/grants'
import { HOST_OUT, PLUGIN_LINE_OFFSET, workerSource } from './plugins/hostPage'
import { openSandbox, type Sandbox } from './plugins/sandbox'
import { PluginLog } from './plugins/log'

type Result = { ok: true } | { ok: false; error: string }

const SOURCE_BYTES = 1024 * 1024
const START_TIMEOUT_MS = 10_000
const UNLOAD_GRACE_MS = 1_000
// memory is read often, a leak grows fast; a ping every fifth tick is enough to spot a stuck loop
const TICK_MS = 2_000
const PING_EVERY = 5
const MEMORY_LIMIT_KB = 512 * 1024
const MAX_IN_FLIGHT = 32
/** local, so each machine says it once */
const PAUSED_NOTICE_KEY = 'plugin_paused_notice_shown'

interface Running {
  filename: string
  name: string
  sandbox: Sandbox
  limiter: Limiter
  subscriptions: Set<PluginEventName>
  inFlight: number
  missedPongs: number
  ready: boolean
  stopping: boolean
  startTimer: ReturnType<typeof setTimeout> | null
  /** settles start() once it is running or has stopped */
  started: (result: Result) => void
  /** settles stop() once the plugin has said goodbye or ran out of time */
  unloaded: (() => void) | null
  /** what was checked against your approval is what runs, even if the file changes before the page asks */
  source: string
  /** as that same copy declares them */
  settings: PluginSettingField[]
}

const running = new Map<string, Running>()
const byContents = new Map<number, Running>()
/** why a plugin that isn't running stopped, for its settings row */
const outcomes = new Map<string, { status: PluginStatus; detail: string }>()
let engineRunning = false
const logs = new PluginLog()
let heartbeat: ReturnType<typeof setInterval> | null = null
let ticks = 0
let wired = false

export function ensurePluginsDir(): void {
  ensureDir(getPluginsDir())
}

interface OnDisk {
  name: string
  description: string
  version: string
  request: PluginRequest
  settings: PluginSettingField[]
  source: string
}

/** read, never required; asking what a file wants must not run it */
function readPlugin(filename: string): OnDisk | { error: string } {
  if (!isSafePluginFilename(filename)) return { error: `"${filename}" is not a plain .js filename inside the plugins folder.` }
  const fullPath = join(getPluginsDir(), filename)
  if (!existsSync(fullPath)) return { error: `${filename} is not in the plugins folder.` }
  try {
    if (statSync(fullPath).size > SOURCE_BYTES) return { error: `${filename} is larger than 1 MB.` }
    const source = readFileSync(fullPath, 'utf8')
    const metadata = parsePluginMetadata(source)
    return {
      name: metadata.name || filename,
      description: metadata.description || 'No description provided.',
      version: metadata.version || '1.0.0',
      request: normalizeRequest(metadata.permissions ?? [], metadata.hosts ?? []),
      settings: normalizeSettingFields(metadata.settings),
      source
    }
  } catch (err) {
    return { error: `Couldn't read ${filename}: ${err instanceof Error ? err.message : String(err)}` }
  }
}

function statusFor(filename: string, request: PluginRequest, grant: PluginGrant | null): { status: PluginStatus; detail: string | null } {
  if (!grant || !grant.on) return { status: 'off', detail: null }
  if (grant.legacy) {
    return { status: 'needs-approval', detail: 'Plugins now run in a sandbox and can only do what you allow. Review what this one asks for to turn it back on.' }
  }
  if (!grantCovers(grant, request)) {
    return { status: 'needs-approval', detail: 'It now asks for more than you approved. Review it to turn it back on.' }
  }
  const live = running.get(filename)
  if (live) return { status: live.ready ? 'running' : 'starting', detail: null }
  const outcome = outcomes.get(filename)
  if (outcome) return outcome
  if (!engineRunning) return { status: 'stopped', detail: 'Plugins run while the Customization Engine is on.' }
  return { status: 'stopped', detail: null }
}

export function scanPlugins(): PluginInfo[] {
  ensurePluginsDir()
  const grants = loadGrants()
  return readdirSync(getPluginsDir())
    .filter(f => f.endsWith('.js'))
    .map(filename => {
      const read = readPlugin(filename)
      const grant = grants[filename] ?? null
      if ('error' in read) {
        return {
          filename, name: filename, description: read.error, version: '1.0.0',
          active: grant?.on === true,
          request: { permissions: [], hosts: [], ignored: [] },
          settings: [],
          grant: grant && !grant.legacy ? { permissions: grant.permissions, hosts: grant.hosts, workspaces: grant.workspaces } : null,
          status: 'stopped' as const,
          statusDetail: read.error
        }
      }
      const { status, detail } = statusFor(filename, read.request, grant)
      return {
        filename,
        name: read.name,
        description: read.description,
        version: read.version,
        active: grant?.on === true,
        request: read.request,
        grant: grant && !grant.legacy ? { permissions: grant.permissions, hosts: grant.hosts, workspaces: grant.workspaces } : null,
        status,
        statusDetail: detail,
        settings: read.settings
      }
    })
}

const MISSING = Symbol('missing')
const storagePrefix = (filename: string): string => `plugin:${filename}:`

/** what you filled in; hand edits or a damaged row read as nothing filled in */
function storedSettings(filename: string): Record<string, PluginSettingValue> {
  const raw = getSetting<unknown>(pluginSettingsKey(filename), null)
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, PluginSettingValue>) : {}
}

/** fields as the file declares them now; a secret only says whether it is set */
export function getPluginSettings(filename: string): { ok: true; fields: PluginSettingState[] } | { ok: false; error: string } {
  const read = readPlugin(filename)
  if ('error' in read) return { ok: false, error: read.error }
  const stored = storedSettings(filename)
  return {
    ok: true,
    fields: read.settings.map(field => {
      const value = stored[field.key]
      const isSet = value !== undefined && value !== null
      return { ...field, isSet, value: field.type === 'secret' || !isSet ? null : value }
    })
  }
}

/** only fields it declares, each checked against its type; null clears one, a key left out stays as it was */
export function savePluginSettings(filename: string, changes: unknown): Result {
  const read = readPlugin(filename)
  if ('error' in read) return { ok: false, error: read.error }
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) return { ok: false, error: 'Those settings were malformed.' }
  const next = storedSettings(filename)
  for (const [key, value] of Object.entries(changes as Record<string, unknown>)) {
    const field = read.settings.find(f => f.key === key)
    if (!field) return { ok: false, error: `${read.name} has no setting named "${key}".` }
    const checked = checkValue(field.type, value)
    if (!checked.ok) return { ok: false, error: `${field.label} ${checked.error}.` }
    if (checked.value === null) delete next[key]
    else next[key] = checked.value
  }
  // a field the file no longer declares has nobody left to read it
  for (const key of Object.keys(next)) if (!read.settings.some(f => f.key === key)) delete next[key]
  setSetting(pluginSettingsKey(filename), next)
  return { ok: true }
}

function realDeps(filename: string, fields: PluginSettingField[]): BridgeDeps {
  const prefix = storagePrefix(filename)
  return {
    setting: key => {
      const field = fields.find(f => f.key === key)
      if (!field) return { declared: false, value: null }
      return { declared: true, value: storedSettings(filename)[key] ?? field.default ?? null }
    },
    liveWorkspaces: () => (readContextList(getDb()) ?? []).map(entry => entry.slug),
    getItem: id => getItemById(id),
    queryItems: (context, type, limit) => getItemsPaginated(context, type, 1, limit).items,
    createItem: payload => createItem(getDb(), payload),
    updateItem: (id, patch) => updateItem(getDb(), id, patch),
    boardColumns: context => readBoardConfig(context).columns.map(c => c.id),
    notify: (title, body, dedupeKey) => notify({ category: 'plugin', title, body, dedupeKey }),
    fetch: (url, init, hosts) => pluginFetch(url, init, hosts),
    storageGet: key => {
      const value = getSetting<unknown>(prefix + key, MISSING)
      return value === MISSING ? { found: false } : { found: true, value }
    },
    storageSet: (key, value) => setSetting(prefix + key, value),
    storageDelete: key => deleteSetting(prefix + key),
    // substr not LIKE: an underscore in a filename is a LIKE wildcard
    storageUsed: () => (getDb()
      .prepare('SELECT COALESCE(SUM(LENGTH(CAST(value AS BLOB))), 0) AS n FROM app_settings WHERE substr(key, 1, ?) = ?')
      .get(prefix.length, prefix) as { n: number }).n,
    storageSize: key => (getDb()
      .prepare('SELECT COALESCE(SUM(LENGTH(CAST(value AS BLOB))), 0) AS n FROM app_settings WHERE key = ?')
      .get(prefix + key) as { n: number }).n,
    dataChanged: () => notifyRenderer(),
    now: () => Date.now()
  }
}

function log(entry: Running, level: 'info' | 'error', text: string): void {
  const kept = logs.write(entry.filename, level, text)
  if (kept === 'dropped') return
  const line = kept === 'dropping'
    ? `[Plugin: ${entry.name}] is logging too much; dropping lines for a minute.`
    : `[Plugin: ${entry.name}] ${text.slice(0, 2000)}`
  if (level === 'error' || kept === 'dropping') console.error(line)
  else console.log(line)
}

export function pluginLog(filename: string): PluginLogLine[] {
  return logs.read(filename)
}

function context(entry: Running): BridgeContext {
  return {
    filename: entry.filename,
    name: entry.name,
    grant: () => getGrant(entry.filename),
    limiter: entry.limiter,
    subscribe: event => entry.subscriptions.add(event)
  }
}

async function answer(entry: Running, id: unknown, method: unknown, args: unknown): Promise<void> {
  if (typeof id !== 'number') return
  if (entry.inFlight >= MAX_IN_FLIGHT) {
    entry.sandbox.send({ t: 'result', id, ok: false, error: `${entry.name} has ${MAX_IN_FLIGHT} calls waiting already. Await some before making more.` })
    return
  }
  entry.inFlight++
  try {
    const value = await dispatch(context(entry), realDeps(entry.filename, entry.settings), method, args)
    entry.sandbox.send({ t: 'result', id, ok: true, value: value ?? null })
  } catch (err) {
    // our own wording goes back as is; anything else is an internal failure, not the plugin's business
    const error = err instanceof PluginCallError ? err.message : `${String(method)} failed inside Checkpoint.`
    if (!(err instanceof PluginCallError)) console.error(`[PluginRegistry] ${entry.name}: ${String(method)} failed:`, err)
    entry.sandbox.send({ t: 'result', id, ok: false, error })
  } finally {
    entry.inFlight--
  }
}

/** page and worker messages; everything in them is the plugin's word, so only the shape is trusted */
function onHostMessage(event: IpcMainEvent, text: unknown): void {
  const entry = byContents.get(event.sender.id)
  // from the plugin's own top frame, or from nobody we know
  if (!entry || event.senderFrame !== event.sender.mainFrame || typeof text !== 'string') return
  let message: Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object') return
    message = parsed as Record<string, unknown>
  } catch {
    return
  }

  switch (message.t) {
    case 'page':
      entry.sandbox.send({ t: 'start', code: workerSource(entry.source) })
      break
    case 'ready':
      if (entry.stopping || entry.ready) break
      entry.ready = true
      if (entry.startTimer) clearTimeout(entry.startTimer)
      entry.startTimer = null
      outcomes.delete(entry.filename)
      log(entry, 'info', 'running')
      entry.started({ ok: true })
      break
    case 'failed':
      stop(entry.filename, { status: 'stopped', detail: `It couldn't start: ${String(message.message ?? 'onLoad threw.').slice(0, 500)}` })
      break
    case 'error': {
      const line = Number(message.line) - PLUGIN_LINE_OFFSET
      const where = line > 0 ? ` (line ${line})` : ''
      const what = `${String(message.message ?? 'An error.').slice(0, 500)}${where}`
      if (entry.ready) log(entry, 'error', what)
      else stop(entry.filename, { status: 'stopped', detail: `It couldn't start: ${what}` })
      break
    }
    case 'call':
      // onLoad and onUnload use the api too, so calls are answered for as long as the sandbox is open
      void answer(entry, message.id, message.method, message.args)
      break
    case 'log':
      log(entry, message.level === 'error' ? 'error' : 'info', typeof message.text === 'string' ? message.text : '')
      break
    case 'pong':
      entry.missedPongs = 0
      break
    case 'dropped':
      log(entry, 'error', `fell behind; an event (${String(message.name)}) was dropped`)
      break
    case 'unloaded':
      entry.unloaded?.()
      break
  }
}

/** events go only where read was granted and the item's workspace was picked */
function fanOut(name: PluginEventName, payload: unknown, contextOf: () => string | null): void {
  if (running.size === 0) return
  let workspace: string | null | undefined
  let live: Set<string> | undefined
  for (const entry of running.values()) {
    if (!entry.ready || entry.stopping || !entry.subscriptions.has(name)) continue
    const grant = getGrant(entry.filename)
    if (!grant || !grant.on || grant.legacy || !grant.permissions.includes('read')) continue
    if (workspace === undefined) workspace = contextOf()
    if (live === undefined) live = new Set((readContextList(getDb()) ?? []).map(e => e.slug))
    if (!workspace || !live.has(workspace) || !grant.workspaces.includes(workspace)) continue
    entry.sandbox.send({ t: 'event', name, payload })
  }
}

function wire(): void {
  if (wired) return
  wired = true
  ipcMain.on(HOST_OUT, onHostMessage)
  for (const name of EVENT_NAMES) {
    onPluginEvent(name, payload => {
      try {
        if (name === 'due:reminded') {
          const { itemId } = payload as { itemId: string }
          fanOut(name, payload, () => getItemById(itemId)?.context ?? null)
        } else if (name === 'focus:completed') {
          fanOut(name, payload, () => (payload as { context: string }).context)
        } else {
          fanOut(name, payload, () => (payload as { item: { context: string } }).item.context)
        }
      } catch (err) {
        console.error(`[PluginRegistry] Could not pass on ${name}:`, err)
      }
    })
  }
}

/** a stuck loop never answers a ping, and memory is read from outside the sandbox */
function beat(): void {
  const ping = ++ticks % PING_EVERY === 0
  let metrics: Electron.ProcessMetric[] = []
  try {
    metrics = app.getAppMetrics()
  } catch {
    // no metrics this beat, the ping still runs
  }
  for (const entry of [...running.values()]) {
    if (entry.stopping) continue
    // onLoad can allocate too, so memory is watched from the start
    const memory = entry.sandbox.memoryKb(metrics)
    if (memory !== null && memory > MEMORY_LIMIT_KB) {
      stop(entry.filename, { status: 'stopped', detail: `Checkpoint stopped it for using more than ${MEMORY_LIMIT_KB / 1024} MB of memory.` }, true)
      continue
    }
    if (!ping || !entry.ready) continue
    if (entry.missedPongs >= 2) {
      stop(entry.filename, { status: 'stopped', detail: 'Checkpoint stopped it because it stopped responding.' }, true)
      continue
    }
    entry.missedPongs++
    entry.sandbox.send({ t: 'ping', n: Date.now() })
  }
  if (running.size === 0 && heartbeat) {
    clearInterval(heartbeat)
    heartbeat = null
  }
}

function start(filename: string): Promise<Result> {
  if (running.has(filename)) return Promise.resolve({ ok: true })
  const read = readPlugin(filename)
  if ('error' in read) {
    outcomes.set(filename, { status: 'stopped', detail: read.error })
    return Promise.resolve({ ok: false, error: read.error })
  }
  const grant = getGrant(filename)
  if (!grant || !grant.on || !grantCovers(grant, read.request)) {
    return Promise.resolve({ ok: false, error: `${read.name} needs your approval first.` })
  }
  wire()

  return new Promise(resolve => {
    const entry: Running = {
      filename,
      name: read.name,
      sandbox: openSandbox(filename, (reason, kind) => {
        stop(filename, { status: kind, detail: reason }, true)
      }),
      limiter: new Limiter(),
      subscriptions: new Set(),
      inFlight: 0,
      missedPongs: 0,
      ready: false,
      stopping: false,
      startTimer: null,
      started: resolve,
      unloaded: null,
      source: read.source,
      settings: read.settings
    }
    running.set(filename, entry)
    byContents.set(entry.sandbox.contents.id, entry)
    entry.startTimer = setTimeout(() => {
      stop(filename, { status: 'stopped', detail: `It didn't finish starting within ${START_TIMEOUT_MS / 1000} seconds.` }, true)
    }, START_TIMEOUT_MS)
    if (!heartbeat) heartbeat = setInterval(beat, TICK_MS)
  })
}

/** onUnload gets a moment; then the process goes, and its timers and loops with it */
function stop(filename: string, outcome: { status: PluginStatus; detail: string } | null, force = false): Promise<void> {
  const entry = running.get(filename)
  if (!entry || entry.stopping) return Promise.resolve()
  entry.stopping = true
  if (entry.startTimer) clearTimeout(entry.startTimer)
  if (outcome && outcome.status !== 'off') outcomes.set(filename, outcome)
  else outcomes.delete(filename)

  const finish = (): void => {
    entry.unloaded = null
    entry.sandbox.close(force || !entry.ready)
    running.delete(filename)
    byContents.delete(entry.sandbox.contents.id)
    // a stop it didn't ask for reads as an error in its log
    if (outcome?.detail) log(entry, 'error', outcome.detail)
    entry.started(outcome && outcome.status !== 'off' ? { ok: false, error: outcome.detail } : { ok: true })
  }

  if (force || !entry.ready) {
    finish()
    return Promise.resolve()
  }
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      finish()
      resolve()
    }, UNLOAD_GRACE_MS)
    entry.unloaded = () => {
      clearTimeout(timer)
      finish()
      resolve()
    }
    entry.sandbox.send({ t: 'unload' })
  })
}

/** grants exactly what you were shown; a file that changed meanwhile has to be shown again */
export async function approvePlugin(
  filename: string,
  approval: { permissions: unknown; hosts: unknown; workspaces: unknown }
): Promise<Result> {
  const read = readPlugin(filename)
  if ('error' in read) return { ok: false, error: read.error }
  const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : [])
  if (!sameRequest(read.request, { permissions: strings(approval.permissions) as PluginRequest['permissions'], hosts: strings(approval.hosts) })) {
    return { ok: false, error: `${read.name} changed while you were looking at it. Review what it asks for again.` }
  }
  const live = new Set((readContextList(getDb()) ?? []).map(e => e.slug))
  const workspaces = [...new Set(strings(approval.workspaces))].filter(w => live.has(w))

  await stop(filename, null)
  saveGrant(filename, {
    on: true,
    permissions: read.request.permissions,
    hosts: read.request.hosts,
    workspaces,
    grantedAt: Date.now()
  })
  outcomes.delete(filename)
  if (!engineRunning) return { ok: true }
  return start(filename)
}

/** off here only; the approval stays so turning it back on starts from what you picked */
export async function disablePlugin(filename: string): Promise<void> {
  if (!isSafePluginFilename(filename)) return
  await stop(filename, null)
  const grant = getGrant(filename)
  if (grant) saveGrant(filename, { ...grant, on: false })
  outcomes.delete(filename)
}

/** the engine came on; each approved plugin starts, one bad one never holds up the rest */
export function startApprovedPlugins(): void {
  engineRunning = true
  const grants = loadGrants()
  noticePaused(Object.values(grants).filter(g => g.on && g.legacy).length)
  for (const [filename, grant] of Object.entries(grants)) {
    if (!grant.on || grant.legacy) continue
    start(filename).then(result => {
      if (!result.ok) console.error(`[PluginRegistry] ${filename} did not start: ${result.error}`)
    }).catch(err => console.error(`[PluginRegistry] ${filename} did not start:`, err))
  }
}

/** plugins that ran before the sandbox stop at the update; a notice, or someone who never opens Settings just sees them quit */
function noticePaused(count: number): void {
  if (count === 0 || getSetting<boolean>(PAUSED_NOTICE_KEY, false)) return
  const shown = notify({
    category: 'plugin',
    title: count === 1 ? 'A plugin is paused' : `${count} plugins are paused`,
    body: 'Plugins now run in a sandbox, so each needs your OK for what it asks for. Click to review them.',
    view: 'settings:features'
  })
  // a notice held back by quiet hours or switched-off notifications tries again next launch
  if (shown) setSetting(PAUSED_NOTICE_KEY, true)
}

/** the file changed on disk: restart it, unless it now asks for more than you approved */
export async function reloadPlugin(filename: string): Promise<void> {
  if (!engineRunning) return
  const grant = getGrant(filename)
  if (!grant || !grant.on) return
  await stop(filename, null)
  outcomes.delete(filename)
  if (existsSync(join(getPluginsDir(), filename))) await start(filename)
}

export async function stopAllPlugins(): Promise<void> {
  engineRunning = false
  await Promise.all([...running.keys()].map(filename => stop(filename, null)))
}

/** for tests */
export function runningPluginCount(): number {
  return running.size
}
