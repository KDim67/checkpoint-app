import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { approvePlugin, disablePlugin, scanPlugins, runningPluginCount, startApprovedPlugins, stopAllPlugins } from '../src/main/pluginRegistry'
import { POLICY_SETTING_KEY, resetNotificationDedupe } from '../src/main/notificationService'
import { DEFAULT_POLICY } from '../src/shared/notificationPolicy'
import { shown } from './stubs/electron'
import { closeDb, getSetting, initDb, setSetting } from '../src/main/db'
import { PLUGIN_GRANTS_KEY } from '../src/shared/pluginPermissions'
import { defined } from './helpers/defined'

// the stub points home at a throwaway dir; metadata, approvals and statuses are real, the sandbox never starts

let home: string

vi.mock('electron', async () => {
  const actual = await vi.importActual<typeof import('./stubs/electron')>('./stubs/electron')
  return {
    ...actual,
    app: {
      ...actual.app,
      getPath: (name: string) => (name === 'home' ? home : `${home}/${name}`)
    }
  }
})

const pluginsDir = (): string => join(home, '.config', 'checkpoint', 'plugins')

const writePlugin = (filename: string, source: string): void => {
  mkdirSync(pluginsDir(), { recursive: true })
  writeFileSync(join(pluginsDir(), filename), source, 'utf8')
}

/** records whether it ever ran */
const asker = (permissions: string[], hosts: string[] = []) => `
globalThis.__pluginRan = true
module.exports = {
  metadata: { name: 'Asker', description: 'test', version: '2.0.0', permissions: ${JSON.stringify(permissions)}, hosts: ${JSON.stringify(hosts)} },
  onLoad(api) {}
}
`

const ran = (): boolean => (globalThis as { __pluginRan?: boolean }).__pluginRan === true
const one = (filename = 'one.js') => defined(scanPlugins().find(p => p.filename === filename))

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'checkpoint-plugins-'))
  initDb(home)
  setSetting('contexts_list', JSON.stringify([{ slug: 'work', name: 'Work', color: '#535e85' }, { slug: 'home', name: 'Home', color: '#535e85' }]))
  ;(globalThis as { __pluginRan?: boolean }).__pluginRan = false
})

afterEach(() => {
  closeDb()
  rmSync(home, { recursive: true, force: true })
})

describe('listing plugins', () => {
  it('reads what a plugin asks for without running it', () => {
    writePlugin('one.js', asker(['read', 'notify'], ['hooks.example.com']))
    expect(one()).toMatchObject({
      name: 'Asker',
      version: '2.0.0',
      active: false,
      status: 'off',
      grant: null,
      request: { permissions: ['read', 'notify', 'network'], hosts: ['hooks.example.com'], ignored: [] }
    })
    expect(ran()).toBe(false)
  })

  it('still lists a file it cannot make sense of, by filename', () => {
    writePlugin('broken.js', 'this is not javascript {{{')
    expect(one('broken.js')).toMatchObject({ name: 'broken.js', request: { permissions: [] } })
  })

  it('says why a file with an unusable name can never run', () => {
    writePlugin('my plugin.js', asker([]))
    expect(one('my plugin.js')).toMatchObject({ status: 'stopped', statusDetail: expect.stringContaining('not a plain .js filename') })
  })

  it('ignores files that are not javascript, and returns nothing for an empty folder', () => {
    expect(scanPlugins()).toStrictEqual([])
    writePlugin('notes.txt', 'hello')
    expect(scanPlugins()).toStrictEqual([])
  })
})

describe('plugins that were on before the sandbox', () => {
  it('wait for your approval, with nothing granted on their behalf', () => {
    writePlugin('one.js', asker(['read']))
    setSetting('customizer_active_plugins', JSON.stringify(['one.js', '../escape.js']))
    expect(one()).toMatchObject({ active: true, status: 'needs-approval', grant: null })
    expect(Object.keys(getSetting<Record<string, unknown>>(PLUGIN_GRANTS_KEY, {}))).toStrictEqual(['one.js'])
  })

  it('are carried over once, so the old list never turns one back on later', async () => {
    writePlugin('one.js', asker([]))
    setSetting('customizer_active_plugins', JSON.stringify(['one.js']))
    scanPlugins()
    await disablePlugin('one.js')
    // an older version on another machine could still write the old list
    setSetting('customizer_active_plugins', JSON.stringify(['one.js']))
    expect(one()).toMatchObject({ active: false, status: 'off' })
  })
})

