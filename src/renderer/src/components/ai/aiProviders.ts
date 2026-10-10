import * as aiApi from '../../data/ai'
import type { AiProviderSet, AiProviderView } from '../../../../shared/aiProviders'

export { isLocalUrl } from '../../../../shared/aiProviders'

// main keeps the connections and their keys; the screen gets each one without its key

export type AiProvider = AiProviderView

export interface ProviderPreset {
  id: string
  name: string
  baseURL: string
  defaultModel: string
  hint: string
  local?: boolean
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'ollama', name: 'Ollama',
    baseURL: 'http://localhost:11434/v1',
    defaultModel: '', hint: 'Runs models locally. The model list auto-fills from your installed models.',
    local: true
  },
  {
    id: 'lmstudio', name: 'LM Studio',
    baseURL: 'http://localhost:1234/v1',
    defaultModel: '', hint: 'Local server from LM Studio. Start the server in LM Studio first.',
    local: true
  },
  {
    id: 'openai', name: 'OpenAI',
    baseURL: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini', hint: 'Cloud. Get a key at platform.openai.com.'
  },
  {
    id: 'gemini', name: 'Google Gemini',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-2.0-flash', hint: 'Cloud. Get a key at aistudio.google.com. Models: gemini-2.0-flash, gemini-1.5-pro.'
  },
  {
    id: 'openrouter', name: 'OpenRouter',
    baseURL: 'https://openrouter.ai/api/v1',
    defaultModel: 'openai/gpt-4o-mini', hint: 'Cloud gateway to many models. Model names are namespaced, e.g. anthropic/claude-3.5-sonnet.'
  },
  {
    id: 'groq', name: 'Groq',
    baseURL: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile', hint: 'Cloud, very fast. Get a key at console.groq.com.'
  }
]

function newId(): string {
  return `prov_${Date.now()}_${Math.floor(Math.random() * 1e4)}`
}

/** main migrates the old flat settings on first run; a failed read shows no connections rather than throwing */
export async function loadProviders(): Promise<AiProviderSet> {
  try {
    return await aiApi.providers.load()
  } catch (err) {
    console.warn('Failed to load the AI connections:', err)
    return { providers: [], activeId: '' }
  }
}

/** null when it didn't save; otherwise what main kept, which may have forgotten a key whose address moved */
export async function persistProviders(providers: AiProvider[], activeId: string): Promise<AiProviderSet | null> {
  try {
    return await aiApi.providers.save(providers.map(({ id, name, baseURL, model }) => ({ id, name, baseURL, model })), activeId)
  } catch (err) {
    console.warn('Failed to save the AI connections:', err)
    return null
  }
}

export async function activateProvider(id: string): Promise<AiProviderSet | null> {
  try {
    return await aiApi.providers.activate(id)
  } catch (err) {
    console.warn('Failed to switch the AI connection:', err)
    return null
  }
}

/** the key goes to main and is never read back; an empty one clears it */
export async function saveProviderKey(id: string, key: string): Promise<AiProviderSet | null> {
  try {
    return await aiApi.providers.setKey(id, key)
  } catch (err) {
    console.warn('Failed to save the API key:', err)
    return null
  }
}

export function providerFromPreset(preset: ProviderPreset): AiProvider {
  return { id: newId(), name: preset.name, baseURL: preset.baseURL, model: preset.defaultModel, hasKey: false }
}
