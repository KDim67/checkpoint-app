import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useAppStore } from '../../store/appStore'
import type { Item } from '../../../../shared/types'
import { clearActionCaches } from './actions/shared'
import { getSkillById } from './skills'
import { buildAssistantMessage } from './boardEnrich'
import { useToast } from '../ui/Toast'
import { loadBoardConfig, patchBoardConfig } from '../../lib/boardConfig'
import { useModelCapabilities } from '../../lib/useModelCapabilities'
import { TIER_BUDGETS } from '../../../../shared/modelCapabilities'
import type { Message, SavedChat } from './types'
import { classifyIntent, estimateTokens, getAIEntitiesFromMessage, parseThinkingAndContent, pruneHistory, wantsColumns } from './aiHelpers'
import { loadSamplesPromptBlock } from '../../lib/emailSamples'
import { buildBasePrompt, buildBoardState, buildDateBlock, buildEnforcement, buildMemoryBlock, buildReasoningInstruction, buildStructuredInstruction, buildWorkspaceIndex, historyBudgetFor, resolveSkillId, structuredKindFor, waitingLabelFor } from './promptAssembly'
import { gatherAttachmentMessages } from './attachmentContext'
import { useMemoryVault } from './useMemoryVault'
import { useSavedChats } from './useSavedChats'
import { useCustomActions } from './useCustomActions'
import { useWorkspaceFolder } from './useWorkspaceFolder'
import { useModelConfig } from './useModelConfig'
import { errorMessage } from '../../../../shared/errors'
import { COPIED_FEEDBACK_MS } from '../../lib/timings'
import { getStringSetting } from '../../lib/settings'
import { bulkDeleteItems, readItems, searchItems } from '../../data/items'
import { createStreamBuffer } from '../../lib/streamBuffer'
import * as aiApi from '../../data/ai'
import * as memoryApi from '../../data/memory'

const STORAGE_KEY_ACTIVE_SKILL = 'checkpoint_ai_active_skill'

// Dedicated stream channel. Keeps this panel's stream isolated from other
// consumers (e.g. the Standup Translator) so both can run concurrently.
const ASSISTANT_STREAM_ID = 'assistant'

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
 * The assistant panel apart from drawing it: the conversation, the stream, the
 * board edits a reply makes, and the hooks for chats, actions, models and memory.
 * The header, the history and the input take its return as one prop.
 */
