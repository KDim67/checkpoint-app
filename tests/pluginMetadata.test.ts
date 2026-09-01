import { describe, it, expect } from 'vitest'
import { isSafePluginFilename, parsePluginMetadata } from '../src/shared/pluginMetadata'

describe('parsePluginMetadata', () => {
  const plugin = (body: string) => `module.exports = { metadata: ${body}, onLoad() {} }`

  it('reads the shape the shipped template uses', () => {
    const source = plugin(`{
      name: "Console Greeter",
      description: "Logs a welcoming message on startup.",
      version: "1.0.0"
    }`)
    expect(parsePluginMetadata(source)).toEqual({
      name: 'Console Greeter',
      description: 'Logs a welcoming message on startup.',
      version: '1.0.0'
    })
  })

  it('accepts single quotes and quoted keys', () => {
    const source = plugin(`{ 'name': 'Single', "version": '2.0' }`)
    expect(parsePluginMetadata(source)).toMatchObject({ name: 'Single', version: '2.0' })
  })

  it('returns nulls when there is no metadata block', () => {
    expect(parsePluginMetadata('module.exports = { onLoad() {} }')).toEqual({
      name: null, description: null, version: null
    })
  })

  it('returns nulls for empty or unusable input', () => {
    expect(parsePluginMetadata('').name).toBeNull()
    expect(parsePluginMetadata('this is not javascript {{{').name).toBeNull()
  })

  it('finds the closing brace past a nested object', () => {
    // Scanning for the first '}' would stop inside `extra` and lose version.
    const source = plugin(`{
      name: "Nested",
      extra: { deep: { deeper: 1 } },
      version: "3.1.4"
    }`)
    expect(parsePluginMetadata(source)).toMatchObject({ name: 'Nested', version: '3.1.4' })
  })

  it('is not confused by an unterminated block', () => {
    expect(parsePluginMetadata('module.exports = { metadata: { name: "x"').name).toBeNull()
  })

  it('handles an escaped quote inside a value', () => {
    const source = plugin(`{ description: "it's a \\"quoted\\" thing" }`)
    expect(parsePluginMetadata(source).description).toBe('it\'s a "quoted" thing')
  })

  it('treats a whitespace-only value as absent', () => {
    expect(parsePluginMetadata(plugin(`{ name: "   " }`)).name).toBeNull()
  })

  it('ignores a name outside the metadata block', () => {
    const source = `const name = "decoy"\n${plugin(`{ version: "1.0" }`)}`
    expect(parsePluginMetadata(source).name).toBeNull()
  })

  it('does not execute what it reads', () => {
    // The whole point: this runs over source text, so a listing cannot have
    // side effects however hostile the file is.
    const hostile = `globalThis.__pwned = true; ${plugin('{ name: "Hostile" }')}`
    expect(parsePluginMetadata(hostile).name).toBe('Hostile')
    expect((globalThis as { __pwned?: boolean }).__pwned).toBeUndefined()
  })
})

describe('isSafePluginFilename', () => {
  it('accepts an ordinary plugin filename', () => {
    for (const name of ['hello.js', 'my-plugin.js', 'my_plugin.2.js', 'A1.js']) {
      expect(isSafePluginFilename(name), name).toBe(true)
    }
  })

  it('rejects traversal', () => {
    // This value arrives over IPC from the renderer.
    for (const name of ['../evil.js', '../../etc/passwd.js', 'a/../../b.js', '..js.js/../x.js']) {
      expect(isSafePluginFilename(name), name).toBe(false)
    }
  })

  it('rejects path separators and absolute paths', () => {
    for (const name of ['sub/plugin.js', 'sub\\plugin.js', '/etc/x.js', 'C:\\x.js']) {
      expect(isSafePluginFilename(name), name).toBe(false)
    }
  })

  it('rejects anything that is not javascript', () => {
    for (const name of ['plugin.txt', 'plugin', 'plugin.js.txt', '.hidden.js']) {
      expect(isSafePluginFilename(name), name).toBe(false)
    }
  })

  it('rejects empty and absurd names', () => {
    expect(isSafePluginFilename('')).toBe(false)
    expect(isSafePluginFilename('x'.repeat(200) + '.js')).toBe(false)
  })
})
