/** the plugin sandbox in real electron: real registry, db, sandbox, preload and bridge, only the plugins are invented; run with npm run check:sandbox */

import { app, webContents } from 'electron'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import http from 'http'

const root = mkdtempSync(join(tmpdir(), 'checkpoint-sandbox-check-'))
app.setPath('home', join(root, 'home'))
app.setPath('userData', join(root, 'userData'))
mkdirSync(join(root, 'home'), { recursive: true })

const results: { name: string; ok: boolean; detail: string }[] = []
const check = (name: string, ok: boolean, detail = ''): void => {
  results.push({ name, ok, detail })
}

let hits = 0
const server = http.createServer((_req, res) => {
  hits++
  res.end('a plugin reached this, which it never should')
})

/** every attempt reports blocked or ESCAPED; its eval and Function are probes the sandbox has to refuse */
const ATTACKER = (port: number, dbFile: string): string => `
module.exports = {
  metadata: { name: "Attacker", version: "1.0.0", permissions: ["read"] },
  async onLoad(api) {
    const out = {}
    const attempt = async (name, fn) => {
      try { out[name] = 'ESCAPED: ' + String(await fn()).slice(0, 80) }
      catch (e) { out[name] = 'blocked' }
    }
    const globals = { require: typeof require, process: typeof process, window: typeof window, document: typeof document, Buffer: typeof Buffer }
    for (const [name, type] of Object.entries(globals)) out['typeof ' + name] = type === 'undefined' ? 'blocked' : 'ESCAPED: ' + type
    const realFetch = (url) => self.constructor.prototype.fetch.call(self, url)
    await attempt('fetch to this machine', () => fetch('http://127.0.0.1:${port}/x').then(r => r.text()))
    await attempt('the original fetch', () => realFetch('http://127.0.0.1:${port}/p').then(r => r.text()))
    await attempt('XMLHttpRequest', () => new Promise((res, rej) => { const x = new XMLHttpRequest(); x.open('GET', 'http://127.0.0.1:${port}/xhr'); x.onload = () => res(x.status); x.onerror = () => rej(new Error('x')); x.send() }))
    await attempt('WebSocket', () => new Promise((res, rej) => { const w = new WebSocket('ws://127.0.0.1:${port}/ws'); w.onopen = () => res('open'); w.onerror = () => rej(new Error('x')) }))
    await attempt('importScripts', () => { importScripts('http://127.0.0.1:${port}/s.js'); return 'ran' })
    await attempt('eval', () => eval('1 + 1'))
    await attempt('Function', () => new Function('return 2')())
    await attempt('the database file', () => realFetch('file:///${dbFile}').then(r => r.text()))
    await attempt('a nested worker', () => new Promise((res, rej) => {
      const w = new Worker(URL.createObjectURL(new Blob(['fetch("http://127.0.0.1:${port}/nested").then(r => postMessage("ok"), e => postMessage("no"))'])))
      w.onmessage = e => (e.data === 'ok' ? res(e.data) : rej(new Error('no')))
      w.onerror = () => rej(new Error('no'))
    }))
    await attempt('api.fetch without network', () => api.fetch('https://example.com/'))
    await attempt('api.items.create without write', () => api.items.create({ context: 'work', type: 'task', title: 'x' }))
    await attempt('api.notify without notify', () => api.notify('hi', ''))
    await attempt('another workspace', () => api.items.query({ context: 'home', type: 'task' }))
    await attempt('a card in another workspace', () => api.items.get('home-task').then(v => (v === null ? Promise.reject(new Error('null')) : v)))
    await attempt('a made-up api call', () => new Promise((resolve, reject) => {
      const id = 999999
      const previous = self.onmessage
      self.onmessage = e => {
        if (e.data && e.data.id === id) { self.onmessage = previous; e.data.ok ? resolve(e.data.value) : reject(new Error(e.data.error)) }
        else previous(e)
      }
      self.postMessage({ t: 'call', id, method: 'db.exec', args: ['DROP TABLE items'] })
    }))
    const own = await api.items.query({ context: 'work', type: 'task' })
    out['its own workspace'] = own.length === 1 ? 'visible' : 'MISSING'
    new BroadcastChannel('checkpoint-plugins').onmessage = e => api.log('CROSSED ' + e.data)
    api.log('RESULTS ' + JSON.stringify(out))
  }
}
`

const NEIGHBOUR = `
module.exports = {
  metadata: { name: "Neighbour", version: "1.0.0", permissions: [] },
  onLoad(api) {
    const channel = new BroadcastChannel('checkpoint-plugins')
    setInterval(() => channel.postMessage('from the neighbour'), 200)
    channel.onmessage = e => api.log('CROSSED ' + e.data)
  }
}
`

const LOOPER = `
module.exports = {
  metadata: { name: "Looper", version: "1.0.0", permissions: [] },
  onLoad() { setTimeout(() => { for (;;) {} }, 500) }
}
`

const LEAKER = `
module.exports = {
  metadata: { name: "Leaker", version: "1.0.0", permissions: [] },
  onLoad() {
    const hoard = []
    setInterval(() => hoard.push(new Array(1e6).fill(hoard.length)), 50)
  }
}
`

const ECHO = (permissions: string): string => `
module.exports = {
  metadata: { name: "Echo", version: "1.0.0", permissions: ${permissions} },
  onLoad(api) {
    this.api = api
    api.events.on('item:completed', async ({ item }) => {
      await api.items.create({ context: item.context, type: 'log', title: 'echo of ' + item.title })
    })
  },
  async onUnload() { await this.api.storage.set('said goodbye', true) }
}
`