export function useAiStreamPanel() {
  const selectedItemId = useAppStore(s => s.selectedItemId)
  const selectItem = useAppStore(s => s.selectItem)
  const activeWorkspace = useAppStore(s => s.activeWorkspace)
  const availableWorkspaces = useAppStore(s => s.availableWorkspaces)
  const setWorkspace = useAppStore(s => s.setWorkspace)
  const { toast } = useToast()

  // Chat message history
  const [messages, setMessages] = useState<Message[]>([])
  const [inputValue, setInputValue] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamingText, setStreamingText] = useState('')

  // Context pre-seeding
  const [contextItem, setContextItem] = useState<Item | null>(null)

  // Configuration settings loaded from DB
  const modelConfig = useModelConfig()
  const {
    selectedModel, localModels, temperature, setTemperature, maxTokens, setMaxTokens,
    providers, activeProviderId, showCookbookModal, showCustomModelPrompt, handleSwitchProvider,
    handleModelChange
  } = modelConfig
  const { caps: modelCaps, budget: modelBudget, refresh: refreshModelCaps } = useModelCapabilities(selectedModel)
  // Mirrored into a ref because the submit path is a long async function; it
  // must read the capabilities current at send time, not at closure creation.
  const [reportedPromptTokens, setReportedPromptTokens] = useState<number | null>(null)
  const modelCapsRef = useRef(modelCaps)
  useEffect(() => {
    modelCapsRef.current = modelCaps
    setReportedPromptTokens(null)
  }, [modelCaps])

  // Saved Chats State
  const chatHistory = useSavedChats(messages)
  // Only what the panel still touches; the rest reaches the drawer through the
  // object itself.
  const { savedChats, currentChatId, setCurrentChatId, showSavedChatsModal, setShowSavedChatsModal, setChatSearchQuery, removeChat } = chatHistory
  const [revertConfirmData, setRevertConfirmData] = useState<{ cardTitles: string[]; columnNames: string[]; index: number } | null>(null)

  const handleNewChat = () => {
    if (isStreaming) {
      aiApi.abortStream(ASSISTANT_STREAM_ID).catch(() => {})
    }
    setMessages([])
    setStreamingText('')
    streamRef.current.reset()
    setIsStreaming(false)
    streamingChatIdRef.current = null
    hasReceivedFirstChunkRef.current = false
    isAbortedRef.current = false
    setIsWaitingForFirstChunk(false)
    setRecalledMemCount(0)
    setCurrentChatId(`chat_${Date.now()}`)
    setShowSavedChatsModal(false)
    // Clear action caches so cards/columns can be re-created in a fresh chat
    clearActionCaches()
  }

  const handleLoadChat = (chat: SavedChat) => {
    if (isStreaming) {
      aiApi.abortStream(ASSISTANT_STREAM_ID).catch(() => {})
    }
    setMessages(chat.messages)
    setStreamingText('')
    streamRef.current.reset()
    setIsStreaming(false)
    streamingChatIdRef.current = null
    setCurrentChatId(chat.id)
    setShowSavedChatsModal(false)
  }

  const handleDeleteChat = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    removeChat(id)
    if (id === currentChatId) {
      handleNewChat()
    }
  }

  // Buffering and throttling references
  const streamRef = useRef(createStreamBuffer(text => setStreamingText(text)))
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const currentChatIdRef = useRef(currentChatId)
  const streamingChatIdRef = useRef<string | null>(null)
  const isAbortedRef = useRef(false)
  const hasReceivedFirstChunkRef = useRef(false)

  // Scroll tracking references
  const isAtBottomRef = useRef(true)
  const prevMessagesLengthRef = useRef(messages.length)

  // Waiting-for-first-chunk indicator
  const [isWaitingForFirstChunk, setIsWaitingForFirstChunk] = useState(false)

  // Recall count and waiting label belong to the stream, not the vault: they are
  // written while a response arrives and read by the header, whether or not the
  // vault has ever been opened.
  const [recalledMemCount, setRecalledMemCount] = useState(0)
  const [waitingLabel, setWaitingLabel] = useState('Thinking…')
  const consolidationTurnRef = useRef(0) // Only consolidate every N turns to save API calls
  const auditTurnRef = useRef(0)
  /**
   * The stream listeners are registered once, so they reach the consolidation
   * pass through this. It always holds the one from the latest render, and with
   * it the current workspace, model and memory vault.
   */
  const consolidateRef = useRef<(messages: Message[]) => Promise<void>>(async () => {})

  const vault = useMemoryVault({ activeWorkspace, selectedModel, toast })
  // Only what the stream and header still touch; the rest reaches the modal
  // through the vault object itself.
  const {
    showMemoryPanel, setShowMemoryPanel,
    setMemories,
    setMemoryConsolidating,
    handleOpenMemoryPanel
  } = vault

  // Settings panel
  const [showSettingsPanel, setShowSettingsPanel] = useState(false)
  const [systemPromptOverride, setSystemPromptOverride] = useState('')

  // Specialized Skill Workflows
  const [activeSkillId, setActiveSkillId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY_ACTIVE_SKILL) || null
    } catch {
      return null
    }
  })

  // Workspace Folder Import & Codebase Indexing
  const { workspaceFolder, workspaceFiles, workspaceIndexing, handleImportWorkspace, handleClearWorkspace } = useWorkspaceFolder()

  // Custom quick actions (user-defined prompt library)
  const quickActions = useCustomActions()
  const { customActions, showCustomActionsModal, setShowCustomActionsModal } = quickActions

  // Copy toast
  const [copiedMsgIndex, setCopiedMsgIndex] = useState<number | null>(null)

  useEffect(() => {
    currentChatIdRef.current = currentChatId
  }, [currentChatId])

  // 1. Fetch Context Item details when selectedItemId changes
  useEffect(() => {
    if (!selectedItemId) {
      setContextItem(null)
      return
    }

    const loadContextDetails = async () => {
      try {
        const res = await searchItems({
          query: selectedItemId,
          context: activeWorkspace
        })
        const found = res.items.find(i => i.id === selectedItemId)
        if (found) {
          setContextItem(found)
        }
      } catch (err) {
        console.error('Failed to load pre-seeded AI context item:', err)
      }
    }
    loadContextDetails()
  }, [selectedItemId, activeWorkspace])

  // Auto-scroll to bottom of messages container
  const scrollToBottom = useCallback((force = false) => {
    if (scrollContainerRef.current && (isAtBottomRef.current || force)) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight
    }
  }, [])

  // Floating "jump to latest" affordance while scrolled up (mirrors isAtBottomRef in state)
  const [showJumpToLatest, setShowJumpToLatest] = useState(false)

  const handleScroll = () => {
    if (!scrollContainerRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current
    const atBottom = scrollHeight - scrollTop - clientHeight < 40
    isAtBottomRef.current = atBottom
    setShowJumpToLatest(!atBottom)
  }

  useEffect(() => {
    const messageAdded = messages.length > prevMessagesLengthRef.current
    prevMessagesLengthRef.current = messages.length
    scrollToBottom(messageAdded)
  }, [messages, streamingText, scrollToBottom])

  // Esc anywhere stops an in-flight generation. The input is disabled while
  // streaming, so a keyboard-only user otherwise has no way to abort.
  useEffect(() => {
    if (!isStreaming) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        handleAbort()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isStreaming])

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
  }, [])

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
  }, [activeWorkspace, selectedModel, showMemoryPanel, setMemories, setMemoryConsolidating])
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
    selectItem,
    activeWorkspace,
    availableWorkspaces,
    setWorkspace,
    messages,
    setMessages,
    inputValue,
    setInputValue,
    isStreaming,
    streamingText,
    contextItem,
    setContextItem,
    modelConfig,
    selectedModel,
    localModels,
    temperature,
    setTemperature,
    maxTokens,
    setMaxTokens,
    providers,
    activeProviderId,
    showCookbookModal,
    showCustomModelPrompt,
    handleSwitchProvider,
    handleModelChange,
    modelCaps,
    refreshModelCaps,
    chatHistory,
    showSavedChatsModal,
    setShowSavedChatsModal,
    setChatSearchQuery,
    revertConfirmData,
    setRevertConfirmData,
    handleNewChat,
    handleLoadChat,
    handleDeleteChat,
    scrollContainerRef,
    isAtBottomRef,
    isWaitingForFirstChunk,
    recalledMemCount,
    waitingLabel,
    vault,
    showMemoryPanel,
    setShowMemoryPanel,
    handleOpenMemoryPanel,
    showSettingsPanel,
    setShowSettingsPanel,
    systemPromptOverride,
    setSystemPromptOverride,
    activeSkillId,
    workspaceFolder,
    workspaceFiles,
    workspaceIndexing,
    handleImportWorkspace,
    handleClearWorkspace,
    quickActions,
    customActions,
    showCustomActionsModal,
    setShowCustomActionsModal,
    copiedMsgIndex,
    scrollToBottom,
    showJumpToLatest,
    setShowJumpToLatest,
    handleScroll,
    handleSelectSkill,
    revertAICreatedEntities,
    handleRevert,
    handleRewrite,
    handleResend,
    handleSubmitWithText,
    handleSubmit,
    handleAbort,
    handleExportChat,
    handleCopyMessage,
    tokenUsage
  }
}

export type AiStreamPanelState = ReturnType<typeof useAiStreamPanel>
