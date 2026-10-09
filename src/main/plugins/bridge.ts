/** every call a plugin makes lands here: checked against what you approved, its workspaces and its limits, then run */

import { z } from 'zod'
import { PERMISSION_TEXT, normalizeHost, type PluginGrant, type PluginPermission } from '../../shared/pluginPermissions'
import type { CreateItemPayload, Item, ItemType } from '../../shared/types'
import type { PluginEventName } from '../pluginEvents'

export const LIMITS = {
  calls: { max: 1000, windowMs: 10_000, what: 'calls every 10 seconds' },
  writes: { max: 60, windowMs: 60_000, what: 'changes a minute' },
  notify: { max: 10, windowMs: 3_600_000, what: 'notifications an hour' },
  fetch: { max: 30, windowMs: 60_000, what: 'requests a minute' }
} as const

export const STORAGE_VALUE_BYTES = 64 * 1024
export const STORAGE_TOTAL_BYTES = 1024 * 1024
export const FETCH_BODY_BYTES = 64 * 1024

export const EVENT_NAMES = ['item:created', 'item:completed', 'due:reminded', 'focus:completed'] as const satisfies readonly PluginEventName[]

export interface FetchInit {
  method: string
  headers: Record<string, string>
  body?: string
}

export interface FetchResult {
  status: number
  headers: Record<string, string>
  text: string
  url: string
}

export type ItemPatch = Partial<Pick<Item, 'title' | 'body' | 'status' | 'priority' | 'due_at' | 'position' | 'context'>>

/** what the bridge may touch, handed in so it can be tested without a database or a network */
export interface BridgeDeps {
  liveWorkspaces(): string[]
  getItem(id: string): Item | null
  queryItems(context: string, type: ItemType, limit: number): Item[]
  createItem(payload: CreateItemPayload): Item
  updateItem(id: string, patch: ItemPatch): Item
  /** a card's status is a column id, and one no column owns hides it */
  boardColumns(context: string): string[]
  notify(title: string, body: string, dedupeKey: string): boolean
  fetch(url: URL, init: FetchInit, hosts: string[]): Promise<FetchResult>
  storageGet(key: string): { found: boolean; value?: unknown }
  storageSet(key: string, value: unknown): void
  storageDelete(key: string): void
  /** bytes this plugin already keeps, and what one key takes now */
  storageUsed(): number
  storageSize(key: string): number
  dataChanged(): void
  now(): number
}

export interface BridgeContext {
  filename: string
  name: string
  /** read fresh on every call, so a rename or a revoke applies at once */
  grant(): PluginGrant | null
  limiter: Limiter
  subscribe(event: PluginEventName): void
}

/** the message is shown to the plugin, and through its log to you */
export class PluginCallError extends Error {}

/** a sliding window per bucket */
export class Limiter {
  private seen = new Map<string, number[]>()

  take(bucket: keyof typeof LIMITS, now: number): boolean {
    const { max, windowMs } = LIMITS[bucket]
    const times = (this.seen.get(bucket) ?? []).filter(t => now - t < windowMs)
    if (times.length >= max) {
      this.seen.set(bucket, times)
      return false
    }
    times.push(now)
    this.seen.set(bucket, times)
    return true
  }
}

const VERB: Record<PluginPermission, string> = {
  read: 'see cards',
  write: 'change cards',
  notify: 'show notifications',
  network: 'reach the internet'
}

function need(ctx: BridgeContext, permission: PluginPermission): PluginGrant {
  const grant = ctx.grant()
  if (!grant || !grant.on || grant.legacy || !grant.permissions.includes(permission)) {
    throw new PluginCallError(
      `${ctx.name} isn't allowed to ${VERB[permission]}. Allow "${PERMISSION_TEXT[permission].label}" in its permissions in Settings, Extensions.`
    )
  }
  return grant
}

/** what you picked that still exists; a deleted workspace drops out on its own */
function scope(ctx: BridgeContext, deps: BridgeDeps): Set<string> {
  const grant = ctx.grant()
  if (!grant) return new Set()
  const live = new Set(deps.liveWorkspaces())
  return new Set(grant.workspaces.filter(w => live.has(w)))
}

function inScope(ctx: BridgeContext, deps: BridgeDeps, context: string): void {
  if (!scope(ctx, deps).has(context)) {
    throw new PluginCallError(`${ctx.name} can't use the workspace "${context}". Pick it in its permissions in Settings, Extensions.`)
  }
}

