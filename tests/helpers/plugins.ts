/** plugin test kit: in-memory deps for the bridge, and the real worker bootstrap run in a vm against it */

import vm from 'node:vm'
import { workerSource } from '../../src/main/plugins/hostPage'
import { dispatch, Limiter, PluginCallError, type BridgeContext, type BridgeDeps, type FetchResult } from '../../src/main/plugins/bridge'
import type { PluginGrant, PluginPermission } from '../../src/shared/pluginPermissions'
import type { PluginEventName } from '../../src/main/pluginEvents'
import type { Item } from '../../src/shared/types'
import { defined } from './defined'

export function grantOf(permissions: PluginPermission[], extra: Partial<PluginGrant> = {}): PluginGrant {
  return { on: true, permissions, hosts: [], workspaces: ['work'], grantedAt: 1, ...extra }
}

export function itemOf(overrides: Partial<Item> = {}): Item {
  return {
    id: 'card-1', type: 'card', context: 'work', title: 'A card', body: '', status: 'todo', priority: 0,
    position: 1, created_at: 1, updated_at: 1, due_at: null, metadata: '{}', ...overrides
  }
}

export function fakeDeps(init: { workspaces?: string[]; items?: Item[]; fetch?: BridgeDeps['fetch'] } = {}) {
  const items = new Map((init.items ?? []).map(i => [i.id, i]))
  const storage = new Map<string, string>()
  const notified: { title: string; body: string; key: string }[] = []
  const fetched: { url: string; method: string; headers: Record<string, string>; body?: string; hosts: string[] }[] = []
  let clock = 1_000_000
  let changes = 0
  const deps: BridgeDeps = {
    liveWorkspaces: () => init.workspaces ?? ['work', 'home'],
    getItem: id => items.get(id) ?? null,
    queryItems: (context, type, limit) => [...items.values()].filter(i => i.context === context && i.type === type).slice(0, limit),
    createItem: payload => {
      const created: Item = { ...payload, id: `made-${items.size + 1}`, created_at: clock, updated_at: clock }
      items.set(created.id, created)
      return created
    },
    updateItem: (id, patch) => {
      const next = { ...defined(items.get(id)), ...patch, updated_at: clock }
      items.set(id, next)
      return next
    },
    boardColumns: () => ['todo', 'doing', 'done'],
    notify: (title, body, key) => {
      notified.push({ title, body, key })
      return true
    },
    fetch: init.fetch ?? (async (url, options, hosts): Promise<FetchResult> => {
      fetched.push({ url: url.href, ...options, hosts })
      return { status: 200, headers: {}, text: 'ok', url: url.href }
    }),
    storageGet: key => (storage.has(key) ? { found: true, value: JSON.parse(defined(storage.get(key))) } : { found: false }),
    storageSet: (key, value) => {
      storage.set(key, JSON.stringify(value))
    },
    storageDelete: key => {
      storage.delete(key)
    },
    storageUsed: () => [...storage.values()].reduce((n, v) => n + Buffer.byteLength(v), 0),
    storageSize: key => (storage.has(key) ? Buffer.byteLength(defined(storage.get(key))) : 0),
    dataChanged: () => {
      changes++
    },
    now: () => clock
  }
  return {
    deps,
    items,
    storage,
    notified,
    fetched,
    advance: (ms: number) => {
      clock += ms
    },
    changes: () => changes
  }
}

export function contextOf(grant: () => PluginGrant | null, name = 'Test Plugin'): BridgeContext & { subscriptions: Set<PluginEventName> } {
  const subscriptions = new Set<PluginEventName>()
  return { filename: 'test.js', name, grant, limiter: new Limiter(), subscribe: e => subscriptions.add(e), subscriptions }
}

