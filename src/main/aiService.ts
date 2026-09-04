import type OpenAI from 'openai'
import type { AiStreamParams, AiUsage } from '../shared/types'
import type { ModelCapabilities } from '../shared/modelCapabilities'
import { getSetting } from './db'

/**
 * Resolves the configured OpenAI-compatible endpoint (base URL + API key) from
 * the settings DB, applying sane Ollama defaults when unset.
 */
export function getAiConfig(): { baseURL: string; apiKey: string; isOllama: boolean } {
  let baseURL = getSetting<string>('ai_base_url', 'http://localhost:11434/v1')
  if (!baseURL || baseURL.trim() === '') {
    baseURL = 'http://localhost:11434/v1'
  }
  let apiKey = getSetting<string>('ai_api_key', 'ollama')
  if (!apiKey || apiKey.trim() === '') {
    apiKey = 'ollama'
  }
  const isOllama =
    baseURL.includes('localhost') || baseURL.includes('127.0.0.1') || apiKey === 'ollama'
  return { baseURL, apiKey, isOllama }
}

/**
 * Turns a raw provider/SDK error into an actionable, human-readable message.
 * A bare "404 status code (no body)" tells the user nothing; this names the
 * likely cause (missing model, wrong URL, server down, bad key).
 */
export function humanizeAiError(err: unknown, ctx: { model?: string; baseURL?: string }): string {
  const e = err as { status?: number; code?: string; message?: string }
  const status = e?.status
  const raw = (e?.message || String(err) || '').trim()
  const model = ctx.model || 'the selected model'
  const base = ctx.baseURL || 'the configured endpoint'

  if (status === 404 || /\b404\b/.test(raw)) {
    return `Model "${model}" or endpoint not found (404) at ${base}. ` +
      `If you're using Ollama, install the model first ("ollama pull ${model}") and make sure the Base URL ends in /v1. ` +
      `If you're using a cloud API, double-check the model name and Base URL in AI Settings.`
  }
  if (status === 401 || status === 403) {
    return `Authentication failed (${status}) at ${base}. Check your API key in AI Settings.`
  }
  if (status === 429) {
    return `Rate limited (429) by ${base}. Wait a moment and try again.`
  }
  if (e?.code === 'ECONNREFUSED' || /econnrefused|fetch failed|failed to fetch|enotfound|network|connect(ion)?\s|timed out/i.test(raw)) {
    return `Could not connect to ${base}. Make sure your AI server (e.g. Ollama) is running and the Base URL is correct in AI Settings.`
  }
  return raw || 'Unknown AI error'
}

/**
 * Constructs an OpenAI SDK client bound to the configured endpoint. Shared by the
 * streaming chat path and the structured-action generator (aiActions.ts).
 */
export async function createOpenAiClient(): Promise<{ client: OpenAI; isOllama: boolean }> {
  const { default: OpenAI } = await import('openai')
  const { baseURL, apiKey, isOllama } = getAiConfig()
  const client = new OpenAI({ baseURL, apiKey, dangerouslyAllowBrowser: false })
  return { client, isOllama }
}

/**
 * o-series models reject `max_tokens` outright and require the newer name.
 * Sending the wrong one fails the whole request rather than degrading.
 */
export function tokenLimitParam(caps: ModelCapabilities, requested: number): Record<string, number> {
  const capped = Math.max(256, Math.min(requested, caps.maxOutputTokens))
  return { [caps.tokenParamName]: capped }
}

/** o-series also rejects any temperature but its default. */
export function temperatureParam(caps: ModelCapabilities, requested: number): Record<string, number> {
  return caps.fixedTemperature !== null ? {} : { temperature: requested }
}

/**
 * Ollama allocates a KV cache the size of num_ctx, so a flat 32768 made a 2B
 * model reserve four times its trained window while capping a 128k model at a
 * quarter of its own. Ask for what the model actually has.
 */
export function ollamaContextParam(caps: ModelCapabilities, isOllama: boolean): object {
  if (!isOllama) return {}
  return { extra_body: { num_ctx: caps.contextTokens } }
}

/**
 * Initiates an AI completion stream from the configured OpenAI-compatible endpoint.
 * Lazily loads the 'openai' npm package and checks database configuration at run-time.
 */
