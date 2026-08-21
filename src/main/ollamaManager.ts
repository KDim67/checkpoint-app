import { execFileQuiet } from './exec'
import { getAiConfig } from './aiService'
import { BrowserWindow } from 'electron'
import { IpcChannels } from '../shared/ipcChannels'
import type { OllamaStatus, PullProgressEvent } from '../shared/cookbookTypes'

let activeAbortController: AbortController | null = null
let lastOfflineLogged = false

/**
 * Ollama's REST root for the configured endpoint. isLocalUrl deliberately
 * accepts LAN addresses, so an Ollama on another machine is a supported setup, 
 * but these calls used to hardcode localhost, leaving that user with an empty
 * model list. Falls back to localhost when the endpoint is a cloud provider.
 */
function ollamaHost(): string {
  const { baseURL, isOllama } = getAiConfig()
  if (!isOllama || !baseURL) return 'http://localhost:11434'
  return baseURL.replace(/\/+$/, '').replace(/\/v1$/, '')
}

/**
 * Checks if Ollama is running, installed, and gets currently available local models.
 * Never throws.
 */
export async function checkOllama(): Promise<OllamaStatus> {
  const downloadUrl = 'https://ollama.com/download'

  // Tier 1: check if Ollama server is running (API is reachable)
  try {
    const response = await fetch(`${ollamaHost()}/api/tags`, {
      signal: AbortSignal.timeout(2000)
    })
    if (response.ok) {
      const data = (await response.json()) as { models?: Array<{ name: string }> }
      const localModels = data.models?.map((m) => m.name) || []
      return {
        installed: true,
        running: true,
        downloadUrl,
        localModels
      }
    }
  } catch {
    // Server is not running. Check if the executable is installed in PATH.
  }

  // Tier 2: check if Ollama CLI is installed in PATH
  try {
    const versionOutput = await execFileQuiet('ollama', ['--version'], 2000)
    if (versionOutput) {
      return {
        installed: true,
        running: false,
        downloadUrl,
        localModels: []
      }
    }
  } catch {
    // Executable not found
  }

  return {
    installed: false,
    running: false,
    downloadUrl,
    localModels: []
  }
}

/**
 * Streams the pull download request from Ollama, parsing the NDJSON format
 * and broadcasting progress percentage updates to the renderer process.
 */
export async function pullModel(modelTag: string, mainWindow: BrowserWindow): Promise<void> {
  // Cancel any existing pull operation first
  if (activeAbortController) {
    activeAbortController.abort()
  }

  activeAbortController = new AbortController()

  try {
    const response = await fetch(`${ollamaHost()}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: modelTag, stream: true }),
      signal: activeAbortController.signal
    })

    if (!response.ok) {
      throw new Error(`Failed to pull: HTTP ${response.status} ${response.statusText}`)
    }

    if (!response.body) {
      throw new Error('ReadableStream not supported on response body')
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      // Save last partial line back to the buffer
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const data = JSON.parse(line)
          const completed = data.completed ?? 0
          const total = data.total ?? 0
          const percent = completed && total ? Math.round((completed / total) * 100) : -1

          const event: PullProgressEvent = {
            modelId: modelTag,
            status: data.status || 'Downloading...',
            completedBytes: completed,
            totalBytes: total,
            percent
          }

          if (!mainWindow.isDestroyed()) {
            mainWindow.webContents.send(IpcChannels.OLLAMA_PULL_PROGRESS, event)
          }
        } catch (jsonErr) {
          console.error('Ollama Manager: Failed to parse NDJSON line:', line, jsonErr)
        }
      }
    }

    // Success done
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IpcChannels.OLLAMA_PULL_DONE, { modelTag })
    }
  } catch (err) {
    const errorObj = err as Error
    const isAbort = errorObj.name === 'AbortError' || errorObj.message?.toLowerCase().includes('aborted')
    const message = isAbort ? 'Installation cancelled by user.' : errorObj.message || String(err)

    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IpcChannels.OLLAMA_PULL_ERROR, { modelTag, message })
    }
  } finally {
    activeAbortController = null
  }
}

/**
 * Deletes a locally-installed Ollama model. Returns true on success.
 */
export async function deleteModel(modelTag: string): Promise<boolean> {
  try {
    const response = await fetch(`${ollamaHost()}/api/delete`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: modelTag, name: modelTag }),
      signal: AbortSignal.timeout(10000)
    })
    return response.ok
  } catch (err) {
    console.error('Ollama Manager: Failed to delete model:', err)
    return false
  }
}

/**
 * Aborts the active pull operation if running.
 */
export function stopPull(): void {
  if (activeAbortController) {
    activeAbortController.abort()
    activeAbortController = null
  }
}

/**
 * Helper to get list of local models directly.
 */
export async function listLocalModels(): Promise<string[]> {
  try {
    const response = await fetch(`${ollamaHost()}/api/tags`, {
      signal: AbortSignal.timeout(2000)
    })
    if (response.ok) {
      lastOfflineLogged = false
      const data = (await response.json()) as { models?: Array<{ name: string }> }
      return data.models?.map((m) => m.name) || []
    }
  } catch (err) {
    const errorObj = err as Error & { cause?: { code?: string } }
    const isOffline =
      errorObj.cause?.code === 'ECONNREFUSED' ||
      errorObj.message?.toLowerCase().includes('fetch failed')
    if (isOffline) {
      if (!lastOfflineLogged) {
        console.warn(`Ollama Manager: server offline or unreachable at ${ollamaHost()}`)
        lastOfflineLogged = true
      }
    } else {
      console.error('Ollama Manager: Failed to list local models:', err)
    }
  }
  return []
}
