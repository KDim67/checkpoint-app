import { getSetting, setSetting } from './db'
import { getAiConfig } from './aiService'
import {
  defaultCapabilities,
  applyQuantizationPenalty,
  tierForParams,
  parseParamsFromLabel,
  parseParamsFromName,
  paramsFromNameHint,
  lookupCurated,
  detectVisionFromName,
  detectReasoningStyle,
  isOpenAiReasoningModel,
  type ModelCapabilities
} from '../shared/modelCapabilities'

const PROBE_TIMEOUT_MS = 4000

/**
 * Discovered capabilities are cached per endpoint+model. Without this the
 * ladder in aiActions re-probes on every restart, which costs a small local
 * model three failed round-trips before it does any work.
 */
const CACHE_SETTING_KEY = 'ai_model_capabilities'

/**
 * Fallbacks from a failed probe are held here for the session only. Persisting
 * them would let one blip, Ollama not up yet at launch, freeze a guessed
 * profile forever, while re-probing on every message would pay the timeout
 * repeatedly against an endpoint that is genuinely down.
 */
const sessionFallbacks = new Map<string, ModelCapabilities>()

type CapabilityCache = Record<string, ModelCapabilities>

function cacheKey(baseURL: string, model: string): string {
  return `${baseURL}::${model}`
}

function readCache(): CapabilityCache {
  const raw = getSetting<string | null>(CACHE_SETTING_KEY, null)
  if (!raw) return {}
  try {
    return (typeof raw === 'string' ? JSON.parse(raw) : raw) as CapabilityCache
  } catch {
    return {}
  }
}

function writeCache(cache: CapabilityCache): void {
  setSetting(CACHE_SETTING_KEY, JSON.stringify(cache))
}

/** Ollama's REST API sits next to the OpenAI-compatible /v1 path, not under it. */
function ollamaRoot(baseURL: string): string {
  return baseURL.replace(/\/+$/, '').replace(/\/v1$/, '')
}

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

// Ollama

interface OllamaTagEntry {
  name?: string
  model?: string
  details?: { parameter_size?: string; quantization_level?: string; family?: string }
}

/**
 * Lists installed models with the metadata attached. The previous listing threw
 * away everything but the name, which is why model size had to be guessed from
 * that name in the first place.
 */
export async function listOllamaModels(
  baseURL: string
): Promise<Array<{ name: string; paramsB: number | null; quantization: string | null }>> {
  const data = (await fetchJson(`${ollamaRoot(baseURL)}/api/tags`)) as { models?: OllamaTagEntry[] }
  return (data.models || []).map(m => ({
    name: m.name || m.model || '',
    paramsB: parseParamsFromLabel(m.details?.parameter_size),
    quantization: m.details?.quantization_level || null
  })).filter(m => m.name)
}

interface OllamaShowResponse {
  // Keyed by architecture, e.g. "llama.context_length" / "qwen2.context_length".
  model_info?: Record<string, unknown>
  // Present on newer Ollama: ["completion", "tools", "vision", "thinking"].
  capabilities?: string[]
  details?: { parameter_size?: string; quantization_level?: string }
}

async function probeOllama(baseURL: string, model: string): Promise<Partial<ModelCapabilities> | null> {
  try {
    const [show, tags] = await Promise.all([
      fetchJson(`${ollamaRoot(baseURL)}/api/show`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model })
      }).catch(() => null) as Promise<OllamaShowResponse | null>,
      listOllamaModels(baseURL).catch(() => [])
    ])
    if (!show) return null

    const info = show.model_info || {}
    const contextEntry = Object.entries(info).find(([k]) => k.endsWith('.context_length'))
    const contextTokens = typeof contextEntry?.[1] === 'number' ? (contextEntry[1] as number) : null

    const tag = tags.find(t => t.name === model)
    const paramsB = parseParamsFromLabel(show.details?.parameter_size) ?? tag?.paramsB ?? null
    const quantization = show.details?.quantization_level ?? tag?.quantization ?? null

    const caps = show.capabilities
    return {
      paramsB,
      quantization,
      ...(contextTokens ? { contextTokens } : {}),
      // Only trust the capabilities array when the server actually sends one;
      // older Ollama omits it entirely and absence is not a denial.
      ...(caps
        ? {
            supportsTools: caps.includes('tools'),
            supportsVision: caps.includes('vision'),
            supportsJsonSchema: true
          }
        : {}),
      source: 'endpoint' as const
    }
  } catch {
    return null
  }
}

