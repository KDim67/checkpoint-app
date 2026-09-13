import { getSetting as getSettingRow, setSetting as setSettingRow } from '../../data/settings'

// main reads one flat config; profiles live here and the active one is mirrored into it

export interface AiProvider {
  id: string
  name: string
  baseURL: string
  apiKey: string
  model: string
}

export interface ProviderPreset {
  id: string
  name: string
  baseURL: string
  apiKeyPlaceholder: string
  defaultModel: string
  hint: string
  local?: boolean
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'ollama', name: 'Ollama',
    baseURL: 'http://localhost:11434/v1', apiKeyPlaceholder: 'ollama',
    defaultModel: '', hint: 'Runs models locally. The model list auto-fills from your installed models.',
    local: true
  },
  {
    id: 'lmstudio', name: 'LM Studio',
    baseURL: 'http://localhost:1234/v1', apiKeyPlaceholder: 'lm-studio',
    defaultModel: '', hint: 'Local server from LM Studio. Start the server in LM Studio first.',
    local: true
  },
  {
    id: 'openai', name: 'OpenAI',
    baseURL: 'https://api.openai.com/v1', apiKeyPlaceholder: 'sk-…',
    defaultModel: 'gpt-4o-mini', hint: 'Cloud. Get a key at platform.openai.com.'
  },
  {
    id: 'gemini', name: 'Google Gemini',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai', apiKeyPlaceholder: 'AIza…',
    defaultModel: 'gemini-2.0-flash', hint: 'Cloud. Get a key at aistudio.google.com. Models: gemini-2.0-flash, gemini-1.5-pro.'
  },
  {
    id: 'openrouter', name: 'OpenRouter',
    baseURL: 'https://openrouter.ai/api/v1', apiKeyPlaceholder: 'sk-or-…',
    defaultModel: 'openai/gpt-4o-mini', hint: 'Cloud gateway to many models. Model names are namespaced, e.g. anthropic/claude-3.5-sonnet.'
  },
  {
    id: 'groq', name: 'Groq',
    baseURL: 'https://api.groq.com/openai/v1', apiKeyPlaceholder: 'gsk_…',
    defaultModel: 'llama-3.3-70b-versatile', hint: 'Cloud, very fast. Get a key at console.groq.com.'
  }
]

/** includes LAN ranges and *.local so a networked ollama still counts as local */
export function isLocalUrl(url: string): boolean {
  if (!url) return true
  return /localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|\b192\.168\.|\b10\.\d{1,3}\.|\b172\.(1[6-9]|2\d|3[01])\.|\.local(?::\d+)?(\/|$)/i.test(url)
}

function newId(): string {
  return `prov_${Date.now()}_${Math.floor(Math.random() * 1e4)}`
}

async function getSetting(key: string): Promise<string | null> {
  try {
    const v = await getSettingRow(key)
    return v == null ? null : String(v)
  } catch {
    return null
  }
}

async function setSetting(key: string, val: string): Promise<void> {
  try {
    await setSettingRow(key, val)
  } catch (err) {
    console.warn(`Failed to persist ${key}:`, err)
  }
}

async function mirrorToFlat(p: AiProvider): Promise<void> {
  await setSetting('ai_base_url', p.baseURL.trim())
  await setSetting('ai_api_key', p.apiKey.trim())
  await setSetting('ai_model', p.model.trim())
}

export async function persistProviders(providers: AiProvider[], activeId: string): Promise<void> {
  await setSetting('ai_providers', JSON.stringify(providers))
  await setSetting('ai_active_provider', activeId)
  const active = providers.find(p => p.id === activeId)
  if (active) await mirrorToFlat(active)
}

/** migrates the legacy flat settings into "Default" on first run */
export async function loadProviders(): Promise<{ providers: AiProvider[]; activeId: string }> {
  const raw = await getSetting('ai_providers')
  let providers: AiProvider[] = []
  if (raw) {
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) providers = parsed.filter(p => p && p.id && typeof p.baseURL === 'string')
    } catch { /* fall through to migration */ }
  }

  // strip a stored "(local)/(cloud)" suffix, early builds doubled it
  let namesFixed = false
  providers = providers.map(p => {
    const clean = (p.name || '').replace(/\s*\((?:local|cloud)\)\s*$/i, '').trim() || 'Provider'
    if (clean !== p.name) namesFixed = true
    return { ...p, name: clean }
  })

  let activeId = await getSetting('ai_active_provider')
  if (namesFixed && providers.length > 0) {
    await setSetting('ai_providers', JSON.stringify(providers))
  }

  if (providers.length === 0) {
    const baseURL = (await getSetting('ai_base_url')) || 'http://localhost:11434/v1'
    const apiKey = (await getSetting('ai_api_key')) || 'ollama'
    const model = (await getSetting('ai_model')) || ''
    const id = newId()
    providers = [{ id, name: isLocalUrl(baseURL) ? 'Ollama' : 'Default', baseURL, apiKey, model }]
    activeId = id
    await persistProviders(providers, id)
  }

  if (!activeId || !providers.some(p => p.id === activeId)) {
    activeId = providers[0].id
    await setSetting('ai_active_provider', activeId)
    await mirrorToFlat(providers[0])
  }

  return { providers, activeId }
}

export async function activateProvider(providers: AiProvider[], id: string): Promise<void> {
  const p = providers.find(x => x.id === id)
  if (!p) return
  await setSetting('ai_active_provider', id)
  await mirrorToFlat(p)
}

export function providerFromPreset(preset: ProviderPreset): AiProvider {
  return {
    id: newId(),
    name: preset.name,
    baseURL: preset.baseURL,
    apiKey: preset.local ? (preset.apiKeyPlaceholder || 'ollama') : '',
    model: preset.defaultModel
  }
}
