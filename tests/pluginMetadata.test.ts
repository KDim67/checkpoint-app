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
      version: '1.0.0',
      permissions: null,
      hosts: null,
      settings: null
    })
  })

  it('accepts single quotes and quoted keys', () => {
    const source = plugin(`{ 'name': 'Single', "version": '2.0' }`)
    expect(parsePluginMetadata(source)).toMatchObject({ name: 'Single', version: '2.0' })
  })

  it('returns nulls when there is no metadata block', () => {
    expect(parsePluginMetadata('module.exports = { onLoad() {} }')).toEqual({
      name: null, description: null, version: null, permissions: null, hosts: null, settings: null
    })
  })

  it('returns nulls for empty or unusable input', () => {
    expect(parsePluginMetadata('').name).toBeNull()
    expect(parsePluginMetadata('this is not javascript {{{').name).toBeNull()
  })

  it('finds the closing brace past a nested object', () => {
    // the first } would stop inside extra
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

  it('reads the permissions and hosts lists', () => {
    const source = plugin(`{
      name: "Asker",
      permissions: ["read", 'notify'],
      hosts: [ "hooks.slack.com" ]
    }`)
    expect(parsePluginMetadata(source)).toMatchObject({ permissions: ['read', 'notify'], hosts: ['hooks.slack.com'] })
  })

  it('takes only string literals from a list, never anything that would have to run', () => {
    const source = plugin(`{ permissions: ["read", someVariable, getMore(), 'write'] }`)
    expect(parsePluginMetadata(source).permissions).toStrictEqual(['read', 'write'])
  })

  it('is not cut short by a brace or bracket inside a string or a comment', () => {
    const source = plugin(`{
      description: "uses } and ] freely",
      // a comment with } in it
      /* and ] here */
      permissions: ["read"],
      version: "1.2.3"
    }`)
    expect(parsePluginMetadata(source)).toMatchObject({ description: 'uses } and ] freely', permissions: ['read'], version: '1.2.3' })
  })

  it('never takes a value that only reads like a key, or a key from a nested object', () => {
    const source = plugin(`{
      description: "name: Impostor",
      extra: { permissions: ["network"], name: "Nested" },
      name: "Real"
    }`)
    expect(parsePluginMetadata(source)).toMatchObject({ name: 'Real', permissions: null })
  })

  it('reads settings fields as literals, leaving anything that would have to run', () => {
    const source = plugin(`{
      settings: [
        { key: "webhook", label: "Webhook, with a } in it", type: "secret" },
        { key: 'count', type: 'number', default: 3 },
        { key: "on", type: "boolean", default: false, description: compute() },
        notAnObject
      ]
    }`)
    expect(parsePluginMetadata(source).settings).toStrictEqual([
      { key: 'webhook', label: 'Webhook, with a } in it', type: 'secret' },
      { key: 'count', type: 'number', default: 3 },
      { key: 'on', type: 'boolean', default: false }
    ])
  })

  it('does not execute what it reads', () => {
    // listing reads source text, so a hostile file can't run
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
    // arrives over IPC
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