const wait = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

async function main(): Promise<void> {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()))
  const port = (server.address() as { port: number }).port

  const db = await import('../../src/main/db')
  const registry = await import('../../src/main/pluginRegistry')
  const { getPluginsDir } = await import('../../src/main/paths')

  db.initDb(join(root, 'userData'))
  db.setSetting('contexts_list', JSON.stringify([{ slug: 'work', name: 'Work', color: '#535e85' }, { slug: 'home', name: 'Home', color: '#535e85' }]))
  const task = db.getDb().prepare(
    "INSERT INTO items (id, type, context, title, body, status, priority, position, created_at, updated_at, due_at, metadata) VALUES (?, 'task', ?, ?, '', 'open', 0, 0, 1, 1, NULL, '{}')"
  )
  task.run('work-task', 'work', 'work task')
  task.run('home-task', 'home', 'home task')

  const dir = getPluginsDir()
  mkdirSync(dir, { recursive: true })
  const plugins: [string, string, string[]][] = [
    ['attacker.js', ATTACKER(port, join(root, 'userData').replace(/\\/g, '/')), ['read']],
    ['neighbour.js', NEIGHBOUR, []],
    ['looper.js', LOOPER, []],
    ['leaker.js', LEAKER, []],
    ['echo.js', ECHO('["read", "write"]'), ['read', 'write']]
  ]
  for (const [file, source, permissions] of plugins) {
    writeFileSync(join(dir, file), source)
    const approved = await registry.approvePlugin(file, { permissions, hosts: [], workspaces: ['work'] })
    check(`approves ${file}`, approved.ok, approved.ok ? '' : approved.error)
  }
  registry.startApprovedPlugins()
  await wait(4000)

  const sandboxes = webContents.getAllWebContents().filter(w => w.getURL().startsWith('data:text/html'))
  const pids = new Set(sandboxes.map(w => w.getOSProcessId()))
  check('every plugin runs in a process of its own', sandboxes.length === plugins.length && pids.size === plugins.length, `${sandboxes.length} sandboxes, ${pids.size} processes`)

  const report = registry.pluginLog('attacker.js').find(l => l.text.startsWith('RESULTS '))
  if (!report) check('the attacker reported', false, JSON.stringify(registry.pluginLog('attacker.js')))
  else {
    for (const [name, outcome] of Object.entries(JSON.parse(report.text.slice('RESULTS '.length)) as Record<string, string>)) {
      const expected = name === 'its own workspace' ? 'visible' : 'blocked'
      check(`attacker: ${name}`, outcome === expected, outcome)
    }
  }

  db.updateItem(db.getDb(), 'work-task', { status: 'done' })
  db.updateItem(db.getDb(), 'home-task', { status: 'done' })
  await wait(1500)
  const echoes = db.getDb().prepare("SELECT context FROM items WHERE type = 'log'").all() as { context: string }[]
  check('an event reaches a plugin in its own workspace only', echoes.length === 1 && echoes[0].context === 'work', JSON.stringify(echoes))

  writeFileSync(join(dir, 'echo.js'), ECHO('["read", "write", "notify"]'))
  await registry.reloadPlugin('echo.js')
  check('onUnload runs before the sandbox goes', db.getSetting('plugin:echo.js:said goodbye', null) === true)
  check('a file that asks for more waits for you', registry.scanPlugins().find(p => p.filename === 'echo.js')?.status === 'needs-approval')

  // a stuck loop misses two pings, ten seconds apart; a leak passes the memory cap
  const status = (file: string) => registry.scanPlugins().find(p => p.filename === file)
  for (let waited = 0; waited < 45_000; waited += 1000) {
    if (status('looper.js')?.status === 'stopped' && status('leaker.js')?.status === 'stopped') break
    await wait(1000)
  }
  check('a stuck loop is stopped', status('looper.js')?.statusDetail?.includes('stopped responding') === true, String(status('looper.js')?.statusDetail))
  check('a leak is stopped at the memory cap', status('leaker.js')?.statusDetail?.includes('MB of memory') === true, String(status('leaker.js')?.statusDetail))

  await registry.stopAllPlugins()
  await wait(500)
  const left = webContents.getAllWebContents().filter(w => !w.isDestroyed() && w.getURL().startsWith('data:text/html')).length
  check('no sandbox outlives being stopped', left === 0, `${left} left`)
  check('nothing reached the network', hits === 0, `${hits} requests`)
  const crossed = ['attacker.js', 'neighbour.js'].some(f => registry.pluginLog(f).some(l => l.text.startsWith('CROSSED')))
  check('plugins cannot talk to each other', !crossed)

  server.close()
  db.closeDb()
  try {
    rmSync(root, { recursive: true, force: true })
  } catch {
    // chromium still holds its own files in there on windows; it is the os temp folder
  }
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.name}${r.ok || !r.detail ? '' : `: ${r.detail}`}`)
  const failed = results.filter(r => !r.ok).length
  console.log(failed === 0 ? `\nAll ${results.length} sandbox checks passed.` : `\n${failed} of ${results.length} sandbox checks failed.`)
  app.exit(failed === 0 ? 0 : 1)
}

app.whenReady().then(main).catch(err => {
  console.error('The sandbox check could not run:', err)
  app.exit(1)
})
// headless: no window is ever opened, so nothing should quit the app early
app.on('window-all-closed', () => {})