describe('the notice that plugins are paused', () => {
  beforeEach(() => {
    shown.length = 0
    setSetting(POLICY_SETTING_KEY, { ...DEFAULT_POLICY, quietEnabled: false })
    resetNotificationDedupe()
  })

  afterEach(async () => {
    await stopAllPlugins()
  })

  it('comes once, on the first start after the update, for the plugins that were on', async () => {
    writePlugin('one.js', asker([]))
    writePlugin('two.js', asker([]))
    setSetting('customizer_active_plugins', JSON.stringify(['one.js', 'two.js']))
    startApprovedPlugins()
    await stopAllPlugins()
    startApprovedPlugins()
    expect(shown).toStrictEqual([{ title: '2 plugins are paused', body: expect.stringContaining('needs your OK') }])
    expect(runningPluginCount()).toBe(0)
  })

  it('stays quiet when nothing was on', () => {
    startApprovedPlugins()
    expect(shown).toStrictEqual([])
  })
})

describe('approving a plugin', () => {
  it('grants exactly what it asks for, in the workspaces you picked that exist', async () => {
    writePlugin('one.js', asker(['read', 'write']))
    const result = await approvePlugin('one.js', { permissions: ['read', 'write'], hosts: [], workspaces: ['work', 'gone', 'work'] })
    expect(result).toStrictEqual({ ok: true })
    expect(one()).toMatchObject({ active: true, grant: { permissions: ['read', 'write'], hosts: [], workspaces: ['work'] } })
  })

  it('refuses when the file changed after you were shown it', async () => {
    writePlugin('one.js', asker(['read', 'write']))
    const result = await approvePlugin('one.js', { permissions: ['read'], hosts: [], workspaces: ['work'] })
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('changed while you were looking') })
    expect(one().grant).toBeNull()
  })

  it('refuses a name that escapes the plugins folder, or a file that is not there', async () => {
    expect(await approvePlugin('../../evil.js', { permissions: [], hosts: [], workspaces: [] })).toMatchObject({ ok: false })
    expect(await approvePlugin('nope.js', { permissions: [], hosts: [], workspaces: [] })).toMatchObject({ ok: false })
  })

  it('waits for the Customization Engine before anything runs', async () => {
    writePlugin('one.js', asker([]))
    await approvePlugin('one.js', { permissions: [], hosts: [], workspaces: [] })
    expect(runningPluginCount()).toBe(0)
    expect(one()).toMatchObject({ status: 'stopped', statusDetail: expect.stringContaining('Customization Engine') })
  })

  it('needs you again when the file later asks for more, and not when it asks for less', async () => {
    writePlugin('one.js', asker(['read', 'notify']))
    await approvePlugin('one.js', { permissions: ['read', 'notify'], hosts: [], workspaces: ['work'] })
    writePlugin('one.js', asker(['read']))
    expect(one().status).not.toBe('needs-approval')
    writePlugin('one.js', asker(['read'], ['hooks.example.com']))
    expect(one()).toMatchObject({ status: 'needs-approval', statusDetail: expect.stringContaining('more than you approved') })
  })
})

describe('turning a plugin off', () => {
  it('keeps what you picked, so turning it back on starts from there', async () => {
    writePlugin('one.js', asker(['read']))
    await approvePlugin('one.js', { permissions: ['read'], hosts: [], workspaces: ['home'] })
    await disablePlugin('one.js')
    expect(one()).toMatchObject({ active: false, status: 'off', grant: { workspaces: ['home'] } })
  })
})

describe('pluginEvents', () => {
  it('delivers to every subscriber', async () => {
    const { onPluginEvent, emitPluginEvent, clearPluginEvents } = await import('../src/main/pluginEvents')
    clearPluginEvents()

    const seen: string[] = []
    onPluginEvent('item:created', () => seen.push('a'))
    onPluginEvent('item:created', () => seen.push('b'))
    emitPluginEvent('item:created', { item: { id: 'x' } as never })

    expect(seen).toEqual(['a', 'b'])
  })

  it('keeps going when one handler throws', async () => {
    // fired inside a db write, a throwing listener mustn't fail card creation
    const { onPluginEvent, emitPluginEvent, clearPluginEvents } = await import('../src/main/pluginEvents')
    clearPluginEvents()

    const seen: string[] = []
    onPluginEvent('item:created', () => { throw new Error('rude') })
    onPluginEvent('item:created', () => seen.push('still ran'))

    expect(() => emitPluginEvent('item:created', { item: { id: 'x' } as never })).not.toThrow()
    expect(seen).toEqual(['still ran'])
  })

  it('stops delivering after unsubscribe', async () => {
    const { onPluginEvent, clearPluginEvents, pluginEventListenerCount } = await import('../src/main/pluginEvents')
    clearPluginEvents()

    const off = onPluginEvent('item:completed', () => {})
    expect(pluginEventListenerCount('item:completed')).toBe(1)
    off()
    expect(pluginEventListenerCount('item:completed')).toBe(0)
  })
})
