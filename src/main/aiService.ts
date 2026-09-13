import type OpenAI from 'openai'
import type { AiStreamParams, AiUsage } from '../shared/types'
import type { ModelCapabilities } from '../shared/modelCapabilities'
import { getAiConfig } from './aiConfig'

/** names the likely cause; a bare "404 (no body)" tells the user nothing */
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

/** shared by streaming chat and the structured generator in aiActions */
export async function createOpenAiClient(): Promise<{ client: OpenAI; isOllama: boolean }> {
  const { default: OpenAI } = await import('openai')
  const { baseURL, apiKey, isOllama } = getAiConfig()
  const client = new OpenAI({ baseURL, apiKey, dangerouslyAllowBrowser: false })
  return { client, isOllama }
}

/** o-series rejects max_tokens and fails the whole request */
export function tokenLimitParam(caps: ModelCapabilities, requested: number): Record<string, number> {
  const capped = Math.max(256, Math.min(requested, caps.maxOutputTokens))
  return { [caps.tokenParamName]: capped }
}

/** o-series rejects any non-default temperature */
export function temperatureParam(caps: ModelCapabilities, requested: number): Record<string, number> {
  return caps.fixedTemperature !== null ? {} : { temperature: requested }
}

/** ollama sizes the KV cache from num_ctx, so ask for the model's real window */
function ollamaContextParam(caps: ModelCapabilities, isOllama: boolean): object {
  if (!isOllama) return {}
  return { extra_body: { num_ctx: caps.contextTokens } }
}

export function startAiStream(
  params: AiStreamParams,
  onChunk: (chunk: string) => void,
  onDone: (usage?: AiUsage) => void,
  onError: (err: Error) => void
): AbortController {
  const controller = new AbortController()
  // reasoning arrives first: open <think> on the first reasoning delta, close on the first content
  let emittedThinkOpen = false
  let closedThink = false
  // usage comes on a final empty-choices chunk, only if stream_options is honoured
  let usage: AiUsage | undefined

  ;(async () => {
    try {
      const { client: openai, isOllama } = await createOpenAiClient()

      const { getModelCapabilities } = await import('./modelCapabilityService')
      const caps = await getModelCapabilities(params.model)

      const body: OpenAI.Chat.ChatCompletionCreateParamsStreaming = {
        model: params.model,
        // only user messages carry image parts in practice, hence the cast
        messages: params.messages as OpenAI.Chat.ChatCompletionMessageParam[],
        stream: true,
        // real token counts; endpoints that don't know it ignore it and the renderer estimates
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

        // reasoning models stream CoT in a separate field; wrap in <think> to reuse the parser
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
      // user aborts aren't errors
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

/** main only: the SDK refuses browser contexts and the renderer would expose the key */
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
