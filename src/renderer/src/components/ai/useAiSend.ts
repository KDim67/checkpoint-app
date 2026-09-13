import { useEffect, useRef } from 'react'
import { getSkillById } from './skills'
import { buildAssistantMessage } from './boardEnrich'
import { loadBoardConfig, patchBoardConfig } from '../../lib/boardConfig'
import { TIER_BUDGETS } from '../../../../shared/modelCapabilities'
import type { Message } from './types'
import { classifyIntent, getAIEntitiesFromMessage, parseThinkingAndContent, pruneHistory, wantsColumns } from './aiHelpers'
import { loadSamplesPromptBlock } from '../../lib/emailSamples'
import { buildBasePrompt, buildBoardState, buildDateBlock, buildEnforcement, buildMemoryBlock, buildReasoningInstruction, buildStructuredInstruction, buildWorkspaceIndex, historyBudgetFor, resolveSkillId, structuredKindFor, waitingLabelFor } from './promptAssembly'
import { gatherAttachmentMessages } from './attachmentContext'
import { errorMessage } from '../../../../shared/errors'
import { bulkDeleteItems, readItems } from '../../data/items'
import * as aiApi from '../../data/ai'
import * as memoryApi from '../../data/memory'
import { ASSISTANT_STREAM_ID, STORAGE_KEY_ACTIVE_SKILL } from './panelConstants'
import type { AiChat } from './useAiChat'

export interface SubmitOptions {
  mode?: string
  cheatsheets?: string[]
  notes?: string[]
  files?: string[]
  images?: string[]
  displayContent?: string
  intentHint?: 'create' | 'analyze'
}

/**
 * Sending a message and receiving the reply: the stream listeners, the prompt
 * built for each turn, and rewriting, resending, reverting and aborting.
 */