// OpenAI-compatible cloud

interface CloudModelEntry {
  id?: string
  context_length?: number
  // OpenRouter shape.
  top_provider?: { context_length?: number; max_completion_tokens?: number }
  architecture?: { input_modalities?: string[]; modality?: string }
  supported_parameters?: string[]
}

export async function listCloudModels(baseURL: string, apiKey: string): Promise<string[]> {
  const headers: Record<string, string> = {}
  if (apiKey && apiKey !== 'ollama') headers['Authorization'] = `Bearer ${apiKey}`
  const data = (await fetchJson(`${baseURL.replace(/\/+$/, '')}/models`, { headers })) as {
    data?: CloudModelEntry[]
  }
  return (data.data || []).map(m => m.id || '').filter(Boolean).sort()
}

async function probeCloud(
  baseURL: string,
  apiKey: string,
  model: string
): Promise<Partial<ModelCapabilities> | null> {
  try {
    const headers: Record<string, string> = {}
    if (apiKey && apiKey !== 'ollama') headers['Authorization'] = `Bearer ${apiKey}`
    const data = (await fetchJson(`${baseURL.replace(/\/+$/, '')}/models`, { headers })) as {
      data?: CloudModelEntry[]
    }
    const entry = (data.data || []).find(m => m.id === model)
    if (!entry) return null

    const contextTokens = entry.context_length ?? entry.top_provider?.context_length ?? null
    const modalities = entry.architecture?.input_modalities
    const params = entry.supported_parameters

    return {
      ...(contextTokens ? { contextTokens } : {}),
      ...(entry.top_provider?.max_completion_tokens
        ? { maxOutputTokens: entry.top_provider.max_completion_tokens }
        : {}),
      ...(modalities ? { supportsVision: modalities.includes('image') } : {}),
      ...(params
        ? {
            supportsTools: params.includes('tools'),
            supportsJsonSchema: params.includes('structured_outputs') || params.includes('response_format')
          }
        : {}),
      source: 'endpoint' as const
    }
  } catch {
    return null
  }
}

// Public API

/**
 * Resolves what a model can do, preferring the endpoint's own answer over the
 * curated table over the model name. Results are cached; pass force to re-probe
 * after pulling a new model or changing endpoints.
 */
export async function getModelCapabilities(
  model: string,
  force = false
): Promise<ModelCapabilities> {
  const { baseURL, apiKey, isOllama } = getAiConfig()
  if (!model) return defaultCapabilities('')

  const key = cacheKey(baseURL, model)
  const cache = readCache()
  if (!force) {
    if (cache[key]) return cache[key]
    const fallback = sessionFallbacks.get(key)
    if (fallback) return fallback
  }

  const base = defaultCapabilities(model)
  const probed = isOllama
    ? await probeOllama(baseURL, model)
    : await probeCloud(baseURL, apiKey, model)

  const merged: ModelCapabilities = { ...base, ...(probed || {}) }

  // Re-derive the tier from whatever size we ended up with, then let heavy
  // quantization pull it back a band.
  const paramsB =
    merged.paramsB ??
    parseParamsFromName(model) ??
    (lookupCurated(model) ? null : paramsFromNameHint(model))
  merged.paramsB = paramsB
  merged.tier = applyQuantizationPenalty(tierForParams(paramsB), merged.quantization)

  // These three are properties of the model family, not of the endpoint, so a
  // silent endpoint must not downgrade what the name already tells us.
  merged.supportsVision = merged.supportsVision || detectVisionFromName(model)
  if (merged.reasoningStyle === 'none') merged.reasoningStyle = detectReasoningStyle(model)
  if (isOpenAiReasoningModel(model)) {
    merged.tokenParamName = 'max_completion_tokens'
    merged.fixedTemperature = 1
  }

  if (merged.source === 'endpoint') {
    cache[key] = merged
    writeCache(cache)
    sessionFallbacks.delete(key)
  } else {
    sessionFallbacks.set(key, merged)
  }
  return merged
}

/** Clears cached capabilities so the next lookup re-probes. */
export function clearCapabilityCache(): void {
  sessionFallbacks.clear()
  setSetting(CACHE_SETTING_KEY, JSON.stringify({}))
}
