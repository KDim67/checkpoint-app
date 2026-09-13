import { useCallback } from 'react'
import { getSkillById } from './skills'
import type { Message } from './types'
import { estimateTokens } from './aiHelpers'
import { COPIED_FEEDBACK_MS } from '../../lib/timings'
import { getStringSetting } from '../../lib/settings'
import * as memoryApi from '../../data/memory'
import type { AiChat } from './useAiChat'

export function useAiPanelExtras(aiChat: AiChat) {
  const {
    activeWorkspace, messages, inputValue, selectedModel, modelCaps, modelBudget,
    reportedPromptTokens, savedChats, currentChatId, consolidationTurnRef, auditTurnRef,
    consolidateRef, showMemoryPanel, setMemories, setMemoryConsolidating, activeSkillId,
    workspaceFolder, workspaceFiles, setCopiedMsgIndex
  } = aiChat
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

  /** runs after each AI turn, silently */
  const triggerMemoryConsolidation = useCallback(async (currentMessages: Message[]) => {
    try {
      // every 2 turns to cut API load
      consolidationTurnRef.current += 1
      if (consolidationTurnRef.current % 2 !== 0) return

      const validContext = activeWorkspace || 'default'
      const userTurn = [...currentMessages].reverse().find(m => m.role === 'user')
      const assistantTurn = [...currentMessages].reverse().find(m => m.role === 'assistant')
      if (!userTurn || !assistantTurn) return

      // skip trivially short exchanges
      const combinedLength = (userTurn.content?.length || 0) + (assistantTurn.content?.length || 0)
      if (combinedLength < 200) return

      const dbModel = await getStringSetting('ai_model', '').catch(() => '')
      const model = dbModel || selectedModel
      if (!model) return

      setMemoryConsolidating(true)

      // runs in main: the SDK refuses the renderer, so this used to throw silently and save nothing
      const saved = await memoryApi.consolidateMemory({
        context: validContext,
        userText: userTurn.content,
        assistantText: assistantTurn.content,
        model
      })

      if (saved && saved.length > 0 && showMemoryPanel) {
        setMemories(saved)
      }

      // self-cleaning audit every 10 runs
      auditTurnRef.current += 1
      if (auditTurnRef.current % 10 === 0) {
        const audited = await memoryApi.auditMemories(validContext, model).catch(() => [])
        if (audited && audited.length > 0 && showMemoryPanel) {
          setMemories(audited)
        }
      }
    } catch (e) {
      // silent, never blocks the user
      console.warn('[Memory] Consolidation pass failed:', e)
    } finally {
      setMemoryConsolidating(false)
    }
  }, [consolidationTurnRef, activeWorkspace, selectedModel, setMemoryConsolidating, showMemoryPanel, auditTurnRef, setMemories])
  consolidateRef.current = triggerMemoryConsolidation

  const handleCopyMessage = async (content: string, index: number) => {
    try {
      await navigator.clipboard.writeText(content)
      setCopiedMsgIndex(index)
      setTimeout(() => setCopiedMsgIndex(null), COPIED_FEEDBACK_MS)
    } catch {
      // no clipboard API
    }
  }

  // rough estimate for the token budget indicator
  const tokenUsage = (() => {
    const contextWindowTokens = modelCaps.contextTokens
    const historyTokens = messages.reduce((sum, m) => sum + estimateTokens(m.content), 0)
    const baseOverheadTokens = 900 // base system prompt + board state scaffolding
    const skillTokens = activeSkillId ? estimateTokens(getSkillById(activeSkillId)?.systemPrompt || '') : 0
    const workspaceTokens = workspaceFolder ? estimateTokens(workspaceFiles.slice(0, modelBudget.workspaceFileCap).map(f => f.relativePath).join('\n')) : 0
    const estimated = historyTokens + estimateTokens(inputValue) + baseOverheadTokens + skillTokens + workspaceTokens
    // the reported figure covers the last turn, add what's typed since
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
