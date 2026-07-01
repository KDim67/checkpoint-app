import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Sparkles, Trash2, BookOpen, X, Download, Check, RefreshCw, MessageSquare, Plus, Edit2, Brain, Sliders, Copy, FileDown, FolderOpen, Gauge } from 'lucide-react'
import { useAppStore } from '../store/appStore'
import type { Item } from '../../../shared/types'
import catalogData from '../../../shared/catalog.json'
import ContextPill from './ai/ContextPill'
import ChatMessage, { clearActionCaches } from './ai/ChatMessage'
import ChatInput from './ai/ChatInput'
import { AI_SKILLS, getSkillById } from './ai/skills'

interface Message {
  role: 'system' | 'user' | 'assistant'
  content: string
  mode?: string
  cheatsheets?: string[]
  timestamp?: number
  boardSnapshot?: {
    columns: any[]
    cards: any[]
  }
}

const STORAGE_KEY_SAVED_CHATS = 'checkpoint_ai_saved_chats'
const STORAGE_KEY_ACTIVE_SKILL = 'checkpoint_ai_active_skill'
const STORAGE_KEY_WORKSPACE_FOLDER = 'checkpoint_ai_workspace_folder'

// Mirrors the `num_ctx` value sent to the model in aiService.ts, used purely
// as a rough visual budget reference for the context-window indicator.
const CONTEXT_WINDOW_TOKENS = 32768

interface WorkspaceFileInfo {
  name: string
  relativePath: string
  extension: string
  size: number
}

// Rough, fast token estimate (no tokenizer dependency): ~4 chars/token is a
// reasonable approximation for English + code text across most BPE vocabularies.
function estimateTokens(text: string): number {
  if (!text) return 0
  return Math.ceil(text.length / 4)
}

/**
 * Prunes the conversation history to fit within a maximum token limit,
 * keeping the newest messages at the end. Always preserves the latest user query.
 */
function pruneHistory(history: Message[], maxHistoryTokens: number): Message[] {
  if (history.length === 0) return []
  const pruned: Message[] = []
  let estimatedTokens = 0

  // Always include the latest turn (the most recent user message)
  const lastMsg = history[history.length - 1]
  pruned.push(lastMsg)
  estimatedTokens += estimateTokens(lastMsg.content)

  // Iterate backwards starting from the second to last message
  for (let i = history.length - 2; i >= 0; i--) {
    const msg = history[i]
    const tokens = estimateTokens(msg.content)
    if (estimatedTokens + tokens > maxHistoryTokens) {
      break
    }
    estimatedTokens += tokens
    pruned.unshift(msg)
  }

  return pruned
}

interface SavedChat {
  id: string
  title: string
  createdAt: number
  messages: Message[]
}

