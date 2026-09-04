import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Sparkles, X, RefreshCw, MessageSquare, Plus, Brain, Sliders, FileDown, FolderOpen, Gauge, ArrowDown } from 'lucide-react'
import { useAppStore } from '../store/appStore'
import type { Item } from '../../../shared/types'
import ContextPill from './ai/ContextPill'
import ChatMessage, { clearActionCaches } from './ai/ChatMessage'
import ChatInput from './ai/ChatInput'
import { AI_SKILLS, getSkillById } from './ai/skills'
import { buildAssistantMessage } from './ai/boardEnrich'
import { loadProviders, persistProviders, activateProvider, isLocalUrl, type AiProvider } from './ai/aiProviders'
import { useToast } from './ui/Toast'
import { loadBoardConfig, patchBoardConfig } from '../lib/boardConfig'
import { useModelCapabilities } from '../lib/useModelCapabilities'
import ModelCapabilityBar from './ai/ModelCapabilityBar'
import { TIER_BUDGETS } from '../../../shared/modelCapabilities'
import type { CustomAction, Message, SavedChat, WorkspaceFileInfo } from './ai/types'
import {
  classifyIntent,
  detectSkill,
  estimateTokens,
  getAIEntitiesFromMessage,
  parseThinkingAndContent,
  pruneHistory,
  supportsVision,
  wantsColumns
} from './ai/aiHelpers'
import { loadSamplesPromptBlock } from '../lib/emailSamples'
import {
  buildBasePrompt,
  buildBoardState,
  buildDateBlock,
  buildEnforcement,
  buildMemoryBlock,
  buildReasoningInstruction,
  buildStructuredInstruction,
  buildWorkspaceIndex,
  historyBudgetFor,
  resolveSkillId,
  structuredKindFor,
  waitingLabelFor
} from './ai/promptAssembly'
import { gatherAttachmentMessages } from './ai/attachmentContext'
import { useMemoryVault } from './ai/useMemoryVault'
import MemoryVaultModal from './ai/MemoryVaultModal'
import CustomActionsModal from './ai/CustomActionsModal'
import SavedChatsModal from './ai/SavedChatsModal'
import SettingsPanel from './ai/SettingsPanel'
import CookbookModal from './ai/CookbookModal'
import RevertConfirmModal from './ai/RevertConfirmModal'
import CustomModelPromptModal from './ai/CustomModelPromptModal'
import { errorMessage } from '../../../shared/errors'

const STORAGE_KEY_SAVED_CHATS = 'checkpoint_ai_saved_chats'
const STORAGE_KEY_ACTIVE_SKILL = 'checkpoint_ai_active_skill'
const STORAGE_KEY_WORKSPACE_FOLDER = 'checkpoint_ai_workspace_folder'

// Dedicated stream channel. Keeps this panel's stream isolated from other
// consumers (e.g. the Standup Translator) so both can run concurrently.
const ASSISTANT_STREAM_ID = 'assistant'

