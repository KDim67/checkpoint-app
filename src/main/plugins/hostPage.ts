/** the page and worker a plugin runs in; nothing in them is trusted, main checks every call that comes out */

import { createHash } from 'crypto'

/** the sandboxed preload can't import, so it spells these out too; a test holds them equal */
export const HOST_OUT = 'plugin-host:out'
export const HOST_IN = 'plugin-host:in'

/** a slow plugin's events queue in its own page, never in main */
export const EVENT_QUEUE_LIMIT = 200

// relays only; it lives in the page's world, the plugin can't reach it from its worker
const PAGE_SCRIPT = `'use strict'
const host = window.pluginHost
let worker = null
let outstanding = 0
host.onMessage(msg => {
  if (msg.t === 'start') {
    const url = URL.createObjectURL(new Blob([msg.code], { type: 'text/javascript' }))
    worker = new Worker(url)
    worker.onmessage = e => {
      if (e.data && e.data.t === 'ack') outstanding = Math.max(0, outstanding - 1)
      else host.send(e.data)
    }
    worker.onerror = e => {
      e.preventDefault()
      host.send({ t: 'error', message: String(e.message || 'The plugin threw an error.'), line: Number(e.lineno) || 0 })
    }
    return
  }
  if (!worker) return
  if (msg.t === 'event') {
    if (outstanding >= ${EVENT_QUEUE_LIMIT}) {
      host.send({ t: 'dropped', name: msg.name })
      return
    }
    outstanding++
  }
  worker.postMessage(msg)
})
host.send({ t: 'page' })
`

// the network walls are the policy and the session; these stand-ins only make the error say what to use instead
const BOOT = `const __checkpoint = (() => {
  'use strict'
  const post = self.postMessage.bind(self)
  const pending = new Map()
  const handlers = new Map()
  let next = 0
  const show = value => {
    if (typeof value === 'string') return value
    if (value instanceof Error) return value.stack || value.message
    try { return JSON.stringify(value) } catch { return String(value) }
  }
  const call = (method, ...args) => new Promise((resolve, reject) => {
    const id = ++next
    pending.set(id, { resolve, reject })
    post({ t: 'call', id, method, args })
  })
  for (const name of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'WebTransport', 'importScripts']) {
    const refuse = () => { throw new Error(name + ' is not available to plugins. Use api.fetch, which reaches the hosts your plugin lists.') }
    try { Object.defineProperty(self, name, { value: refuse }) } catch {}
  }
  const api = Object.freeze({
    workspaces: () => call('workspaces'),
    items: Object.freeze({
      get: id => call('items.get', id),
      query: query => call('items.query', query),
      create: item => call('items.create', item),
      update: (id, patch) => call('items.update', id, patch)
    }),
    events: Object.freeze({
      on(name, handler) {
        if (typeof handler !== 'function') throw new TypeError('api.events.on needs a function to call')
        const set = handlers.get(name) || new Set()
        handlers.set(name, set)
        set.add(handler)
        call('events.subscribe', name).catch(err => {
          set.delete(handler)
          post({ t: 'log', level: 'error', text: show(err) })
        })
        return () => { set.delete(handler) }
      }
    }),
    notify: (title, body) => call('notify', title, body),
    fetch: (url, init) => call('fetch', url, init),
    storage: Object.freeze({
      get: (key, fallback) => call('storage.get', key).then(r => (r && r.found ? r.value : fallback)),
      set: (key, value) => call('storage.set', key, value)
    }),
    log: (...args) => post({ t: 'log', level: 'info', text: args.map(show).join(' ') })
  })
  const module = { exports: {} }
  const settle = async fn => {
    try { await fn() } catch (err) { post({ t: 'log', level: 'error', text: show(err) }) }
  }
  self.onmessage = async ({ data }) => {
    if (!data || typeof data !== 'object') return
    if (data.t === 'result') {
      const waiting = pending.get(data.id)
      if (!waiting) return
      pending.delete(data.id)
      if (data.ok) waiting.resolve(data.value)
      else waiting.reject(new Error(data.error))
    } else if (data.t === 'event') {
      for (const handler of [...(handlers.get(data.name) || [])]) await settle(() => handler(data.payload))
      post({ t: 'ack' })
    } else if (data.t === 'ping') {
      post({ t: 'pong', n: data.n })
    } else if (data.t === 'unload') {
      const plugin = module.exports
      if (plugin && typeof plugin.onUnload === 'function') await settle(() => plugin.onUnload())
      post({ t: 'unloaded' })
    }
  }
  const start = async () => {
    const plugin = module.exports
    try {
      if (plugin && typeof plugin.onLoad === 'function') await plugin.onLoad(api)
      post({ t: 'ready' })
    } catch (err) {
      post({ t: 'failed', message: show(err) })
    }
  }
  return { module, start }
})();
;(function (module, exports) {`

const WRAP_CLOSE = `
}).call(__checkpoint.module.exports, __checkpoint.module, __checkpoint.module.exports);
__checkpoint.start();
`

/** a line in the worker script, minus this, is the line in the plugin's own file */
export const PLUGIN_LINE_OFFSET = BOOT.split('\n').length

/** sloppy mode like any CommonJS file; only the host's own code is strict */
export function workerSource(pluginSource: string): string {
  return `${BOOT}\n${pluginSource}${WRAP_CLOSE}`
}

const scriptHash = createHash('sha256').update(PAGE_SCRIPT).digest('base64')

/** no network, no frames, no eval; the worker inherits all of it */
export const HOST_POLICY = [
  "default-src 'none'",
  `script-src 'sha256-${scriptHash}'`,
  'worker-src blob:',
  "connect-src 'none'",
  "base-uri 'none'",
  "form-action 'none'"
].join('; ')

const html = `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${HOST_POLICY}"><script>${PAGE_SCRIPT}</script>`

/** the one address the plugin's session lets through */
export const HOST_PAGE_URL = `data:text/html;base64,${Buffer.from(html, 'utf8').toString('base64')}`
