// What a model can actually do.
//
// This replaces the name-substring guessing that decided context size, vision
// support and prompt verbosity. Those checks read `'72b'.includes('2b')` as
// true, so a 72B model was driven with a 2B model's budgets. Capabilities are
// now discovered from the endpoint (Ollama /api/tags + /api/show, or a cloud
// /models listing) and only fall back to parsing the name when nothing answers.

/**
 * Coarse size bands. Everything that scales with model strength. How much
 * context to spend, how terse the prompt must be, how hard to push structured
 * output. Keys off the tier rather than off a raw parameter count.
 */
export type ModelTier = 'tiny' | 'small' | 'mid' | 'large' | 'frontier'

/** How a model exposes its chain-of-thought, so the panel knows what to read. */
type ReasoningStyle = 'none' | 'think_tags' | 'reasoning_field'

export interface ModelCapabilities {
  /** Model id as the endpoint knows it. */
  model: string
  tier: ModelTier
  /** Billions of parameters. null when the endpoint does not say and the name has no hint. */
  paramsB: number | null
  /** Usable input window in tokens. */
  contextTokens: number
  /** Ceiling for a single response. */
  maxOutputTokens: number
  supportsTools: boolean
  supportsJsonSchema: boolean
  supportsVision: boolean
  reasoningStyle: ReasoningStyle
  /** o-series rejects max_tokens and requires this name instead. */
  tokenParamName: 'max_tokens' | 'max_completion_tokens'
  /** o-series rejects any temperature but the default; null means "send ours". */
  fixedTemperature: number | null
  /** Quantization label from Ollama, e.g. Q4_K_M. Drives the tier demotion below. */
  quantization: string | null
  /** Where these values came from, so the UI can admit when it is guessing. */
  source: 'endpoint' | 'curated' | 'name' | 'default'
}

// Tier bands
// Boundaries sit where behaviour actually changes: ~4B is where reliable JSON
// starts, ~14B where multi-step instructions hold, ~40B where the full prompt
// and tool calling are safe.
const TIER_BANDS: Array<{ tier: ModelTier; minB: number }> = [
  { tier: 'frontier', minB: 150 },
  { tier: 'large', minB: 40 },
  { tier: 'mid', minB: 14 },
  { tier: 'small', minB: 4 },
  { tier: 'tiny', minB: 0 }
]

export function tierForParams(paramsB: number | null): ModelTier {
  // An unknown size is almost always a cloud model behind a name like
  // "gpt-4o" or "claude-sonnet-4", so assume capable rather than crippling it.
  if (paramsB === null) return 'frontier'
  return TIER_BANDS.find(b => paramsB >= b.minB)?.tier ?? 'tiny'
}

const TIER_ORDER: ModelTier[] = ['tiny', 'small', 'mid', 'large', 'frontier']

function demoteTier(tier: ModelTier, steps = 1): ModelTier {
  const i = TIER_ORDER.indexOf(tier)
  return TIER_ORDER[Math.max(0, i - steps)]
}

/**
 * Heavy quantization costs real capability. A Q2 70B follows a schema worse
 * than a Q8 32B, so it drops a band. Q4 and above is the common case and is
 * left alone.
 */
export function applyQuantizationPenalty(tier: ModelTier, quantization: string | null): ModelTier {
  if (!quantization) return tier
  return /q2|q3|iq1|iq2|iq3/i.test(quantization) ? demoteTier(tier) : tier
}

// Name parsing (last resort)

/**
 * Pulls a parameter count out of a model name.
 *
 * Anchored on a separator so "72b" cannot match "2b", which is exactly how
 * 72B/27B/32B/8x22B models ended up being driven as if they were 2B.
 * "8x22b" is a mixture-of-experts total, reported as total rather than active
 * because the memory footprint follows the total.
 */
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

/**
 * Families whose names carry no parameter count. Only consulted when the name
 * has no "<n>b" and no curated entry matched, so "gpt-4o-mini" is unaffected.
 * It matches the curated gpt-4o row first.
 */
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

