import type OpenAI from 'openai'
import type { AiStreamParams } from '../shared/types'
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
 * Initiates an AI completion stream from the configured OpenAI-compatible endpoint.
 * Lazily loads the 'openai' npm package and checks database configuration at run-time.
 */
export function startAiStream(
  params: AiStreamParams,
  onChunk: (chunk: string) => void,
  onDone: () => void,
  onError: (err: Error) => void
): AbortController {
  const controller = new AbortController()

  // Run the async streaming logic in the background
  ;(async () => {
    try {
      const { client: openai, isOllama } = await createOpenAiClient()

      const body: OpenAI.Chat.ChatCompletionCreateParamsStreaming = {
        model: params.model,
        // AiChatMessage permits multimodal parts on any role for simplicity;
        // in practice only user messages carry image parts, which matches the
        // OpenAI wire format, hence the narrowing cast.
        messages: params.messages as OpenAI.Chat.ChatCompletionMessageParam[],
        temperature: params.temperature ?? 0.7,
        max_tokens: params.maxTokens ?? 2048,
        stream: true,
        ...(isOllama ? ({ extra_body: { num_ctx: 32768 } } as object) : {})
      }

      const stream = await openai.chat.completions.create(body, {
        signal: controller.signal
      })

      for await (const chunk of stream) {
        const text = chunk.choices[0]?.delta?.content ?? ''
        if (text) {
          onChunk(text)
        }
      }

      onDone()
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
 * Non-streaming completion for background/internal tasks (e.g. memory consolidation,
 * summarization) that need a single text result rather than a live stream.
 *
 * IMPORTANT: this, like startAiStream, must run in the MAIN process. The OpenAI SDK
 * refuses to construct a client inside a browser-like context (Electron's renderer
 * counts as one: window/document/navigator are all present there), and the renderer
 * is also where a user-supplied cloud API key would otherwise be exposed. Keeping every
 * model call here, behind IPC, is what makes it safe to add more background AI features.
 */
export async function runCompletion(params: {
  model: string
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
  temperature?: number
  maxTokens?: number
}): Promise<string> {
  const { client: openai } = await createOpenAiClient()

  const response = await openai.chat.completions.create({
    model: params.model,
    messages: params.messages,
    temperature: params.temperature ?? 0.2,
    max_tokens: params.maxTokens ?? 600
  })

  return response.choices[0]?.message?.content?.trim() || ''
}
