import { describe, it, expect } from 'vitest'
import { EXAMPLE_PLUGINS, findExamplePlugin } from '../src/shared/examplePlugins'
import { parsePluginMetadata, isSafePluginFilename } from '../src/shared/pluginMetadata'

// they double as docs: metadata readable without running

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
    // gallery name and parsed metadata must agree
    for (const example of EXAMPLE_PLUGINS) {
      expect(parsePluginMetadata(example.source).name, example.filename).toBe(example.name)
    }
  })

  it('are found by filename', () => {
    expect(findExamplePlugin(EXAMPLE_PLUGINS[0].filename)?.name).toBe(EXAMPLE_PLUGINS[0].name)
    expect(findExamplePlugin('nope.js')).toBeNull()
  })

  it('say what they need, so turning one on shows you something true', () => {
    // running them with exactly that is pluginWorker.test.ts
    for (const example of EXAMPLE_PLUGINS) {
      expect(parsePluginMetadata(example.source).permissions, example.filename).not.toBeNull()
    }
  })
})
