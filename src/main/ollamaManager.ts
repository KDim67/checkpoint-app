import { execFile } from 'child_process'
import { BrowserWindow } from 'electron'
import { IpcChannels } from '../shared/ipcChannels'
import type { OllamaStatus, PullProgressEvent } from '../shared/cookbookTypes'

let activeAbortController: AbortController | null = null

/**
 * Runs a command with arguments and a timeout.
 * Returns empty string if it fails or times out.
 */
function execFileAsync(file: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve) => {
    const controller = new AbortController()
    const timeout = setTimeout(() => {
      controller.abort()
    }, timeoutMs)

    execFile(file, args, { signal: controller.signal }, (error, stdout) => {
      clearTimeout(timeout)
      if (error) {
        resolve('')
      } else {
        resolve(stdout.trim())
      }
    })
  })
}

/**
 * Checks if Ollama is running, installed, and gets currently available local models.
 * Never throws.
 */
export async function checkOllama(): Promise<OllamaStatus> {
  const downloadUrl = 'https://ollama.com/download'

  // Tier 1: check if Ollama server is running (API is reachable)
  try {
    const response = await fetch('http://localhost:11434/api/tags', {
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
    const versionOutput = await execFileAsync('ollama', ['--version'], 2000)
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
    const response = await fetch('http://localhost:11434/api/pull', {
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
    const response = await fetch('http://localhost:11434/api/tags', {
      signal: AbortSignal.timeout(2000)
    })
    if (response.ok) {
      const data = (await response.json()) as { models?: Array<{ name: string }> }
      return data.models?.map((m) => m.name) || []
    }
  } catch (err) {
    console.error('Ollama Manager: Failed to list local models:', err)
  }
  return []
}