export function useAiSend(aiChat: AiChat) {
  const {
    activeWorkspace, messages, setMessages, inputValue, setInputValue, isStreaming, setIsStreaming,
    setStreamingText, contextItem, selectedModel, temperature, maxTokens, setReportedPromptTokens,
    modelCapsRef, setRevertConfirmData, handleNewChat, streamRef, currentChatIdRef,
    streamingChatIdRef, isAbortedRef, hasReceivedFirstChunkRef, setIsWaitingForFirstChunk,
    setRecalledMemCount, setWaitingLabel, consolidateRef, setShowMemoryPanel, systemPromptOverride,
    activeSkillId, setActiveSkillId, workspaceFolder, workspaceFiles
  } = aiChat
  // 4. Mount IPC Streaming Listeners with cleanups to prevent leaks
  useEffect(() => {
    const stream = streamRef.current
    const unsubscribeChunk = aiApi.onChunk((chunk, streamId) => {
      if (streamId && streamId !== ASSISTANT_STREAM_ID) return
      if (isAbortedRef.current) return
      // Ignore chunks if current chat is no longer the streaming chat
      if (streamingChatIdRef.current !== currentChatIdRef.current) return

      // Clear "waiting for first chunk" indicator on first chunk received
      if (!hasReceivedFirstChunkRef.current) {
        hasReceivedFirstChunkRef.current = true
        setIsWaitingForFirstChunk(false)
      }

      streamRef.current.push(chunk)
    })

    const unsubscribeDone = aiApi.onDone((streamId, usage) => {
      if (streamId && streamId !== ASSISTANT_STREAM_ID) return
      // Endpoints honouring stream_options report what the prompt actually
      // cost; that replaces the estimate until the next turn changes it.
      if (usage?.promptTokens) setReportedPromptTokens(usage.promptTokens)
      if (isAbortedRef.current) {
        isAbortedRef.current = false
        return
      }
      const finalAssistantResponse = streamRef.current.flush()

      // Only append to UI if user is still on the same chat
      if (streamingChatIdRef.current === currentChatIdRef.current) {
        const { thinking, content: finalContent } = parseThinkingAndContent(finalAssistantResponse)
        setMessages(prev => {
          const updated = [...prev, {
            role: 'assistant' as const,
            content: finalContent,
            thinking: thinking || undefined,
            timestamp: Date.now()
          }]
          // Kick off background memory consolidation after message is committed
          setTimeout(() => consolidateRef.current(updated), 100)
          return updated
        })
        setStreamingText('')
      }
      streamRef.current.reset()
      streamingChatIdRef.current = null
      hasReceivedFirstChunkRef.current = false
      setIsWaitingForFirstChunk(false)
      setIsStreaming(false)
    })

    const unsubscribeError = aiApi.onError((errMessage, streamId) => {
      if (streamId && streamId !== ASSISTANT_STREAM_ID) return
      if (isAbortedRef.current) {
        isAbortedRef.current = false
        return
      }
      const errText = `\n\n**Error:** ${errMessage}`
      const finalAssistantResponse = streamRef.current.flush() + errText
      if (streamingChatIdRef.current === currentChatIdRef.current) {
        const { thinking, content: finalContent } = parseThinkingAndContent(finalAssistantResponse)
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: finalContent,
          thinking: thinking || undefined,
          timestamp: Date.now()
        }])
        setStreamingText('')
      }
      streamRef.current.reset()
      streamingChatIdRef.current = null
      hasReceivedFirstChunkRef.current = false
      setIsWaitingForFirstChunk(false)
      setIsStreaming(false)
    })

    return () => {
      unsubscribeChunk()
      unsubscribeDone()
      unsubscribeError()
      stream.flush()
    }
  }, [consolidateRef, currentChatIdRef, hasReceivedFirstChunkRef, isAbortedRef, setIsStreaming, setIsWaitingForFirstChunk, setMessages, setReportedPromptTokens, setStreamingText, streamRef, streamingChatIdRef])

  const handleSelectSkill = (skillId: string | null) => {
    setActiveSkillId(prev => {
      const next = prev === skillId ? null : skillId
      try {
        if (next) localStorage.setItem(STORAGE_KEY_ACTIVE_SKILL, next)
        else localStorage.removeItem(STORAGE_KEY_ACTIVE_SKILL)
      } catch {}
      return next
    })
  }

  // Snapshots & Board Reversion
  const revertAICreatedEntities = async (cardTitles: string[], columnNames: string[]) => {
    const validContext = activeWorkspace || 'default'

    // 1. Delete cards/tasks with matching titles in this context
    if (cardTitles.length > 0) {
      const [tasksRes, cardsRes] = await Promise.all([
        readItems(validContext, 'task').catch(() => []),
        readItems(validContext, 'card').catch(() => [])
      ])
      const allItems = [...(tasksRes || []), ...(cardsRes || [])].filter(i => i.status !== 'archived')
      const itemsToDelete = allItems
        .filter(item => cardTitles.includes(item.title.trim()))
        .map(item => item.id)

      if (itemsToDelete.length > 0) {
        await bulkDeleteItems(itemsToDelete).catch(() => {})
      }
    }

    // 2. Delete columns with matching names in this context
    if (columnNames.length > 0) {
      // The unified board document, not the legacy column key. That key stopped
      // being written when board configuration was unified, so reverting against
      // it both read and wrote a snapshot the board no longer looks at.
      const { columns } = await loadBoardConfig(validContext)

      if (columns.length > 0) {
        const updatedCols = columns.filter(col => !columnNames.includes(col.name.trim()))
        await patchBoardConfig(validContext, { columns: updatedCols }).catch(() => {})
      }
    }

    // 3. Trigger UI reload
    window.dispatchEvent(new CustomEvent('kanban-refresh'))
    window.dispatchEvent(new CustomEvent('item-updated'))
  }

  const handleRevert = async (messageIndex: number) => {
    const assistantMsg = messages[messageIndex + 1]
    if (!assistantMsg) return

    const { cardTitles, columnNames } = getAIEntitiesFromMessage(assistantMsg.content)
    setRevertConfirmData({ cardTitles, columnNames, index: messageIndex })
  }

  // Rewrite & Resend handlers
  const handleRewrite = async (newContent: string, messageIndex: number) => {
    if (isStreaming) return

    const originalMsg = messages[messageIndex]
    const updatedUserMsg: Message = {
      ...originalMsg,
      content: newContent,
      timestamp: Date.now()
    }

    const historyToKeep = messages.slice(0, messageIndex)
    const nextList = [...historyToKeep, updatedUserMsg]
    setMessages(nextList)

    await runChatStream(nextList)
  }

  const handleResend = async (messageIndex: number) => {
    if (isStreaming) return

    const historyToKeep = messages.slice(0, messageIndex + 1)
    setMessages(historyToKeep)

    await runChatStream(historyToKeep)
  }

  // 5. Submit Query
  const handleSubmitWithText = async (textToSubmit?: string, options?: SubmitOptions) => {
    const text = (textToSubmit ?? inputValue).trim()
    const hasAttachment = !!(options?.cheatsheets?.length || options?.notes?.length || options?.files?.length || options?.images?.length)
    if (!text && !hasAttachment) return
    if (isStreaming) return

    // Slash Commands Parser
    if (text.startsWith('/')) {
      const parts = text.split(/\s+/)
      const cmd = parts[0].toLowerCase()
      const remainingText = parts.slice(1).join(' ').trim()

      if (cmd === '/clear') {
        // Full reset (same as New Chat). Also clears the action caches so
        // previously created card titles can be recreated in the fresh thread.
        handleNewChat()
        setInputValue('')
        return
      }

      if (cmd === '/mem' || cmd === '/memory') {
        setShowMemoryPanel(true)
        setInputValue('')
        return
      }

      if (cmd === '/help') {
        const userMsg: Message = {
          role: 'user',
          content: text,
          timestamp: Date.now()
        }
        const helpMsg: Message = {
          role: 'assistant',
          content: `### 🤖 Checkpoint AI Slash Commands\n\n` +
            `Use the following slash commands to quickly trigger active skills or workspace tools:\n\n` +
            `* **\`\/clear\`**. Clears the current chat thread.\n` +
            `* **\`\/mem\`** or **\`\/memory\`**. Opens the **Memory Vault** overlay.\n` +
            `* **\`\/narrative [query]\`**. Switches active skill to **Narrative Specialist** (submits optional query).\n` +
            `* **\`\/kanban [query]\`**. Switches active skill to **Kanban Architect** (submits optional query).\n` +
            `* **\`\/plan\`** or **\`\/planner [query]\`**. Switches active skill to **Implementation Planner** (submits optional query).\n` +
            `* **\`\/help\`**. Displays this command help menu.`,
          timestamp: Date.now()
        }
        setMessages(prev => [...prev, userMsg, helpMsg])
        setInputValue('')
        return
      }

      // Skill switching commands
      let matchedSkillId: string | null = null
      if (cmd === '/narrative') matchedSkillId = 'narrative_specialist'
      else if (cmd === '/kanban') matchedSkillId = 'kanban_architect'
      else if (cmd === '/plan' || cmd === '/planner') matchedSkillId = 'implementation_planner'

      if (matchedSkillId) {
        // Switch the skill
        setActiveSkillId(matchedSkillId)
        try { localStorage.setItem(STORAGE_KEY_ACTIVE_SKILL, matchedSkillId) } catch {}

        if (remainingText) {
          // Submit the rest of the text under this new skill
          const userMessage: Message = {
            role: 'user',
            content: remainingText,
            mode: options?.mode,
            cheatsheets: options?.cheatsheets,
            timestamp: Date.now()
          }
          const nextMessages = [...messages, userMessage]
          setMessages(nextMessages)
          setInputValue('')
          await runChatStream(nextMessages)
        } else {
          // Just print a system confirmation message
          const systemMsg: Message = {
            role: 'assistant',
            content: `✨ Switched active skill to **${getSkillById(matchedSkillId)?.label}**.`,
            timestamp: Date.now()
          }
          setMessages(prev => [...prev, { role: 'user', content: text, timestamp: Date.now() }, systemMsg])
          setInputValue('')
        }
        return
      }
    }

    const userMessage: Message = {
      role: 'user',
      content: text || '(see attachments)',
      displayContent: options?.displayContent,
      intentHint: options?.intentHint,
      mode: options?.mode,
      cheatsheets: options?.cheatsheets,
      notes: options?.notes,
      files: options?.files,
      images: options?.images,
      timestamp: Date.now()
    }
    const nextMessages = [...messages, userMessage]
    setMessages(nextMessages)
    setInputValue('')
    await runChatStream(nextMessages)
  }

  const runChatStream = async (nextMessages: Message[]) => {
    setIsStreaming(true)
    setIsWaitingForFirstChunk(true)
    setWaitingLabel('Thinking…')
    streamingChatIdRef.current = currentChatIdRef.current
    hasReceivedFirstChunkRef.current = false
    isAbortedRef.current = false
    streamRef.current.reset()
    setStreamingText('')
    const modelLower = selectedModel.toLowerCase()

      try {
        const lastUserMsg = [...nextMessages].reverse().find(m => m.role === 'user')
        const text = lastUserMsg?.content || ''

        // Discovered from the endpoint rather than guessed from the model
        // name. The old check read '72b'.includes('2b') as true and drove a
        // 72B model with a 2B model's budgets.
        const caps = modelCapsRef.current
        const budget = TIER_BUDGETS[caps.tier]
        const isSmallModel = budget.tersePrompt
        const memoryRecallLimit = budget.memoryRecallLimit
        const workspaceFileCap = budget.workspaceFileCap
        // Reserve the model's real output ceiling instead of a flat guess.
        const contextWindowTokens = Math.max(2048, caps.contextTokens - caps.maxOutputTokens)

        const baseSystemPromptContent = buildBasePrompt(isSmallModel)

        // Seed context as a system instruction if preset
        const systemPrompt: Message[] = [
          {
            role: 'system',
            content: baseSystemPromptContent
          }
        ]

        // Ground all date/deadline reasoning. Models have no clock of their
        // own, so "Friday", "next week" and "overdue" are meaningless without this.
        systemPrompt.push({
          role: 'system',
          content: buildDateBlock(new Date())
        })

        // Scrape live board state (columns, cards) and then retrieve semantic memories.
        // Board state comes FIRST so memories have board context when recalled.
        try {
          const validContext = activeWorkspace || 'default'
          // This list becomes the "VALID COLUMN IDs" the model is told to use,
          // so reading the stale legacy key meant describing a board that no
          // longer existed: columns the user had deleted were still offered,
          // and ones they had added were invisible. loadBoardConfig always
          // returns a non-empty column set, so no defaults fallback is needed.
          const { columns: colsList } = await loadBoardConfig(validContext)

          const [tasksRes, cardsRes] = await Promise.all([
            readItems(validContext, 'task').catch(() => []),
            readItems(validContext, 'card').catch(() => [])
          ])
          const cardOnlyItems = (cardsRes || []).filter(i => i.status !== 'archived')
          const allItems = [...(tasksRes || []), ...cardOnlyItems].filter(i => i.status !== 'archived')

          const liveBoardStateText = buildBoardState(validContext, colsList, cardOnlyItems, allItems)

          systemPrompt.push({
            role: 'system',
            content: liveBoardStateText
          })

          // 2. Semantic Memory Vector Retrieval (runs AFTER board state so memories interpret board context)
          try {
            const memories = await memoryApi.searchMemories(text, validContext, memoryRecallLimit).catch(() => [])
            setRecalledMemCount(memories?.length || 0)
            if (memories && memories.length > 0) {
              systemPrompt.push({
                role: 'system',
                content: buildMemoryBlock(memories)
              })
            }
          } catch (memErr) {
            console.warn('Failed to retrieve semantic memories for AI context:', memErr)
          }
        } catch (err) {
          console.warn('Failed to scrape workspace items for AI context:', err)
        }

        // Specialized Skill Workflow injection (auto-elevated if not manually overridden)
        const lastUserContentForSkill = nextMessages[nextMessages.length - 1]?.content || text
        const predictedIntent = classifyIntent(lastUserContentForSkill, activeSkillId)
        const resolvedSkillId = resolveSkillId(activeSkillId, lastUserContentForSkill, predictedIntent)

        const activeSkill = getSkillById(resolvedSkillId)
        if (activeSkill) {
          systemPrompt.push({
            role: 'system',
            content: activeSkill.systemPrompt
          })
        }

        // Workspace codebase index injection. Grouped by top-level folder and file-type buckets
        // so the model understands project structure, not just a flat list of filenames.
        if (workspaceFolder && workspaceFiles.length > 0) {
          systemPrompt.push({
            role: 'system',
            content: buildWorkspaceIndex(workspaceFolder, workspaceFiles, workspaceFileCap)
          })
        }

      if (contextItem) {
        systemPrompt.push({
          role: 'system',
          content: `Active Selected Focus Item details:\nType: ${contextItem.type}\nTitle: ${contextItem.title}\nContent:\n${contextItem.body || '[No description]'}`
        })
      }

      // Inject user's session-level system prompt override if set
      if (systemPromptOverride.trim()) {
        systemPrompt.push({
          role: 'system',
          content: `ADDITIONAL USER INSTRUCTIONS FOR THIS SESSION:\n${systemPromptOverride.trim()}`
        })
      }

      // Inject saved Email Writing Style Context & Multi-Draft Samples, ONLY when no specialized
      // skill is active. Injecting this while a skill runs pollutes the skill's system prompt.
      if (!activeSkillId) {
        try {
          // Read through the database rather than localStorage: a restored or
          // synced database used to carry samples the panel could not see.
          const samplesText = await loadSamplesPromptBlock()
          if (samplesText.trim()) {
            systemPrompt.push({
              role: 'system',
              content: `User's Writing Voice & Sample Emails:\n${samplesText}\n\nWhen drafting or rewriting emails, mirror this exact writing style, tone, and formatting.`
            })
          }
        } catch (styleErr) {
          console.warn('Failed to inject email writing sample style:', styleErr)
        }
      }

      // Prepare final API messages payload
      const apiMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> }> = [
        ...systemPrompt,
        ...(await gatherAttachmentMessages({ messages: nextMessages, text, isSmallModel, contextWindowTokens, workspaceFolder }))
      ]

      // Calculate token budget for conversation history:
      const historyBudget = historyBudgetFor(contextWindowTokens, resolvedSkillId, workspaceFolder, workspaceFiles, workspaceFileCap)
      const prunedHistory = pruneHistory(nextMessages, Math.max(4000, historyBudget))

      // Add conversation history. User messages with image attachments become
      // multimodal content parts (vision-capable models read them directly).
      for (const msg of prunedHistory) {
        if (msg.role === 'user' && msg.images && msg.images.length > 0) {
          apiMessages.push({
            role: 'user',
            content: [
              { type: 'text', text: msg.content },
              ...msg.images.map(url => ({ type: 'image_url' as const, image_url: { url } }))
            ]
          })
        } else {
          apiMessages.push({ role: msg.role, content: msg.content })
        }
      }

      // Classify the user's intent and inject a skill-aware enforcement message at the
      // very bottom of the prompt stack (highest weight position for the model).
      // NOTE: only a MANUALLY-pinned skill (activeSkillId) forces its structured
      // output. An auto-recalled skill only sets tone/expertise, so a casual
      // mention ("what tasks…", "the character…") won't surprise the user with a
      // plan or dialogue block; clear create-requests still trigger via the base classifier.
      const lastUserContent = prunedHistory[prunedHistory.length - 1]?.content || ''
      let intent = classifyIntent(lastUserContent, activeSkillId)
      // An explicit quick-action intent is authoritative. A "Do NOT output JSON"
      // analyze prompt must never be mis-read as a create request, and vice versa.
      if (lastUserMsg?.intentHint === 'analyze') intent = 'converse'
      else if (lastUserMsg?.intentHint === 'create') intent = 'create_items'

      // Reliable structured action path
      // For creation intents, generate the action through the structured generator
      // (tool-calling / JSON-schema / JSON-mode), which forces valid, schema-shaped
      // output even on tiny local models, then deterministically enriches it with
      // tags + colors. Falls back to the streaming path below on any failure, so
      // this can only improve reliability, never regress it.
      const structuredKind = structuredKindFor(intent)

      if (structuredKind) {
        setWaitingLabel(waitingLabelFor(structuredKind))
        const instruction = buildStructuredInstruction(structuredKind, wantsColumns(lastUserContent))

        const structuredMessages = [...apiMessages, { role: 'system' as const, content: instruction }]
        try {
          const result = await aiApi.generateStructured({
            kind: structuredKind,
            model: selectedModel,
            messages: structuredMessages,
            temperature
          })

          // Respect an in-flight user abort. Don't post or fall back.
          if (isAbortedRef.current) {
            isAbortedRef.current = false
            setStreamingText('')
            streamRef.current.reset()
            streamingChatIdRef.current = null
            hasReceivedFirstChunkRef.current = false
            setIsWaitingForFirstChunk(false)
            setIsStreaming(false)
            return
          }

          if (result.ok && result.data) {
            const content = buildAssistantMessage(structuredKind, result.data)
            if (content) {
              if (streamingChatIdRef.current === currentChatIdRef.current) {
                setMessages(prev => {
                  const updated = [...prev, { role: 'assistant' as const, content, timestamp: Date.now() }]
                  setTimeout(() => consolidateRef.current(updated), 100)
                  return updated
                })
              }
              setStreamingText('')
              streamRef.current.reset()
              streamingChatIdRef.current = null
              hasReceivedFirstChunkRef.current = false
              setIsWaitingForFirstChunk(false)
              setIsStreaming(false)
              return
            }
          }
          console.warn('Structured generation unusable, falling back to streaming:', result.error)
        } catch (structErr) {
          console.warn('Structured generation threw, falling back to streaming:', structErr)
        }
      }

      // Inject model-tuned reasoning instructions
      const reasoningInstruction = buildReasoningInstruction(modelLower, isSmallModel)

      apiMessages.push({ role: 'system', content: reasoningInstruction })

      const enforcementContent = buildEnforcement(intent)

      apiMessages.push({ role: 'system', content: enforcementContent })

      const params = {
        model: selectedModel,
        messages: apiMessages,
        temperature,
        maxTokens
      }
      await aiApi.startStream(params, ASSISTANT_STREAM_ID)
    } catch (err) {
      setIsStreaming(false)
      setMessages(prev => [...prev, { role: 'assistant', content: `**Failed to initiate stream:** ${errorMessage(err)}` }])
    }
  }

  const handleSubmit = (options?: { mode?: string; cheatsheets?: string[]; notes?: string[]; files?: string[]; images?: string[] }) =>
    handleSubmitWithText(undefined, options)

  const handleAbort = async () => {
    try {
      isAbortedRef.current = true
      await aiApi.abortStream(ASSISTANT_STREAM_ID)
      await aiApi.abortStructured().catch(() => {})
      const partialText = streamRef.current.flush().trim()
      if (partialText) {
        setMessages(prev => [...prev, { role: 'assistant', content: partialText + '\n\n*(Generation stopped)*', timestamp: Date.now() }])
      }
      setStreamingText('')
      streamRef.current.reset()
      streamingChatIdRef.current = null
      hasReceivedFirstChunkRef.current = false
      setIsWaitingForFirstChunk(false)
      setIsStreaming(false)
      // CRITICAL FIX: Reset abort flag so subsequent streams work correctly.
      // The backend silently swallows AbortErrors and never fires onDone/onError,
      // so isAbortedRef would otherwise stay true forever, dropping all future chunks.
      isAbortedRef.current = false
    } catch (err) {
      console.error('Failed to abort stream:', err)
      isAbortedRef.current = false
      setIsWaitingForFirstChunk(false)
      setIsStreaming(false)
    }
  }

  // Esc anywhere stops an in-flight generation. The input is disabled while
  // streaming, so a keyboard-only user otherwise has no way to abort. The abort
  // is reached through a ref so the listener is not removed and added again on
  // every render of a streaming reply.
  const abortRef = useRef(handleAbort)
  abortRef.current = handleAbort
  useEffect(() => {
    if (!isStreaming) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        abortRef.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isStreaming])

  return {
    handleSelectSkill,
    revertAICreatedEntities,
    handleRevert,
    handleRewrite,
    handleResend,
    handleSubmitWithText,
    handleSubmit,
    handleAbort
  }
}

export type AiSend = ReturnType<typeof useAiSend>
