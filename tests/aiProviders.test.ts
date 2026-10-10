import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDb, getSetting, initDb, setSetting } from '../src/main/db'
import { activateAiProvider, loadAiProviders, saveAiProviders, savedKeyFor, setAiProviderKey } from '../src/main/aiProviders'
import { originOf } from '../src/shared/aiProviders'
import type { AiProviderSet } from '../src/shared/aiProviders'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'checkpoint-ai-providers-'))
  initDb(dir)
})

afterEach(() => {
  closeDb()
  rmSync(dir, { recursive: true, force: true })
})

/** as the screen stored them before main kept them: a json string, keys inside */
const storeOld = (providers: object[], activeId: string): void => {
  setSetting('ai_providers', JSON.stringify(providers))
  setSetting('ai_active_provider', activeId)
}

const stored = (): Array<{ id: string; apiKey: string; baseURL: string }> => JSON.parse(getSetting<string>('ai_providers', '[]'))
const flat = () => ({ baseURL: getSetting('ai_base_url', ''), apiKey: getSetting('ai_api_key', ''), model: getSetting('ai_model', '') })
const inputOf = (set: AiProviderSet) => set.providers.map(({ id, name, baseURL, model }) => ({ id, name, baseURL, model }))

const openai = { id: 'a', name: 'OpenAI', baseURL: 'https://api.openai.com/v1', apiKey: 'sk-live-123', model: 'gpt-4o-mini' }
const local = { id: 'b', name: 'Ollama', baseURL: 'http://localhost:11434/v1', apiKey: 'ollama', model: 'llama3' }

describe('the AI connections the screen sees', () => {
  it('never include a key, only whether one is saved', () => {
    storeOld([openai, local], 'a')
    const set = loadAiProviders()
    expect(set).toStrictEqual({
      activeId: 'a',
      providers: [
        { id: 'a', name: 'OpenAI', baseURL: 'https://api.openai.com/v1', model: 'gpt-4o-mini', hasKey: true },
        { id: 'b', name: 'Ollama', baseURL: 'http://localhost:11434/v1', model: 'llama3', hasKey: false }
      ]
    })
    expect(JSON.stringify(set)).not.toContain('sk-live-123')
  })

  it('start from the old flat settings on first run, keeping the key in main', () => {
    setSetting('ai_base_url', 'https://api.groq.com/openai/v1')
    setSetting('ai_api_key', 'gsk-old')
    setSetting('ai_model', 'llama-3.3-70b-versatile')
    const set = loadAiProviders()
    expect(set.providers).toMatchObject([{ name: 'Default', baseURL: 'https://api.groq.com/openai/v1', hasKey: true }])
    expect(stored()[0].apiKey).toBe('gsk-old')
    expect(getSetting('ai_active_provider', '')).toBe(set.activeId)
  })

  it('fall back to the first one when the active one is gone, and generation follows', () => {
    storeOld([openai, local], 'gone')
    expect(loadAiProviders().activeId).toBe('a')
    expect(flat()).toStrictEqual({ baseURL: openai.baseURL, apiKey: 'sk-live-123', model: 'gpt-4o-mini' })
  })
})

describe('saving the connections', () => {
  it('keeps each key when the name, model or path changes', () => {
    storeOld([openai], 'a')
    const set = loadAiProviders()
    const [p] = inputOf(set)
    saveAiProviders({ providers: [{ ...p, name: 'Work', model: 'gpt-4o', baseURL: 'https://api.openai.com/v2' }], activeId: 'a' })
    expect(stored()[0].apiKey).toBe('sk-live-123')
    expect(flat()).toStrictEqual({ baseURL: 'https://api.openai.com/v2', apiKey: 'sk-live-123', model: 'gpt-4o' })
  })

  it('forgets a key whose address moves to another site, so it is never sent there', () => {
    storeOld([openai], 'a')
    const [p] = inputOf(loadAiProviders())
    const set = saveAiProviders({ providers: [{ ...p, baseURL: 'https://collector.example.com/v1' }], activeId: 'a' })
    expect(set.providers[0].hasKey).toBe(false)
    expect(stored()[0].apiKey).toBe('')
    expect(flat().apiKey).toBe('')
  })

  it('takes a removed connection key with it, and gives a new one none', () => {
    storeOld([openai, local], 'b')
    const set = saveAiProviders({ providers: [inputOf(loadAiProviders())[1], { id: 'c', name: 'Groq', baseURL: 'https://api.groq.com/openai/v1', model: '' }], activeId: 'c' })
    expect(set.providers.map(p => [p.id, p.hasKey])).toStrictEqual([['b', false], ['c', false]])
    expect(JSON.stringify(stored())).not.toContain('sk-live-123')
  })

  it('refuses what is not a list of connections', () => {
    expect(() => saveAiProviders({ providers: [], activeId: 'a' })).toThrow()
    expect(() => saveAiProviders({ providers: [{ id: 'a', apiKey: 'x' }], activeId: 'a' })).toThrow()
  })
})

describe('a key', () => {
  it('goes in and never comes back out, and the active one is what generation uses', () => {
    storeOld([openai, local], 'a')
    const set = setAiProviderKey('a', '  sk-new  ')
    expect(set.providers[0].hasKey).toBe(true)
    expect(JSON.stringify(set)).not.toContain('sk-new')
    expect(flat().apiKey).toBe('sk-new')
  })

  it('on another connection waits until that one is switched to', () => {
    storeOld([openai, local], 'a')
    activateAiProvider('a')
    setAiProviderKey('b', 'lm-key')
    expect(flat().apiKey).toBe('sk-live-123')
    activateAiProvider('b')
    expect(flat()).toStrictEqual({ baseURL: local.baseURL, apiKey: 'lm-key', model: 'llama3' })
  })

  it('is used to test a connection only on the site it was saved for', () => {
    storeOld([openai], 'a')
    expect(savedKeyFor('a', 'https://api.openai.com/v1/')).toBe('sk-live-123')
    expect(savedKeyFor('a', 'https://collector.example.com/v1')).toBe('')
    expect(savedKeyFor('nope', 'https://api.openai.com/v1')).toBe('')
    expect(savedKeyFor(undefined, 'https://api.openai.com/v1')).toBe('')
  })

  it('for a connection that is gone is refused', () => {
    storeOld([openai], 'a')
    expect(() => setAiProviderKey('gone', 'x')).toThrow('no longer exists')
  })
})

describe('the site a key belongs to', () => {
  it('is the scheme, host and port, whatever the path or case', () => {
    expect(originOf('https://API.openai.com/v1')).toBe(originOf('https://api.openai.com/other'))
    expect(originOf('https://api.openai.com')).not.toBe(originOf('http://api.openai.com'))
    expect(originOf('http://localhost:11434/v1')).not.toBe(originOf('http://localhost:1234/v1'))
  })
})
