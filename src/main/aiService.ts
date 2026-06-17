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

      const stream = await openai.chat.completions.create(
        {
          model: params.model,
          messages: params.messages,
          temperature: params.temperature ?? 0.7,
          max_tokens: params.maxTokens ?? 2048,
          stream: true
        },
        {
          signal: controller.signal
        }
      )

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
