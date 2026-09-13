import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useAppStore } from '../../store/appStore'
import type { Item } from '../../../../shared/types'
import { clearActionCaches } from './actions/shared'
import { useToast } from '../ui/Toast'
import { useModelCapabilities } from '../../lib/useModelCapabilities'
import type { Message, SavedChat } from './types'
import { useMemoryVault } from './useMemoryVault'
import { useSavedChats } from './useSavedChats'
import { useCustomActions } from './useCustomActions'
import { useWorkspaceFolder } from './useWorkspaceFolder'
import { useModelConfig } from './useModelConfig'
import { searchItems } from '../../data/items'
import { createStreamBuffer } from '../../lib/streamBuffer'
import * as aiApi from '../../data/ai'
import { ASSISTANT_STREAM_ID, STORAGE_KEY_ACTIVE_SKILL } from './panelConstants'

/**
 * The conversation and what surrounds it: messages, the saved chats, the model,
 * memory, skills, the project folder, quick actions and the scroll position.
 */
export function useAiChat() {
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
    setIsStreaming,
    streamingText,
    setStreamingText,
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
    modelBudget,
    refreshModelCaps,
    reportedPromptTokens,
    setReportedPromptTokens,
    modelCapsRef,
    chatHistory,
    savedChats,
    currentChatId,
    showSavedChatsModal,
    setShowSavedChatsModal,
    setChatSearchQuery,
    revertConfirmData,
    setRevertConfirmData,
    handleNewChat,
    handleLoadChat,
    handleDeleteChat,
    streamRef,
    scrollContainerRef,
    currentChatIdRef,
    streamingChatIdRef,
    isAbortedRef,
    hasReceivedFirstChunkRef,
    isAtBottomRef,
    isWaitingForFirstChunk,
    setIsWaitingForFirstChunk,
    recalledMemCount,
    setRecalledMemCount,
    waitingLabel,
    setWaitingLabel,
    consolidationTurnRef,
    auditTurnRef,
    consolidateRef,
    vault,
    showMemoryPanel,
    setShowMemoryPanel,
    setMemories,
    setMemoryConsolidating,
    handleOpenMemoryPanel,
    showSettingsPanel,
    setShowSettingsPanel,
    systemPromptOverride,
    setSystemPromptOverride,
    activeSkillId,
    setActiveSkillId,
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
    setCopiedMsgIndex,
    scrollToBottom,
    showJumpToLatest,
    setShowJumpToLatest,
    handleScroll
  }
}

export type AiChat = ReturnType<typeof useAiChat>
