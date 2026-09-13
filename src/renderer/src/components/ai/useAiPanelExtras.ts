import { useCallback } from 'react'
import { getSkillById } from './skills'
import type { Message } from './types'
import { estimateTokens } from './aiHelpers'
import { COPIED_FEEDBACK_MS } from '../../lib/timings'
import { getStringSetting } from '../../lib/settings'
import * as memoryApi from '../../data/memory'
import type { AiChat } from './useAiChat'

/** Exporting and copying a chat, consolidating memories after a turn, and the token budget estimate. */
export function useAiPanelExtras(aiChat: AiChat) {
  const {
    activeWorkspace, messages, inputValue, selectedModel, modelCaps, modelBudget,
    reportedPromptTokens, savedChats, currentChatId, consolidationTurnRef, auditTurnRef,
    consolidateRef, showMemoryPanel, setMemories, setMemoryConsolidating, activeSkillId,
    workspaceFolder, workspaceFiles, setCopiedMsgIndex
  } = aiChat
  // Export chat as Markdown
  const handleExportChat = () => {
    const chatMessages = messages.filter(m => m.role !== 'system')
    if (chatMessages.length === 0) return
    const title = savedChats.find(c => c.id === currentChatId)?.title || 'Chat Export'
    const lines = [`# ${title}`, `*Exported ${new Date().toLocaleString()}*`, '']
    for (const msg of chatMessages) {
      const label = msg.role === 'user' ? '**You**' : '**AI Assistant**'
      const ts = msg.timestamp ? `*${new Date(msg.timestamp).toLocaleTimeString()}*` : ''
      lines.push(`${label} ${ts}`, '', msg.content, '', '---', '')
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${title.replace(/[^a-z0-9]/gi, '-').toLowerCase()}.md`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  // Memory panel
  // Load memories whenever the panel opens (from ANY entry point: the button,
  // the /mem command, or the "N recalled" chip) and whenever the workspace
  // changes while it's open. This is what keeps the panel in sync with the
  // Settings memory vault instead of showing a stale/empty count.

  /**
   * Background memory consolidation. Fires after each AI turn.
   * Uses a secondary AI call to extract key facts from the last exchange.
   * Runs silently without blocking the UI.
   */
  const triggerMemoryConsolidation = useCallback(async (currentMessages: Message[]) => {
    try {
      // Rate-limit: only consolidate every 2 turns to reduce API load
      consolidationTurnRef.current += 1
      if (consolidationTurnRef.current % 2 !== 0) return

      const validContext = activeWorkspace || 'default'
      const userTurn = [...currentMessages].reverse().find(m => m.role === 'user')
      const assistantTurn = [...currentMessages].reverse().find(m => m.role === 'assistant')
      if (!userTurn || !assistantTurn) return

      // Don't consolidate trivially short exchanges
      const combinedLength = (userTurn.content?.length || 0) + (assistantTurn.content?.length || 0)
      if (combinedLength < 200) return

      const dbModel = await getStringSetting('ai_model', '').catch(() => '')
      const model = dbModel || selectedModel
      if (!model) return

      setMemoryConsolidating(true)

      // Runs entirely in the main process now. See memoryService.consolidateFromExchange.
      // (Constructing the OpenAI client here in the renderer never worked: the SDK refuses
      // to initialize in a browser-like context, which Electron's renderer is, so this used
      // to throw immediately and get swallowed by the catch below. No memories were ever
      // actually being written.)
      const saved = await memoryApi.consolidateMemory({
        context: validContext,
        userText: userTurn.content,
        assistantText: assistantTurn.content,
        model
      })

      if (saved && saved.length > 0 && showMemoryPanel) {
        setMemories(saved)
      }

      // Every 10 consolidation runs, perform a self-cleaning audit
      auditTurnRef.current += 1
      if (auditTurnRef.current % 10 === 0) {
        const audited = await memoryApi.auditMemories(validContext, model).catch(() => [])
        if (audited && audited.length > 0 && showMemoryPanel) {
          setMemories(audited)
        }
      }
    } catch (e) {
      // Background consolidation failures are silent, never block the user
      console.warn('[Memory] Consolidation pass failed:', e)
    } finally {
      setMemoryConsolidating(false)
    }
  }, [consolidationTurnRef, activeWorkspace, selectedModel, setMemoryConsolidating, showMemoryPanel, auditTurnRef, setMemories])
  consolidateRef.current = triggerMemoryConsolidation

  // Copy message
  const handleCopyMessage = async (content: string, index: number) => {
    try {
      await navigator.clipboard.writeText(content)
      setCopiedMsgIndex(index)
      setTimeout(() => setCopiedMsgIndex(null), COPIED_FEEDBACK_MS)
    } catch {
      // fallback for environments without clipboard API
    }
  }

  // Rough context-window usage estimate for the Token Budget Indicator.
  const tokenUsage = (() => {
    const contextWindowTokens = modelCaps.contextTokens
    const historyTokens = messages.reduce((sum, m) => sum + estimateTokens(m.content), 0)
    const baseOverheadTokens = 900 // base system prompt + live board state scaffolding
    const skillTokens = activeSkillId ? estimateTokens(getSkillById(activeSkillId)?.systemPrompt || '') : 0
    const workspaceTokens = workspaceFolder ? estimateTokens(workspaceFiles.slice(0, modelBudget.workspaceFileCap).map(f => f.relativePath).join('\n')) : 0
    const estimated = historyTokens + estimateTokens(inputValue) + baseOverheadTokens + skillTokens + workspaceTokens
    // The reported figure covers the last completed turn, so anything typed
    // since is added on top of it.
    const used = reportedPromptTokens !== null
      ? reportedPromptTokens + estimateTokens(inputValue)
      : estimated
    const ratio = Math.min(1, used / contextWindowTokens)
    return { used, ratio, measured: reportedPromptTokens !== null }
  })()

  return {
    handleExportChat,
    handleCopyMessage,
    tokenUsage
  }
}

export type AiPanelExtras = ReturnType<typeof useAiPanelExtras>
