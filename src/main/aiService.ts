import type OpenAI from 'openai'
import type { AiStreamParams } from '../shared/types'
import { getSetting } from './db'

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
      const { default: OpenAI } = await import('openai')

      let baseURL = getSetting<string>('ai_base_url', 'http://localhost:11434/v1')
      if (!baseURL || baseURL.trim() === '') {
        baseURL = 'http://localhost:11434/v1'
      }
      let apiKey = getSetting<string>('ai_api_key', 'ollama')
      if (!apiKey || apiKey.trim() === '') {
        apiKey = 'ollama'
      }

      const openai = new OpenAI({
        baseURL,
        apiKey,
        dangerouslyAllowBrowser: false
      })

      const body: OpenAI.Chat.ChatCompletionCreateParamsStreaming = {
        model: params.model,
        messages: params.messages,
        temperature: params.temperature ?? 0.7,
        max_tokens: params.maxTokens ?? 2048,
        stream: true,
        // Ollama-compatible extension for full context window; not part of the
        // official OpenAI param set, so it's appended via a narrow cast rather
        // than casting the whole request body (which previously broke the SDK's
        // streaming overload resolution and silently returned a non-streaming
        // response type).
        ...({ extra_body: { num_ctx: 32768 } } as object)
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
        onError(err instanceof Error ? err : new Error(String(err)))
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
  const { default: OpenAI } = await import('openai')

  let baseURL = getSetting<string>('ai_base_url', 'http://localhost:11434/v1')
  if (!baseURL || baseURL.trim() === '') {
    baseURL = 'http://localhost:11434/v1'
  }
  let apiKey = getSetting<string>('ai_api_key', 'ollama')
  if (!apiKey || apiKey.trim() === '') {
    apiKey = 'ollama'
  }

  const openai = new OpenAI({
    baseURL,
    apiKey,
    dangerouslyAllowBrowser: false
  })

  const response = await openai.chat.completions.create({
    model: params.model,
    messages: params.messages,
    temperature: params.temperature ?? 0.2,
    max_tokens: params.maxTokens ?? 600
  })

  return response.choices[0]?.message?.content?.trim() || ''
}