/** the same answer whether the card is missing or just not its to see */
function visibleItem(ctx: BridgeContext, deps: BridgeDeps, id: string): Item | null {
  const item = deps.getItem(id)
  return item && scope(ctx, deps).has(item.context) ? item : null
}

function limit(ctx: BridgeContext, deps: BridgeDeps, bucket: keyof typeof LIMITS): void {
  if (!ctx.limiter.take(bucket, deps.now())) {
    const { max, what } = LIMITS[bucket]
    throw new PluginCallError(`${ctx.name} reached its limit of ${max} ${what}. Try again shortly.`)
  }
}

/** zod's own wording, prefixed with what was being called */
function parse<T>(schema: z.ZodType<T>, value: unknown, what: string): T {
  const result = schema.safeParse(value)
  if (result.success) return result.data
  const issue = result.error.issues[0]
  const where = issue.path.length ? ` (${issue.path.join('.')})` : ''
  throw new PluginCallError(`${what}: ${issue.message}${where}`)
}

const slug = z.string().min(1).max(200)
const itemType = z.enum(['log', 'card', 'task'])
const priority = z.number().int().min(0).max(3)
const dueAt = z.number().finite().nullable()
const title = z.string().min(1).max(500)
const body = z.string().max(100_000)
const status = z.string().min(1).max(100)

const querySchema = z.object({
  context: slug,
  type: itemType,
  limit: z.number().int().min(1).max(200).optional()
}).strict()

const createSchema = z.object({
  context: slug,
  type: itemType,
  title,
  body: body.optional(),
  status: status.optional(),
  priority: priority.optional(),
  due_at: dueAt.optional(),
  position: z.number().finite().optional()
}).strict()

const patchSchema = z.object({
  title: title.optional(),
  body: body.optional(),
  status: status.optional(),
  priority: priority.optional(),
  due_at: dueAt.optional(),
  position: z.number().finite().optional(),
  context: slug.optional()
}).strict()

// what fetch would refuse anyway, or what would let a plugin speak for the connection
const FORBIDDEN_HEADERS = /^(host|connection|content-length|transfer-encoding|keep-alive|upgrade|te|trailer|expect|proxy-.*)$/i