/** the bridge's answer, or the message it refused with */
export async function call(ctx: BridgeContext, deps: BridgeDeps, method: string, ...args: unknown[]): Promise<{ ok: true; value: unknown } | { ok: false; error: string }> {
  try {
    return { ok: true, value: await dispatch(ctx, deps, method, args) }
  } catch (err) {
    if (err instanceof PluginCallError) return { ok: false, error: err.message }
    throw err
  }
}

const roundTrip = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

export interface FakeWorker {
  logs: { level: string; text: string }[]
  /** settles on ready or on failure */
  started: Promise<{ ok: true } | { ok: false; error: string }>
  /** delivers an event and waits until its handlers finish */
  emit(name: PluginEventName, payload: unknown): Promise<void>
  unload(): Promise<void>
  subscriptions: Set<PluginEventName>
  /** clears what the plugin left running, the way closing the sandbox does */
  close(): void
}

/** messages are JSON both ways, as through the real preload */
export function startFakeWorker(source: string, grant: () => PluginGrant | null, deps: BridgeDeps, name = 'Test Plugin'): FakeWorker {
  const ctx = contextOf(grant, name)
  const logs: FakeWorker['logs'] = []
  const timers = new Set<ReturnType<typeof setTimeout>>()
  const acks: (() => void)[] = []
  let unloaded: (() => void) | null = null
  let settle: (r: { ok: true } | { ok: false; error: string }) => void = () => {}
  const started = new Promise<{ ok: true } | { ok: false; error: string }>(resolve => {
    settle = resolve
  })

  const sandbox: Record<string, unknown> = {
    console,
    setTimeout: (fn: () => void, ms: number) => {
      const t = setTimeout(fn, ms)
      timers.add(t)
      return t
    },
    clearTimeout: (t: ReturnType<typeof setTimeout>) => clearTimeout(t),
    setInterval: (fn: () => void, ms: number) => {
      const t = setInterval(fn, ms)
      timers.add(t)
      return t
    },
    clearInterval: (t: ReturnType<typeof setInterval>) => clearInterval(t)
  }
  sandbox.self = sandbox
  const toWorker = (data: unknown): void => {
    const handler = sandbox.onmessage as ((e: { data: unknown }) => void) | undefined
    handler?.({ data: roundTrip(data) })
  }

  sandbox.postMessage = (raw: unknown): void => {
    const message = roundTrip(raw) as Record<string, unknown>
    switch (message.t) {
      case 'call':
        void call(ctx, deps, String(message.method), ...(message.args as unknown[])).then(result =>
          toWorker(result.ok
            ? { t: 'result', id: message.id, ok: true, value: result.value ?? null }
            : { t: 'result', id: message.id, ok: false, error: result.error }))
        break
      case 'ready':
        settle({ ok: true })
        break
      case 'failed':
        settle({ ok: false, error: String(message.message) })
        break
      case 'log':
        logs.push({ level: String(message.level), text: String(message.text) })
        break
      case 'ack':
        acks.shift()?.()
        break
      case 'unloaded':
        unloaded?.()
        break
    }
  }

  const context = vm.createContext(sandbox)
  try {
    vm.runInContext(workerSource(source), context, { filename: 'plugin-worker.js' })
  } catch (err) {
    // the vm's errors come from another realm, so instanceof Error is false for them
    const e = err as { message?: string; stack?: string }
    settle({ ok: false, error: `${e.message ?? String(err)}\n${e.stack ?? ''}` })
  }

  return {
    logs,
    started,
    subscriptions: ctx.subscriptions,
    emit: (name, payload) => new Promise(resolve => {
      acks.push(resolve)
      toWorker({ t: 'event', name, payload })
    }),
    unload: () => new Promise(resolve => {
      unloaded = resolve
      toWorker({ t: 'unload' })
    }),
    close: () => {
      for (const t of timers) clearTimeout(t)
      timers.clear()
    }
  }
}

/** lets queued promise callbacks run, enough for a call to reach the bridge and come back */
export async function settled(): Promise<void> {
  for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve))
}
