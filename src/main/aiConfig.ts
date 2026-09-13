/** own module: beside the streamer it made the capability probe an import cycle */

import { getSetting } from './db'

const OLLAMA_DEFAULT_URL = 'http://localhost:11434/v1'

export function getAiConfig(): { baseURL: string; apiKey: string; isOllama: boolean } {
  let baseURL = getSetting<string>('ai_base_url', OLLAMA_DEFAULT_URL)
  if (!baseURL || baseURL.trim() === '') {
    baseURL = OLLAMA_DEFAULT_URL
  }
  let apiKey = getSetting<string>('ai_api_key', 'ollama')
  if (!apiKey || apiKey.trim() === '') {
    apiKey = 'ollama'
  }
  const isOllama =
    baseURL.includes('localhost') || baseURL.includes('127.0.0.1') || apiKey === 'ollama'
  return { baseURL, apiKey, isOllama }
}