const fetchSchema = z.object({
  method: z.enum(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']).optional(),
  headers: z.record(z.string().max(8192)).optional(),
  body: z.string().optional()
}).strict()

const storageKey = z.string().min(1).max(200)

type Handler = (ctx: BridgeContext, deps: BridgeDeps, args: unknown[]) => unknown | Promise<unknown>

const HANDLERS: Record<string, Handler> = {
  workspaces: (ctx, deps) => [...scope(ctx, deps)].sort(),

  'items.get': (ctx, deps, [id]) => {
    need(ctx, 'read')
    return visibleItem(ctx, deps, parse(z.string().min(1).max(200), id, 'api.items.get'))
  },

  'items.query': (ctx, deps, [query]) => {
    need(ctx, 'read')
    const q = parse(querySchema, query, 'api.items.query')
    inScope(ctx, deps, q.context)
    return deps.queryItems(q.context, q.type, q.limit ?? 50)
  },

  'items.create': (ctx, deps, [input]) => {
    need(ctx, 'write')
    const p = parse(createSchema, input, 'api.items.create')
    inScope(ctx, deps, p.context)
    limit(ctx, deps, 'writes')
    const columns = p.type === 'card' ? deps.boardColumns(p.context) : []
    const created = deps.createItem({
      type: p.type,
      context: p.context,
      title: p.title,
      body: p.body ?? '',
      status: p.type === 'card'
        ? (p.status && columns.includes(p.status) ? p.status : columns[0] ?? 'todo')
        : p.status ?? 'open',
      priority: (p.priority ?? 0) as Item['priority'],
      position: p.position ?? deps.now(),
      due_at: p.due_at ?? null,
      // never the plugin's to set: it is where repeating tasks and other features keep their links
      metadata: '{}'
    })
    deps.dataChanged()
    return created
  },

  'items.update': (ctx, deps, [id, patch]) => {
    need(ctx, 'write')
    const itemId = parse(z.string().min(1).max(200), id, 'api.items.update')
    const changes = parse(patchSchema, patch, 'api.items.update')
    const item = visibleItem(ctx, deps, itemId)
    if (!item) throw new PluginCallError(`${ctx.name} has no card with the id "${itemId}" in the workspaces it can use.`)
    if (changes.context !== undefined) inScope(ctx, deps, changes.context)
    if (Object.keys(changes).length === 0) return item
    if (item.type === 'card' && changes.status !== undefined) {
      const columns = deps.boardColumns(changes.context ?? item.context)
      if (!columns.includes(changes.status)) {
        throw new PluginCallError(`api.items.update: "${changes.status}" is not a column on that board. Its columns are ${columns.join(', ')}.`)
      }
    }
    limit(ctx, deps, 'writes')
    const updated = deps.updateItem(itemId, changes as ItemPatch)
    deps.dataChanged()
    return updated
  },

  'events.subscribe': (ctx, _deps, [name]) => {
    need(ctx, 'read')
    ctx.subscribe(parse(z.enum(EVENT_NAMES), name, 'api.events.on'))
    return true
  },

  notify: (ctx, deps, [heading, text]) => {
    need(ctx, 'notify')
    const t = parse(z.string().min(1).max(120), heading, 'api.notify title')
    const b = parse(z.string().max(500), text ?? '', 'api.notify body')
    limit(ctx, deps, 'notify')
    return deps.notify(t, b, `plugin:${ctx.filename}:${t}`)
  },

  fetch: async (ctx, deps, [address, init]) => {
    const grant = need(ctx, 'network')
    const raw = parse(z.string().min(1).max(4096), address, 'api.fetch url')
    let url: URL
    try {
      url = new URL(raw)
    } catch {
      throw new PluginCallError(`api.fetch: "${raw.slice(0, 200)}" is not a full address.`)
    }
    if (url.protocol !== 'https:') throw new PluginCallError(`api.fetch: plugins can only use https addresses.`)
    const host = normalizeHost(url.hostname)
    if (!host || !grant.hosts.includes(host)) {
      throw new PluginCallError(`${ctx.name} can only reach the hosts it lists. Add "${url.hostname}" to its hosts, then approve it again.`)
    }
    const options = parse(fetchSchema, init ?? {}, 'api.fetch')
    const method = options.method ?? 'GET'
    if (options.body !== undefined && (method === 'GET' || method === 'HEAD')) {
      throw new PluginCallError(`api.fetch: a ${method} request can't carry a body.`)
    }
    if (options.body !== undefined && Buffer.byteLength(options.body, 'utf8') > FETCH_BODY_BYTES) {
      throw new PluginCallError(`api.fetch: the body is larger than ${FETCH_BODY_BYTES / 1024} KB.`)
    }
    const headers = Object.fromEntries(Object.entries(options.headers ?? {}).filter(([k]) => !FORBIDDEN_HEADERS.test(k)))
    limit(ctx, deps, 'fetch')
    return deps.fetch(url, { method, headers, ...(options.body !== undefined ? { body: options.body } : {}) }, grant.hosts)
  },

  'storage.get': (_ctx, deps, [key]) => deps.storageGet(parse(storageKey, key, 'api.storage.get')),

  'storage.set': (ctx, deps, [key, value]) => {
    const k = parse(storageKey, key, 'api.storage.set')
    // JSON carries no undefined, so null is how a plugin forgets a key
    if (value === null || value === undefined) {
      deps.storageDelete(k)
      return true
    }
    const size = Buffer.byteLength(JSON.stringify(value), 'utf8')
    if (size > STORAGE_VALUE_BYTES) {
      throw new PluginCallError(`api.storage.set: "${k}" is ${Math.ceil(size / 1024)} KB; one value can be at most ${STORAGE_VALUE_BYTES / 1024} KB.`)
    }
    if (deps.storageUsed() - deps.storageSize(k) + size > STORAGE_TOTAL_BYTES) {
      throw new PluginCallError(`${ctx.name} has used its ${STORAGE_TOTAL_BYTES / 1024 / 1024} MB of storage. Remove something with api.storage.set(key, null) first.`)
    }
    deps.storageSet(k, value)
    return true
  }
}

export async function dispatch(ctx: BridgeContext, deps: BridgeDeps, method: unknown, args: unknown): Promise<unknown> {
  if (typeof method !== 'string' || !Object.prototype.hasOwnProperty.call(HANDLERS, method)) {
    throw new PluginCallError(`There is no api call named "${String(method).slice(0, 80)}".`)
  }
  limit(ctx, deps, 'calls')
  return HANDLERS[method](ctx, deps, Array.isArray(args) ? args : [])
}
