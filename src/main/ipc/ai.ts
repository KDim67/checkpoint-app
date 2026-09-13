/** streaming, structured generation and model capabilities */

import { ipcMain } from 'electron'
import { IpcChannels } from '../../shared/ipcChannels'

// one live stream per channel; the legacy no-id call maps to ''
const aiStreamControllers = new Map<string, AbortController>()
let structuredAbortController: AbortController | null = null
import { sendToWindow } from '../windows'

export function registerAiHandlers(): void {
  // streamId lets features stream at once without cross-talk; events echo it back for filtering
  ipcMain.handle(IpcChannels.AI_STREAM_START, async (_event, params: unknown, streamId?: unknown) => {
    const id = typeof streamId === 'string' ? streamId : ''

    // a new stream on the same channel replaces the old one
    const existing = aiStreamControllers.get(id)
    if (existing) {
      existing.abort()
      aiStreamControllers.delete(id)
    }

    const send = (channel: string, ...args: unknown[]): void => {
      sendToWindow(channel, ...args)
    }

    try {
      const parsedParams = params as import('../../shared/types').AiStreamParams
      const { startAiStream } = await import('../aiService')

      const controller = startAiStream(
        parsedParams,
        (chunk) => send(IpcChannels.AI_CHUNK, chunk, id),
        (usage) => {
          send(IpcChannels.AI_DONE, id, usage)
          aiStreamControllers.delete(id)
        },
        (err) => {
          send(IpcChannels.AI_ERROR, err.message, id)
          aiStreamControllers.delete(id)
        }
      )
      aiStreamControllers.set(id, controller)
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error)
      send(IpcChannels.AI_ERROR, errMsg, id)
      aiStreamControllers.delete(id)
    }
  })

  ipcMain.handle(IpcChannels.AI_STREAM_ABORT, (_event, streamId?: unknown) => {
    const id = typeof streamId === 'string' ? streamId : undefined
    if (id === undefined) {
      // legacy no-id abort stops everything
      for (const controller of aiStreamControllers.values()) controller.abort()
      aiStreamControllers.clear()
    } else {
      aiStreamControllers.get(id)?.abort()
      aiStreamControllers.delete(id)
    }
    return true
  })

  // request/response, not streamed
  ipcMain.handle(IpcChannels.AI_GENERATE_STRUCTURED, async (_event, params: unknown) => {
    if (structuredAbortController) {
      structuredAbortController.abort()
    }
    const controller = new AbortController()
    structuredAbortController = controller
    try {
      const { generateStructured } = await import('../aiActions')
      const typed = params as import('../../shared/types').AiStructuredParams
      const result = await generateStructured(typed, controller.signal)
      return result
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error)
      return { ok: false, error: errMsg }
    } finally {
      if (structuredAbortController === controller) structuredAbortController = null
    }
  })

  ipcMain.handle(IpcChannels.AI_GET_CAPABILITIES, async (_event, model: unknown, force?: unknown) => {
    const { getModelCapabilities } = await import('../modelCapabilityService')
    return getModelCapabilities(typeof model === 'string' ? model : '', force === true)
  })

  ipcMain.handle(IpcChannels.AI_GENERATE_ABORT, () => {
    if (structuredAbortController) {
      structuredAbortController.abort()
      structuredAbortController = null
    }
    return true
  })
  
  ipcMain.handle(IpcChannels.AI_TEST_CONNECTION, async (_event, baseURL: string, apiKey: string) => {
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      const trimmedKey = apiKey.trim()
      if (trimmedKey && trimmedKey !== 'ollama') {
        headers['Authorization'] = `Bearer ${trimmedKey}`
      }
      const res = await fetch(`${baseURL.replace(/\/+$/, '')}/models`, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(8000)
      })
      if (res.ok) {
        return { success: true }
      } else {
        const text = await res.text().catch(() => '')
        return { success: false, error: `HTTP ${res.status}: ${text || res.statusText}` }
      }
    } catch (err) {
      return { success: false, error: (err as Error).message || 'Network request failed' }
    }
  })
}
