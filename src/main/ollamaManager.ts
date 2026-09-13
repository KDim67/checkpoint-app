import { execFileQuiet } from './exec'
import { getAiConfig } from './aiConfig'
import { BrowserWindow } from 'electron'
import { IpcChannels } from '../shared/ipcChannels'
import type { OllamaStatus, PullProgressEvent } from '../shared/cookbookTypes'
import { errorMessage } from '../shared/errors'

let activeAbortController: AbortController | null = null
let lastOfflineLogged = false

/** isLocalUrl accepts LAN, so don't hardcode localhost; cloud endpoints fall back to it */
function ollamaHost(): string {
  const { baseURL, isOllama } = getAiConfig()
  if (!isOllama || !baseURL) return 'http://localhost:11434'
  return baseURL.replace(/\/+$/, '').replace(/\/v1$/, '')
}

/** never throws */
export async function checkOllama(): Promise<OllamaStatus> {
  const downloadUrl = 'https://ollama.com/download'

  // server up?
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
    // not running, maybe installed
  }

  // CLI on PATH?
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
    // not installed
  }

  return {
    installed: false,
    running: false,
    downloadUrl,
    localModels: []
  }
}

/** parses NDJSON progress and forwards percentages to the renderer */
export async function pullModel(modelTag: string, mainWindow: BrowserWindow): Promise<void> {
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
      // keep the partial last line for the next chunk
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

    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IpcChannels.OLLAMA_PULL_DONE, { modelTag })
    }
  } catch (err) {
    const errorObj = err as Error
    const isAbort = errorObj.name === 'AbortError' || errorObj.message?.toLowerCase().includes('aborted')
    const message = isAbort ? 'Installation cancelled by user.' : errorMessage(err)

    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IpcChannels.OLLAMA_PULL_ERROR, { modelTag, message })
    }
  } finally {
    activeAbortController = null
  }
}

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

export function stopPull(): void {
  if (activeAbortController) {
    activeAbortController.abort()
    activeAbortController = null
  }
}

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
