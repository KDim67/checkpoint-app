/** the ai connections and their keys; the screen gets names, addresses and models, never a key */

import { z } from 'zod'
import { getSetting, setSetting } from './db'
import { isLocalUrl, originOf, type AiProviderSet, type AiProviderView } from '../shared/aiProviders'

const PROVIDERS_KEY = 'ai_providers'
const ACTIVE_KEY = 'ai_active_provider'
const DEFAULT_BASE_URL = 'http://localhost:11434/v1'
// what a local server is sent in place of a key
const LOCAL_KEY = 'ollama'

interface Stored {
  id: string
  name: string
  baseURL: string
  apiKey: string
  model: string
}

const Id = z.string().min(1).max(100)
const SaveInput = z.object({
  providers: z.array(z.object({
    id: Id,
    name: z.string().max(200),
    baseURL: z.string().max(2000),
    model: z.string().max(500)
  })).min(1).max(50),
  activeId: z.string().max(100)
})

const text = (value: unknown): string => (typeof value === 'string' ? value : '')

/** a json string inside the setting, as the screen stored it, so an older version still reads it */
function readStored(): Stored[] {
  let parsed = getSetting<unknown>(PROVIDERS_KEY, null)
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed)
    } catch {
      return []
    }
  }
  if (!Array.isArray(parsed)) return []
  return (parsed as unknown[])
    .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object')
    .filter(p => typeof p.id === 'string' && p.id !== '' && typeof p.baseURL === 'string')
    .map(p => ({ id: text(p.id), name: text(p.name), baseURL: text(p.baseURL), apiKey: text(p.apiKey), model: text(p.model) }))
}

function writeStored(list: Stored[]): void {
  setSetting(PROVIDERS_KEY, JSON.stringify(list))
}

const view = (p: Stored): AiProviderView => {
  const key = p.apiKey.trim()
  return { id: p.id, name: p.name, baseURL: p.baseURL, model: p.model, hasKey: key !== '' && key !== LOCAL_KEY }
}

/** generation reads one flat config; the active connection is copied into it */
function mirror(p: Stored): void {
  setSetting('ai_base_url', p.baseURL.trim())
  setSetting('ai_api_key', p.apiKey.trim())
  setSetting('ai_model', p.model.trim())
}

function activeIdOf(list: Stored[]): string {
  const id = text(getSetting<unknown>(ACTIVE_KEY, ''))
  return list.some(p => p.id === id) ? id : list[0].id
}

const setOf = (list: Stored[], activeId: string): AiProviderSet => ({ providers: list.map(view), activeId })

const newId = (): string => `prov_${Date.now()}_${Math.floor(Math.random() * 1e4)}`

/** the flat settings from before connections had names become the first one */
export function loadAiProviders(): AiProviderSet {
  let list = readStored()
  let changed = false
  // early builds doubled a "(local)" or "(cloud)" suffix
  list = list.map(p => {
    const name = p.name.replace(/\s*\((?:local|cloud)\)\s*$/i, '').trim() || 'Provider'
    if (name !== p.name) changed = true
    return { ...p, name }
  })
  if (list.length === 0) {
    const baseURL = text(getSetting<unknown>('ai_base_url', '')) || DEFAULT_BASE_URL
    list = [{
      id: newId(),
      name: isLocalUrl(baseURL) ? 'Ollama' : 'Default',
      baseURL,
      apiKey: text(getSetting<unknown>('ai_api_key', '')) || LOCAL_KEY,
      model: text(getSetting<unknown>('ai_model', ''))
    }]
    changed = true
  }
  if (changed) writeStored(list)
  const stored = text(getSetting<unknown>(ACTIVE_KEY, ''))
  const activeId = activeIdOf(list)
  if (activeId !== stored) {
    setSetting(ACTIVE_KEY, activeId)
    mirror(list.find(p => p.id === activeId) ?? list[0])
  }
  return setOf(list, activeId)
}

/** names, addresses and models as the screen has them; each keeps its key unless its address moved to another site */
export function saveAiProviders(input: unknown): AiProviderSet {
  const { providers, activeId } = SaveInput.parse(input)
  const before = new Map(readStored().map(p => [p.id, p]))
  const seen = new Set<string>()
  const list: Stored[] = []
  for (const p of providers) {
    if (seen.has(p.id)) continue
    seen.add(p.id)
    const old = before.get(p.id)
    // otherwise pointing a connection somewhere else would be all it takes to have its key sent there
    const apiKey = old && originOf(old.baseURL) === originOf(p.baseURL) ? old.apiKey : ''
    list.push({ id: p.id, name: p.name, baseURL: p.baseURL, apiKey, model: p.model })
  }
  writeStored(list)
  const active = list.find(p => p.id === activeId) ?? list[0]
  setSetting(ACTIVE_KEY, active.id)
  mirror(active)
  return setOf(list, active.id)
}

/** an empty key clears it */
export function setAiProviderKey(id: unknown, key: unknown): AiProviderSet {
  const providerId = Id.parse(id)
  const apiKey = z.string().max(4096).parse(key).trim()
  const list = readStored()
  const target = list.find(p => p.id === providerId)
  if (!target) throw new Error('That AI connection no longer exists. Reopen Settings and try again.')
  target.apiKey = apiKey
  writeStored(list)
  const activeId = activeIdOf(list)
  if (activeId === providerId) mirror(target)
  return setOf(list, activeId)
}

export function activateAiProvider(id: unknown): AiProviderSet {
  const providerId = Id.parse(id)
  const list = readStored()
  const target = list.find(p => p.id === providerId)
  if (!target) throw new Error('That AI connection no longer exists. Reopen Settings and try again.')
  setSetting(ACTIVE_KEY, providerId)
  mirror(target)
  return setOf(list, providerId)
}

/** the saved key, and only for the site it was saved for; anything else gets none */
export function savedKeyFor(id: unknown, baseURL: string): string {
  if (typeof id !== 'string') return ''
  const target = readStored().find(p => p.id === id)
  return target && originOf(target.baseURL) === originOf(baseURL) ? target.apiKey.trim() : ''
}
