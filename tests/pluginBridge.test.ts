import { describe, it, expect } from 'vitest'
import { LIMITS, STORAGE_TOTAL_BYTES, STORAGE_VALUE_BYTES } from '../src/main/plugins/bridge'
import type { PluginGrant } from '../src/shared/pluginPermissions'
import { call, contextOf, fakeDeps, grantOf, itemOf } from './helpers/plugins'

const setup = (grant: PluginGrant | null, items = [itemOf(), itemOf({ id: 'home-1', context: 'home' })]) => {
  const kit = fakeDeps({ items })
  let current = grant
  const ctx = contextOf(() => current)
  return { ...kit, ctx, regrant: (next: PluginGrant | null) => { current = next } }
}

describe('what a plugin is allowed to do', () => {
  it('refuses every call that needs a permission it was not given, and says how to give it', async () => {
    const { ctx, deps } = setup(grantOf([]))
    const refusals = await Promise.all([
      call(ctx, deps, 'items.get', 'card-1'),
      call(ctx, deps, 'items.create', { context: 'work', type: 'task', title: 'x' }),
      call(ctx, deps, 'notify', 'Hi', ''),
      call(ctx, deps, 'fetch', 'https://example.com/'),
      call(ctx, deps, 'events.subscribe', 'item:created')
    ])
    for (const r of refusals) expect(r.ok).toBe(false)
    expect(refusals[0]).toMatchObject({ error: expect.stringContaining('isn\'t allowed to see cards. Allow "See cards"') })
    expect(refusals[1]).toMatchObject({ error: expect.stringContaining('"Change cards"') })
  })

  it('treats a plugin that was on before the sandbox as having nothing', async () => {
    const { ctx, deps } = setup(grantOf(['read', 'write'], { legacy: true }))
    expect(await call(ctx, deps, 'items.get', 'card-1')).toMatchObject({ ok: false })
  })

  it('stops honouring a grant the moment it is turned off', async () => {
    const { ctx, deps, regrant } = setup(grantOf(['read']))
    expect(await call(ctx, deps, 'items.get', 'card-1')).toMatchObject({ ok: true, value: { id: 'card-1' } })
    regrant({ ...grantOf(['read']), on: false })
    expect(await call(ctx, deps, 'items.get', 'card-1')).toMatchObject({ ok: false })
  })

  it('answers an unknown call by name, including ones from the prototype', async () => {
    const { ctx, deps } = setup(grantOf(['read']))
    expect(await call(ctx, deps, 'toString')).toMatchObject({ ok: false, error: 'There is no api call named "toString".' })
    expect(await call(ctx, deps, 'app.quit')).toMatchObject({ ok: false })
  })
})

describe('the workspaces it can use', () => {
  it('lists only the ones you picked that still exist', async () => {
    const kit = fakeDeps({ workspaces: ['work', 'home'] })
    const ctx = contextOf(() => grantOf([], { workspaces: ['work', 'deleted'] }))
    expect(await call(ctx, kit.deps, 'workspaces')).toStrictEqual({ ok: true, value: ['work'] })
  })

  it('gets null for a card elsewhere, the same as for one that does not exist', async () => {
    const { ctx, deps } = setup(grantOf(['read']))
    expect(await call(ctx, deps, 'items.get', 'home-1')).toStrictEqual({ ok: true, value: null })
    expect(await call(ctx, deps, 'items.get', 'nope')).toStrictEqual({ ok: true, value: null })
  })

  it('cannot change a card elsewhere, and is told what it would be told if the card were missing', async () => {
    const { ctx, deps, items } = setup(grantOf(['read', 'write']))
    const elsewhere = await call(ctx, deps, 'items.update', 'home-1', { title: 'mine now' })
    const missing = await call(ctx, deps, 'items.update', 'nope', { title: 'mine now' })
    expect(elsewhere).toMatchObject({ ok: false })
    expect(elsewhere.ok === false && elsewhere.error.replace('home-1', 'X')).toBe(missing.ok === false && missing.error.replace('nope', 'X'))
    expect(items.get('home-1')?.title).toBe('A card')
  })

  it('cannot query, create in, or move a card into a workspace you did not pick', async () => {
    const { ctx, deps, items } = setup(grantOf(['read', 'write']))
    expect(await call(ctx, deps, 'items.query', { context: 'home', type: 'card' })).toMatchObject({ ok: false, error: expect.stringContaining('can\'t use the workspace "home"') })
    expect(await call(ctx, deps, 'items.create', { context: 'home', type: 'task', title: 'x' })).toMatchObject({ ok: false })
    expect(await call(ctx, deps, 'items.update', 'card-1', { context: 'home' })).toMatchObject({ ok: false })
    expect(items.get('card-1')?.context).toBe('work')
  })

  it('loses a workspace that was deleted, even though the grant still names it', async () => {
    const kit = fakeDeps({ workspaces: ['home'], items: [itemOf()] })
    const ctx = contextOf(() => grantOf(['read']))
    expect(await call(ctx, kit.deps, 'items.get', 'card-1')).toStrictEqual({ ok: true, value: null })
  })
})