export default function AiStreamPanel() {
  const selectedItemId = useAppStore(s => s.selectedItemId)
  const selectItem = useAppStore(s => s.selectItem)
  const activeContext = useAppStore(s => s.activeContext)

  // Chat message history
  const [messages, setMessages] = useState<Message[]>([])
  const [inputValue, setInputValue] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamingText, setStreamingText] = useState('')

  // Context pre-seeding
  const [contextItem, setContextItem] = useState<Item | null>(null)

  // Configuration settings loaded from DB
  const [selectedModel, setSelectedModel] = useState('llama3')
  const [localModels, setLocalModels] = useState<string[]>([])
  const [temperature, setTemperature] = useState(0.7)
  const [maxTokens, setMaxTokens] = useState(2048)
  const [useOllamaSelector, setUseOllamaSelector] = useState(false)
  const [showCookbookModal, setShowCookbookModal] = useState(false)
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
  const [revertConfirmData, setRevertConfirmData] = useState<{ snapshot: { columns: any[]; cards: any[] }; index: number } | null>(null)
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
      window.electronAPI.ai.abortStream().catch(() => {})
    }
    setMessages([])
    setStreamingText('')
    chunkBufferRef.current = ''
    setIsStreaming(false)
    streamingChatIdRef.current = null
    hasReceivedFirstChunkRef.current = false
    isAbortedRef.current = false
    setIsWaitingForFirstChunk(false)
    setCurrentChatId(`chat_${Date.now()}`)
    setShowSavedChatsModal(false)
    // Clear action caches so cards/columns can be re-created in a fresh chat
    clearActionCaches()
  }

  const handleLoadChat = (chat: SavedChat) => {
    if (isStreaming) {
      window.electronAPI.ai.abortStream().catch(() => {})
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

  // Memory panel
  const [showMemoryPanel, setShowMemoryPanel] = useState(false)
  const [memories, setMemories] = useState<any[]>([])
  const [memoryLoading, setMemoryLoading] = useState(false)
  const [memorySearchQuery, setMemorySearchQuery] = useState('')
  const [editingMemoryId, setEditingMemoryId] = useState<string | null>(null)
  const [editingMemoryContent, setEditingMemoryContent] = useState('')
  const [showAddMemoryForm, setShowAddMemoryForm] = useState(false)
  const [newMemoryKey, setNewMemoryKey] = useState('')
  const [newMemoryContent, setNewMemoryContent] = useState('')
  const [newMemoryCategory, setNewMemoryCategory] = useState<'semantic' | 'episodic' | 'working'>('semantic')
  const [memoryConsolidating, setMemoryConsolidating] = useState(false)
  const consolidationTurnRef = useRef(0) // Only consolidate every N turns to save API calls

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

  // 2. Load Configuration and Local Models on mount
  useEffect(() => {
    const loadAiConfig = async () => {
      try {
        const dbModel = await window.electronAPI.db.getSetting('ai_model')
        const dbTemp = await window.electronAPI.db.getSetting('ai_temperature')
        const dbMaxTokens = await window.electronAPI.db.getSetting('ai_max_tokens')

        if (dbModel) setSelectedModel(dbModel as string)
        if (dbTemp !== null) setTemperature(Number(dbTemp))
        if (dbMaxTokens !== null) setMaxTokens(Number(dbMaxTokens))

        // Check local models from Ollama
        const list = await window.electronAPI.ollama.listLocal()
        if (list && list.length > 0) {
          setLocalModels(list)
          setUseOllamaSelector(true)
          // Default to the first local model if selectedModel is empty
          if (!dbModel) {
            setSelectedModel(list[0])
            await window.electronAPI.db.setSetting('ai_model', list[0])
          }
        } else {
          setUseOllamaSelector(false)
        }
      } catch {
        // Fallback to text input model selector if Ollama is not running/available
        setUseOllamaSelector(false)
      }
    }
    loadAiConfig()
  }, [])

  // Auto-scroll to bottom of messages container
  const scrollToBottom = useCallback((force = false) => {
    if (scrollContainerRef.current && (isAtBottomRef.current || force)) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight
    }
  }, [])

  const handleScroll = () => {
    if (!scrollContainerRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current
    isAtBottomRef.current = scrollHeight - scrollTop - clientHeight < 40
  }

  useEffect(() => {
    const messageAdded = messages.length > prevMessagesLengthRef.current
    prevMessagesLengthRef.current = messages.length
    scrollToBottom(messageAdded)
  }, [messages, streamingText])

  // 4. Mount IPC Streaming Listeners with cleanups to prevent leaks
  useEffect(() => {
    const unsubscribeChunk = window.electronAPI.ai.onChunk((chunk) => {
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

    const unsubscribeDone = window.electronAPI.ai.onDone(() => {
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
        setMessages(prev => {
          const updated = [...prev, { role: 'assistant' as const, content: finalAssistantResponse, timestamp: Date.now() }]
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

    const unsubscribeError = window.electronAPI.ai.onError((errMessage) => {
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
        setMessages(prev => [...prev, { role: 'assistant', content: finalAssistantResponse, timestamp: Date.now() }])
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

  const handleModelChange = async (val: string) => {
    if (val === '__OPEN_COOKBOOK__') {
      setShowCookbookModal(true)
      refreshLocalModels()
      return
    }
    setSelectedModel(val)
    await window.electronAPI.db.setSetting('ai_model', val)
  }

  const refreshLocalModels = async () => {
    try {
      const list = await window.electronAPI.ollama.listLocal()
      if (list && list.length > 0) {
        setLocalModels(list)
        setUseOllamaSelector(true)
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
  const captureBoardSnapshot = async (): Promise<{ columns: any[]; cards: any[] }> => {
    const validContext = activeContext || 'default'
    const key = `kanban_columns_${validContext}`
    
    // Get columns
    const rawCols = await window.electronAPI.db.getSetting(key).catch(() => null)
    let columns: any[] = []
    if (typeof rawCols === 'string') {
      try { columns = JSON.parse(rawCols) } catch { columns = [] }
    } else if (Array.isArray(rawCols)) {
      columns = rawCols
    }
    if (columns.length === 0) {
      columns = [
        { id: 'open', name: 'Backlog' },
        { id: 'in_progress', name: 'In Progress' },
        { id: 'in_review', name: 'In Review' },
        { id: 'done', name: 'Done' }
      ]
    }

    // Get cards
    const [tasksRes, cardsRes] = await Promise.all([
      window.electronAPI.db.getItems(validContext, 'task', 1, 1000).catch(() => ({ items: [] })),
      window.electronAPI.db.getItems(validContext, 'card', 1, 1000).catch(() => ({ items: [] }))
    ])
    const cards = [...(tasksRes?.items || []), ...(cardsRes?.items || [])]

    return { columns, cards }
  }

  const restoreBoardFromSnapshot = async (snapshot: { columns: any[]; cards: any[] }) => {
    const validContext = activeContext || 'default'

    // 1. Delete all current items in the context
    const [tasksRes, cardsRes] = await Promise.all([
      window.electronAPI.db.getItems(validContext, 'task', 1, 1000).catch(() => ({ items: [] })),
      window.electronAPI.db.getItems(validContext, 'card', 1, 1000).catch(() => ({ items: [] }))
    ])
    const itemsToDelete = [...(tasksRes?.items || []), ...(cardsRes?.items || [])].map(i => i.id)
    if (itemsToDelete.length > 0) {
      await window.electronAPI.db.bulkDeleteItems(itemsToDelete).catch(() => {})
    }

    // 2. Restore columns setting
    const key = `kanban_columns_${validContext}`
    await window.electronAPI.db.setSetting(key, JSON.stringify(snapshot.columns)).catch(() => {})

    // 3. Re-create all snapshot cards
    for (const card of snapshot.cards) {
      const tagIds = card.tags ? card.tags.map((t: any) => t.id) : []
      await window.electronAPI.db.createItem({
        type: card.type || 'card',
        context: validContext,
        title: card.title,
        body: card.body || '',
        status: card.status || 'open',
        priority: card.priority ?? 0,
        position: card.position,
        due_at: card.due_at || null,
        metadata: card.metadata || '{}'
      }, tagIds).catch((err) => {
        console.error('Failed to restore snapshot item:', err)
      })
    }

    // 4. Trigger UI refresh
    window.dispatchEvent(new CustomEvent('kanban-refresh'))
    window.dispatchEvent(new CustomEvent('item-updated'))
  }

  const handleRevert = async (snapshot: { columns: any[]; cards: any[] }, messageIndex: number) => {
    try {
      await restoreBoardFromSnapshot(snapshot)
      setMessages(prev => prev.slice(0, messageIndex))
    } catch (err) {
      console.error('Failed to revert board snapshot:', err)
    }
  }

  // Rewrite & Resend handlers
  const handleRewrite = async (newContent: string, messageIndex: number) => {
    if (isStreaming) return

    let snapshot
    try {
      snapshot = await captureBoardSnapshot()
    } catch {}

    const originalMsg = messages[messageIndex]
    const updatedUserMsg: Message = {
      ...originalMsg,
      content: newContent,
      timestamp: Date.now(),
      boardSnapshot: snapshot
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
  const handleSubmitWithText = async (textToSubmit?: string, options?: { mode?: string; cheatsheets?: string[] }) => {
    const text = (textToSubmit ?? inputValue).trim()
    if (!text && !options?.cheatsheets?.length) return
    if (isStreaming) return

    let snapshot
    try {
      snapshot = await captureBoardSnapshot()
    } catch {}

    const userMessage: Message = {
      role: 'user',
      content: text || 'Analyze attached cheatsheet(s).',
      mode: options?.mode,
      cheatsheets: options?.cheatsheets,
      timestamp: Date.now(),
      boardSnapshot: snapshot
    }
    const nextMessages = [...messages, userMessage]
    setMessages(nextMessages)
    if (!textToSubmit) setInputValue('')

    await runChatStream(nextMessages)
  }

  const runChatStream = async (nextMessages: Message[]) => {
    setIsStreaming(true)
    setIsWaitingForFirstChunk(true)
    hasReceivedFirstChunkRef.current = false
    streamingChatIdRef.current = currentChatId
    chunkBufferRef.current = ''
    setStreamingText('')

    try {
      const lastUserMsg = [...nextMessages].reverse().find(m => m.role === 'user')
      const text = lastUserMsg?.content || ''

      // Check if the selected model is small (e.g. < 4B parameters)
      const modelLower = (selectedModel || '').toLowerCase()
      const isSmallModel =
        modelLower.includes('2b') ||
        modelLower.includes('1.5b') ||
        modelLower.includes('3b') ||
        modelLower.includes('0.5b') ||
        modelLower.includes('tiny') ||
        modelLower.includes('mini') ||
        modelLower.includes('small')

      const baseSystemPromptContent = isSmallModel
        ? `You are Checkpoint AI, an assistant with DIRECT WRITE ACCESS to the user's Kanban board.

██ MANDATORY ACTION RULE ██
When the user explicitly asks to create or add items (e.g. "add tasks", "create cards", "make columns", "build the board", "set up tasks for X", "add more tasks", "give me cards for Y", "populate the board"):
→ You MUST immediately output JSON action blocks that CREATE those items directly on the board.
→ DO NOT explain what you will do. DO NOT ask for confirmation. JUST OUTPUT THE JSON BLOCKS.
→ NEVER say "I'll create..." or "Here are the tasks...", just output the JSON block.

██ CONVERSATIONAL & INQUIRY RULE ██
- When the user sends a greeting (e.g. "hello", "hey", "hi") or asks a general question:
  → Respond with a helpful, friendly, natural-language text answer.
  → DO NOT output any JSON action blocks unless specifically asked to add/create items.

██ JSON FORMAT (BATCH) ██
To create columns and cards, output exactly this JSON format:
\`\`\`json
{
  "columns": [
    { "name": "Backlog", "color": "#6b7280", "colorMode": "header" },
    { "name": "In Progress", "color": "#3b82f6", "colorMode": "header" },
    { "name": "Done", "color": "#22c55e", "colorMode": "header" }
  ],
  "cards": [
    { "title": "Task Title", "body": "Description", "status": "Backlog", "priority": 2 }
  ]
}
\`\`\`
- Valid JSON only. No trailing commas. No comments inside JSON.
- "priority": 1=Low, 2=Medium, 3=High.
- "color": hex value like "#a855f7".`
      : `You are Checkpoint AI, an intelligent project assistant with DIRECT WRITE ACCESS to the user's Kanban board, columns, and cards. You CREATE things, not describe them.

██ MANDATORY ACTION RULE ██
When the user explicitly asks to create, plan, or add items (e.g. "add tasks", "create cards", "make columns", "build the board", "set up tasks for X", "add more tasks", "give me cards for Y", "populate the board", "start building Z"):
→ You MUST immediately output JSON action blocks that CREATE those items directly on the board.
→ DO NOT explain what you will do. DO NOT ask for confirmation. JUST OUTPUT THE JSON BLOCKS.
→ NEVER say "I'll create..." or "Here are the tasks I'd suggest...", just output the blocks.
→ If the user says "add tasks" you add tasks. If they say "more" you add more. No avoidance.

██ CONVERSATIONAL & INQUIRY RULE ██
- When the user sends a greeting (e.g. "hello", "hey", "hi"), asks a general question, or requests a project audit:
  → Respond with a helpful, friendly, natural-language text answer.
  → DO NOT output any JSON action blocks (cards/columns) unless specifically asked to add or create them.
  → Act as an intelligent project partner, answering questions clearly based on the live board state, codebase structure, and recalled memories.

██ DISAMBIGUATION ██
- "Cards" and "Columns" = Kanban board items in Checkpoint. NOT playing cards. NOT Trello.
- Everything you generate is AUTOMATICALLY added to the board. No copy-pasting needed.
- NEVER mention external tools (Trello, Asana, Jira, Notion). Everything works here.

██ JSON RULES ██
- Valid JSON only. No trailing commas. No comments inside JSON.
- "priority": 1=Low, 2=Medium, 3=High
- "color": hex value like "#a855f7" (NOT color names like "purple")
- "colorMode": "header" or "full"
- "status": must match an existing column NAME (e.g. "Backlog", "In Progress")

━━━ BATCH FORMAT (PREFERRED, use this for 2+ items) ━━━
\`\`\`json
{
  "columns": [
    { "name": "Backlog",     "color": "#6b7280", "colorMode": "header" },
    { "name": "In Progress", "color": "#3b82f6", "colorMode": "header" },
    { "name": "Done",        "color": "#22c55e", "colorMode": "header" }
  ],
  "cards": [
    { "title": "Task One",   "body": "Description here", "status": "Backlog",     "priority": 2 },
    { "title": "Task Two",   "body": "Description here", "status": "In Progress", "priority": 3 }
  ]
}
\`\`\`

━━━ SINGLE CARD ━━━
\`\`\`json:create_card
{
  "title": "Core System: Character Movement",
  "body": "Implement player controls and physics-based movement",
  "status": "Backlog",
  "priority": 2,
  "tags": [{ "name": "gameplay", "color": "#a855f7" }]
}
\`\`\`

━━━ SINGLE COLUMN ━━━
\`\`\`json:create_column
{
  "name": "Story & Worldbuilding",
  "wipLimit": 10,
  "color": "#a855f7",
  "colorMode": "header"
}
\`\`\`

━━━ IMPLEMENTATION PLAN ━━━
\`\`\`json:create_plan
{
  "title": "Implementation Plan Title",
  "overview": "Overview of goals and steps",
  "steps": [
    { "title": "Step 1: Setup Game Engine", "details": "Initialize project assets", "status": "pending" }
  ]
}
\`\`\`

━━━ BRANCHING DIALOGUE / QUEST FLOW ━━━
\`\`\`json:create_dialogue_tree
{
  "startNode": "start",
  "nodes": [
    { "id": "start", "speaker": "Elder", "text": "Greetings traveler!", "choices": [{ "text": "Hello!", "target": "quest_1" }] }
  ]
}
\`\`\`

When creating multiple cards or setting up a board, ALWAYS use the BATCH format, it is the most reliable and creates everything in a single step.
You MUST output populated JSON blocks with multiple columns AND cards whenever asked to set up a project, game, or task list.`

      // Seed context as a system instruction if preset
      const systemPrompt: Message[] = [
        {
          role: 'system',
          content: baseSystemPromptContent
        }
      ]

      // 1. Semantic Memory Vector Retrieval
      try {
        const validContext = activeContext || 'default'
        const memories = await window.electronAPI.memory.searchMemories(text, validContext, 8).catch(() => [])
        if (memories && memories.length > 0) {
          const memFormatted = memories.map(m => `- [${m.category.toUpperCase()}] ${m.memory_key}: ${m.content}`).join('\n')
          systemPrompt.push({
            role: 'system',
            content: `RECALLED PROJECT MEMORIES & KNOWN FACTS:\n${memFormatted}\n\nUse these persistent memories to maintain consistency with past decisions, user rules, and game lore.`
          })
        }
      } catch (memErr) {
        console.warn('Failed to retrieve semantic memories for AI context:', memErr)
      }

      // Automatically scrape all workspace columns and items to give AI full knowledge of tasks & board structure
      try {
        const validContext = activeContext || 'default'
        const key = `kanban_columns_${validContext}`
        const rawCols = await window.electronAPI.db.getSetting(key).catch(() => null)
        let colsList: any[] = []
        if (typeof rawCols === 'string') {
          try { colsList = JSON.parse(rawCols) } catch (e) { colsList = [] }
        } else if (Array.isArray(rawCols)) {
          colsList = rawCols
        }
        if (colsList.length === 0) {
          colsList = [
            { id: 'open', name: 'Backlog' },
            { id: 'in_progress', name: 'In Progress' },
            { id: 'in_review', name: 'In Review' },
            { id: 'done', name: 'Done' }
          ]
        }

        const [tasksRes, cardsRes] = await Promise.all([
          window.electronAPI.db.getItems(validContext, 'task', 1, 1000).catch(() => ({ items: [] })),
          window.electronAPI.db.getItems(validContext, 'card', 1, 1000).catch(() => ({ items: [] }))
        ])
        const allItems = [...(tasksRes?.items || []), ...(cardsRes?.items || [])]

        let colSummaries: string[] = []
        for (const col of colsList) {
          const colCards = allItems.filter(i => i.status === col.id || i.status.toLowerCase() === col.name.toLowerCase())
          let cardListText = ''
          if (colCards.length > 0) {
            cardListText = colCards.map(c => {
              const bodySnippet = c.body ? `, Description: "${c.body.slice(0, 150).replace(/\n/g, ' ')}"` : ''
              const tagsText = c.tags && c.tags.length > 0 ? ` [Tags: ${c.tags.map((t: any) => t.name).join(', ')}]` : ''
              return `    * Card Title: "${c.title}" (Priority: ${c.priority === 3 ? 'High' : c.priority === 2 ? 'Med' : 'Low'})${tagsText}${bodySnippet}`
            }).join('\n')
          } else {
            cardListText = '    * (No cards in this column yet)'
          }
          colSummaries.push(`- Column Name: "${col.name}" (ID: "${col.id}"):\n${cardListText}`)
        }

        const existingCardTitles = allItems.map((i: any) => i.title).join(', ')
        const liveBoardStateText = `CURRENT LIVE KANBAN BOARD STATE (Context: ${validContext}):\nExisting Board Columns & Cards:\n${colSummaries.join('\n\n')}\n\nEXISTING CARD TITLES (DO NOT DUPLICATE THESE EXACT TITLES): ${existingCardTitles || 'none yet'}\n\nBOARD RULES:\n1. READ the existing columns and cards above before responding.\n2. NEVER create cards with the same title as an existing card (titles listed above).\n3. When asked to 'add more tasks' or 'add another': generate BRAND NEW tasks with completely different titles that complement but do not repeat what exists.\n4. You CAN add cards to existing columns, just use new unique titles.`

        systemPrompt.push({
          role: 'system',
          content: liveBoardStateText
        })
      } catch (err) {
        console.warn('Failed to scrape workspace items for AI context:', err)
      }

      // Specialized Skill Workflow injection
      const activeSkill = getSkillById(activeSkillId)
      if (activeSkill) {
        systemPrompt.push({
          role: 'system',
          content: activeSkill.systemPrompt
        })
      }

      // Imported workspace codebase index injection
      if (workspaceFolder && workspaceFiles.length > 0) {
        const fileTree = workspaceFiles
          .slice(0, 300)
          .map(f => `  ${f.relativePath} (${f.extension || 'no ext'}, ${f.size}b)`)
          .join('\n')
        systemPrompt.push({
          role: 'system',
          content: `IMPORTED WORKSPACE CODEBASE INDEX:\nProject folder: ${workspaceFolder}\nIndexed files (${workspaceFiles.length} total${workspaceFiles.length > 300 ? ', showing first 300' : ''}):\n${fileTree}\n\nUse this file listing to understand the project's architecture. You do not have file contents yet, if you need to read a specific file's contents to answer accurately, ask the user to paste it or attach it as a cheatsheet.`
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

      // Inject saved Email Writing Style Context & Multi-Draft Samples if present
      try {
        let samplesText = ''
        const storedSamples = localStorage.getItem('checkpoint_email_writing_samples')
        if (storedSamples) {
          const parsed = JSON.parse(storedSamples)
          if (Array.isArray(parsed) && parsed.length > 0) {
            const validBodies = parsed.filter((s: { body?: string }) => s.body && s.body.trim())
            if (validBodies.length > 0) {
              samplesText = validBodies.map((s: { title?: string; body: string }, i: number) => `--- Sample ${i + 1} (${s.title || 'Draft'}) ---\n${s.body}`).join('\n\n')
            }
          }
        }
        if (!samplesText) {
          samplesText = localStorage.getItem('checkpoint_email_writing_style') || ''
        }

        if (samplesText.trim()) {
          systemPrompt.push({
            role: 'system',
            content: `User's Writing Voice & Sample Emails:\n${samplesText}\n\nWhen drafting or rewriting emails, mirror this exact writing style, tone, and formatting.`
          })
        }
      } catch (styleErr) {
        console.warn('Failed to inject email writing sample style:', styleErr)
      }

      // Collect all unique cheatsheets across current options and conversation history
      const allActiveCheatsheets = new Set<string>()
      nextMessages.forEach(m => {
        if (m.cheatsheets && Array.isArray(m.cheatsheets)) {
          m.cheatsheets.forEach(cs => allActiveCheatsheets.add(cs))
        }
      })

      // Prepare final API messages payload
      const apiMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [...systemPrompt]

      // Attach full document text ONCE at the top as a system knowledge base
      if (allActiveCheatsheets.size > 0) {
        let fullDocText = ''
        for (const sheetName of Array.from(allActiveCheatsheets)) {
          try {
            const rawText = await window.electronAPI.cheatsheets.getText(sheetName)
            if (rawText && rawText.trim()) {
              let cleanText = rawText.trim()
              if (cleanText.length > 45000) {
                cleanText = cleanText.slice(0, 45000) + '\n\n[... Remaining document text truncated for context memory ...]'
              }
              fullDocText += `\n\n=== ATTACHED CHEATSHEET / REFERENCE DOCUMENT: "${sheetName}" ===\n${cleanText}\n=== END OF DOCUMENT: "${sheetName}" ===\n`
            }
          } catch (pdfErr) {
            console.warn(`Failed to read cheatsheet text for ${sheetName}:`, pdfErr)
          }
        }
        if (fullDocText) {
          apiMessages.push({
            role: 'system',
            content: `CRITICAL KNOWLEDGE BASE DOCUMENTS:\nThe following reference documents have been uploaded and attached by the user. You HAVE full access to these documents below. Do NOT ask the user to provide or upload the PDF file again, because it is ALREADY provided right here:\n${fullDocText}`
          })
        }
      }

      // Calculate token budget for conversation history:
      // total window (32768) - base prompts overhead - input value - cheatsheets - system prompts
      const baseOverheadTokens = 900
      const skillTokens = activeSkillId ? estimateTokens(getSkillById(activeSkillId)?.systemPrompt || '') : 0
      const workspaceTokens = workspaceFolder ? estimateTokens(workspaceFiles.slice(0, 300).map(f => f.relativePath).join('\n')) : 0
      const historyBudget = CONTEXT_WINDOW_TOKENS - baseOverheadTokens - skillTokens - workspaceTokens - 2000 // leave 2000 tokens for system docs and response safety
      const prunedHistory = pruneHistory(nextMessages, Math.max(4000, historyBudget))

      // Add conversation history with clean text
      for (const msg of prunedHistory) {
        apiMessages.push({ role: msg.role, content: msg.content })
      }

      // Reinforce action block mandate at the absolute bottom of prompt history
      const lastUserContent = (prunedHistory[prunedHistory.length - 1]?.content || '').toLowerCase()
      const isActionRequest = lastUserContent.includes('create') || lastUserContent.includes('card') ||
        lastUserContent.includes('column') || lastUserContent.includes('task') ||
        lastUserContent.includes('board') || lastUserContent.includes('build') ||
        lastUserContent.includes('game') || lastUserContent.includes('add') ||
        lastUserContent.includes('more') || lastUserContent.includes('another') ||
        lastUserContent.includes('make') || lastUserContent.includes('generate') ||
        lastUserContent.includes('set up') || lastUserContent.includes('populate')

      if (isActionRequest) {
        apiMessages.push({
          role: 'system',
          content: `⚡ ACTION REQUIRED, OUTPUT JSON BLOCKS NOW ⚡
The user is asking you to CREATE something on their Kanban board.
→ Check the live board state above to avoid exact duplicates.
→ Immediately output \`\`\`json batch blocks (or \`\`\`json:create_card / \`\`\`json:create_column) with REAL content.
→ DO NOT just talk about it. DO NOT refuse. DO NOT ask for permission. CREATE IT.
→ "Add tasks", "more tasks", "add another" = always generate new JSON blocks with new unique titles.`
        })
      } else {
        apiMessages.push({
          role: 'system',
          content: `💬 GENERAL CONVERSATION, DO NOT OUTPUT JSON BLOCKS 💬
The user is NOT asking you to add, create, or modify any items on the Kanban board right now.
→ DO NOT output any \`\`\`json or JSON block structures (no columns, cards, plans, or dialogue trees).
→ Respond purely in natural, friendly plain text.
→ Answer their question, greet them back, or ask how you can help them build their board today.`
        })
      }

      const params = {
        model: selectedModel,
        messages: apiMessages,
        temperature,
        maxTokens
      }
      await window.electronAPI.ai.startStream(params)
    } catch (err) {
      const error = err as Error
      setIsStreaming(false)
      setMessages(prev => [...prev, { role: 'assistant', content: `**Failed to initiate stream:** ${error.message || String(err)}` }])
    }
  }

  const handleSubmit = (options?: { mode?: string; cheatsheets?: string[] }) => handleSubmitWithText(undefined, options)

  const handleAbort = async () => {
    try {
      isAbortedRef.current = true
      await window.electronAPI.ai.abortStream()
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

  const handleClearChat = async () => {
    // Abort any in-progress stream first to prevent ghost messages
    if (isStreaming) {
      try {
        isAbortedRef.current = true
        await window.electronAPI.ai.abortStream()
        if (animationFrameRef.current) {
          cancelAnimationFrame(animationFrameRef.current)
          animationFrameRef.current = null
        }
      } catch {
        // ignore abort errors on clear
      }
    }
    setMessages([])
    setStreamingText('')
    chunkBufferRef.current = ''
    // FIX: Reset the streaming chat reference so future streams on a fresh chat work correctly
    streamingChatIdRef.current = null
    hasReceivedFirstChunkRef.current = false
    isAbortedRef.current = false
    setIsWaitingForFirstChunk(false)
    setIsStreaming(false)
    // Clear action caches so the same titles can be recreated after a clear
    clearActionCaches()
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
  const handleOpenMemoryPanel = async () => {
    setMemoryLoading(true)
    setShowMemoryPanel(true)
    try {
      const mems = await window.electronAPI.memory.getMemories(activeContext)
      setMemories(mems || [])
    } catch (e) {
      console.warn('Failed to load memories:', e)
      setMemories([])
    } finally {
      setMemoryLoading(false)
    }
  }

  const handleDeleteMemory = async (id: string) => {
    try {
      await window.electronAPI.memory.deleteMemory(id)
      setMemories(prev => prev.filter((m: any) => m.id !== id))
    } catch (e) {
      console.warn('Failed to delete memory:', e)
    }
  }

  const handleTogglePinMemory = async (id: string) => {
    try {
      const newPinned = await window.electronAPI.memory.togglePinMemory(id)
      setMemories(prev => prev.map((m: any) => m.id === id ? { ...m, is_pinned: newPinned } : m))
    } catch (e) {
      console.warn('Failed to toggle pin memory:', e)
    }
  }

  const handleStartEditMemory = (mem: any) => {
    setEditingMemoryId(mem.id)
    setEditingMemoryContent(mem.content)
  }

  const handleSaveEditMemory = async (id: string) => {
    try {
      await window.electronAPI.memory.updateMemoryContent(id, editingMemoryContent)
      setMemories(prev => prev.map((m: any) => m.id === id ? { ...m, content: editingMemoryContent, updated_at: Date.now() } : m))
      setEditingMemoryId(null)
    } catch (e) {
      console.warn('Failed to update memory:', e)
    }
  }

  const handleAddMemory = async () => {
    if (!newMemoryKey.trim() || !newMemoryContent.trim()) return
    try {
      const saved = await window.electronAPI.memory.saveMemory({
        context: activeContext || 'default',
        category: newMemoryCategory,
        memory_key: newMemoryKey.trim(),
        content: newMemoryContent.trim()
      })
      setMemories(prev => [saved, ...prev])
      setNewMemoryKey('')
      setNewMemoryContent('')
      setNewMemoryCategory('semantic')
      setShowAddMemoryForm(false)
    } catch (e) {
      console.warn('Failed to add memory:', e)
    }
  }

  /**
   * Background memory consolidation, fires after each AI turn.
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

      // Runs entirely in the main process now, see memoryService.consolidateFromExchange.
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
  // Includes conversation history, the in-progress draft, and a fixed
  // overhead approximation for the base system prompt / live board state /
  // active skill / workspace index that get injected at send time.
  const tokenUsage = (() => {
    const historyChars = messages.reduce((sum, m) => sum + m.content.length, 0)
    const baseOverheadTokens = 900 // base system prompt + live board state scaffolding
    const skillTokens = activeSkillId ? estimateTokens(getSkillById(activeSkillId)?.systemPrompt || '') : 0
    const workspaceTokens = workspaceFolder ? estimateTokens(workspaceFiles.slice(0, 300).map(f => f.relativePath).join('\n')) : 0
    const used = Math.ceil(historyChars / 4) + estimateTokens(inputValue) + baseOverheadTokens + skillTokens + workspaceTokens
    const ratio = Math.min(1, used / CONTEXT_WINDOW_TOKENS)
    return { used, ratio }
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
                  <option key={m} value={m}>{m}</option>
                ))}
                <option value="__OPEN_COOKBOOK__">+ Get More Models (Cookbook)...</option>
              </select>
            )
          })()}
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
              title={workspaceFolder ? `Workspace imported: ${workspaceFolder} (${workspaceFiles.length} files), click to re-import` : 'Import a project folder for codebase context'}
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
              onClick={() => setShowSavedChatsModal(true)}
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
      {showSettingsPanel && (
        <div style={{
          padding: 'var(--space-3) var(--space-4)',
          borderBottom: '1px solid var(--color-surface-offset)',
          background: 'var(--color-surface-1)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-2)',
          flexShrink: 0
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {/* Temperature Slider */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '10px', fontWeight: 'bold', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Temperature
                </span>
                <span style={{ fontSize: '10px', fontWeight: 'bold', color: 'var(--color-secondary)' }}>
                  {temperature.toFixed(1)}
                </span>
              </div>
              <input
                type="range"
                min="0"
                max="2"
                step="0.1"
                value={temperature}
                onChange={e => {
                  const v = parseFloat(e.target.value)
                  setTemperature(v)
                  window.electronAPI.db.setSetting('ai_temperature', String(v)).catch(() => {})
                }}
                style={{ width: '100%', accentColor: 'var(--color-secondary)', cursor: 'pointer' }}
              />
            </div>

            {/* Max Tokens Slider */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '2px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '10px', fontWeight: 'bold', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Max Response Tokens
                </span>
                <span style={{ fontSize: '10px', fontWeight: 'bold', color: 'var(--color-secondary)' }}>
                  {maxTokens}
                </span>
              </div>
              <input
                type="range"
                min="256"
                max="8192"
                step="256"
                value={maxTokens}
                onChange={e => {
                  const v = parseInt(e.target.value)
                  setMaxTokens(v)
                  window.electronAPI.db.setSetting('ai_max_tokens', String(v)).catch(() => {})
                }}
                style={{ width: '100%', accentColor: 'var(--color-secondary)', cursor: 'pointer' }}
              />
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span style={{ fontSize: '10px', fontWeight: 'bold', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>
              System Prompt Override (optional)
            </span>
            <textarea
              value={systemPromptOverride}
              onChange={e => setSystemPromptOverride(e.target.value)}
              placeholder="Add extra instructions the AI will always follow in this session..."
              rows={2}
              style={{
                background: 'var(--color-surface-2)',
                border: '1px solid var(--color-surface-offset)',
                color: 'var(--color-text-base)',
                borderRadius: 'var(--radius-sm)',
                padding: '6px 8px',
                fontSize: '11px',
                resize: 'vertical',
                outline: 'none',
                fontFamily: 'inherit',
                lineHeight: 1.4
              }}
            />
          </div>
        </div>
      )}

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
              gap: 'var(--space-2)',
              textAlign: 'center',
              padding: 'var(--space-6)'
            }}
          >
            <Sparkles size={24} style={{ color: 'var(--color-secondary)' }} />
            <span>
              Pre-seed task context from details view, click "AI Assist", or write a question below.
            </span>
          </div>
        )}

        {messages.map((msg, index) => (
          <ChatMessage
            key={index}
            message={msg}
            messageIndex={index}
            onResend={handleResend}
            onRewrite={handleRewrite}
            onRevert={handleRevert}
            onCopy={handleCopyMessage}
            isCopied={copiedMsgIndex === index}
            isStreaming={isStreaming}
          />
        ))}

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
              <span>Thinking…</span>
            </div>
          </div>
        )}

        {/* Streaming text preview bubble */}
        {streamingText && (
          <ChatMessage message={{ role: 'assistant', content: streamingText }} isStreaming />
        )}
      </div>

      {/* Input panel at bottom */}
      <div
        style={{
          padding: 'var(--space-3) var(--space-4) var(--space-4)',
          borderTop: '1px solid var(--color-surface-offset)',
          background: 'var(--color-surface-1)',
          flexShrink: 0
        }}
      >
        {/* Skill Selector Pill Bar + Workspace pill */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', marginBottom: '8px' }}>
          {AI_SKILLS.map(skill => {
            const isActive = activeSkillId === skill.id
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
                <span>{skill.shortLabel}</span>
              </button>
            )
          })}

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

          {/* Token Budget Indicator */}
          <div
            title={`~${tokenUsage.used.toLocaleString()} / ${CONTEXT_WINDOW_TOKENS.toLocaleString()} tokens of context window estimated in use`}
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
          onTriggerPrompt={handleSubmitWithText}
        />
      </div>

      {/* Cookbook Model Manager Popup Modal */}
      {showCookbookModal && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 100,
            background: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 'var(--space-4)'
          }}
        >
          <div
            style={{
              background: 'var(--color-surface-1)',
              border: '1px solid var(--color-surface-offset)',
              borderRadius: 'var(--radius-md)',
              width: '100%',
              maxHeight: '90%',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
              overflow: 'hidden'
            }}
          >
            {/* Header */}
            <div
              style={{
                padding: 'var(--space-3) var(--space-4)',
                borderBottom: '1px solid var(--color-surface-offset)',
                background: 'var(--color-surface-2)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexShrink: 0
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                <BookOpen size={14} style={{ color: 'var(--color-secondary)' }} />
                <span style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-base)' }}>
                  Model Cookbook
                </span>
              </div>
              <button
                onClick={() => setShowCookbookModal(false)}
                style={{ background: 'transparent', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', padding: '2px' }}
              >
                <X size={14} />
              </button>
            </div>

            {/* Models List */}
            <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-3)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              {/* Local Installed Models Section */}
              <div>
                <div style={{ fontSize: '10px', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-muted)', textTransform: 'uppercase', marginBottom: '6px' }}>
                  Installed Local Models
                </div>
                {(() => {
                  const effectiveModels = Array.from(new Set([
                    ...localModels,
                    ...(selectedModel ? [selectedModel] : [])
                  ]))
                  if (effectiveModels.length === 0) {
                    return <div style={{ fontSize: '11px', color: 'var(--color-text-faint)', fontStyle: 'italic' }}>No local Ollama models detected.</div>
                  }
                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      {effectiveModels.map(m => {
                        const isSelected = selectedModel === m
                        return (
                          <div
                            key={m}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              padding: '6px 10px',
                              background: isSelected ? 'var(--color-secondary-muted)' : 'var(--color-surface-2)',
                              border: '1px solid var(--color-surface-offset)',
                              borderRadius: 'var(--radius-sm)',
                              fontSize: '11px'
                            }}
                          >
                            <span style={{ fontWeight: isSelected ? 'bold' : 'normal', color: isSelected ? 'var(--color-secondary)' : 'var(--color-text-base)' }}>
                              {m}
                            </span>
                            <button
                              onClick={() => { handleModelChange(m); setShowCookbookModal(false) }}
                              style={{
                                background: isSelected ? 'var(--color-secondary)' : 'var(--color-surface-1)',
                                color: isSelected ? '#000' : 'var(--color-text-base)',
                                border: 'none',
                                borderRadius: 'var(--radius-sm)',
                                padding: '2px 8px',
                                fontSize: '10px',
                                fontWeight: 'bold',
                                cursor: 'pointer'
                              }}
                            >
                              {isSelected ? 'Active' : 'Select'}
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  )
                })()}
              </div>

              {/* Catalog Available Models */}
              <div>
                <div style={{ fontSize: '10px', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-muted)', textTransform: 'uppercase', marginBottom: '6px' }}>
                  Catalog Models
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {(catalogData as any[]).map(cat => {
                    const q4Tag = cat.variants?.q4?.ollamaTag || cat.id
                    const effectiveModels = Array.from(new Set([...localModels, ...(selectedModel ? [selectedModel] : [])]))
                    const isInstalled = effectiveModels.some(lm => {
                      const normLm = lm.toLowerCase().replace(/[:-]/g, '')
                      const normCatId = cat.id.toLowerCase().replace(/[:-]/g, '')
                      return normLm.includes(normCatId) || normCatId.includes(normLm) || (cat.id.includes('gemma') && lm.toLowerCase().includes('gemma'))
                    })
                    const isPullingThis = pullingTag === q4Tag
                    return (
                      <div
                        key={cat.id}
                        style={{
                          padding: '8px 10px',
                          background: 'var(--color-surface-2)',
                          border: '1px solid var(--color-surface-offset)',
                          borderRadius: 'var(--radius-sm)',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '4px'
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <span style={{ fontSize: '11px', fontWeight: 'bold', color: 'var(--color-text-base)' }}>{cat.name}</span>
                          {isInstalled ? (
                            <button
                              onClick={() => {
                                const matched = effectiveModels.find(lm => {
                                  const normLm = lm.toLowerCase().replace(/[:-]/g, '')
                                  const normCatId = cat.id.toLowerCase().replace(/[:-]/g, '')
                                  return normLm.includes(normCatId) || normCatId.includes(normLm) || (cat.id.includes('gemma') && lm.toLowerCase().includes('gemma'))
                                }) || q4Tag
                                handleModelChange(matched);
                                setShowCookbookModal(false)
                              }}
                              style={{ background: 'var(--color-surface-1)', color: 'var(--color-secondary)', border: '1px solid var(--color-secondary-muted)', borderRadius: 'var(--radius-sm)', padding: '2px 8px', fontSize: '10px', fontWeight: 'bold', cursor: 'pointer' }}
                            >
                              Select
                            </button>
                          ) : (
                            <button
                              disabled={isPullingThis}
                              onClick={() => handlePullModel(q4Tag)}
                              style={{ background: 'var(--color-primary)', color: '#fff', border: 'none', borderRadius: 'var(--radius-sm)', padding: '2px 8px', fontSize: '10px', fontWeight: 'bold', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
                            >
                              {isPullingThis ? <RefreshCw size={10} className="spin" /> : <Download size={10} />}
                              <span>{isPullingThis ? `${pullProgress}%` : 'Download'}</span>
                            </button>
                          )}
                        </div>
                        <div style={{ fontSize: '10px', color: 'var(--color-text-muted)', lineHeight: '1.3' }}>{cat.description}</div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Saved Chats Drawer Modal */}
      {showSavedChatsModal && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 100,
            background: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 'var(--space-4)'
          }}
        >
          <div
            style={{
              background: 'var(--color-surface-1)',
              border: '1px solid var(--color-surface-offset)',
              borderRadius: 'var(--radius-md)',
              width: '100%',
              maxHeight: '90%',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
              overflow: 'hidden'
            }}
          >
            {/* Header */}
            <div
              style={{
                padding: 'var(--space-3) var(--space-4)',
                borderBottom: '1px solid var(--color-surface-offset)',
                background: 'var(--color-surface-2)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexShrink: 0
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                <MessageSquare size={14} style={{ color: 'var(--color-secondary)' }} />
                <span style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-base)' }}>
                  Saved Chats ({savedChats.length}/50)
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                <button
                  onClick={handleNewChat}
                  style={{
                    background: 'var(--color-secondary)',
                    color: '#000',
                    border: 'none',
                    borderRadius: 'var(--radius-sm)',
                    padding: '2px 8px',
                    fontSize: '10px',
                    fontWeight: 'bold',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '2px'
                  }}
                >
                  <Plus size={10} />
                  <span>New</span>
                </button>
                <button
                  onClick={() => setShowSavedChatsModal(false)}
                  style={{ background: 'transparent', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', padding: '2px' }}
                >
                  <X size={14} />
                </button>
              </div>
            </div>

            {/* List */}
            <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-3)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {savedChats.length === 0 ? (
                <div style={{ fontSize: '11px', color: 'var(--color-text-faint)', textAlign: 'center', padding: 'var(--space-4)' }}>
                  No saved conversations yet. Start chatting to auto-save!
                </div>
              ) : (
                savedChats.map(chat => {
                  const isActive = chat.id === currentChatId
                  const isEditing = editingChatId === chat.id
                  return (
                    <div
                      key={chat.id}
                      onClick={() => handleLoadChat(chat)}
                      style={{
                        padding: '8px 10px',
                        background: isActive ? 'var(--color-secondary-muted)' : 'var(--color-surface-2)',
                        border: isActive ? '1px solid var(--color-secondary)' : '1px solid var(--color-surface-offset)',
                        borderRadius: 'var(--radius-sm)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        cursor: 'pointer',
                        transition: 'background 150ms ease'
                      }}
                    >
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', overflow: 'hidden', flex: 1, marginRight: '8px' }}>
                        {isEditing ? (
                          <input
                            type="text"
                            value={editingTitle}
                            autoFocus
                            onClick={e => e.stopPropagation()}
                            onChange={e => setEditingTitle(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') handleSaveRename(chat.id)
                              if (e.key === 'Escape') setEditingChatId(null)
                            }}
                            onBlur={() => handleSaveRename(chat.id)}
                            style={{
                              background: 'var(--color-surface-1)',
                              border: '1px solid var(--color-secondary)',
                              color: 'var(--color-text-base)',
                              borderRadius: 'var(--radius-sm)',
                              padding: '1px 4px',
                              fontSize: '11px',
                              outline: 'none'
                            }}
                          />
                        ) : (
                          <span style={{ fontSize: '11px', fontWeight: isActive ? 'bold' : 'normal', color: isActive ? 'var(--color-secondary)' : 'var(--color-text-base)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {chat.title}
                          </span>
                        )}
                        <span style={{ fontSize: '9px', color: 'var(--color-text-muted)' }}>
                          {chat.messages.length} messages • {new Date(chat.createdAt).toLocaleDateString()}
                        </span>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
                        <button
                          onClick={e => {
                            e.stopPropagation()
                            setEditingChatId(chat.id)
                            setEditingTitle(chat.title)
                          }}
                          style={{ background: 'transparent', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', padding: '2px' }}
                          title="Rename Chat"
                        >
                          <Edit2 size={11} />
                        </button>
                        <button
                          onClick={e => handleDeleteChat(chat.id, e)}
                          style={{ background: 'transparent', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', padding: '2px' }}
                          title="Delete Chat"
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </div>
      )}
      {/* Memory Vault Modal */}
      {showMemoryPanel && (() => {
        const CATEGORY_COLORS: Record<string, string> = {
          semantic: '#3b82f6',
          episodic: '#f59e0b',
          working: '#6b7280'
        }
        const CATEGORY_LABELS: Record<string, string> = {
          semantic: 'FACT',
          episodic: 'EPISODE',
          working: 'WORKING'
        }
        const filteredMems = memorySearchQuery.trim()
          ? memories.filter((m: any) =>
              m.memory_key.toLowerCase().includes(memorySearchQuery.toLowerCase()) ||
              m.content.toLowerCase().includes(memorySearchQuery.toLowerCase()) ||
              m.category.toLowerCase().includes(memorySearchQuery.toLowerCase())
            )
          : memories

        const pinnedMems = filteredMems.filter((m: any) => m.is_pinned)
        const unpinnedMems = filteredMems.filter((m: any) => !m.is_pinned)
        const orderedMems = [...pinnedMems, ...unpinnedMems]

        return (
          <div style={{
            position: 'absolute', inset: 0, zIndex: 100,
            background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(6px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '16px'
          }}>
            <div style={{
              background: 'var(--color-surface-1)',
              border: '1px solid var(--color-surface-offset)',
              borderRadius: 'var(--radius-md)', width: '100%', maxHeight: '92%',
              display: 'flex', flexDirection: 'column',
              boxShadow: '0 16px 48px rgba(0,0,0,0.6)', overflow: 'hidden'
            }}>
              {/* Header */}
              <div style={{
                padding: '10px 14px',
                borderBottom: '1px solid var(--color-surface-offset)',
                background: 'var(--color-surface-2)',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Brain size={14} style={{ color: '#a855f7' }} />
                  <span style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--color-text-base)' }}>
                    Memory Vault
                  </span>
                  <span style={{ fontSize: '9px', color: 'var(--color-text-muted)', background: 'var(--color-surface-offset)', padding: '1px 7px', borderRadius: '10px' }}>
                    {activeContext}
                  </span>
                  <span style={{ fontSize: '10px', color: '#a855f7', background: 'rgba(168,85,247,0.1)', padding: '1px 7px', borderRadius: '10px', fontWeight: 'bold' }}>
                    {memories.length} memories
                  </span>
                  {memoryConsolidating && (
                    <span style={{ fontSize: '9px', color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <RefreshCw size={9} style={{ animation: 'spin 1s linear infinite' }} />
                      Consolidating…
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <button
                    onClick={() => setShowAddMemoryForm(v => !v)}
                    style={{
                      background: showAddMemoryForm ? 'var(--color-secondary)' : 'rgba(168,85,247,0.12)',
                      border: '1px solid rgba(168,85,247,0.3)',
                      color: showAddMemoryForm ? '#fff' : '#a855f7',
                      borderRadius: 'var(--radius-sm)', padding: '3px 8px',
                      fontSize: '10px', fontWeight: 'bold', cursor: 'pointer',
                      display: 'flex', alignItems: 'center', gap: '4px'
                    }}
                  >
                    <Plus size={10} /> Add Memory
                  </button>
                  <button onClick={() => { setShowMemoryPanel(false); setShowAddMemoryForm(false); setEditingMemoryId(null); setMemorySearchQuery('') }}
                    style={{ background: 'transparent', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', padding: '2px' }}>
                    <X size={14} />
                  </button>
                </div>
              </div>

              {/* Search Bar */}
              <div style={{ padding: '8px 14px', borderBottom: '1px solid var(--color-surface-offset)', flexShrink: 0 }}>
                <input
                  type="text"
                  placeholder="Search memories…"
                  value={memorySearchQuery}
                  onChange={e => setMemorySearchQuery(e.target.value)}
                  style={{
                    width: '100%', boxSizing: 'border-box',
                    background: 'var(--color-surface-2)',
                    border: '1px solid var(--color-surface-offset)',
                    borderRadius: 'var(--radius-sm)',
                    color: 'var(--color-text-base)',
                    fontSize: '11px', padding: '5px 10px', outline: 'none'
                  }}
                />
              </div>

              {/* Add Memory Form */}
              {showAddMemoryForm && (
                <div style={{
                  padding: '10px 14px',
                  borderBottom: '1px solid var(--color-surface-offset)',
                  background: 'rgba(168,85,247,0.05)',
                  display: 'flex', flexDirection: 'column', gap: '6px', flexShrink: 0
                }}>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <input
                      type="text"
                      placeholder="Memory key (e.g. player_movement_system)"
                      value={newMemoryKey}
                      onChange={e => setNewMemoryKey(e.target.value)}
                      style={{
                        flex: 1, background: 'var(--color-surface-2)',
                        border: '1px solid rgba(168,85,247,0.3)',
                        borderRadius: 'var(--radius-sm)', color: 'var(--color-text-base)',
                        fontSize: '11px', padding: '5px 8px', outline: 'none'
                      }}
                    />
                    <select
                      value={newMemoryCategory}
                      onChange={e => setNewMemoryCategory(e.target.value as any)}
                      style={{
                        background: 'var(--color-surface-2)',
                        border: '1px solid rgba(168,85,247,0.3)',
                        borderRadius: 'var(--radius-sm)', color: 'var(--color-text-base)',
                        fontSize: '11px', padding: '5px 6px', outline: 'none'
                      }}
                    >
                      <option value="semantic">Semantic (Fact)</option>
                      <option value="episodic">Episodic (Event)</option>
                      <option value="working">Working (Temp)</option>
                    </select>
                  </div>
                  <textarea
                    placeholder="What should the AI remember?"
                    value={newMemoryContent}
                    onChange={e => setNewMemoryContent(e.target.value)}
                    rows={2}
                    style={{
                      width: '100%', boxSizing: 'border-box', resize: 'none',
                      background: 'var(--color-surface-2)',
                      border: '1px solid rgba(168,85,247,0.3)',
                      borderRadius: 'var(--radius-sm)', color: 'var(--color-text-base)',
                      fontSize: '11px', padding: '5px 8px', outline: 'none',
                      fontFamily: 'inherit'
                    }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '6px' }}>
                    <button
                      onClick={() => { setShowAddMemoryForm(false); setNewMemoryKey(''); setNewMemoryContent('') }}
                      style={{ background: 'transparent', border: '1px solid var(--color-surface-offset)', color: 'var(--color-text-muted)', borderRadius: 'var(--radius-sm)', padding: '3px 10px', fontSize: '10px', cursor: 'pointer' }}
                    >Cancel</button>
                    <button
                      onClick={handleAddMemory}
                      disabled={!newMemoryKey.trim() || !newMemoryContent.trim()}
                      style={{
                        background: newMemoryKey.trim() && newMemoryContent.trim() ? '#a855f7' : 'var(--color-surface-offset)',
                        border: 'none', color: '#fff', borderRadius: 'var(--radius-sm)',
                        padding: '3px 10px', fontSize: '10px', fontWeight: 'bold', cursor: 'pointer'
                      }}
                    >Save Memory</button>
                  </div>
                </div>
              )}

              {/* Memory List */}
              <div style={{ flex: 1, overflowY: 'auto', padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: '5px' }}>
                {memoryLoading ? (
                  <div style={{ fontSize: '11px', color: 'var(--color-text-muted)', textAlign: 'center', padding: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                    <RefreshCw size={12} style={{ animation: 'spin 1s linear infinite' }} />
                    Loading memories…
                  </div>
                ) : orderedMems.length === 0 ? (
                  <div style={{ fontSize: '11px', color: 'var(--color-text-faint)', textAlign: 'center', padding: '24px', fontStyle: 'italic', lineHeight: 1.6 }}>
                    {memorySearchQuery ? `No memories match "${memorySearchQuery}"` : (
                      <>No memories stored for this workspace yet.<br />The AI will automatically extract important facts as you chat.</>
                    )}
                  </div>
                ) : (
                  orderedMems.map((mem: any) => (
                    <div key={mem.id} style={{
                      padding: '8px 10px',
                      background: mem.is_pinned
                        ? 'linear-gradient(135deg, rgba(168,85,247,0.1) 0%, rgba(59,130,246,0.06) 100%)'
                        : 'var(--color-surface-2)',
                      border: `1px solid ${mem.is_pinned ? 'rgba(168,85,247,0.35)' : 'var(--color-surface-offset)'}`,
                      borderRadius: 'var(--radius-sm)',
                      display: 'flex', flexDirection: 'column', gap: '5px',
                      transition: 'border-color 150ms'
                    }}>
                      {/* Memory Header Row */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flex: 1, overflow: 'hidden', minWidth: 0 }}>
                          <span style={{
                            fontSize: '9px', fontWeight: 'bold', flexShrink: 0,
                            color: CATEGORY_COLORS[mem.category] || '#6b7280',
                            background: `${CATEGORY_COLORS[mem.category] || '#6b7280'}18`,
                            border: `1px solid ${CATEGORY_COLORS[mem.category] || '#6b7280'}40`,
                            padding: '1px 5px', borderRadius: '3px'
                          }}>
                            {CATEGORY_LABELS[mem.category] || mem.category.toUpperCase()}
                          </span>
                          <span style={{
                            fontSize: '11px', fontWeight: 'bold',
                            color: mem.is_pinned ? '#c084fc' : 'var(--color-text-base)',
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
                          }}>
                            {mem.memory_key}
                          </span>
                        </div>
                        {/* Action Buttons */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '2px', flexShrink: 0 }}>
                          <button
                            onClick={() => handleTogglePinMemory(mem.id)}
                            title={mem.is_pinned ? 'Unpin memory' : 'Pin memory (always recalled first)'}
                            style={{
                              background: mem.is_pinned ? 'rgba(168,85,247,0.15)' : 'transparent',
                              border: 'none',
                              color: mem.is_pinned ? '#a855f7' : 'var(--color-text-faint)',
                              cursor: 'pointer', padding: '2px 4px', borderRadius: '3px', fontSize: '11px'
                            }}
                          >📌</button>
                          <button
                            onClick={() => editingMemoryId === mem.id ? setEditingMemoryId(null) : handleStartEditMemory(mem)}
                            title="Edit memory content"
                            style={{
                              background: editingMemoryId === mem.id ? 'rgba(59,130,246,0.15)' : 'transparent',
                              border: 'none',
                              color: editingMemoryId === mem.id ? '#3b82f6' : 'var(--color-text-faint)',
                              cursor: 'pointer', padding: '2px 4px', borderRadius: '3px'
                            }}
                          ><Edit2 size={10} /></button>
                          <button
                            onClick={() => handleDeleteMemory(mem.id)}
                            title="Delete memory"
                            style={{ background: 'transparent', border: 'none', color: 'var(--color-text-faint)', cursor: 'pointer', padding: '2px 4px', borderRadius: '3px' }}
                          ><Trash2 size={10} /></button>
                        </div>
                      </div>

                      {/* Content, editable or read-only */}
                      {editingMemoryId === mem.id ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <textarea
                            value={editingMemoryContent}
                            onChange={e => setEditingMemoryContent(e.target.value)}
                            rows={3}
                            autoFocus
                            style={{
                              width: '100%', boxSizing: 'border-box', resize: 'vertical',
                              background: 'var(--color-surface-1)',
                              border: '1px solid rgba(59,130,246,0.4)',
                              borderRadius: '3px', color: 'var(--color-text-base)',
                              fontSize: '11px', padding: '4px 6px', outline: 'none',
                              fontFamily: 'inherit', lineHeight: 1.4
                            }}
                          />
                          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '4px' }}>
                            <button
                              onClick={() => setEditingMemoryId(null)}
                              style={{ background: 'transparent', border: '1px solid var(--color-surface-offset)', color: 'var(--color-text-muted)', borderRadius: '3px', padding: '2px 8px', fontSize: '10px', cursor: 'pointer' }}
                            >Cancel</button>
                            <button
                              onClick={() => handleSaveEditMemory(mem.id)}
                              style={{ background: '#3b82f6', border: 'none', color: '#fff', borderRadius: '3px', padding: '2px 8px', fontSize: '10px', fontWeight: 'bold', cursor: 'pointer' }}
                            >Save</button>
                          </div>
                        </div>
                      ) : (
                        <div style={{ fontSize: '11px', color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
                          {mem.content}
                        </div>
                      )}

                      {/* Footer meta */}
                      <div style={{ fontSize: '9px', color: 'var(--color-text-faint)', display: 'flex', gap: '8px' }}>
                        <span>Recalled {mem.access_count}×</span>
                        <span>·</span>
                        <span>Updated {new Date(mem.updated_at).toLocaleDateString()}</span>
                        {mem.is_pinned && <span style={{ color: '#a855f7' }}>· Always recalled</span>}
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Footer legend */}
              <div style={{
                padding: '6px 14px',
                borderTop: '1px solid var(--color-surface-offset)',
                background: 'var(--color-surface-2)',
                display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0
              }}>
                {Object.entries(CATEGORY_LABELS).map(([cat, label]) => (
                  <div key={cat} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <span style={{
                      width: '6px', height: '6px', borderRadius: '50%',
                      background: CATEGORY_COLORS[cat], display: 'inline-block', flexShrink: 0
                    }} />
                    <span style={{ fontSize: '9px', color: 'var(--color-text-muted)' }}>{label}</span>
                  </div>
                ))}
                <span style={{ fontSize: '9px', color: 'var(--color-text-faint)', marginLeft: 'auto' }}>
                  Auto-extracted after each AI response
                </span>
              </div>
            </div>
          </div>
        )
      })()}

      {/* Styled Revert Confirmation Modal */}
      {revertConfirmData && (
        <div className="modal-overlay" onClick={() => setRevertConfirmData(null)}>
          <style>{`
            .modal-overlay {
              position: fixed;
              top: 0;
              left: 0;
              right: 0;
              bottom: 0;
              background: rgba(0, 0, 0, 0.75);
              z-index: 2000;
              display: flex;
              align-items: center;
              justify-content: center;
              backdrop-filter: blur(5px);
              animation: modal-fade-in 150ms ease-out;
            }
            .revert-modal {
              width: 440px;
              background: var(--color-surface-1);
              border: 1px solid var(--color-surface-offset);
              border-radius: var(--radius-lg);
              padding: var(--space-6);
              display: flex;
              flex-direction: column;
              gap: var(--space-4);
              box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);
              animation: modal-scale-in 200ms cubic-bezier(0.16, 1, 0.3, 1);
            }
            @keyframes modal-fade-in {
              from { opacity: 0; }
              to { opacity: 1; }
            }
            @keyframes modal-scale-in {
              from { transform: scale(0.95); opacity: 0; }
              to { transform: scale(1); opacity: 1; }
            }
          `}</style>
          <div className="revert-modal" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true">
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
              <Trash2 style={{ color: 'var(--color-error)' }} size={22} />
              <h2 style={{ fontSize: 'var(--text-md)', fontWeight: 'var(--weight-semibold)', margin: 0 }}>
                Revert Board State
              </h2>
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-base)', margin: 0, lineHeight: 1.5 }}>
                Are you sure you want to revert the board to the state before this message was sent?
              </p>
              <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', margin: 0, lineHeight: 1.5 }}>
                This will **permanently delete** any columns or cards created during this conversation turn, restore the prior snapshot, and truncate the chat history.
              </p>
            </div>

            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '4px' }}>
              <button
                onClick={() => setRevertConfirmData(null)}
                style={{
                  background: 'transparent',
                  border: '1px solid var(--color-surface-offset)',
                  borderRadius: 'var(--radius-md)',
                  color: 'var(--color-text-base)',
                  padding: '6px 14px',
                  fontSize: 'var(--text-xs)',
                  cursor: 'pointer',
                  fontWeight: 'var(--weight-medium)',
                  transition: 'background-color 150ms'
                }}
                onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--color-surface-2)'}
                onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  const data = revertConfirmData
                  setRevertConfirmData(null)
                  try {
                    await restoreBoardFromSnapshot(data.snapshot)
                    setMessages(prev => prev.slice(0, data.index))
                  } catch (err) {
                    console.error('Failed to revert board snapshot:', err)
                  }
                }}
                style={{
                  background: 'var(--color-error)',
                  border: 'none',
                  borderRadius: 'var(--radius-md)',
                  color: 'var(--color-text-inverted)',
                  padding: '6px 14px',
                  fontSize: 'var(--text-xs)',
                  cursor: 'pointer',
                  fontWeight: 'bold',
                  transition: 'opacity 150ms'
                }}
                onMouseEnter={e => e.currentTarget.style.opacity = '0.9'}
                onMouseLeave={e => e.currentTarget.style.opacity = '1'}
              >
                Revert Changes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}