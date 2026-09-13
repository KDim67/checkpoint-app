import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// the stub points home at a throwaway dir; require, metadata, load and unload are all real

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

/** records what ran */
const recordingPlugin = (marker: string) => `
globalThis.__pluginMarks = globalThis.__pluginMarks || []
globalThis.__pluginMarks.push('${marker}:toplevel')
module.exports = {
  metadata: { name: '${marker}', description: 'test', version: '2.0.0' },
  onLoad(api) { globalThis.__pluginMarks.push('${marker}:onLoad'); api.log('hi') },
  onUnload() { globalThis.__pluginMarks.push('${marker}:onUnload') }
}
`

const marks = (): string[] => (globalThis as { __pluginMarks?: string[] }).__pluginMarks ?? []

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'checkpoint-plugins-'))
  ;(globalThis as { __pluginMarks?: string[] }).__pluginMarks = []
  vi.resetModules()
})

afterEach(() => {
  rmSync(home, { recursive: true, force: true })
})

describe('scanPlugins', () => {
  it('finds a plugin and reads its metadata', async () => {
    writePlugin('one.js', recordingPlugin('one'))
    const { scanPlugins } = await import('../src/main/pluginRegistry')

    const found = scanPlugins([])
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ filename: 'one.js', name: 'one', version: '2.0.0', active: false })
  })

  it('marks the plugins listed as active', async () => {
    writePlugin('one.js', recordingPlugin('one'))
    const { scanPlugins } = await import('../src/main/pluginRegistry')
    expect(scanPlugins(['one.js'])[0].active).toBe(true)
  })

  it('still lists a file it cannot make sense of, by filename', async () => {
    // not executing means syntax errors surface at load instead
    writePlugin('broken.js', 'this is not javascript {{{')
    const { scanPlugins } = await import('../src/main/pluginRegistry')

    const found = scanPlugins([])
    expect(found).toHaveLength(1)
    expect(found[0].filename).toBe('broken.js')
    expect(found[0].name).toBe('broken.js')
  })

  it('ignores files that are not javascript', async () => {
    writePlugin('notes.txt', 'hello')
    writePlugin('one.js', recordingPlugin('one'))
    const { scanPlugins } = await import('../src/main/pluginRegistry')
    expect(scanPlugins([])).toHaveLength(1)
  })

  it('returns nothing when the directory is empty', async () => {
    const { scanPlugins } = await import('../src/main/pluginRegistry')
    expect(scanPlugins([])).toEqual([])
  })

  it('does NOT execute a disabled plugin merely to list it', async () => {
    // listing is a read, disabled plugins mustn't run
    writePlugin('one.js', recordingPlugin('one'))
    const { scanPlugins } = await import('../src/main/pluginRegistry')

    scanPlugins([])
    expect(marks()).not.toContain('one:toplevel')
  })
})

describe('loadPlugin', () => {
  it('runs onLoad and reports success', async () => {
    writePlugin('one.js', recordingPlugin('one'))
    const { loadPlugin } = await import('../src/main/pluginRegistry')

    expect(loadPlugin('one.js')).toMatchObject({ ok: true })
    expect(marks()).toContain('one:onLoad')
  })

  it('reports why a broken plugin failed instead of failing silently', async () => {
    writePlugin('broken.js', 'module.exports = { onLoad() { throw new Error("boom") } }')
    const { loadPlugin } = await import('../src/main/pluginRegistry')

    const result = loadPlugin('broken.js')
    expect(result.ok).toBe(false)
    expect('error' in result && result.error).toContain('boom')
  })

  it('reports a missing file rather than doing nothing', async () => {
    const { loadPlugin } = await import('../src/main/pluginRegistry')
    const result = loadPlugin('nope.js')
    expect(result.ok).toBe(false)
  })

  it('refuses a filename that escapes the plugins directory', async () => {
    // the name arrives over IPC, untrusted
    const { loadPlugin } = await import('../src/main/pluginRegistry')
    const result = loadPlugin('../../../evil.js')
    expect(result.ok).toBe(false)
  })

  it('does not load the same plugin twice', async () => {
    writePlugin('one.js', recordingPlugin('one'))
    const { loadPlugin } = await import('../src/main/pluginRegistry')

    loadPlugin('one.js')
    loadPlugin('one.js')
    expect(marks().filter(m => m === 'one:onLoad')).toHaveLength(1)
  })
})

describe('unloadPlugin', () => {
  it('calls onUnload', async () => {
    writePlugin('one.js', recordingPlugin('one'))
    const { loadPlugin, unloadPlugin } = await import('../src/main/pluginRegistry')

    loadPlugin('one.js')
    unloadPlugin('one.js')
    expect(marks()).toContain('one:onUnload')
  })

  it('survives a plugin that throws on the way out', async () => {
    writePlugin('rude.js', 'module.exports = { onUnload() { throw new Error("no") } }')
    const { loadPlugin, unloadPlugin } = await import('../src/main/pluginRegistry')

    loadPlugin('rude.js')
    expect(() => unloadPlugin('rude.js')).not.toThrow()
  })

  it('lets a plugin be loaded again after unloading', async () => {
    writePlugin('one.js', recordingPlugin('one'))
    const { loadPlugin, unloadPlugin } = await import('../src/main/pluginRegistry')

    loadPlugin('one.js')
    unloadPlugin('one.js')
    loadPlugin('one.js')
    expect(marks().filter(m => m === 'one:onLoad')).toHaveLength(2)
  })

  it('picks up edits to a plugin file between loads', async () => {
    // the cache is purged on unload, or re-enabling runs old code
    writePlugin('one.js', recordingPlugin('first'))
    const { loadPlugin, unloadPlugin } = await import('../src/main/pluginRegistry')

    loadPlugin('one.js')
    unloadPlugin('one.js')
    writePlugin('one.js', recordingPlugin('second'))
    loadPlugin('one.js')

    expect(marks()).toContain('second:onLoad')
  })

  it('does nothing for a plugin that was never loaded', async () => {
    const { unloadPlugin } = await import('../src/main/pluginRegistry')
    expect(() => unloadPlugin('ghost.js')).not.toThrow()
  })
})