describe('changing cards', () => {
  it('creates with the board\'s first column, metadata it can never set, and tells the window to reload', async () => {
    const { ctx, deps, items, changes } = setup(grantOf(['write']))
    const made = await call(ctx, deps, 'items.create', { context: 'work', type: 'card', title: 'New', status: 'nowhere' })
    expect(made).toMatchObject({ ok: true, value: { status: 'todo', metadata: '{}', priority: 0 } })
    expect(items.size).toBe(3)
    expect(changes()).toBe(1)
  })

  it('refuses fields that are not its to set, and a column the board does not have', async () => {
    const { ctx, deps } = setup(grantOf(['read', 'write']))
    expect(await call(ctx, deps, 'items.create', { context: 'work', type: 'task', title: 'x', metadata: '{"recurrenceId":"r"}' })).toMatchObject({ ok: false })
    expect(await call(ctx, deps, 'items.update', 'card-1', { id: 'other' })).toMatchObject({ ok: false })
    expect(await call(ctx, deps, 'items.update', 'card-1', { status: 'limbo' })).toMatchObject({ ok: false, error: expect.stringContaining('todo, doing, done') })
    expect(await call(ctx, deps, 'items.update', 'card-1', { status: 'done', priority: 3 })).toMatchObject({ ok: true, value: { status: 'done', priority: 3 } })
  })

  it('checks the shape of what it sends', async () => {
    const { ctx, deps } = setup(grantOf(['read', 'write']))
    expect(await call(ctx, deps, 'items.create', { context: 'work', type: 'note', title: 'x' })).toMatchObject({ ok: false, error: expect.stringContaining('api.items.create') })
    expect(await call(ctx, deps, 'items.update', 'card-1', { priority: 9 })).toMatchObject({ ok: false })
    expect(await call(ctx, deps, 'items.query', { context: 'work', type: 'card', limit: 5000 })).toMatchObject({ ok: false })
  })
})

describe('limits', () => {
  it('allows 60 changes a minute and refuses the 61st, then recovers', async () => {
    const { ctx, deps, advance } = setup(grantOf(['write']))
    for (let i = 0; i < LIMITS.writes.max; i++) {
      expect((await call(ctx, deps, 'items.create', { context: 'work', type: 'task', title: `t${i}` })).ok).toBe(true)
    }
    expect(await call(ctx, deps, 'items.create', { context: 'work', type: 'task', title: 'one more' })).toMatchObject({ ok: false, error: expect.stringContaining('60 changes a minute') })
    advance(LIMITS.writes.windowMs)
    expect((await call(ctx, deps, 'items.create', { context: 'work', type: 'task', title: 'later' })).ok).toBe(true)
  })

  it('allows 10 notifications an hour', async () => {
    const { ctx, deps, notified } = setup(grantOf(['notify']))
    for (let i = 0; i < 11; i++) await call(ctx, deps, 'notify', `n${i}`, '')
    expect(notified).toHaveLength(10)
    expect(notified[0].key).toBe('plugin:test.js:n0')
  })

  it('caps calls of any kind, so a busy loop of reads can\'t hold the app', async () => {
    const { ctx, deps } = setup(grantOf(['read']))
    let refused = 0
    for (let i = 0; i <= LIMITS.calls.max; i++) if (!(await call(ctx, deps, 'items.get', 'card-1')).ok) refused++
    expect(refused).toBe(1)
  })
})

