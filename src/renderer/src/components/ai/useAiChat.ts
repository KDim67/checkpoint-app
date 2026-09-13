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

export function useAiChat() {
  const selectedItemId = useAppStore(s => s.selectedItemId)
  const selectItem = useAppStore(s => s.selectItem)
  const activeWorkspace = useAppStore(s => s.activeWorkspace)
  const availableWorkspaces = useAppStore(s => s.availableWorkspaces)
  const setWorkspace = useAppStore(s => s.setWorkspace)
  const { toast } = useToast()

  const [messages, setMessages] = useState<Message[]>([])
  const [inputValue, setInputValue] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamingText, setStreamingText] = useState('')

  const [contextItem, setContextItem] = useState<Item | null>(null)

  const modelConfig = useModelConfig()
  const {
    selectedModel, localModels, temperature, setTemperature, maxTokens, setMaxTokens,
    providers, activeProviderId, showCookbookModal, showCustomModelPrompt, handleSwitchProvider,
    handleModelChange
  } = modelConfig
  const { caps: modelCaps, budget: modelBudget, refresh: refreshModelCaps } = useModelCapabilities(selectedModel)
  // mirrored into a ref: the long async submit must read caps at send time
  const [reportedPromptTokens, setReportedPromptTokens] = useState<number | null>(null)
  const modelCapsRef = useRef(modelCaps)
  useEffect(() => {
    modelCapsRef.current = modelCaps
    setReportedPromptTokens(null)
  }, [modelCaps])

  const chatHistory = useSavedChats(messages)
  // only what the panel still touches, the drawer gets the rest via the object
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
    // so cards and columns can be re-created in a fresh chat
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

  const streamRef = useRef(createStreamBuffer(text => setStreamingText(text)))
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const currentChatIdRef = useRef(currentChatId)
  const streamingChatIdRef = useRef<string | null>(null)
  const isAbortedRef = useRef(false)
  const hasReceivedFirstChunkRef = useRef(false)

  const isAtBottomRef = useRef(true)
  const prevMessagesLengthRef = useRef(messages.length)

  const [isWaitingForFirstChunk, setIsWaitingForFirstChunk] = useState(false)

  // these belong to the stream, not the vault: written while replies arrive, read by the header
  const [recalledMemCount, setRecalledMemCount] = useState(0)
  const [waitingLabel, setWaitingLabel] = useState('Thinking…')
  const consolidationTurnRef = useRef(0) // consolidate every N turns to save API calls
  const auditTurnRef = useRef(0)
  /** listeners register once, so they reach the latest consolidation pass through this */
  const consolidateRef = useRef<(messages: Message[]) => Promise<void>>(async () => {})

  const vault = useMemoryVault({ activeWorkspace, selectedModel, toast })
  // only what the stream and header touch
  const {
    showMemoryPanel, setShowMemoryPanel,
    setMemories,
    setMemoryConsolidating,
    handleOpenMemoryPanel
  } = vault

  const [showSettingsPanel, setShowSettingsPanel] = useState(false)
  const [systemPromptOverride, setSystemPromptOverride] = useState('')

  const [activeSkillId, setActiveSkillId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY_ACTIVE_SKILL) || null
    } catch {
      return null
    }
  })

  const { workspaceFolder, workspaceFiles, workspaceIndexing, handleImportWorkspace, handleClearWorkspace } = useWorkspaceFolder()

  const quickActions = useCustomActions()
  const { customActions, showCustomActionsModal, setShowCustomActionsModal } = quickActions

  const [copiedMsgIndex, setCopiedMsgIndex] = useState<number | null>(null)

  useEffect(() => {
    currentChatIdRef.current = currentChatId
  }, [currentChatId])

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

  const scrollToBottom = useCallback((force = false) => {
    if (scrollContainerRef.current && (isAtBottomRef.current || force)) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight
    }
  }, [])

  // mirrors isAtBottomRef in state
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