/** Ollama reports sizes as "7.6B" / "70.6B" in details.parameter_size. */
export function parseParamsFromLabel(label: string | null | undefined): number | null {
  if (!label) return null
  const m = String(label).match(/(\d+(?:\.\d+)?)\s*b/i)
  if (!m) return null
  const value = parseFloat(m[1])
  return Number.isFinite(value) && value > 0 ? value : null
}

// Curated fallback
// Only for cloud endpoints whose /models listing omits context length. Kept
// deliberately small and prefix-matched: every entry here is a maintenance
// liability, so it carries context length and nothing else.
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
  // Strip an OpenRouter-style vendor prefix before matching.
  const name = (modelName || '').toLowerCase().replace(/^[^/]+\//, '')
  return CURATED.filter(c => name.startsWith(c.prefix)).sort((a, b) => b.prefix.length - a.prefix.length)[0]
}

// Feature detection from the name, when the endpoint stays silent

const VISION_RE = /llava|moondream|bakllava|minicpm-?v|qwen[\w.-]*vl|internvl|vision|pixtral|gpt-4o|gpt-4\.\d|gpt-4-turbo|gemini|claude|grok|llama[\w.-]*vision/i

/** o-series models reject max_tokens and any non-default temperature. */
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

// Per-tier budgets

export interface TierBudget {
  /** Memories injected into the prompt per turn. */
  memoryRecallLimit: number
  /** Memories kept before pruning. */
  memoryStoreLimit: number
  /** Workspace file paths listed. */
  workspaceFileCap: number
  /** Share of the context window spendable on attached documents. */
  docBudgetRatio: number
  /** Use the terse system prompt instead of the full one. */
  tersePrompt: boolean
  /** Ask for structured output in batches instead of one large object. */
  batchStructured: boolean
  /** Extra corrective attempts after a JSON parse or validation failure. */
  repairAttempts: number
}

export const TIER_BUDGETS: Record<ModelTier, TierBudget> = {
  tiny:     { memoryRecallLimit: 3,  memoryStoreLimit: 30,  workspaceFileCap: 120,  docBudgetRatio: 0.25, tersePrompt: true,  batchStructured: true,  repairAttempts: 2 },
  small:    { memoryRecallLimit: 4,  memoryStoreLimit: 40,  workspaceFileCap: 250,  docBudgetRatio: 0.30, tersePrompt: true,  batchStructured: false, repairAttempts: 2 },
  mid:      { memoryRecallLimit: 6,  memoryStoreLimit: 80,  workspaceFileCap: 500,  docBudgetRatio: 0.35, tersePrompt: false, batchStructured: false, repairAttempts: 1 },
  large:    { memoryRecallLimit: 10, memoryStoreLimit: 120, workspaceFileCap: 1000, docBudgetRatio: 0.40, tersePrompt: false, batchStructured: false, repairAttempts: 1 },
  frontier: { memoryRecallLimit: 12, memoryStoreLimit: 160, workspaceFileCap: 1500, docBudgetRatio: 0.45, tersePrompt: false, batchStructured: false, repairAttempts: 1 }
}

/**
 * Which structured-output methods to try, strongest first.
 *
 * Tiny models are taken straight to prose-with-a-schema-hint: they almost never
 * satisfy a forced tool call, and each failed attempt is a full round-trip on
 * the slowest hardware in the range.
 */
export function methodOrderForTier(tier: ModelTier, caps: ModelCapabilities): string[] {
  if (tier === 'tiny') return ['json_object', 'text']
  const order: string[] = []
  if (caps.supportsTools) order.push('tools')
  if (caps.supportsJsonSchema) order.push('json_schema')
  order.push('json_object', 'text')
  return order
}

/** Used before any discovery has run, and whenever discovery fails. */
export function defaultCapabilities(model: string): ModelCapabilities {
  const curated = lookupCurated(model)
  // A curated hit means a known cloud model, where a "mini" suffix is branding
  // rather than a size, so the word hints stay out of it.
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
