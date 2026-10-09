import { describe, it, expect, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { EXAMPLE_PLUGINS, findExamplePlugin } from '../src/shared/examplePlugins'
import { parsePluginMetadata } from '../src/shared/pluginMetadata'
import { normalizeRequest } from '../src/shared/pluginPermissions'
import { HOST_IN, HOST_OUT, HOST_PAGE_URL, HOST_POLICY, PLUGIN_LINE_OFFSET } from '../src/main/plugins/hostPage'
import { fakeDeps, grantOf, itemOf, settled, startFakeWorker, type FakeWorker } from './helpers/plugins'
import { defined } from './helpers/defined'

// the real bootstrap and plugin code, in a vm instead of the sandbox; electron's part is checked by the headless harness

const open: FakeWorker[] = []
const start = (...args: Parameters<typeof startFakeWorker>): FakeWorker => {
  const worker = startFakeWorker(...args)
  open.push(worker)
  return worker
}

afterEach(() => {
  for (const worker of open.splice(0)) worker.close()
})

/** exactly what the example says it needs, nothing more */
const declaredGrant = (source: string) => {
  const metadata = parsePluginMetadata(source)
  const request = normalizeRequest(metadata.permissions ?? [], metadata.hosts ?? [])
  return grantOf(request.permissions, { hosts: request.hosts })
}

describe('the worker bootstrap', () => {
  it('runs onLoad with an api whose calls come back as promises', async () => {
    const kit = fakeDeps({ items: [itemOf()] })
    const worker = start(`module.exports = { async onLoad(api) {
      const item = await api.items.get('card-1')
      await api.storage.set('seen', item.title)
      api.log('saw', item.title)
    } }`, () => grantOf(['read']), kit.deps)
    expect(await worker.started).toStrictEqual({ ok: true })
    expect(kit.storage.get('seen')).toBe('"A card"')
    expect(worker.logs).toContainEqual({ level: 'info', text: 'saw A card' })
  })

  it('turns a refused call into a rejection the plugin can catch', async () => {
    const kit = fakeDeps()
    const worker = start(`module.exports = { async onLoad(api) {
      try { await api.notify('hi', '') } catch (err) { api.log('refused: ' + err.message) }
    } }`, () => grantOf([]), kit.deps)
    await worker.started
    expect(worker.logs[0].text).toMatch(/^refused: Test Plugin isn't allowed to show notifications/)
  })

  it('reports an onLoad that throws as a failed start', async () => {
    const worker = start('module.exports = { onLoad() { throw new Error("nope") } }', () => grantOf([]), fakeDeps().deps)
    expect(await worker.started).toMatchObject({ ok: false, error: expect.stringContaining('nope') })
  })

  it('points a syntax error at the line in the plugin\'s own file', async () => {
    const worker = start('module.exports = {\n  onLoad() {\n    let = = 1\n  }\n}', () => grantOf([]), fakeDeps().deps)
    const result = await worker.started
    expect(result.ok).toBe(false)
    const line = Number(/plugin-worker\.js:(\d+)/.exec(result.ok ? '' : result.error)?.[1])
    expect(line - PLUGIN_LINE_OFFSET).toBe(3)
  })

  it('runs plugin code in sloppy mode like any CommonJS file, and gives it no require', async () => {
    const kit = fakeDeps()
    const worker = start(`leaked = 1
module.exports = { onLoad(api) { api.log(typeof require, typeof process) } }`, () => grantOf([]), kit.deps)
    expect(await worker.started).toStrictEqual({ ok: true })
    expect(worker.logs[0].text).toBe('undefined undefined')
  })

  it('names api.fetch when a plugin reaches for fetch', async () => {
    const worker = start(`module.exports = { onLoad(api) {
      try { fetch('https://example.com') } catch (err) { api.log(err.message) }
    } }`, () => grantOf([]), fakeDeps().deps)
    await worker.started
    expect(worker.logs[0].text).toContain('Use api.fetch')
  })

  it('stops delivering to a handler once it unsubscribes', async () => {
    const kit = fakeDeps()
    const worker = start(`module.exports = { onLoad(api) {
      const off = api.events.on('item:created', ({ item }) => { api.log(item.title); off() })
    } }`, () => grantOf(['read']), kit.deps)
    await worker.started
    await settled()
    await worker.emit('item:created', { item: itemOf({ title: 'first' }) })
    await worker.emit('item:created', { item: itemOf({ title: 'second' }) })
    expect(worker.logs.map(l => l.text)).toStrictEqual(['first'])
  })

  it('calls onUnload before it goes', async () => {
    const kit = fakeDeps()
    const worker = start('module.exports = { onLoad(api) { this.api = api }, async onUnload() { this.api.log("bye") } }', () => grantOf([]), kit.deps)
    await worker.started
    await worker.unload()
    expect(worker.logs.map(l => l.text)).toContain('bye')
  })
})

describe('the shipped examples', () => {
  it('each starts and works with only the permissions it declares', async () => {
    for (const example of EXAMPLE_PLUGINS) {
      const kit = fakeDeps({ items: [itemOf()] })
      const worker = start(example.source, () => declaredGrant(example.source), kit.deps, example.name)
      expect(await worker.started, example.filename).toStrictEqual({ ok: true })
      await settled()
      expect(worker.logs.filter(l => l.level === 'error'), example.filename).toStrictEqual([])
    }
  })

  it('Daily Summary writes one log entry on the fifth finished card of the day, then stays quiet', async () => {
    const example = defined(findExamplePlugin('daily-summary.js'))
    const kit = fakeDeps()
    const worker = start(example.source, () => declaredGrant(example.source), kit.deps)
    await worker.started
    await settled()
    for (let i = 1; i <= 6; i++) await worker.emit('item:completed', { item: itemOf({ id: `c${i}`, title: `Card ${i}` }) })
    const logs = [...kit.items.values()].filter(i => i.type === 'log')
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatchObject({ context: 'work', title: 'Finished 5 things today' })
    expect(kit.notified).toHaveLength(1)
  })

  it('Auto Tagger raises an urgent-sounding card and leaves the rest alone', async () => {
    const example = defined(findExamplePlugin('auto-tagger.js'))
    const kit = fakeDeps({ items: [itemOf({ id: 'bug', title: 'Login crash on start' }), itemOf({ id: 'calm', title: 'Tidy the docs' })] })
    const worker = start(example.source, () => declaredGrant(example.source), kit.deps)
    await worker.started
    await settled()
    await worker.emit('item:created', { item: defined(kit.items.get('bug')) })
    await worker.emit('item:created', { item: defined(kit.items.get('calm')) })
    expect(kit.items.get('bug')?.priority).toBe(3)
    expect(kit.items.get('calm')?.priority).toBe(0)
  })

  it('Finished Webhook waits for its address, then posts to the host it lists', async () => {
    const example = defined(findExamplePlugin('finished-webhook.js'))
    const unset = start(example.source, () => declaredGrant(example.source), fakeDeps({ settings: { webhook: null } }).deps)
    await unset.started
    await settled()
    await unset.emit('item:completed', { item: itemOf() })
    expect(unset.logs.map(l => l.text)).toContain('fill in the webhook address in the plugin settings first')

    const source = example.source
    const kit = fakeDeps({ settings: { webhook: 'https://hooks.slack.com/services/T000/B000/xyz' } })
    const worker = start(source, () => declaredGrant(source), kit.deps)
    await worker.started
    await settled()
    await worker.emit('item:completed', { item: itemOf({ title: 'Ship it' }) })
    expect(kit.fetched).toHaveLength(1)
    expect(kit.fetched[0]).toMatchObject({ method: 'POST', url: 'https://hooks.slack.com/services/T000/B000/xyz', body: '{"text":"Finished: Ship it"}' })
  })

  it('declare everything they use, so none of them would trip on its own grant', () => {
    expect(declaredGrant(defined(findExamplePlugin('finished-webhook.js')).source)).toMatchObject({ permissions: ['read', 'network'], hosts: ['hooks.slack.com'] })
  })
})

describe('the types file plugin authors get', () => {
  it('describes exactly the api the worker hands a plugin', async () => {
    const worker = start(`module.exports = { onLoad(api) {
      const walk = (o, at) => Object.entries(o).flatMap(([k, v]) => typeof v === 'function' ? [at + k] : walk(v, at + k + '.'))
      api.log(JSON.stringify(walk(api, '').sort()))
    } }`, () => grantOf([]), fakeDeps().deps)
    await worker.started
    const calls = JSON.parse(worker.logs[0].text) as string[]
    expect(calls).toStrictEqual(['events.on', 'fetch', 'items.create', 'items.get', 'items.query', 'items.update', 'log', 'notify', 'settings.get', 'storage.get', 'storage.set', 'workspaces'])
    const types = readFileSync('src/main/plugins/checkpoint-plugin.d.ts', 'utf8')
    for (const name of calls) {
      const parts = name.split('.')
      if (parts.length === 2) expect(types, name).toMatch(new RegExp(`\\b${parts[0]}: \\{[\\s\\S]*?\\b${parts[1]}[<(]`))
      else expect(types, name).toMatch(new RegExp(`\\b${parts[0]}\\(`))
    }
  })
})

describe('the host page', () => {
  it('shares its channel names with the sandboxed preload, which cannot import them', () => {
    const preload = readFileSync('src/preload/pluginHost.ts', 'utf8')
    expect(preload).toContain(`'${HOST_OUT}'`)
    expect(preload).toContain(`'${HOST_IN}'`)
  })

  it('allows no network, no eval and only its own script', () => {
    expect(HOST_POLICY).toContain("default-src 'none'")
    expect(HOST_POLICY).toContain("connect-src 'none'")
    expect(HOST_POLICY).not.toContain('unsafe')
  })

  it('carries a script whose hash the policy names, so the page runs and nothing else does', () => {
    const html = Buffer.from(HOST_PAGE_URL.replace('data:text/html;base64,', ''), 'base64').toString('utf8')
    const script = defined(/<script>([\s\S]*)<\/script>/.exec(html))[1]
    const hash = createHash('sha256').update(script).digest('base64')
    expect(html).toContain(`script-src 'sha256-${hash}'`)
  })
})
