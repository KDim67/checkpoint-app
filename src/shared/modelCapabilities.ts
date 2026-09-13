// discovered from the endpoint, names only as a last resort: '72b'.includes('2b') ran 72B on 2B budgets

/** coarse bands everything scales off, not raw param counts */
export type ModelTier = 'tiny' | 'small' | 'mid' | 'large' | 'frontier'

/** how to read its chain-of-thought */
type ReasoningStyle = 'none' | 'think_tags' | 'reasoning_field'

export interface ModelCapabilities {
  /** as the endpoint knows it */
  model: string
  tier: ModelTier
  /** billions; null when nothing says */
  paramsB: number | null
  /** usable input window */
  contextTokens: number
  /** single response ceiling */
  maxOutputTokens: number
  supportsTools: boolean
  supportsJsonSchema: boolean
  supportsVision: boolean
  reasoningStyle: ReasoningStyle
  /** o-series needs max_completion_tokens */
  tokenParamName: 'max_tokens' | 'max_completion_tokens'
  /** o-series allows only the default; null sends ours */
  fixedTemperature: number | null
  /** e.g. Q4_K_M, drives the tier demotion */
  quantization: string | null
  /** so the UI can admit when it's guessing */
  source: 'endpoint' | 'curated' | 'name' | 'default'
}

// ~4B reliable JSON, ~14B multi-step, ~40B full prompt and tools
const TIER_BANDS: Array<{ tier: ModelTier; minB: number }> = [
  { tier: 'frontier', minB: 150 },
  { tier: 'large', minB: 40 },
  { tier: 'mid', minB: 14 },
  { tier: 'small', minB: 4 },
  { tier: 'tiny', minB: 0 }
]

export function tierForParams(paramsB: number | null): ModelTier {
  // an unknown size is usually a cloud model, assume capable
  if (paramsB === null) return 'frontier'
  return TIER_BANDS.find(b => paramsB >= b.minB)?.tier ?? 'tiny'
}

const TIER_ORDER: ModelTier[] = ['tiny', 'small', 'mid', 'large', 'frontier']

function demoteTier(tier: ModelTier, steps = 1): ModelTier {
  const i = TIER_ORDER.indexOf(tier)
  return TIER_ORDER[Math.max(0, i - steps)]
}

/** Q2 drops a band, Q4 and up left alone */
export function applyQuantizationPenalty(tier: ModelTier, quantization: string | null): ModelTier {
  if (!quantization) return tier
  return /q2|q3|iq1|iq2|iq3/i.test(quantization) ? demoteTier(tier) : tier
}

/** anchored on a separator so 72b can't match 2b; MoE reported as total */
export function parseParamsFromName(modelName: string): number | null {
  const name = (modelName || '').toLowerCase()

  const moe = name.match(/(?:^|[-_:/\s])(\d+)\s*x\s*(\d+(?:\.\d+)?)\s*b(?![a-z0-9])/)
  if (moe) {
    const experts = parseFloat(moe[1])
    const perExpert = parseFloat(moe[2])
    if (Number.isFinite(experts) && Number.isFinite(perExpert)) return experts * perExpert
  }

  const plain = name.match(/(?:^|[-_:/\s])(\d+(?:\.\d+)?)\s*b(?![a-z0-9])/)
  if (plain) {
    const value = parseFloat(plain[1])
    if (Number.isFinite(value) && value > 0 && value < 100000) return value
  }
  return null
}

/** only when there's no <n>b and no curated match */
const NAME_SIZE_HINTS: Array<{ re: RegExp; paramsB: number }> = [
  { re: /phi-?4/i, paramsB: 14 },
  { re: /phi-?3\.5|phi-?3/i, paramsB: 3.8 },
  { re: /phi-?2/i, paramsB: 2.7 },
  { re: /tinyllama|tinydolphin/i, paramsB: 1.1 },
  { re: /(?:^|[-_:/])(?:nano|tiny)(?:[-_:/]|$)/i, paramsB: 2 },
  { re: /(?:^|[-_:/])mini(?:[-_:/]|$)/i, paramsB: 4 },
  { re: /(?:^|[-_:/])small(?:[-_:/]|$)/i, paramsB: 8 },
  { re: /(?:^|[-_:/])medium(?:[-_:/]|$)/i, paramsB: 14 }
]