export default function AiStreamPanel() {
  const selectedItemId = useAppStore(s => s.selectedItemId)
  const selectItem = useAppStore(s => s.selectItem)
  const activeContext = useAppStore(s => s.activeContext)
  const availableContexts = useAppStore(s => s.availableContexts)
  const setContext = useAppStore(s => s.setContext)
  const { toast } = useToast()

  // Chat message history
  const [messages, setMessages] = useState<Message[]>([])
  const [inputValue, setInputValue] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamingText, setStreamingText] = useState('')

  // Context pre-seeding
  const [contextItem, setContextItem] = useState<Item | null>(null)

  // Configuration settings loaded from DB
  const [selectedModel, setSelectedModel] = useState('llama3')
  const { caps: modelCaps, budget: modelBudget, refresh: refreshModelCaps } = useModelCapabilities(selectedModel)
  // Mirrored into a ref because the submit path is a long async function; it
  // must read the capabilities current at send time, not at closure creation.
  const [reportedPromptTokens, setReportedPromptTokens] = useState<number | null>(null)
  const modelCapsRef = useRef(modelCaps)
  useEffect(() => {
    modelCapsRef.current = modelCaps
    setReportedPromptTokens(null)
  }, [modelCaps])
  const [localModels, setLocalModels] = useState<string[]>([])
  const [temperature, setTemperature] = useState(0.7)
  const [maxTokens, setMaxTokens] = useState(2048)
  const [providers, setProviders] = useState<AiProvider[]>([])
  const [activeProviderId, setActiveProviderId] = useState<string>('')
  const [showCookbookModal, setShowCookbookModal] = useState(false)
  const [showCustomModelPrompt, setShowCustomModelPrompt] = useState(false)
  const [customModelInput, setCustomModelInput] = useState('')
  const [pullingTag, setPullingTag] = useState<string | null>(null)
  const [pullProgress, setPullProgress] = useState<number>(0)

  // Saved Chats State
  const [savedChats, setSavedChats] = useState<SavedChat[]>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY_SAVED_CHATS)
      return stored ? JSON.parse(stored) : []
    } catch {
      return []
    }
  })
  const [currentChatId, setCurrentChatId] = useState<string>(() => `chat_${Date.now()}`)
  const [showSavedChatsModal, setShowSavedChatsModal] = useState(false)
  const [chatSearchQuery, setChatSearchQuery] = useState('')
  const [revertConfirmData, setRevertConfirmData] = useState<{ cardTitles: string[]; columnNames: string[]; index: number } | null>(null)
  const [editingChatId, setEditingChatId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState('')

  // Sync active messages into saved chats list (limit 50)
  useEffect(() => {
    if (messages.length === 0) return
    setSavedChats(prev => {
      const existingIdx = prev.findIndex(c => c.id === currentChatId)
      const firstUserMsg = messages.find(m => m.role === 'user')?.content || 'New Conversation'
      const defaultTitle = firstUserMsg.length > 28 ? firstUserMsg.slice(0, 28) + '...' : firstUserMsg

      let updated: SavedChat[]
      if (existingIdx >= 0) {
        updated = [...prev]
        updated[existingIdx] = {
          ...updated[existingIdx],
          messages,
          title: updated[existingIdx].title || defaultTitle
        }
      } else {
        const newChat: SavedChat = {
          id: currentChatId,
          title: defaultTitle,
          createdAt: Date.now(),
          messages
        }
        updated = [newChat, ...prev]
      }

      const capped = updated.slice(0, 50)
      try {
        localStorage.setItem(STORAGE_KEY_SAVED_CHATS, JSON.stringify(capped))
      } catch (e) {
        console.warn('Failed to persist saved chats:', e)
      }
      return capped
    })
  }, [messages, currentChatId])

  const handleNewChat = () => {
    if (isStreaming) {
      window.electronAPI.ai.abortStream(ASSISTANT_STREAM_ID).catch(() => {})
    }
    setMessages([])
    setStreamingText('')
    chunkBufferRef.current = ''
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
      window.electronAPI.ai.abortStream(ASSISTANT_STREAM_ID).catch(() => {})
    }
    setMessages(chat.messages)
    setStreamingText('')
    chunkBufferRef.current = ''
    setIsStreaming(false)
    streamingChatIdRef.current = null
    setCurrentChatId(chat.id)
    setShowSavedChatsModal(false)
  }

  const handleDeleteChat = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const updated = savedChats.filter(c => c.id !== id)
    setSavedChats(updated)
    try {
      localStorage.setItem(STORAGE_KEY_SAVED_CHATS, JSON.stringify(updated))
    } catch {}
    if (id === currentChatId) {
      handleNewChat()
    }
  }

  const handleSaveRename = (id: string) => {
    if (!editingTitle.trim()) {
      setEditingChatId(null)
      return
    }
    const updated = savedChats.map(c => c.id === id ? { ...c, title: editingTitle.trim() } : c)
    setSavedChats(updated)
    try {
      localStorage.setItem(STORAGE_KEY_SAVED_CHATS, JSON.stringify(updated))
    } catch {}
    setEditingChatId(null)
  }

  // Buffering and throttling references
  const chunkBufferRef = useRef('')
  const animationFrameRef = useRef<number | null>(null)
  const lastUpdateRef = useRef(0)
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

  const vault = useMemoryVault({ activeContext, selectedModel, toast })
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
  const [workspaceFolder, setWorkspaceFolder] = useState<string | null>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY_WORKSPACE_FOLDER) || null
    } catch {
      return null
    }
  })
  const [workspaceFiles, setWorkspaceFiles] = useState<WorkspaceFileInfo[]>([])
  const [workspaceIndexing, setWorkspaceIndexing] = useState(false)

  // Custom quick actions (user-defined prompt library)
  const [customActions, setCustomActions] = useState<CustomAction[]>([])
  const [showCustomActionsModal, setShowCustomActionsModal] = useState(false)
  const [caLabel, setCaLabel] = useState('')
  const [caPrompt, setCaPrompt] = useState('')
  const [caIntent, setCaIntent] = useState<'create' | 'analyze'>('analyze')

  useEffect(() => {
    window.electronAPI.db.getSetting('ai_custom_actions').then(raw => {
      if (typeof raw !== 'string' || !raw) return
      try {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed)) {
          setCustomActions(parsed.filter(a => a && a.id && a.label && a.prompt))
        }
      } catch { /* corrupted setting. Start fresh */ }
    }).catch(() => {})
  }, [])

  const persistCustomActions = (list: CustomAction[]): void => {
    setCustomActions(list)
    window.electronAPI.db.setSetting('ai_custom_actions', JSON.stringify(list)).catch(() => {})
  }

  const handleAddCustomAction = (): void => {
    if (!caLabel.trim() || !caPrompt.trim()) return
    persistCustomActions([
      ...customActions,
      { id: `ca_${Date.now()}`, label: caLabel.trim().slice(0, 40), prompt: caPrompt.trim(), intent: caIntent }
    ])
    setCaLabel('')
    setCaPrompt('')
    setCaIntent('analyze')
  }

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
        const res = await window.electronAPI.db.searchItems({
          query: selectedItemId,
          context: activeContext
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
  }, [selectedItemId, activeContext])

  // 2. Load provider profiles + models. Provider-aware: the model list and the
  //    Ollama dropdown only apply to LOCAL endpoints; cloud providers use the
  //    profile's typed model. Re-runs whenever the active provider changes.
  const loadAiConfig = useCallback(async () => {
    try {
      const { providers: provs, activeId } = await loadProviders()
      setProviders(provs)
      setActiveProviderId(activeId)

      const active = provs.find(p => p.id === activeId)
      const baseUrl = active?.baseURL || ''
      const savedModel = active?.model || ''
      const isLocalEndpoint = isLocalUrl(baseUrl)

      if (savedModel) setSelectedModel(savedModel)

      const dbTemp = await window.electronAPI.db.getSetting('ai_temperature')
      const dbMaxTokens = await window.electronAPI.db.getSetting('ai_max_tokens')
      if (dbTemp !== null) setTemperature(Number(dbTemp))
      if (dbMaxTokens !== null) setMaxTokens(Number(dbMaxTokens))

      if (isLocalEndpoint) {
        // Local endpoint: the model MUST be one Ollama actually has installed.
        const list = await window.electronAPI.ollama.listLocal().catch(() => [] as string[])
        if (list && list.length > 0) {
          setLocalModels(list)
          // Auto-heal the "default model not installed → 404" trap.
          const savedInstalled = savedModel && list.includes(savedModel)
          if (!savedModel || !savedInstalled) {
            setSelectedModel(list[0])
            const next = provs.map(p => (p.id === activeId ? { ...p, model: list[0] } : p))
            setProviders(next)
            await persistProviders(next, activeId)
          }
        } else {
          setLocalModels([])
        }
      } else {
        // Cloud provider: use the profile's typed model, no Ollama dropdown.
        setLocalModels([])
      }
    } catch (err) {
      console.warn('Failed to load AI config:', err)
    }
  }, [])

  useEffect(() => {
    loadAiConfig()
    const handler = (): void => { loadAiConfig() }
    window.addEventListener('checkpoint-ai-provider-changed', handler)
    return () => window.removeEventListener('checkpoint-ai-provider-changed', handler)
  }, [loadAiConfig])

  const handleSwitchProvider = useCallback(async (id: string) => {
    setActiveProviderId(id)
    await activateProvider(providers, id)
    await loadAiConfig()
  }, [providers, loadAiConfig])

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
  }, [messages, streamingText])

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStreaming])

  // 4. Mount IPC Streaming Listeners with cleanups to prevent leaks
  useEffect(() => {
    const unsubscribeChunk = window.electronAPI.ai.onChunk((chunk, streamId) => {
      if (streamId && streamId !== ASSISTANT_STREAM_ID) return
      if (isAbortedRef.current) return
      // Ignore chunks if current chat is no longer the streaming chat
      if (streamingChatIdRef.current !== currentChatIdRef.current) return

      // Clear "waiting for first chunk" indicator on first chunk received
      if (!hasReceivedFirstChunkRef.current) {
        hasReceivedFirstChunkRef.current = true
        setIsWaitingForFirstChunk(false)
      }

      chunkBufferRef.current += chunk

      const now = Date.now()
      if (now - lastUpdateRef.current > 50) {
        lastUpdateRef.current = now
        setStreamingText(chunkBufferRef.current)
      } else if (!animationFrameRef.current) {
        animationFrameRef.current = requestAnimationFrame(() => {
          animationFrameRef.current = null
          setStreamingText(chunkBufferRef.current)
        })
      }
    })

    const unsubscribeDone = window.electronAPI.ai.onDone((streamId, usage) => {
      if (streamId && streamId !== ASSISTANT_STREAM_ID) return
      // Endpoints honouring stream_options report what the prompt actually
      // cost; that replaces the estimate until the next turn changes it.
      if (usage?.promptTokens) setReportedPromptTokens(usage.promptTokens)
      if (isAbortedRef.current) {
        isAbortedRef.current = false
        return
      }
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
        animationFrameRef.current = null
      }
      const finalAssistantResponse = chunkBufferRef.current

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
          setTimeout(() => triggerMemoryConsolidation(updated), 100)
          return updated
        })
        setStreamingText('')
      }
      chunkBufferRef.current = ''
      streamingChatIdRef.current = null
      hasReceivedFirstChunkRef.current = false
      setIsWaitingForFirstChunk(false)
      setIsStreaming(false)
    })

    const unsubscribeError = window.electronAPI.ai.onError((errMessage, streamId) => {
      if (streamId && streamId !== ASSISTANT_STREAM_ID) return
      if (isAbortedRef.current) {
        isAbortedRef.current = false
        return
      }
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
        animationFrameRef.current = null
      }
      const errText = `\n\n**Error:** ${errMessage}`
      const finalAssistantResponse = chunkBufferRef.current + errText
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
      chunkBufferRef.current = ''
      streamingChatIdRef.current = null
      hasReceivedFirstChunkRef.current = false
      setIsWaitingForFirstChunk(false)
      setIsStreaming(false)
    })

    return () => {
      unsubscribeChunk()
      unsubscribeDone()
      unsubscribeError()
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
    }
  }, [])

  // 2b. Re-index a previously selected workspace folder on mount
  useEffect(() => {
    if (!workspaceFolder) return
    let cancelled = false
    setWorkspaceIndexing(true)
    window.electronAPI.workspace.getStructure(workspaceFolder)
      .then(files => { if (!cancelled) setWorkspaceFiles(files || []) })
      .catch(err => console.warn('Failed to re-index workspace folder:', err))
      .finally(() => { if (!cancelled) setWorkspaceIndexing(false) })
    return () => { cancelled = true }
  }, [])

  const handleImportWorkspace = async () => {
    try {
      const folder = await window.electronAPI.workspace.selectFolder()
      if (!folder) return
      setWorkspaceIndexing(true)
      setWorkspaceFolder(folder)
      try { localStorage.setItem(STORAGE_KEY_WORKSPACE_FOLDER, folder) } catch {}
      const files = await window.electronAPI.workspace.getStructure(folder)
      setWorkspaceFiles(files || [])
    } catch (err) {
      console.warn('Failed to import workspace folder:', err)
    } finally {
      setWorkspaceIndexing(false)
    }
  }

  const handleClearWorkspace = () => {
    setWorkspaceFolder(null)
    setWorkspaceFiles([])
    try { localStorage.removeItem(STORAGE_KEY_WORKSPACE_FOLDER) } catch {}
  }

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

  // Set the model and keep the active provider profile (the source of truth) in sync.
  const applyModel = useCallback(async (val: string) => {
    setSelectedModel(val)
    await window.electronAPI.db.setSetting('ai_model', val)
    setProviders(prev => {
      if (!activeProviderId) return prev
      const next = prev.map(p => (p.id === activeProviderId ? { ...p, model: val } : p))
      persistProviders(next, activeProviderId)
      return next
    })
  }, [activeProviderId])

  const handleModelChange = async (val: string) => {
    if (val === '__OPEN_COOKBOOK__') {
      setShowCookbookModal(true)
      refreshLocalModels()
      return
    }
    if (val === '__CUSTOM_MODEL__') {
      setCustomModelInput('')
      setShowCustomModelPrompt(true)
      return
    }
    await applyModel(val)
  }

  const refreshLocalModels = async () => {
    try {
      const list = await window.electronAPI.ollama.listLocal()
      if (list && list.length > 0) {
        setLocalModels(list)
      }
    } catch (e) {
      console.warn('Failed to refresh local models:', e)
    }
  }

  const handlePullModel = async (tag: string) => {
    setPullingTag(tag)
    setPullProgress(0)
    const unsub = window.electronAPI.cookbook.onPullProgress(evt => {
      if (evt.percent !== undefined) setPullProgress(evt.percent)
    })
    try {
      await window.electronAPI.cookbook.pullModel(tag)
      await refreshLocalModels()
      await handleModelChange(tag)
    } catch (e) {
      console.error('Failed to pull model:', e)
    } finally {
      unsub()
      setPullingTag(null)
    }
  }

  // Snapshots & Board Reversion
  const revertAICreatedEntities = async (cardTitles: string[], columnNames: string[]) => {
    const validContext = activeContext || 'default'

    // 1. Delete cards/tasks with matching titles in this context
    if (cardTitles.length > 0) {
      const [tasksRes, cardsRes] = await Promise.all([
        window.electronAPI.db.getItems(validContext, 'task', 1, 1000).catch(() => ({ items: [] })),
        window.electronAPI.db.getItems(validContext, 'card', 1, 1000).catch(() => ({ items: [] }))
      ])
      const allItems = [...(tasksRes?.items || []), ...(cardsRes?.items || [])].filter(i => i.status !== 'archived')
      const itemsToDelete = allItems
        .filter(item => cardTitles.includes(item.title.trim()))
        .map(item => item.id)

      if (itemsToDelete.length > 0) {
        await window.electronAPI.db.bulkDeleteItems(itemsToDelete).catch(() => {})
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
  interface SubmitOptions {
    mode?: string
    cheatsheets?: string[]
    notes?: string[]
    files?: string[]
    images?: string[]
    displayContent?: string
    intentHint?: 'create' | 'analyze'
  }
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
    chunkBufferRef.current = ''
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
          const validContext = activeContext || 'default'
          // This list becomes the "VALID COLUMN IDs" the model is told to use,
          // so reading the stale legacy key meant describing a board that no
          // longer existed: columns the user had deleted were still offered,
          // and ones they had added were invisible. loadBoardConfig always
          // returns a non-empty column set, so no defaults fallback is needed.
          const { columns: colsList } = await loadBoardConfig(validContext)

          const [tasksRes, cardsRes] = await Promise.all([
            window.electronAPI.db.getItems(validContext, 'task', 1, 1000).catch(() => ({ items: [] })),
            window.electronAPI.db.getItems(validContext, 'card', 1, 1000).catch(() => ({ items: [] }))
          ])
          const cardOnlyItems = (cardsRes?.items || []).filter(i => i.status !== 'archived')
          const allItems = [...(tasksRes?.items || []), ...cardOnlyItems].filter(i => i.status !== 'archived')

          const liveBoardStateText = buildBoardState(validContext, colsList, cardOnlyItems, allItems)

          systemPrompt.push({
            role: 'system',
            content: liveBoardStateText
          })

          // 2. Semantic Memory Vector Retrieval (runs AFTER board state so memories interpret board context)
          try {
            const memories = await window.electronAPI.memory.searchMemories(text, validContext, memoryRecallLimit).catch(() => [])
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
          const result = await window.electronAPI.ai.generateStructured({
            kind: structuredKind,
            model: selectedModel,
            messages: structuredMessages,
            temperature
          })

          // Respect an in-flight user abort. Don't post or fall back.
          if (isAbortedRef.current) {
            isAbortedRef.current = false
            setStreamingText('')
            chunkBufferRef.current = ''
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
                  setTimeout(() => triggerMemoryConsolidation(updated), 100)
                  return updated
                })
              }
              setStreamingText('')
              chunkBufferRef.current = ''
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
      await window.electronAPI.ai.startStream(params, ASSISTANT_STREAM_ID)
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
      await window.electronAPI.ai.abortStream(ASSISTANT_STREAM_ID)
      await window.electronAPI.ai.abortStructured().catch(() => {})
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
        animationFrameRef.current = null
      }
      const partialText = chunkBufferRef.current.trim()
      if (partialText) {
        setMessages(prev => [...prev, { role: 'assistant', content: partialText + '\n\n*(Generation stopped)*', timestamp: Date.now() }])
      }
      setStreamingText('')
      chunkBufferRef.current = ''
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

      const validContext = activeContext || 'default'
      const userTurn = [...currentMessages].reverse().find(m => m.role === 'user')
      const assistantTurn = [...currentMessages].reverse().find(m => m.role === 'assistant')
      if (!userTurn || !assistantTurn) return

      // Don't consolidate trivially short exchanges
      const combinedLength = (userTurn.content?.length || 0) + (assistantTurn.content?.length || 0)
      if (combinedLength < 200) return

      const dbModel = await window.electronAPI.db.getSetting('ai_model').catch(() => null)
      const model = (dbModel as string) || selectedModel
      if (!model) return

      setMemoryConsolidating(true)

      // Runs entirely in the main process now. See memoryService.consolidateFromExchange.
      // (Constructing the OpenAI client here in the renderer never worked: the SDK refuses
      // to initialize in a browser-like context, which Electron's renderer is, so this used
      // to throw immediately and get swallowed by the catch below. No memories were ever
      // actually being written.)
      const saved = await window.electronAPI.memory.consolidateMemory({
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
        const audited = await window.electronAPI.memory.auditMemories(validContext, model).catch(() => [])
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
  }, [activeContext, selectedModel, showMemoryPanel])

  // Copy message
  const handleCopyMessage = async (content: string, index: number) => {
    try {
      await navigator.clipboard.writeText(content)
      setCopiedMsgIndex(index)
      setTimeout(() => setCopiedMsgIndex(null), 2000)
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

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        width: '100%',
        overflow: 'hidden',
        boxSizing: 'border-box'
      }}
    >
      {/* Selector Header controls */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-2)',
          padding: 'var(--space-2) var(--space-4)',
          borderBottom: '1px solid var(--color-surface-offset)',
          background: 'var(--color-surface-2)',
          flexShrink: 0
        }}
      >
        {/* Row 0: Provider Selection (manage profiles in Settings → AI) */}
        {providers.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', width: '100%' }}>
            <span style={{ fontSize: '10px', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-muted)', textTransform: 'uppercase', flexShrink: 0 }}>
              Provider
            </span>
            <select
              value={activeProviderId}
              onChange={e => handleSwitchProvider(e.target.value)}
              title="Switch AI provider. Add/edit profiles in Settings → AI"
              style={{
                background: 'var(--color-surface-1)', border: '1px solid var(--color-surface-offset)',
                color: 'var(--color-text-base)', borderRadius: 'var(--radius-sm)', padding: '3px 8px',
                fontSize: '11px', outline: 'none', cursor: 'pointer', flex: 1, minWidth: 0
              }}
            >
              {providers.map(p => (
                <option key={p.id} value={p.id}>{p.name}{isLocalUrl(p.baseURL) ? ' (local)' : ' (cloud)'}</option>
              ))}
            </select>
          </div>
        )}

        {/* Row 1: Model Selection */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', width: '100%' }}>
          <span style={{ fontSize: '10px', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-muted)', textTransform: 'uppercase', flexShrink: 0 }}>
            Model
          </span>
          {(() => {
            const dropdownModels = Array.from(new Set([
              ...localModels,
              ...(selectedModel ? [selectedModel] : ['llama3'])
            ]))
            return (
              <select
                value={selectedModel}
                onChange={e => handleModelChange(e.target.value)}
                style={{
                  background: 'var(--color-surface-1)',
                  border: '1px solid var(--color-surface-offset)',
                  color: 'var(--color-text-base)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '3px 8px',
                  fontSize: '11px',
                  outline: 'none',
                  cursor: 'pointer',
                  flex: 1,
                  minWidth: 0
                }}
              >
                {dropdownModels.map(m => (
                  <option key={m} value={m}>{m}{supportsVision(m) ? ' 👁' : ''}</option>
                ))}
                <option value="__CUSTOM_MODEL__">+ Use Custom Model...</option>
                <option value="__OPEN_COOKBOOK__">+ Get More Models (Cookbook)...</option>
              </select>
            )
          })()}
        </div>

        <ModelCapabilityBar caps={modelCaps} onRefresh={refreshModelCaps} />

        {/* Row 1b: Workspace / Context Selection. The board the AI reads & writes */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', width: '100%' }}>
          <span style={{ fontSize: '10px', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-muted)', textTransform: 'uppercase', flexShrink: 0 }}>
            Workspace
          </span>
          <select
            value={activeContext}
            onChange={e => setContext(e.target.value)}
            title="Which workspace/context the assistant reads from and creates items in"
            style={{
              background: 'var(--color-surface-1)', border: '1px solid var(--color-surface-offset)',
              color: 'var(--color-text-base)', borderRadius: 'var(--radius-sm)', padding: '3px 8px',
              fontSize: '11px', outline: 'none', cursor: 'pointer', flex: 1, minWidth: 0
            }}
          >
            {(availableContexts.length > 0 ? availableContexts : ['default']).map(ctx => (
              <option key={ctx} value={ctx}>{ctx}</option>
            ))}
          </select>
        </div>

        {/* Row 2: Action Buttons */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          width: '100%',
          borderTop: '1px dashed var(--color-surface-offset)',
          paddingTop: 'var(--space-1.5)'
        }}>
          <span style={{ fontSize: '10px', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>
            Actions
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <button
              onClick={handleImportWorkspace}
              disabled={workspaceIndexing}
              style={{
                background: workspaceFolder ? 'var(--color-secondary-muted)' : 'transparent',
                border: 'none',
                color: workspaceFolder ? 'var(--color-secondary)' : 'var(--color-text-muted)',
                cursor: workspaceIndexing ? 'default' : 'pointer',
                padding: '4px',
                display: 'flex',
                alignItems: 'center',
                borderRadius: 'var(--radius-sm)'
              }}
              onMouseEnter={e => { if (!workspaceFolder) e.currentTarget.style.color = 'var(--color-secondary)' }}
              onMouseLeave={e => { if (!workspaceFolder) e.currentTarget.style.color = 'var(--color-text-muted)' }}
              title={workspaceFolder ? `Workspace imported: ${workspaceFolder} (${workspaceFiles.length} files). Click to re-import` : 'Import a project folder for codebase context'}
            >
              {workspaceIndexing ? <RefreshCw size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <FolderOpen size={13} />}
            </button>

            <button
              onClick={handleOpenMemoryPanel}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--color-text-muted)',
                cursor: 'pointer',
                padding: '4px',
                display: 'flex',
                alignItems: 'center',
                borderRadius: 'var(--radius-sm)'
              }}
              onMouseEnter={e => (e.currentTarget.style.color = 'var(--color-secondary)')}
              onMouseLeave={e => (e.currentTarget.style.color = 'var(--color-text-muted)')}
              title="View AI Memories"
            >
              <Brain size={13} />
            </button>

            <button
              onClick={handleExportChat}
              disabled={messages.filter(m => m.role !== 'system').length === 0}
              style={{
                background: 'transparent',
                border: 'none',
                color: messages.filter(m => m.role !== 'system').length === 0 ? 'var(--color-text-faint)' : 'var(--color-text-muted)',
                cursor: messages.filter(m => m.role !== 'system').length === 0 ? 'default' : 'pointer',
                padding: '4px',
                display: 'flex',
                alignItems: 'center',
                borderRadius: 'var(--radius-sm)'
              }}
              onMouseEnter={e => { if (messages.filter(m => m.role !== 'system').length > 0) e.currentTarget.style.color = 'var(--color-secondary)' }}
              onMouseLeave={e => { if (messages.filter(m => m.role !== 'system').length > 0) e.currentTarget.style.color = 'var(--color-text-muted)' }}
              title="Export Chat as Markdown"
            >
              <FileDown size={13} />
            </button>

            <button
              onClick={() => setShowSettingsPanel(s => !s)}
              style={{
                background: showSettingsPanel ? 'var(--color-secondary-muted)' : 'transparent',
                border: 'none',
                color: showSettingsPanel ? 'var(--color-secondary)' : 'var(--color-text-muted)',
                cursor: 'pointer',
                padding: '4px',
                display: 'flex',
                alignItems: 'center',
                borderRadius: 'var(--radius-sm)'
              }}
              onMouseEnter={e => { if (!showSettingsPanel) e.currentTarget.style.color = 'var(--color-secondary)' }}
              onMouseLeave={e => { if (!showSettingsPanel) e.currentTarget.style.color = 'var(--color-text-muted)' }}
              title="AI Settings (Temperature, System Prompt)"
            >
              <Sliders size={13} />
            </button>

            <button
              onClick={() => { setChatSearchQuery(''); setShowSavedChatsModal(true) }}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--color-text-muted)',
                cursor: 'pointer',
                padding: '4px',
                display: 'flex',
                alignItems: 'center',
                borderRadius: 'var(--radius-sm)'
              }}
              onMouseEnter={e => (e.currentTarget.style.color = 'var(--color-secondary)')}
              onMouseLeave={e => (e.currentTarget.style.color = 'var(--color-text-muted)')}
              title="Saved Chats (History)"
            >
              <MessageSquare size={13} />
            </button>

            <button
              onClick={handleNewChat}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--color-text-muted)',
                cursor: 'pointer',
                padding: '4px',
                display: 'flex',
                alignItems: 'center',
                borderRadius: 'var(--radius-sm)'
              }}
              onMouseEnter={e => (e.currentTarget.style.color = 'var(--color-secondary)')}
              onMouseLeave={e => (e.currentTarget.style.color = 'var(--color-text-muted)')}
              title="New Chat"
            >
              <Plus size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* Inline Settings Panel */}
      {showSettingsPanel && <SettingsPanel temperature={temperature} setTemperature={setTemperature} maxTokens={maxTokens} setMaxTokens={setMaxTokens} systemPromptOverride={systemPromptOverride} setSystemPromptOverride={setSystemPromptOverride} />}

      {/* Main chat history list */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: 'var(--space-4)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-4)'
        }}
      >
        {/* Context pre-seeded pill if active */}
        {contextItem && (
          <div style={{ flexShrink: 0 }}>
            <ContextPill item={contextItem} onClear={() => { selectItem(null); setContextItem(null) }} />
          </div>
        )}

        {messages.length === 0 && !streamingText && !isWaitingForFirstChunk && (
          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--color-text-muted)',
              fontSize: 'var(--text-xs)',
              gap: 'var(--space-3)',
              textAlign: 'center',
              padding: 'var(--space-6)'
            }}
          >
            <Sparkles size={26} style={{ color: 'var(--color-secondary)' }} />
            <div>
              <div style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text-base)' }}>
                Your project co-pilot
              </div>
              <div style={{ fontSize: '11px', marginTop: '2px' }}>
                It reads your board, creates and edits cards, and remembers your project.
              </div>
            </div>

            {/* Example chips. Make the invisible feature surface visible */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', justifyContent: 'center', maxWidth: '340px' }}>
              {[
                { label: '🗂 Set up a board for my project', action: () => handleSubmitWithText('Design a Kanban board for this project: propose the workflow COLUMNS (each with a fitting color) and seed each column with a few well-scoped starter cards (with tags and priorities).', { displayContent: 'Set up a board', intentHint: 'create' }) },
                { label: '✅ Move finished cards to Done', action: () => handleSubmitWithText('Move every card that is clearly finished to the Done column.') },
                { label: '💡 What should I work on next?', action: () => handleSubmitWithText('Review my current board and tell me what to work on next and why. Do NOT output JSON: give a prioritized, reasoned plain-text list.', { displayContent: 'What should I work on next?', intentHint: 'analyze' }) },
                { label: '📎 @-mention notes, files & PDFs', action: () => setInputValue('@') }
              ].map(chip => (
                <button
                  key={chip.label}
                  onClick={chip.action}
                  style={{
                    background: 'var(--color-surface-2)',
                    border: '1px solid var(--color-surface-offset)',
                    color: 'var(--color-text-base)',
                    borderRadius: '999px',
                    padding: '5px 12px',
                    fontSize: '10px',
                    fontWeight: 'var(--weight-medium)',
                    cursor: 'pointer',
                    transition: 'all 120ms ease'
                  }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--color-secondary)'; e.currentTarget.style.color = 'var(--color-secondary)' }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--color-surface-offset)'; e.currentTarget.style.color = 'var(--color-text-base)' }}
                >
                  {chip.label}
                </button>
              ))}
            </div>

            <span style={{ fontSize: '9px', color: 'var(--color-text-faint)' }}>
              / commands · @ mentions · paste screenshots (👁 models) · Esc stops generation
            </span>
          </div>
        )}

        {messages.map((msg, index) => {
          // Check if subsequent message has JSON entities that can be reverted
          const nextMsg = messages[index + 1]
          const hasRevertAction = !!(
            nextMsg &&
            nextMsg.role === 'assistant' &&
            nextMsg.content.includes('```json')
          )

          return (
            <ChatMessage
              key={index}
              message={msg}
              messageIndex={index}
              onResend={handleResend}
              onRewrite={handleRewrite}
              onRevert={handleRevert}
              onCopy={handleCopyMessage}
              isCopied={copiedMsgIndex === index}
              // Committed messages are final. The blinking cursor belongs ONLY to
              // the live streaming preview below, never to already-written messages.
              isStreaming={false}
              hasRevertAction={hasRevertAction}
              actionsLocked={isStreaming}
            />
          )
        })}

        {/* "Thinking…" indicator while waiting for first chunk */}
        {isWaitingForFirstChunk && !streamingText && (
          <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'flex-start', width: '100%' }}>
            <div style={{
              width: '24px', height: '24px', borderRadius: '50%', display: 'flex',
              alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              background: 'var(--color-secondary-muted)', color: 'var(--color-secondary)',
              border: '1px solid var(--color-secondary)'
            }}>
              <Sparkles size={12} fill="currentColor" />
            </div>
            <div style={{
              background: 'var(--color-surface-2)',
              border: '1px solid rgba(255,255,255,0.06)',
              borderRadius: 'var(--radius-lg)',
              padding: 'var(--space-3) var(--space-4)',
              fontSize: 'var(--text-xs)',
              color: 'var(--color-text-muted)',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}>
              <span style={{ display: 'inline-flex', gap: '3px', alignItems: 'center' }}>
                <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: 'var(--color-secondary)', display: 'inline-block', animation: 'pulse 1.2s ease-in-out infinite', animationDelay: '0s' }} />
                <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: 'var(--color-secondary)', display: 'inline-block', animation: 'pulse 1.2s ease-in-out infinite', animationDelay: '0.2s' }} />
                <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: 'var(--color-secondary)', display: 'inline-block', animation: 'pulse 1.2s ease-in-out infinite', animationDelay: '0.4s' }} />
              </span>
              <span>{waitingLabel}</span>
            </div>
          </div>
        )}

        {/* Streaming text preview bubble */}
        {streamingText && (() => {
          const { thinking, content } = parseThinkingAndContent(streamingText)
          return (
            <ChatMessage
              message={{ role: 'assistant', content, thinking: thinking || undefined }}
              isStreaming
            />
          )
        })()}
      </div>

      {/* Input panel at bottom */}
      <div
        style={{
          padding: 'var(--space-3) var(--space-4) var(--space-4)',
          borderTop: '1px solid var(--color-surface-offset)',
          background: 'var(--color-surface-1)',
          flexShrink: 0,
          position: 'relative'
        }}
      >
        {/* Jump back to the newest message when scrolled up */}
        {showJumpToLatest && (
          <button
            onClick={() => {
              isAtBottomRef.current = true
              setShowJumpToLatest(false)
              scrollToBottom(true)
            }}
            title="Jump to the latest message"
            style={{
              position: 'absolute',
              top: '-40px',
              right: 'var(--space-4)',
              zIndex: 20,
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
              background: 'var(--color-surface-elevated)',
              border: '1px solid var(--color-surface-offset)',
              color: 'var(--color-text-base)',
              borderRadius: '999px',
              padding: '5px 12px',
              fontSize: '10px',
              fontWeight: 'bold',
              cursor: 'pointer',
              boxShadow: '0 4px 12px rgba(0,0,0,0.4)'
            }}
          >
            <ArrowDown size={12} style={{ color: 'var(--color-secondary)' }} />
            <span>{isStreaming ? 'Following live…' : 'Latest'}</span>
          </button>
        )}
        {/* Skill Selector Pill Bar + Workspace pill */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', marginBottom: '8px' }}>
          {(() => {
            const resolvedAutoSkillId = (() => {
              if (activeSkillId) return null
              const skill = detectSkill(inputValue)
              if (skill) return skill
              const intent = classifyIntent(inputValue, null)
              if (intent === 'create_dialogue') return 'narrative_specialist'
              if (intent === 'create_plan') return 'implementation_planner'
              return null
            })()

            return AI_SKILLS.map(skill => {
              const isManualActive = activeSkillId === skill.id
              const isAutoActive = !activeSkillId && resolvedAutoSkillId === skill.id
              const isActive = isManualActive || isAutoActive
              return (
                <button
                  key={skill.id}
                  onClick={() => handleSelectSkill(skill.id)}
                  title={skill.description}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '5px',
                    background: isActive ? `${skill.color}22` : 'var(--color-surface-2)',
                    border: `1px solid ${isActive ? skill.color : 'var(--color-surface-offset)'}`,
                    color: isActive ? skill.color : 'var(--color-text-muted)',
                    borderRadius: '999px',
                    padding: '3px 10px',
                    fontSize: '10px',
                    fontWeight: 'bold',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    transition: 'all 100ms ease'
                  }}
                >
                  <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: isActive ? skill.color : 'var(--color-text-faint)', flexShrink: 0 }} />
                  <span>{skill.shortLabel}{isAutoActive ? ' (auto)' : ''}</span>
                </button>
              )
            })
          })()}

          {workspaceFolder && (
            <div
              title={`${workspaceFolder}, ${workspaceFiles.length} files indexed`}
              style={{
                display: 'flex', alignItems: 'center', gap: '5px',
                background: 'rgba(56,189,248,0.12)', border: '1px solid rgba(56,189,248,0.4)',
                color: '#38bdf8', borderRadius: '999px', padding: '3px 8px 3px 10px',
                fontSize: '10px', fontWeight: 'bold', whiteSpace: 'nowrap'
              }}
            >
              <FolderOpen size={11} />
              <span style={{ maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {workspaceFolder.split(/[\\/]/).pop()} ({workspaceFiles.length})
              </span>
              <button
                onClick={handleClearWorkspace}
                title="Remove imported workspace"
                style={{ background: 'transparent', border: 'none', color: '#38bdf8', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center' }}
              >
                <X size={11} />
              </button>
            </div>
          )}

          {recalledMemCount > 0 && (
            <button
              onClick={() => setShowMemoryPanel(true)}
              title={`${recalledMemCount} project memories were recalled for the last message. Click to open the Memory Vault.`}
              style={{
                display: 'flex', alignItems: 'center', gap: '5px',
                background: 'rgba(168,85,247,0.12)', border: '1px solid rgba(168,85,247,0.4)',
                color: '#c084fc', borderRadius: '999px', padding: '3px 10px',
                fontSize: '10px', fontWeight: 'bold', whiteSpace: 'nowrap', cursor: 'pointer'
              }}
            >
              <Brain size={11} />
              <span>{recalledMemCount} recalled</span>
            </button>
          )}

          {/* Token Budget Indicator */}
          <div
            title={`${tokenUsage.measured ? '' : '~'}${tokenUsage.used.toLocaleString()} / ${modelCaps.contextTokens.toLocaleString()} tokens of context window in use${tokenUsage.measured ? ' (reported by the endpoint)' : ' (estimated)'}`}
            style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              marginLeft: 'auto', flexShrink: 0
            }}
          >
            <Gauge size={11} style={{ color: tokenUsage.ratio > 0.85 ? '#ef4444' : tokenUsage.ratio > 0.6 ? '#eab308' : 'var(--color-text-faint)' }} />
            <div style={{ width: '56px', height: '4px', borderRadius: '2px', background: 'var(--color-surface-offset)', overflow: 'hidden' }}>
              <div style={{
                width: `${Math.max(2, tokenUsage.ratio * 100)}%`,
                height: '100%',
                background: tokenUsage.ratio > 0.85 ? '#ef4444' : tokenUsage.ratio > 0.6 ? '#eab308' : 'var(--color-secondary)',
                transition: 'width 200ms ease'
              }} />
            </div>
            <span style={{ fontSize: '9px', color: 'var(--color-text-faint)', whiteSpace: 'nowrap' }}>
              {Math.round(tokenUsage.ratio * 100)}%
            </span>
          </div>
        </div>

        <ChatInput
          value={inputValue}
          onChange={setInputValue}
          onSubmit={handleSubmit}
          onAbort={handleAbort}
          isStreaming={isStreaming}
          contextItem={contextItem}
          onTriggerPrompt={(prompt, displayContent, intentHint) => handleSubmitWithText(prompt, { displayContent, intentHint })}
          activeSkill={getSkillById(activeSkillId)}
          onClearSkill={() => handleSelectSkill(null)}
          workspaceFiles={workspaceFiles.map(f => ({ name: f.name, relativePath: f.relativePath }))}
          customActions={customActions}
          onManageCustomActions={() => setShowCustomActionsModal(true)}
          visionCapable={modelCaps.supportsVision}
        />
      </div>

      {/* Custom Quick Actions Manager Modal */}
      {showCustomActionsModal && <CustomActionsModal customActions={customActions} persistCustomActions={persistCustomActions} caLabel={caLabel} setCaLabel={setCaLabel} caPrompt={caPrompt} setCaPrompt={setCaPrompt} caIntent={caIntent} setCaIntent={setCaIntent} handleAddCustomAction={handleAddCustomAction} setShowCustomActionsModal={setShowCustomActionsModal} />}

      {/* Cookbook Model Manager Popup Modal */}
      {showCookbookModal && <CookbookModal selectedModel={selectedModel} localModels={localModels} pullingTag={pullingTag} pullProgress={pullProgress} handleModelChange={handleModelChange} handlePullModel={handlePullModel} setShowCookbookModal={setShowCookbookModal} />}

      {/* Saved Chats Drawer Modal */}
      {showSavedChatsModal && <SavedChatsModal savedChats={savedChats} currentChatId={currentChatId} chatSearchQuery={chatSearchQuery} setChatSearchQuery={setChatSearchQuery} editingChatId={editingChatId} setEditingChatId={setEditingChatId} editingTitle={editingTitle} setEditingTitle={setEditingTitle} handleNewChat={handleNewChat} handleLoadChat={handleLoadChat} handleDeleteChat={handleDeleteChat} handleSaveRename={handleSaveRename} setShowSavedChatsModal={setShowSavedChatsModal} />}
      {/* Memory Vault Modal */}
      {showMemoryPanel && <MemoryVaultModal vault={vault} activeContext={activeContext} />}

      {/* Styled Revert Confirmation Modal */}
      {revertConfirmData && <RevertConfirmModal revertConfirmData={revertConfirmData} setRevertConfirmData={setRevertConfirmData} revertAICreatedEntities={revertAICreatedEntities} setMessages={setMessages} />}

      {/* Custom Model Prompt Modal */}
      {showCustomModelPrompt && <CustomModelPromptModal customModelInput={customModelInput} setCustomModelInput={setCustomModelInput} applyModel={applyModel} setShowCustomModelPrompt={setShowCustomModelPrompt} />}
    </div>
  )
}