describe('the network', () => {
  const net = (hosts = ['hooks.example.com']) => setup(grantOf(['network'], { hosts }))

  it('reaches only a listed host, over https', async () => {
    const { ctx, deps, fetched } = net()
    expect(await call(ctx, deps, 'fetch', 'https://hooks.example.com/x', { method: 'POST', body: '{}' })).toMatchObject({ ok: true, value: { status: 200 } })
    expect(await call(ctx, deps, 'fetch', 'http://hooks.example.com/x')).toMatchObject({ ok: false, error: expect.stringContaining('https') })
    expect(await call(ctx, deps, 'fetch', 'https://evil.example.net/x')).toMatchObject({ ok: false, error: expect.stringContaining('Add "evil.example.net"') })
    expect(await call(ctx, deps, 'fetch', 'https://127.0.0.1/')).toMatchObject({ ok: false })
    expect(fetched).toHaveLength(1)
    expect(fetched[0].hosts).toStrictEqual(['hooks.example.com'])
  })

  it('strips headers that speak for the connection and refuses an oversized or misplaced body', async () => {
    const { ctx, deps, fetched } = net()
    await call(ctx, deps, 'fetch', 'https://hooks.example.com/', { headers: { Host: 'internal', 'X-Token': 'a', 'Content-Length': '1' } })
    expect(fetched[0].headers).toStrictEqual({ 'X-Token': 'a' })
    expect(await call(ctx, deps, 'fetch', 'https://hooks.example.com/', { body: 'x' })).toMatchObject({ ok: false, error: expect.stringContaining('GET request can\'t carry a body') })
    expect(await call(ctx, deps, 'fetch', 'https://hooks.example.com/', { method: 'POST', body: 'x'.repeat(70_000) })).toMatchObject({ ok: false })
  })

  it('allows 30 requests a minute', async () => {
    const { ctx, deps, fetched } = net()
    for (let i = 0; i < 31; i++) await call(ctx, deps, 'fetch', 'https://hooks.example.com/')
    expect(fetched).toHaveLength(30)
  })
})

describe('storage', () => {
  it('keeps JSON, forgets a key set to null, and needs no permission', async () => {
    const { ctx, deps } = setup(grantOf([]))
    expect(await call(ctx, deps, 'storage.get', 'k')).toStrictEqual({ ok: true, value: { found: false } })
    await call(ctx, deps, 'storage.set', 'k', { a: [1, 2] })
    expect(await call(ctx, deps, 'storage.get', 'k')).toStrictEqual({ ok: true, value: { found: true, value: { a: [1, 2] } } })
    await call(ctx, deps, 'storage.set', 'k', null)
    expect(await call(ctx, deps, 'storage.get', 'k')).toStrictEqual({ ok: true, value: { found: false } })
  })

  it('caps one value at 64 KB and the whole at 1 MB, counting a replaced value once', async () => {
    const { ctx, deps } = setup(grantOf([]))
    expect(await call(ctx, deps, 'storage.set', 'big', 'x'.repeat(STORAGE_VALUE_BYTES))).toMatchObject({ ok: false })
    const chunk = 'x'.repeat(STORAGE_VALUE_BYTES - 100)
    const fits = Math.floor(STORAGE_TOTAL_BYTES / (STORAGE_VALUE_BYTES - 98))
    for (let i = 0; i < fits; i++) expect((await call(ctx, deps, 'storage.set', `k${i}`, chunk)).ok).toBe(true)
    expect(await call(ctx, deps, 'storage.set', 'one-more', chunk)).toMatchObject({ ok: false, error: expect.stringContaining('1 MB of storage') })
    expect((await call(ctx, deps, 'storage.set', 'k0', chunk)).ok).toBe(true)
  })
})

describe('events', () => {
  it('subscribes only to events that exist, and only with read', async () => {
    const { ctx, deps } = setup(grantOf(['read']))
    expect(await call(ctx, deps, 'events.subscribe', 'item:completed')).toStrictEqual({ ok: true, value: true })
    expect(await call(ctx, deps, 'events.subscribe', 'app:quit')).toMatchObject({ ok: false })
    expect([...ctx.subscriptions]).toStrictEqual(['item:completed'])
  })
})