export function paramsFromNameHint(modelName: string): number | null {
  return NAME_SIZE_HINTS.find(h => h.re.test(modelName || ''))?.paramsB ?? null
}

/** ollama's "7.6B" labels */
export function parseParamsFromLabel(label: string | null | undefined): number | null {
  if (!label) return null
  const m = String(label).match(/(\d+(?:\.\d+)?)\s*b/i)
  if (!m) return null
  const value = parseFloat(m[1])
  return Number.isFinite(value) && value > 0 ? value : null
}

// only for clouds whose listing omits context length; kept small, it's maintenance
interface CuratedEntry {
  prefix: string
  contextTokens: number
  maxOutputTokens?: number
  vision?: boolean
  reasoning?: ReasoningStyle
}

const CURATED: CuratedEntry[] = [
  { prefix: 'gpt-4o', contextTokens: 128000, maxOutputTokens: 16384, vision: true },
  { prefix: 'gpt-4.1', contextTokens: 1000000, maxOutputTokens: 32768, vision: true },
  { prefix: 'gpt-4-turbo', contextTokens: 128000, maxOutputTokens: 4096, vision: true },
  { prefix: 'gpt-4', contextTokens: 8192, maxOutputTokens: 4096 },
  { prefix: 'gpt-3.5', contextTokens: 16385, maxOutputTokens: 4096 },
  { prefix: 'o1', contextTokens: 200000, maxOutputTokens: 100000, reasoning: 'reasoning_field' },
  { prefix: 'o3', contextTokens: 200000, maxOutputTokens: 100000, reasoning: 'reasoning_field' },
  { prefix: 'o4', contextTokens: 200000, maxOutputTokens: 100000, reasoning: 'reasoning_field' },
  { prefix: 'claude', contextTokens: 200000, maxOutputTokens: 8192, vision: true },
  { prefix: 'gemini-1.5-pro', contextTokens: 2000000, maxOutputTokens: 8192, vision: true },
  { prefix: 'gemini', contextTokens: 1000000, maxOutputTokens: 8192, vision: true },
  { prefix: 'deepseek-reasoner', contextTokens: 64000, maxOutputTokens: 8192, reasoning: 'reasoning_field' },
  { prefix: 'deepseek', contextTokens: 64000, maxOutputTokens: 8192 },
  { prefix: 'grok', contextTokens: 131072, maxOutputTokens: 8192, vision: true },
  { prefix: 'llama-3.3', contextTokens: 131072, maxOutputTokens: 8192 },
  { prefix: 'mistral', contextTokens: 32768, maxOutputTokens: 8192 }
]

