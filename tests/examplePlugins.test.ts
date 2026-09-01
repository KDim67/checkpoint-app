import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EXAMPLE_PLUGINS, findExamplePlugin } from '../src/shared/examplePlugins'
import { parsePluginMetadata, isSafePluginFilename } from '../src/shared/pluginMetadata'

// The examples double as the API's documentation, so they are held to the same
// bar as the app: they must load, and their metadata must be readable without
// running them.

let home: string

vi.mock('electron', async () => {
  const actual = await vi.importActual<typeof import('./stubs/electron')>('./stubs/electron')
  return {
    ...actual,
    app: { ...actual.app, getPath: (n: string) => (n === 'home' ? home : `${home}/${n}`) }
  }
})

const pluginsDir = (): string => join(home, '.config', 'checkpoint', 'plugins')

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'checkpoint-examples-'))
  vi.resetModules()
})

afterEach(() => {
  rmSync(home, { recursive: true, force: true })
})

describe('the shipped examples', () => {
  it('ships more than one', () => {
    expect(EXAMPLE_PLUGINS.length).toBeGreaterThan(1)
  })

  it('have unique, safe filenames', () => {
    const names = EXAMPLE_PLUGINS.map(e => e.filename)
    expect(new Set(names).size).toBe(names.length)
    for (const name of names) expect(isSafePluginFilename(name), name).toBe(true)
  })

  it('carry metadata the listing can read without executing them', () => {
    for (const example of EXAMPLE_PLUGINS) {
      const metadata = parsePluginMetadata(example.source)
      expect(metadata.name, example.filename).toBeTruthy()
      expect(metadata.description, example.filename).toBeTruthy()
      expect(metadata.version, example.filename).toBeTruthy()
    }
  })

  it('describe themselves consistently with their own metadata', () => {
    // The gallery shows `name`; the plugin list shows the parsed metadata. If
    // they disagree, installing one appears to install something else.
    for (const example of EXAMPLE_PLUGINS) {
      expect(parsePluginMetadata(example.source).name, example.filename).toBe(example.name)
    }
  })

  it('are found by filename', () => {
    expect(findExamplePlugin(EXAMPLE_PLUGINS[0].filename)?.name).toBe(EXAMPLE_PLUGINS[0].name)
    expect(findExamplePlugin('nope.js')).toBeNull()
  })

  it('every one of them actually loads', async () => {
    // The real registry, the real require, the real API object. An example that
    // throws on load would be worse than shipping none.
    const { loadPlugin, unloadPlugin } = await import('../src/main/pluginRegistry')
    mkdirSync(pluginsDir(), { recursive: true })

    for (const example of EXAMPLE_PLUGINS) {
      writeFileSync(join(pluginsDir(), example.filename), example.source, 'utf8')
      const result = loadPlugin(example.filename)
      expect(result, example.filename).toMatchObject({ ok: true })
      unloadPlugin(example.filename)
    }
  })

  it('unload without leaving event subscriptions behind', async () => {
    const { loadPlugin, unloadPlugin } = await import('../src/main/pluginRegistry')
    const { pluginEventListenerCount } = await import('../src/main/pluginEvents')
    mkdirSync(pluginsDir(), { recursive: true })

    for (const example of EXAMPLE_PLUGINS) {
      writeFileSync(join(pluginsDir(), example.filename), example.source, 'utf8')
      loadPlugin(example.filename)
    }
    for (const example of EXAMPLE_PLUGINS) unloadPlugin(example.filename)

    // Enable/disable cycles would otherwise leak a listener each time.
    expect(pluginEventListenerCount('item:created')).toBe(0)
    expect(pluginEventListenerCount('item:completed')).toBe(0)
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
    // Emitted from inside a database write: a throwing plugin must not surface
    // as a failed card creation.
    const { onPluginEvent, emitPluginEvent, clearPluginEvents } = await import('../src/main/pluginEvents')
    clearPluginEvents()

    const seen: string[] = []
    onPluginEvent('item:created', () => { throw new Error('rude') })
    onPluginEvent('item:created', () => seen.push('still ran'))

    expect(() => emitPluginEvent('item:created', { item: { id: 'x' } as never })).not.toThrow()
    expect(seen).toEqual(['still ran'])
  })

  it('stops delivering after unsubscribe', async () => {
    const { onPluginEvent, clearPluginEvents, pluginEventListenerCount } =
      await import('../src/main/pluginEvents')
    clearPluginEvents()

    const off = onPluginEvent('item:completed', () => {})
    expect(pluginEventListenerCount('item:completed')).toBe(1)
    off()
    expect(pluginEventListenerCount('item:completed')).toBe(0)
  })
})