export function startAiStream(
  params: AiStreamParams,
  onChunk: (chunk: string) => void,
  onDone: (usage?: AiUsage) => void,
  onError: (err: Error) => void
): AbortController {
  const controller = new AbortController()
  // Reasoning arrives before content, so the <think> wrapper is opened on the
  // first reasoning delta and closed on the first content delta.
  let emittedThinkOpen = false
  let closedThink = false
  // Endpoints that honour stream_options put usage on a final chunk whose
  // choices array is empty; ones that ignore it never send this at all.
  let usage: AiUsage | undefined

  // Run the async streaming logic in the background
  ;(async () => {
    try {
      const { client: openai, isOllama } = await createOpenAiClient()

      const { getModelCapabilities } = await import('./modelCapabilityService')
      const caps = await getModelCapabilities(params.model)

      const body: OpenAI.Chat.ChatCompletionCreateParamsStreaming = {
        model: params.model,
        // AiChatMessage permits multimodal parts on any role for simplicity;
        // in practice only user messages carry image parts, which matches the
        // OpenAI wire format. Hence the narrowing cast.
        messages: params.messages as OpenAI.Chat.ChatCompletionMessageParam[],
        stream: true,
        // Ask for real token counts. Endpoints that do not know the option
        // ignore it, and the renderer keeps its estimate as a fallback.
        stream_options: { include_usage: true },
        ...tokenLimitParam(caps, params.maxTokens ?? 2048),
        ...temperatureParam(caps, params.temperature ?? 0.7),
        ...ollamaContextParam(caps, isOllama)
      } as OpenAI.Chat.ChatCompletionCreateParamsStreaming

      const stream = await openai.chat.completions.create(body, {
        signal: controller.signal
      })

      for await (const chunk of stream) {
        if (chunk.usage) {
          usage = {
            promptTokens: chunk.usage.prompt_tokens ?? 0,
            completionTokens: chunk.usage.completion_tokens ?? 0,
            totalTokens: chunk.usage.total_tokens ?? 0
          }
        }
        const delta = chunk.choices[0]?.delta as
          | { content?: string; reasoning_content?: string; reasoning?: string }
          | undefined

        // Reasoning models over the API stream their chain-of-thought in a
        // separate field rather than inside <think> tags. Wrapping it in the
        // tags the renderer already parses keeps both shapes on one path.
        const reasoning = delta?.reasoning_content ?? delta?.reasoning
        if (reasoning) {
          if (!emittedThinkOpen) {
            emittedThinkOpen = true
            onChunk('<think>')
          }
          onChunk(reasoning)
        }

        const text = delta?.content ?? ''
        if (text) {
          if (emittedThinkOpen && !closedThink) {
            closedThink = true
            onChunk('</think>')
          }
          onChunk(text)
        }
      }

      if (emittedThinkOpen && !closedThink) onChunk('</think>')

      onDone(usage)
    } catch (err) {
      const error = err as Error & { code?: string; status?: number }
      // Silently ignore user-requested aborts
      const isAbort =
        error.name === 'AbortError' ||
        error.message?.toLowerCase().includes('aborted') ||
        error.message?.toLowerCase().includes('cancel') ||
        error.code === 'ERR_USER_ABORT' ||
        error.status === 499

      if (!isAbort) {
        const { baseURL } = getAiConfig()
        onError(new Error(humanizeAiError(error, { model: params.model, baseURL })))
      }
    }
  })()

  return controller
}

/**
 * Non-streaming completion for background work (memory consolidation,
 * summarisation) that wants one text result rather than a stream.
 *
 * Must run in MAIN, like startAiStream: the OpenAI SDK refuses to construct a
 * client in a browser-like context, and the renderer is where a cloud API key
 * would be exposed.
 */
export async function runCompletion(params: {
  model: string
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
  temperature?: number
  maxTokens?: number
}): Promise<string> {
  const { client: openai } = await createOpenAiClient()

  const { getModelCapabilities } = await import('./modelCapabilityService')
  const caps = await getModelCapabilities(params.model)

  const response = await openai.chat.completions.create({
    model: params.model,
    messages: params.messages,
    ...tokenLimitParam(caps, params.maxTokens ?? 600),
    ...temperatureParam(caps, params.temperature ?? 0.2)
  } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming)

  return response.choices[0]?.message?.content?.trim() || ''
}