export function lookupCurated(modelName: string): CuratedEntry | undefined {
  // strip an OpenRouter vendor prefix
  const name = (modelName || '').toLowerCase().replace(/^[^/]+\//, '')
  return CURATED.filter(c => name.startsWith(c.prefix)).sort((a, b) => b.prefix.length - a.prefix.length)[0]
}

// name-based detection when the endpoint's silent

const VISION_RE = /llava|moondream|bakllava|minicpm-?v|qwen[\w.-]*vl|internvl|vision|pixtral|gpt-4o|gpt-4\.\d|gpt-4-turbo|gemini|claude|grok|llama[\w.-]*vision/i

/** o-series rejects max_tokens and custom temperature */
const OPENAI_REASONING_RE = /(?:^|\/)(o1|o3|o4)(?:-|$)/i

const THINK_TAG_RE = /r1\b|deepseek-r1|qwq|marco-o1|think/i
const REASONING_FIELD_RE = /deepseek-reasoner|(?:^|\/)(o1|o3|o4)(?:-|$)/i

export function detectReasoningStyle(modelName: string): ReasoningStyle {
  const name = modelName || ''
  if (REASONING_FIELD_RE.test(name)) return 'reasoning_field'
  if (THINK_TAG_RE.test(name)) return 'think_tags'
  return 'none'
}

export function isOpenAiReasoningModel(modelName: string): boolean {
  return OPENAI_REASONING_RE.test(modelName || '')
}

export function detectVisionFromName(modelName: string): boolean {
  return VISION_RE.test(modelName || '')
}

export interface TierBudget {
  /** per turn */
  memoryRecallLimit: number
  /** before pruning */
  memoryStoreLimit: number
  workspaceFileCap: number
  /** share of the window for attached docs */
  docBudgetRatio: number
  tersePrompt: boolean
  /** batches instead of one big object */
  batchStructured: boolean
  /** retries after a parse or validation failure */
  repairAttempts: number
}

export const TIER_BUDGETS: Record<ModelTier, TierBudget> = {
  tiny:     { memoryRecallLimit: 3,  memoryStoreLimit: 30,  workspaceFileCap: 120,  docBudgetRatio: 0.25, tersePrompt: true,  batchStructured: true,  repairAttempts: 2 },
  small:    { memoryRecallLimit: 4,  memoryStoreLimit: 40,  workspaceFileCap: 250,  docBudgetRatio: 0.30, tersePrompt: true,  batchStructured: false, repairAttempts: 2 },
  mid:      { memoryRecallLimit: 6,  memoryStoreLimit: 80,  workspaceFileCap: 500,  docBudgetRatio: 0.35, tersePrompt: false, batchStructured: false, repairAttempts: 1 },
  large:    { memoryRecallLimit: 10, memoryStoreLimit: 120, workspaceFileCap: 1000, docBudgetRatio: 0.40, tersePrompt: false, batchStructured: false, repairAttempts: 1 },
  frontier: { memoryRecallLimit: 12, memoryStoreLimit: 160, workspaceFileCap: 1500, docBudgetRatio: 0.45, tersePrompt: false, batchStructured: false, repairAttempts: 1 }
}

/** strongest first; tiny models go straight to prose, forced tools fail and cost round-trips */
export function methodOrderForTier(tier: ModelTier, caps: ModelCapabilities): string[] {
  if (tier === 'tiny') return ['json_object', 'text']
  const order: string[] = []
  if (caps.supportsTools) order.push('tools')
  if (caps.supportsJsonSchema) order.push('json_schema')
  order.push('json_object', 'text')
  return order
}

/** before discovery, and when it fails */
export function defaultCapabilities(model: string): ModelCapabilities {
  const curated = lookupCurated(model)
  // curated means cloud, where "mini" is branding not size
  const paramsB = parseParamsFromName(model) ?? (curated ? null : paramsFromNameHint(model))
  const tier = tierForParams(paramsB)
  return {
    model,
    tier,
    paramsB,
    contextTokens: curated?.contextTokens ?? (tier === 'tiny' ? 8192 : tier === 'small' ? 16384 : 32768),
    maxOutputTokens: curated?.maxOutputTokens ?? (tier === 'tiny' ? 1024 : 4096),
    supportsTools: tier !== 'tiny',
    supportsJsonSchema: tier !== 'tiny',
    supportsVision: curated?.vision ?? detectVisionFromName(model),
    reasoningStyle: curated?.reasoning ?? detectReasoningStyle(model),
    tokenParamName: isOpenAiReasoningModel(model) ? 'max_completion_tokens' : 'max_tokens',
    fixedTemperature: isOpenAiReasoningModel(model) ? 1 : null,
    quantization: null,
    source: curated ? 'curated' : paramsB !== null ? 'name' : 'default'
  }
}
