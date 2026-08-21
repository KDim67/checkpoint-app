import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Sparkles, Trash2, BookOpen, X, Download, RefreshCw, MessageSquare, Plus, Edit2, Brain, Sliders, FileDown, FolderOpen, Gauge, Search, Pin, ArrowDown } from 'lucide-react'
import { useAppStore } from '../store/appStore'
import type { Item } from '../../../shared/types'
import catalogData from '../../../shared/catalog.json'
import ContextPill from './ai/ContextPill'
import ChatMessage, { clearActionCaches } from './ai/ChatMessage'
import ChatInput from './ai/ChatInput'
import { AI_SKILLS, getSkillById } from './ai/skills'
import { buildAssistantMessage, PALETTE_HINT } from './ai/boardEnrich'
import { loadProviders, persistProviders, activateProvider, isLocalUrl, type AiProvider } from './ai/aiProviders'
import { useToast } from './ui/Toast'
import { useModelCapabilities } from '../lib/useModelCapabilities'
import ModelCapabilityBar from './ai/ModelCapabilityBar'
import { TIER_BUDGETS, detectVisionFromName } from '../../../shared/modelCapabilities'

interface Message {
  role: 'system' | 'user' | 'assistant'
  content: string
  /** Chain-of-thought extracted from <think>…</think> tags (reasoning models). */
  thinking?: string
  /** Optional concise label shown in the bubble instead of the full prompt (quick actions). */
  displayContent?: string
  /** Explicit intent from a quick-action button, so it can't be mis-classified by keywords. */
  intentHint?: 'create' | 'analyze'
  mode?: string
  cheatsheets?: string[]
  /** Attached note titles (from the Notes feature). */
  notes?: string[]
  /** Attached workspace file relative paths. */
  files?: string[]
  /** Attached images as data URLs (vision models). */
  images?: string[]
  timestamp?: number
  boardSnapshot?: {
    columns: any[]
    cards: any[]
  }
}

const STORAGE_KEY_SAVED_CHATS = 'checkpoint_ai_saved_chats'
const STORAGE_KEY_ACTIVE_SKILL = 'checkpoint_ai_active_skill'
const STORAGE_KEY_WORKSPACE_FOLDER = 'checkpoint_ai_workspace_folder'

// Dedicated stream channel, keeps this panel's stream isolated from other
// consumers (e.g. the Standup Translator) so both can run concurrently.
const ASSISTANT_STREAM_ID = 'assistant'

/**
 * Name-only fallback, for the model dropdown where a per-entry IPC probe would
 * be wasteful. The live model uses discovered capabilities via
 * useModelCapabilities; this is only a hint for models the user has not
 * selected yet.
 */
export function supportsVision(modelName: string): boolean {
  return detectVisionFromName(modelName)
}

export function parseThinkingAndContent(text: string) {
  let thinking = ''
  let content = text

  let thinkStartIdx = -1
  let tagLength = 0
  let endTag = ''

  const startTags = [
    { tag: '<think>', end: '</think>' },
    { tag: '<thought>', end: '</thought>' },
    { tag: '<thinking>', end: '</thinking>' }
  ]

  for (const item of startTags) {
    const idx = text.indexOf(item.tag)
    if (idx !== -1 && (thinkStartIdx === -1 || idx < thinkStartIdx)) {
      thinkStartIdx = idx
      tagLength = item.tag.length
      endTag = item.end
    }
  }

  if (thinkStartIdx !== -1) {
    const thinkEndIdx = text.indexOf(endTag)
    if (thinkEndIdx !== -1) {
      thinking = text.slice(thinkStartIdx + tagLength, thinkEndIdx).trim()
      content = (text.slice(0, thinkStartIdx) + text.slice(thinkEndIdx + endTag.length)).trim()
    } else {
      thinking = text.slice(thinkStartIdx + tagLength).trim()
      content = text.slice(0, thinkStartIdx).trim()
    }
  }
  return { thinking, content }
}

interface WorkspaceFileInfo {
  name: string
  relativePath: string
  extension: string
  size: number
}

// Rough, fast token estimate, no tokenizer dependency.
//
// A flat 4 chars/token holds for Latin prose but understates CJK badly: those
// codepoints cost roughly a token each, so a Chinese conversation was reported
// at a quarter of its real size and blew the context window without warning.
// Counted separately, then combined.
const CJK_RE = /[぀-ヿ㐀-䶿一-鿿豈-﫿가-힯]/g

function estimateTokens(text: string): number {
  if (!text) return 0
  const cjkCount = text.match(CJK_RE)?.length ?? 0
  const rest = text.length - cjkCount
  return Math.ceil(cjkCount + rest / 4)
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

// Semantic intent classifier, replaces the fragile keyword-heuristic approach.
// Returns what action type the model should take, factoring in the active skill.
// Defaults to 'converse' to prevent hallucination when intent is ambiguous.
type IntentType = 'create_items' | 'create_plan' | 'create_dialogue' | 'update_items' | 'converse'

function classifyIntent(text: string, activeSkillId: string | null): IntentType {
  const lower = text.toLowerCase().trim()

  // Board EDITING signals (existing cards), checked before creation so
  // "move X to done" never reads as a create request. High-precision patterns.
  if (
    /\b(move|put|shift|transfer)\b[\s\S]{0,60}\b(to|into|in)\b[\s\S]{0,40}\b(column|done|progress|review|backlog|lane|stage)\b/.test(lower) ||
    /\barchive\b[\s\S]{0,60}\b(card|task|item|column|everything|all|done)\b/.test(lower) ||
    /\b(set|change|bump|raise|lower|update|increase|decrease)\b[\s\S]{0,50}\bpriorit/.test(lower) ||
    /\bmark\b[\s\S]{0,60}\bas\b[\s\S]{0,20}\b(done|complete|completed|finished|in.progress|review)\b/.test(lower) ||
    /\brename\b[\s\S]{0,60}\b(card|task|item)\b/.test(lower) ||
    /\b(reprioriti[sz]e|re-prioriti[sz]e)\b/.test(lower) ||
    /\b(set|change|add|update|clear|remove|push|extend)\b[\s\S]{0,50}\b(due date|deadline|due)\b/.test(lower) ||
    /\b(due|deadline)\b[\s\S]{0,30}\b(to|for|on|by)\b[\s\S]{0,30}\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|next week|\d)/.test(lower)
  ) return 'update_items'

  // Skill-specific intent elevation: active skill biases strongly toward its native format
  if (activeSkillId === 'narrative_specialist') {
    const dialogueTriggers = ['dialogue', 'dialog', 'quest', 'story', 'narrative', 'write', 'create', 'generate', 'design', 'character', 'npc', 'scene', 'conversation', 'lore', 'plot']
    if (dialogueTriggers.some(t => lower.includes(t))) return 'create_dialogue'
  }
  if (activeSkillId === 'implementation_planner') {
    const planTriggers = ['plan', 'implement', 'build', 'design', 'system', 'feature', 'how', 'approach', 'steps', 'architect', 'refactor', 'create', 'generate', 'scaffold']
    if (planTriggers.some(t => lower.includes(t))) return 'create_plan'
  }

  // High-confidence dialogue signals (explicit multi-word patterns)
  if (/dialogue tree|quest flow|branching dialogue|npc dialogue|create.*dialogue|dialogue.*for|conversation.*tree/.test(lower)) return 'create_dialogue'

  // High-confidence plan signals
  if (/implementation plan|create.*plan|make.*plan|step.by.step plan|detailed plan|plan for/.test(lower)) return 'create_plan'

  // Item creation: requires BOTH an imperative verb AND an item noun (high-precision pairing)
  const CREATE_VERBS = ['create', 'add', 'make', 'generate', 'build', 'populate', 'set up', 'scaffold', 'give me', 'suggest', 'produce']
  const ITEM_NOUNS  = ['card', 'task', 'column', 'board', 'ticket', 'item', 'stage', 'more task', 'another task', 'some task', 'few task']
  const hasCreateVerb = CREATE_VERBS.some(v => lower.includes(v))
  const hasItemNoun   = ITEM_NOUNS.some(n => lower.includes(n))
  if (hasCreateVerb && hasItemNoun) return 'create_items'

  // "more" / "another" as standalone follow-up → create more of whatever the current topic is
  if (/^(more|add more|another|give me more|a few more|some more)/.test(lower)) return 'create_items'

  // Default to conversational, only output JSON when explicitly requested
  return 'converse'
}

// Automatic skill recall, infers which specialized skill best fits the message
// so the user never has to manually pick one (they still can, to pin it).
function detectSkill(text: string): string | null {
  const t = (text || '').toLowerCase()
  if (!t.trim()) return null

  const scores: Record<string, number> = {
    narrative_specialist: 0,
    implementation_planner: 0,
    kanban_architect: 0
  }
  const bump = (id: string, kws: string[], w = 1): void => {
    for (const k of kws) if (t.includes(k)) scores[id] += w
  }

  bump('narrative_specialist', ['dialogue', 'dialog', 'quest', 'story', 'narrative', 'lore', 'npc', 'cutscene', 'worldbuild', 'character arc', 'branching', 'conversation tree'], 2)
  bump('narrative_specialist', ['character', 'plot', 'scene', 'voice'])

  bump('implementation_planner', ['implementation plan', 'step-by-step', 'step by step', 'roadmap', 'architecture', 'design doc', 'technical spec', 'how should i build', 'how do i implement', 'approach for'], 2)
  bump('implementation_planner', ['plan', 'implement', 'architect', 'refactor', 'strategy', 'milestone'])

  bump('kanban_architect', ['column', 'columns', 'board', 'kanban', 'backlog', 'sprint', 'workflow', 'lane', 'wip', 'swimlane', 'pipeline stage'], 2)
  bump('kanban_architect', ['card', 'cards', 'task', 'tasks', 'ticket', 'prioriti', 'organize', 'break down'])

  let best: string | null = null
  let bestScore = 0
  for (const [id, s] of Object.entries(scores)) {
    if (s > bestScore) { bestScore = s; best = id }
  }
  return bestScore >= 2 ? best : null
}

/** True when the user is asking for board structure (columns/stages/lanes), not just cards. */
function wantsColumns(text: string): boolean {
  return /\b(column|columns|lane|lanes|stage|stages|swimlane|set ?up (a|the|my)? ?board|board structure|workflow|pipeline|restructure)\b/i.test(text || '')
}

/**
 * Helper to parse assistant response content and extract the exact card titles
 * and column names that the AI attempted to create.
 */
function getAIEntitiesFromMessage(content: string): { cardTitles: string[]; columnNames: string[] } {
  const cardTitles: string[] = []
  const columnNames: string[] = []

  // Regex to extract text inside ```json ... ``` blocks
  const regex = /```json(?::\w+)?\s*([\s\S]*?)\s*```/g
  let match
  while ((match = regex.exec(content)) !== null) {
    try {
      const jsonText = match[1].trim()
      const parsed = JSON.parse(jsonText)
      
      if (parsed && typeof parsed === 'object') {
        // 1. Batch format
        if (Array.isArray(parsed.cards)) {
          parsed.cards.forEach((c: any) => {
            if (c && c.title) cardTitles.push(c.title.trim())
          })
        }
        if (Array.isArray(parsed.columns)) {
          parsed.columns.forEach((col: any) => {
            if (col && col.name) columnNames.push(col.name.trim())
          })
        }

        // 2. Single card format
        if (parsed.title && !parsed.cards) {
          cardTitles.push(parsed.title.trim())
        }

        // 3. Single column format
        if (parsed.name && !parsed.columns) {
          columnNames.push(parsed.name.trim())
        }
      }
    } catch (e) {
      // Skip invalid JSON
    }
  }

  return { cardTitles, columnNames }
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

  // Memory panel
  const [showMemoryPanel, setShowMemoryPanel] = useState(false)
  const [recalledMemCount, setRecalledMemCount] = useState(0)
  const [waitingLabel, setWaitingLabel] = useState('Thinking…')
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
  const auditTurnRef = useRef(0)

  const handleAuditMemories = async () => {
    try {
      setMemoryLoading(true)
      const validContext = activeContext || 'default'
      const audited = await window.electronAPI.memory.auditMemories(validContext, selectedModel)
      setMemories(audited)
      toast('Memory vault audited and optimized!', { type: 'success' })
    } catch (e) {
      console.warn('Memory audit failed:', e)
    } finally {
      setMemoryLoading(false)
    }
  }

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
  interface CustomAction { id: string; label: string; prompt: string; intent: 'create' | 'analyze' }
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
      } catch { /* corrupted setting, start fresh */ }
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

  // Esc anywhere stops an in-flight generation, the input is disabled while
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
      const key = `kanban_columns_${validContext}`
      const rawCols = await window.electronAPI.db.getSetting(key).catch(() => null)
      let columns: any[] = []
      if (typeof rawCols === 'string') {
        try { columns = JSON.parse(rawCols) } catch { columns = [] }
      } else if (Array.isArray(rawCols)) {
        columns = rawCols
      }

      if (columns.length > 0) {
        const updatedCols = columns.filter(col => !columnNames.includes(col.name.trim()))
        await window.electronAPI.db.setSetting(key, JSON.stringify(updatedCols)).catch(() => {})
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
        // Full reset (same as New Chat), also clears the action caches so
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
            `* **\`\/clear\`**, Clears the current chat thread.\n` +
            `* **\`\/mem\`** or **\`\/memory\`**, Opens the **Memory Vault** overlay.\n` +
            `* **\`\/narrative [query]\`**, Switches active skill to **Narrative Specialist** (submits optional query).\n` +
            `* **\`\/kanban [query]\`**, Switches active skill to **Kanban Architect** (submits optional query).\n` +
            `* **\`\/plan\`** or **\`\/planner [query]\`**, Switches active skill to **Implementation Planner** (submits optional query).\n` +
            `* **\`\/help\`**, Displays this command help menu.`,
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
        // name, the old check read '72b'.includes('2b') as true and drove a
        // 72B model with a 2B model's budgets.
        const caps = modelCapsRef.current
        const budget = TIER_BUDGETS[caps.tier]
        const isSmallModel = budget.tersePrompt
        const memoryRecallLimit = budget.memoryRecallLimit
        const workspaceFileCap = budget.workspaceFileCap
        // Reserve the model's real output ceiling instead of a flat guess.
        const contextWindowTokens = Math.max(2048, caps.contextTokens - caps.maxOutputTokens)

        const baseSystemPromptContent = isSmallModel
          ? `You are Checkpoint AI, a helpful project assistant with DIRECT WRITE ACCESS to the user's Kanban board. Anything you create is added to the board automatically.

WHEN CREATING CARDS:
- Give every card a clear title, a concrete one-line body, a priority (1=Low, 2=Medium, 3=High), and 1-3 short tags, each tag with a hex color.
- Reuse existing columns when they fit; only add a new column for a genuinely new stage.
- Never duplicate a card title that already exists on the board.
- ${PALETTE_HINT}

If asked to create, respond with a JSON batch block:
\`\`\`json
{
  "cards": [
    { "title": "Task Title", "body": "What to do / definition of done", "status": "Backlog", "priority": 2, "tags": [{ "name": "gameplay", "color": "#22c55e" }] }
  ]
}
\`\`\`
Otherwise, answer the user's question in friendly plain text.`
          : `You are the Checkpoint AI Assistant, a pair-programming partner and project coordinator built directly into a game developer's visual Kanban workspace. Everything you create is automatically added to the board; there is no copy-paste and no external tool (never mention Trello/Jira/Asana/Notion).

██ WHEN CREATING BOARD ITEMS ██
1. AUDIT first: read the live board state below (columns + card titles) before creating anything.
2. NO DUPLICATES: never create a card whose title matches or heavily overlaps an existing one.
3. REUSE COLUMNS: if the existing columns fit, place cards in them and DO NOT create columns. Only introduce a column for a genuinely new workflow stage.
4. QUALITY over quantity: propose essential, high-impact, well-scoped cards (3-6 by default, or the number requested), no filler.
5. BE CREATIVE & VISUAL: give every card a fitting priority (1-3) and 1-3 topical tags, each with a hex color. Give any new column a fitting hex color. ${PALETTE_HINT}
6. When creation is justified, just do it, don't ask permission or explain first.

██ WHEN CONVERSING ██
- For questions, explanations, audits, or advice: reply in friendly natural-language text. Do NOT emit JSON action blocks unless the user asked to create/add something.
- "Cards" and "Columns" are Checkpoint Kanban items (not playing cards).

██ FORMAT (only when creating) ██
- Batch (preferred for cards): \`\`\`json { "cards": [ { "title", "body", "status", "priority", "tags": [{ "name", "color" }] } ], "columns": [ { "name", "color", "colorMode": "header" } ] } \`\`\`, omit "columns" unless adding new stages.
- Implementation plan: \`\`\`json:create_plan { "title", "overview", "steps": [{ "title", "details", "status": "pending" }] } \`\`\`
- Branching dialogue: \`\`\`json:create_dialogue_tree { "startNode", "nodes": [{ "id", "speaker", "text", "choices": [{ "text", "target" }] }] } \`\`\`
- Valid JSON only: no trailing commas, no comments. priority is 1|2|3. colors are hex like "#a855f7". status is an existing column name or id.`

        // Seed context as a system instruction if preset
        const systemPrompt: Message[] = [
          {
            role: 'system',
            content: baseSystemPromptContent
          }
        ]

        // Ground all date/deadline reasoning, models have no clock of their
        // own, so "Friday", "next week" and "overdue" are meaningless without this.
        const nowDate = new Date()
        systemPrompt.push({
          role: 'system',
          content: `CURRENT DATE & TIME: ${nowDate.toLocaleString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })} (ISO date: ${nowDate.toISOString().slice(0, 10)}). Resolve every relative date ("Friday", "next week", "overdue", "this sprint") against this moment. Cards may carry a deadline shown as (Due: …) in the board state below.`
        })

        // Scrape live board state (columns, cards) and then retrieve semantic memories.
        // Board state comes FIRST so memories have board context when recalled.
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
          const cardOnlyItems = (cardsRes?.items || []).filter(i => i.status !== 'archived')
          const allItems = [...(tasksRes?.items || []), ...cardOnlyItems].filter(i => i.status !== 'archived')

          // Per-column card summaries, ONLY type 'card' items: that is what
          // the Kanban board actually renders. Listing backlog tasks here made
          // the model (and the edit executor) target invisible items.
          const colSummaries: string[] = []
          for (const col of colsList) {
            const colCards = cardOnlyItems.filter(i => i.status === col.id || i.status.toLowerCase() === col.name.toLowerCase())
            let cardListText = ''
            if (colCards.length > 0) {
              cardListText = colCards.map(c => {
                const bodySnippet = c.body ? `, "${c.body.slice(0, 120).replace(/\n/g, ' ')}"` : ''
                const tagsText = c.tags && c.tags.length > 0 ? ` [Tags: ${c.tags.map((t: any) => t.name).join(', ')}]` : ''
                const dueText = c.due_at ? ` (Due: ${new Date(c.due_at).toISOString().slice(0, 10)})` : ''
                return `    • "${c.title}" (Priority: ${c.priority === 3 ? 'High' : c.priority === 2 ? 'Med' : 'Low'})${dueText}${tagsText}${bodySnippet}`
              }).join('\n')
            } else {
              cardListText = '    (empty)'
            }
            colSummaries.push(`Column "${col.name}" [ID: "${col.id}"]:\n${cardListText}`)
          }

          // VALID COLUMN IDs as a bullet list so the model can copy them exactly
          const validColIds = colsList.map(c => `  • "${c.id}" → "${c.name}"`).join('\n')

          // FORBIDDEN DUPLICATE TITLES as a bullet list (easier to match than CSV)
          const forbiddenTitles = allItems.length > 0
            ? allItems.map((i: any) => `  • ${i.title}`).join('\n')
            : '  (none yet)'

          const liveBoardStateText = [
            `CURRENT LIVE KANBAN BOARD STATE (Context: ${validContext})`,
            '',
            `VALID COLUMN IDs, use ONLY these exact strings in any "status" field:`,
            validColIds,
            '',
            `CARDS PER COLUMN:`,
            colSummaries.join('\n\n'),
            '',
            `FORBIDDEN DUPLICATE TITLES, NEVER create cards with these exact titles:`,
            forbiddenTitles,
            '',
            `BOARD RULES:`,
            `1. Use ONLY the column IDs from VALID COLUMN IDs above in any JSON "status" field. Never invent IDs.`,
            `2. NEVER create cards with titles from the FORBIDDEN list above.`,
            `3. JSON blocks ALWAYS create NEW items. Use plain text to reference or discuss existing items.`,
            `4. "Add more tasks" = generate entirely NEW tasks with completely different titles.`
          ].join('\n')

          systemPrompt.push({
            role: 'system',
            content: liveBoardStateText
          })

          // 2. Semantic Memory Vector Retrieval (runs AFTER board state so memories interpret board context)
          try {
            const memories = await window.electronAPI.memory.searchMemories(text, validContext, memoryRecallLimit).catch(() => [])
            setRecalledMemCount(memories?.length || 0)
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
        } catch (err) {
          console.warn('Failed to scrape workspace items for AI context:', err)
        }

        // Specialized Skill Workflow injection (auto-elevated if not manually overridden)
        const lastUserContentForSkill = nextMessages[nextMessages.length - 1]?.content || text
        const predictedIntent = classifyIntent(lastUserContentForSkill, activeSkillId)
        // Auto-recall the best-fitting skill when the user hasn't pinned one.
        let resolvedSkillId = activeSkillId || detectSkill(lastUserContentForSkill)
        if (!resolvedSkillId) {
          if (predictedIntent === 'create_dialogue') resolvedSkillId = 'narrative_specialist'
          else if (predictedIntent === 'create_plan') resolvedSkillId = 'implementation_planner'
        }

        const activeSkill = getSkillById(resolvedSkillId)
        if (activeSkill) {
          systemPrompt.push({
            role: 'system',
            content: activeSkill.systemPrompt
          })
        }

        // Workspace codebase index injection, grouped by top-level folder and file-type buckets
        // so the model understands project structure, not just a flat list of filenames.
        if (workspaceFolder && workspaceFiles.length > 0) {
          const cappedFiles = workspaceFiles.slice(0, workspaceFileCap)

          // Group files by top-level folder
          const folderGroups: Record<string, typeof cappedFiles[0][]> = {}
          for (const f of cappedFiles) {
            const parts = f.relativePath.replace(/\\/g, '/').split('/')
            const topFolder = parts.length > 1 ? parts[0] : '(root)'
            if (!folderGroups[topFolder]) folderGroups[topFolder] = []
            folderGroups[topFolder].push(f)
          }

          // Summarize each folder: file count + extension buckets
          const folderSummaries = Object.entries(folderGroups)
            .map(([folder, files]) => {
              const extBuckets: Record<string, number> = {}
              for (const f of files) {
                const ext = f.extension || '(no ext)'
                extBuckets[ext] = (extBuckets[ext] || 0) + 1
              }
              const bucketStr = Object.entries(extBuckets)
                .sort((a, b) => b[1] - a[1])
                .map(([ext, count]) => `${ext}\u00d7${count}`)
                .join(', ')
              return `  \u{1F4C1} ${folder}/, ${files.length} file${files.length !== 1 ? 's' : ''} (${bucketStr})`
            })
            .join('\n')

          systemPrompt.push({
            role: 'system',
            content: `IMPORTED WORKSPACE CODEBASE INDEX:\nProject folder: ${workspaceFolder}\nTotal files: ${workspaceFiles.length}${workspaceFiles.length > 500 ? ' (capped at 500)' : ''}\n\nFile structure by folder:\n${folderSummaries}\n\nUse this structure to understand the project architecture. If you need a specific file's contents, ask the user to paste it or attach it as a cheatsheet.`
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
      }

      // Collect all unique cheatsheets/notes/files across the conversation
      const allActiveCheatsheets = new Set<string>()
      const allActiveNotes = new Set<string>()
      const allActiveFiles = new Set<string>()
      nextMessages.forEach(m => {
        if (Array.isArray(m.cheatsheets)) m.cheatsheets.forEach(cs => allActiveCheatsheets.add(cs))
        if (Array.isArray(m.notes)) m.notes.forEach(n => allActiveNotes.add(n))
        if (Array.isArray(m.files)) m.files.forEach(f => allActiveFiles.add(f))
      })

      // Prepare final API messages payload
      const apiMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> }> = [...systemPrompt]

      // Attach reference-document text as a system knowledge base. Rather than
      // dumping every full PDF (which floods a small model's context and buries
      // the relevant part), pull only the passages relevant to the user's
      // question, sized to the model's context window and split across sheets.
      if (allActiveCheatsheets.size > 0) {
        const sheetNames = Array.from(allActiveCheatsheets)
        // Total char budget for all attached docs, scaled to the context window.
        const totalBudget = isSmallModel ? 6000 : Math.min(60000, Math.round(contextWindowTokens * 1.2))
        const perSheet = Math.max(1500, Math.floor(totalBudget / sheetNames.length))
        let fullDocText = ''
        for (const sheetName of sheetNames) {
          try {
            const relevant = await window.electronAPI.cheatsheets.getRelevant(sheetName, text, perSheet)
            const cleanText = (relevant || '').trim()
            if (cleanText) {
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

      // Attached NOTES (from the Notes feature), full content, size-capped
      if (allActiveNotes.size > 0) {
        const perNoteCap = isSmallModel ? 3000 : 9000
        let notesText = ''
        for (const noteTitle of Array.from(allActiveNotes)) {
          try {
            const content = await window.electronAPI.notes.readNote(noteTitle)
            const clean = (content || '').trim().slice(0, perNoteCap)
            if (clean) notesText += `\n\n=== ATTACHED NOTE: "${noteTitle}" ===\n${clean}\n=== END OF NOTE ===\n`
          } catch (noteErr) {
            console.warn(`Failed to read note "${noteTitle}":`, noteErr)
          }
        }
        if (notesText) {
          apiMessages.push({
            role: 'system',
            content: `USER'S PROJECT NOTES (attached by the user, you HAVE their full content below):${notesText}`
          })
        }
      } else if (text.length > 12) {
        // Auto-recall: no notes attached, surface the 2 most relevant note
        // snippets so lore/design decisions written in Notes stay consistent.
        try {
          const hits = await window.electronAPI.notes.searchNotes(text)
          const top = (hits || []).slice(0, 2).filter(h => h.snippet && h.snippet.trim())
          if (top.length > 0) {
            const recall = top.map(h => `- Note "${h.title}": …${h.snippet.trim().slice(0, 280)}…`).join('\n')
            apiMessages.push({
              role: 'system',
              content: `RELEVANT PROJECT NOTES (auto-recalled snippets, the user can attach the full note with @):\n${recall}`
            })
          }
        } catch { /* auto-recall is best-effort */ }
      }

      // Attached WORKSPACE FILES, actual source contents, size-capped
      if (allActiveFiles.size > 0 && workspaceFolder) {
        const perFileCap = isSmallModel ? 4000 : 12000
        let filesText = ''
        for (const relPath of Array.from(allActiveFiles)) {
          try {
            const content = await window.electronAPI.workspace.readFile(workspaceFolder, relPath)
            const clean = (content || '').trim().slice(0, perFileCap)
            if (clean) filesText += `\n\n=== ATTACHED FILE: "${relPath}" ===\n\`\`\`\n${clean}\n\`\`\`\n=== END OF FILE ===\n`
          } catch (fileErr) {
            console.warn(`Failed to read workspace file "${relPath}":`, fileErr)
          }
        }
        if (filesText) {
          apiMessages.push({
            role: 'system',
            content: `WORKSPACE SOURCE FILES (attached by the user, you HAVE their contents below):${filesText}`
          })
        }
      }

      // Calculate token budget for conversation history:
      const baseOverheadTokens = 900
      const skillTokens = resolvedSkillId ? estimateTokens(getSkillById(resolvedSkillId)?.systemPrompt || '') : 0
      const workspaceTokens = workspaceFolder ? estimateTokens(workspaceFiles.slice(0, workspaceFileCap).map(f => f.relativePath).join('\n')) : 0
      const historyBudget = contextWindowTokens - baseOverheadTokens - skillTokens - workspaceTokens - 2000 // leave 2000 tokens for system docs and response safety
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
      // An explicit quick-action intent is authoritative, a "Do NOT output JSON"
      // analyze prompt must never be mis-read as a create request, and vice versa.
      if (lastUserMsg?.intentHint === 'analyze') intent = 'converse'
      else if (lastUserMsg?.intentHint === 'create') intent = 'create_items'

      // Reliable structured action path
      // For creation intents, generate the action through the structured generator
      // (tool-calling / JSON-schema / JSON-mode), which forces valid, schema-shaped
      // output even on tiny local models, then deterministically enriches it with
      // tags + colors. Falls back to the streaming path below on any failure, so
      // this can only improve reliability, never regress it.
      const structuredKind: 'board' | 'plan' | 'dialogue' | 'update' | null =
        intent === 'create_items' ? 'board' :
        intent === 'create_plan' ? 'plan' :
        intent === 'create_dialogue' ? 'dialogue' :
        intent === 'update_items' ? 'update' : null

      if (structuredKind) {
        setWaitingLabel(
          structuredKind === 'board' ? 'Composing board changes…' :
          structuredKind === 'plan' ? 'Drafting a plan…' :
          structuredKind === 'update' ? 'Applying board edits…' : 'Writing dialogue…'
        )
        const columnGuidance = wantsColumns(lastUserContent)
          ? `The user is asking about BOARD STRUCTURE, include a "columns" array of the workflow stages (each with a name and a hex color), and place the cards into those columns. Design a sensible pipeline (e.g. Backlog → In Progress → Review → Done) if none fits.`
          : `Reuse existing columns when they fit; only add columns for genuinely new stages.`
        const instruction = structuredKind === 'board'
          ? `Create the requested board items now. FIRST read the CURRENT LIVE KANBAN BOARD STATE above: do NOT create any card whose title matches or closely overlaps one already on the board (see the FORBIDDEN DUPLICATE TITLES list), only propose genuinely new, non-duplicate work. Give EVERY card a fitting priority (1-3) and 1-3 topical tags, each with a hex color. ${columnGuidance} ${PALETTE_HINT}`
          : structuredKind === 'plan'
          ? `Produce a concrete, specific implementation plan with actionable steps.`
          : structuredKind === 'update'
          ? `Apply the requested edits to EXISTING cards now. Read the CURRENT LIVE KANBAN BOARD STATE above. RULES: (1) "target" is ALWAYS a CARD TITLE copied exactly from CARDS PER COLUMN above, NEVER a column name. (2) The destination column goes ONLY in "toColumn" (a VALID COLUMN ID or name). (3) One operation per card: to move 2 cards, emit 2 move operations, each with one card title as target. (4) Do NOT use update_body unless the user explicitly asked to rewrite a description. (5) For deadlines use set_due_date with "due" as an ISO date YYYY-MM-DD, resolving relative dates against the CURRENT DATE above (empty string clears). (6) Only include operations the user actually asked for.`
          : `Produce a branching dialogue tree. Every choice.target must be an exact node id in the tree, or "end".`

        const structuredMessages = [...apiMessages, { role: 'system' as const, content: instruction }]
        try {
          const result = await window.electronAPI.ai.generateStructured({
            kind: structuredKind,
            model: selectedModel,
            messages: structuredMessages,
            temperature
          })

          // Respect an in-flight user abort, don't post or fall back.
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
      let reasoningInstruction = ''
      const isNativeThinking = modelLower.includes('r1') || modelLower.includes('think') || modelLower.includes('qwq')
      if (isNativeThinking) {
        reasoningInstruction = `You MUST write your internal chain-of-thought reasoning inside <think>...</think> tags. Keep your reasoning thorough, logical, and step-by-step. Do not output anything else inside the <think> tags.`
      } else if (isSmallModel) {
        reasoningInstruction = `Before answering, briefly consider:
1. Confirm the exact output format requested.
2. Cross-check for duplicate titles and valid column IDs.`
      } else {
        reasoningInstruction = `Analyze step-by-step:
1. What memory/context is relevant?
2. Which column IDs match the target state?
3. Prevent duplicate card titles.
Format your reasoning clearly before giving your final response.`
      }

      apiMessages.push({ role: 'system', content: reasoningInstruction })

      let enforcementContent = ''
      switch (intent) {
        case 'create_dialogue':
          enforcementContent = `⚡ NARRATIVE ACTION REQUIRED ⚡
Output a \`\`\`json:create_dialogue_tree block RIGHT NOW.
→ Every node must have: id (unique string), speaker, text, choices[].
→ Every choice.target MUST be an EXACT id of another node in this same tree, or the literal string "end".
→ CRITICAL: Cross-check every choice.target against your own node ids before outputting. A broken link is a hallucination.
→ Start with a node whose id matches the startNode field. Give each NPC a distinct voice.`
          break
        case 'create_plan':
          enforcementContent = `⚡ PLAN ACTION REQUIRED ⚡
Output a \`\`\`json:create_plan block RIGHT NOW.
→ Include: title, overview (2–4 sentences covering scope and risks), steps[].
→ Each step: { "title": "Step N: Short imperative verb phrase", "details": "Specific enough to start immediately", "status": "pending" }
→ After the plan block, ONE brief paragraph on tradeoffs. STOP. Do not ask about Kanban export or next steps.`
          break
        case 'create_items':
          enforcementContent = `⚡ ACTION REQUIRED, OUTPUT JSON BLOCKS NOW ⚡
→ Use ONLY the column IDs listed in VALID COLUMN IDs above in any "status" field. Never invent IDs.
→ Check FORBIDDEN DUPLICATE TITLES above, never repeat any of those exact titles.
→ Immediately output a \`\`\`json batch block with REAL, specific, unique content.
→ DO NOT explain first. DO NOT ask for permission. DO NOT produce vague placeholder titles. CREATE IT.`
          break
        case 'update_items':
          enforcementContent = `⚡ BOARD EDIT REQUIRED, OUTPUT AN update_board BLOCK NOW ⚡
Output a \`\`\`json:update_board block of this shape:
{ "operations": [ { "op": "move", "target": "Exact Existing Card Title", "toColumn": "Done" } ] }
→ op is one of: move | set_priority | retitle | update_body | archive.
→ "target" MUST be copied EXACTLY from the card titles in the CURRENT LIVE KANBAN BOARD STATE above. Never invent titles.
→ For "move", "toColumn" must be a VALID COLUMN ID or name from above.
→ Only the operations the user asked for. DO NOT create new cards.`
          break
        default: // 'converse'
          enforcementContent = `💬 GENERAL CONVERSATION, DO NOT OUTPUT JSON BLOCKS 💬
→ DO NOT output any \`\`\`json structures, plan blocks, or dialogue trees.
→ Respond in natural, friendly plain text only.
→ Answer their question clearly, referencing the live board state or recalled memories where relevant.`
      }

      apiMessages.push({ role: 'system', content: enforcementContent })

      const params = {
        model: selectedModel,
        messages: apiMessages,
        temperature,
        maxTokens
      }
      await window.electronAPI.ai.startStream(params, ASSISTANT_STREAM_ID)
    } catch (err) {
      const error = err as Error
      setIsStreaming(false)
      setMessages(prev => [...prev, { role: 'assistant', content: `**Failed to initiate stream:** ${error.message || String(err)}` }])
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
  // Load memories whenever the panel opens (from ANY entry point, the button,
  // the /mem command, or the "N recalled" chip) and whenever the workspace
  // changes while it's open. This is what keeps the panel in sync with the
  // Settings memory vault instead of showing a stale/empty count.
  useEffect(() => {
    if (!showMemoryPanel) return
    let cancelled = false
    setMemoryLoading(true)
    window.electronAPI.memory.getMemories(activeContext)
      .then(mems => { if (!cancelled) setMemories(mems || []) })
      .catch(e => { if (!cancelled) { console.warn('Failed to load memories:', e); setMemories([]) } })
      .finally(() => { if (!cancelled) setMemoryLoading(false) })
    return () => { cancelled = true }
  }, [showMemoryPanel, activeContext])

  const handleOpenMemoryPanel = (): void => {
    setShowMemoryPanel(true)
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
              title="Switch AI provider, add/edit profiles in Settings → AI"
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

        {/* Row 1b: Workspace / Context Selection, the board the AI reads & writes */}
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
          <div className="col">
            {/* Temperature Slider */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <div className="row-between">
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
              <div className="row-between">
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

            {/* Example chips, make the invisible feature surface visible */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', justifyContent: 'center', maxWidth: '340px' }}>
              {[
                { label: '🗂 Set up a board for my project', action: () => handleSubmitWithText('Design a Kanban board for this project: propose the workflow COLUMNS (each with a fitting color) and seed each column with a few well-scoped starter cards (with tags and priorities).', { displayContent: 'Set up a board', intentHint: 'create' }) },
                { label: '✅ Move finished cards to Done', action: () => handleSubmitWithText('Move every card that is clearly finished to the Done column.') },
                { label: '💡 What should I work on next?', action: () => handleSubmitWithText('Review my current board and tell me what to work on next and why. Do NOT output JSON, give a prioritized, reasoned plain-text list.', { displayContent: 'What should I work on next?', intentHint: 'analyze' }) },
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
              // Committed messages are final, the blinking cursor belongs ONLY to
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
      {showCustomActionsModal && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 110,
          background: 'rgba(0, 0, 0, 0.75)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--space-4)'
        }}>
          <div style={{
            background: 'var(--color-surface-1)', border: '1px solid var(--color-surface-offset)',
            borderRadius: 'var(--radius-md)', width: '100%', maxHeight: '90%',
            display: 'flex', flexDirection: 'column', boxShadow: '0 8px 32px rgba(0,0,0,0.5)', overflow: 'hidden'
          }}>
            <div style={{
              padding: 'var(--space-3) var(--space-4)', borderBottom: '1px solid var(--color-surface-offset)',
              background: 'var(--color-surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0
            }}>
              <div className="row">
                <Sparkles size={14} style={{ color: 'var(--color-secondary)' }} />
                <span style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-base)' }}>
                  My Quick Actions ({customActions.length})
                </span>
              </div>
              <button
                onClick={() => setShowCustomActionsModal(false)}
                style={{ background: 'transparent', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', padding: '2px' }}
              >
                <X size={14} />
              </button>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-3)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              {/* Existing actions */}
              {customActions.length === 0 ? (
                <div style={{ fontSize: '11px', color: 'var(--color-text-faint)', textAlign: 'center', padding: 'var(--space-3)' }}>
                  No custom actions yet. Save the prompts you find yourself retyping, they'll appear in the ＋ menu.
                </div>
              ) : (
                customActions.map(a => (
                  <div key={a.id} style={{
                    display: 'flex', alignItems: 'flex-start', gap: '8px', padding: '8px 10px',
                    background: 'var(--color-surface-2)', border: '1px solid var(--color-surface-offset)', borderRadius: 'var(--radius-sm)'
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ fontSize: '11px', fontWeight: 'bold', color: 'var(--color-text-base)' }}>{a.label}</span>
                        <span style={{
                          fontSize: '8px', fontWeight: 'bold', textTransform: 'uppercase', padding: '1px 6px', borderRadius: '6px',
                          background: a.intent === 'create' ? 'rgba(205,241,43,0.12)' : 'rgba(59,130,246,0.12)',
                          color: a.intent === 'create' ? 'var(--color-secondary)' : '#60a5fa'
                        }}>
                          {a.intent === 'create' ? 'Creates items' : 'Analyzes'}
                        </span>
                      </div>
                      <div style={{ fontSize: '10px', color: 'var(--color-text-muted)', marginTop: '2px', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                        {a.prompt}
                      </div>
                    </div>
                    <button
                      onClick={() => persistCustomActions(customActions.filter(x => x.id !== a.id))}
                      title="Delete action"
                      style={{ background: 'transparent', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', padding: '2px', flexShrink: 0 }}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))
              )}

              {/* Add form */}
              <div style={{
                borderTop: '1px solid var(--color-surface-offset)', paddingTop: 'var(--space-3)',
                display: 'flex', flexDirection: 'column', gap: '6px'
              }}>
                <span style={{ fontSize: '9px', fontWeight: 'bold', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>New quick action</span>
                <input
                  type="text"
                  value={caLabel}
                  onChange={e => setCaLabel(e.target.value)}
                  placeholder="Label (e.g. Write patch notes)"
                  style={{
                    background: 'var(--color-surface-2)', border: '1px solid var(--color-surface-offset)',
                    color: 'var(--color-text-base)', borderRadius: 'var(--radius-sm)', padding: '6px 8px', fontSize: '11px', outline: 'none'
                  }}
                />
                <textarea
                  value={caPrompt}
                  onChange={e => setCaPrompt(e.target.value)}
                  placeholder="The full prompt to send…"
                  rows={3}
                  style={{
                    background: 'var(--color-surface-2)', border: '1px solid var(--color-surface-offset)',
                    color: 'var(--color-text-base)', borderRadius: 'var(--radius-sm)', padding: '6px 8px',
                    fontSize: '11px', outline: 'none', resize: 'vertical', fontFamily: 'inherit'
                  }}
                />
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                  <select
                    value={caIntent}
                    onChange={e => setCaIntent(e.target.value as 'create' | 'analyze')}
                    title="'Creates items' routes through the structured board generator; 'Analyzes' guarantees a plain-text answer."
                    style={{
                      background: 'var(--color-surface-2)', border: '1px solid var(--color-surface-offset)',
                      color: 'var(--color-text-base)', borderRadius: 'var(--radius-sm)', padding: '4px 8px', fontSize: '10px', outline: 'none', cursor: 'pointer'
                    }}
                  >
                    <option value="analyze">Analyzes (plain text)</option>
                    <option value="create">Creates board items</option>
                  </select>
                  <button
                    onClick={handleAddCustomAction}
                    disabled={!caLabel.trim() || !caPrompt.trim()}
                    style={{
                      background: caLabel.trim() && caPrompt.trim() ? 'var(--color-secondary)' : 'var(--color-surface-offset)',
                      color: caLabel.trim() && caPrompt.trim() ? '#000' : 'var(--color-text-faint)',
                      border: 'none', borderRadius: 'var(--radius-sm)', padding: '5px 12px',
                      fontSize: '10px', fontWeight: 'bold', cursor: caLabel.trim() && caPrompt.trim() ? 'pointer' : 'default'
                    }}
                  >
                    Save Action
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

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
              <div className="row">
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
                        <div className="row-between">
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
              <div className="row">
                <MessageSquare size={14} style={{ color: 'var(--color-secondary)' }} />
                <span style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-base)' }}>
                  Saved Chats ({savedChats.length}/50)
                </span>
              </div>
              <div className="row">
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

            {/* Search */}
            {savedChats.length > 3 && (
              <div style={{ padding: 'var(--space-2) var(--space-3) 0', position: 'relative', flexShrink: 0 }}>
                <Search size={12} style={{ position: 'absolute', left: 'calc(var(--space-3) + 8px)', top: 'calc(50% + 4px)', transform: 'translateY(-50%)', color: 'var(--color-text-faint)', pointerEvents: 'none' }} />
                <input
                  type="text"
                  placeholder="Search chats…"
                  value={chatSearchQuery}
                  onChange={e => setChatSearchQuery(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Escape') setChatSearchQuery('') }}
                  style={{
                    width: '100%',
                    background: 'var(--color-surface-2)',
                    border: '1px solid var(--color-surface-offset)',
                    color: 'var(--color-text-base)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '5px 8px 5px 26px',
                    fontSize: '11px',
                    outline: 'none',
                    boxSizing: 'border-box'
                  }}
                />
              </div>
            )}

            {/* List */}
            <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-3)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {(() => {
                const q = chatSearchQuery.trim().toLowerCase()
                const visibleChats = q
                  ? savedChats.filter(c =>
                      c.title.toLowerCase().includes(q) ||
                      c.messages.some(m => m.content.toLowerCase().includes(q)))
                  : savedChats
                if (savedChats.length === 0) {
                  return (
                    <div style={{ fontSize: '11px', color: 'var(--color-text-faint)', textAlign: 'center', padding: 'var(--space-4)' }}>
                      No saved conversations yet. Start chatting to auto-save!
                    </div>
                  )
                }
                if (visibleChats.length === 0) {
                  return (
                    <div style={{ fontSize: '11px', color: 'var(--color-text-faint)', textAlign: 'center', padding: 'var(--space-4)' }}>
                      No chats match “{chatSearchQuery.trim()}”.
                    </div>
                  )
                }
                return visibleChats.map(chat => {
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
              })()}
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
          <div className="memory-vault-overlay" style={{
            position: 'absolute', inset: 0, zIndex: 100,
            background: 'rgba(10, 12, 18, 0.82)', backdropFilter: 'blur(10px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '16px'
          }}>
            <style>{`
              .memory-vault-overlay {
                animation: memory-fade-in 150ms ease-out;
              }
              .memory-vault-card {
                animation: memory-scale-in 220ms cubic-bezier(0.16, 1, 0.3, 1);
              }
            `}</style>
            <div className="memory-vault-card" style={{
              background: 'var(--color-surface-1)',
              border: '1px solid var(--color-surface-offset)',
              borderRadius: 'var(--radius-lg)', width: '100%', maxHeight: '92%',
              display: 'flex', flexDirection: 'column',
              boxShadow: '0 20px 50px rgba(0,0,0,0.5)', overflow: 'hidden'
            }}>
              {/* Header */}
              <div style={{
                padding: '12px 16px 10px',
                borderBottom: '1px solid var(--color-surface-offset)',
                background: 'var(--color-surface-2)',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                flexShrink: 0
              }}>
                {/* Row 1: Title and Close button */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Brain size={15} style={{ color: '#a855f7' }} />
                    <span style={{ fontSize: '13px', fontWeight: 'bold', color: 'var(--color-text-base)', letterSpacing: '0.01em' }}>
                      Memory Vault
                    </span>
                    {memoryConsolidating && (
                      <span style={{ fontSize: '9px', color: 'var(--color-text-muted)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                        <RefreshCw size={9} style={{ animation: 'spin 1s linear infinite' }} />
                        Consolidating…
                      </span>
                    )}
                  </div>
                  <button onClick={() => { setShowMemoryPanel(false); setShowAddMemoryForm(false); setEditingMemoryId(null); setMemorySearchQuery('') }}
                    style={{ background: 'transparent', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <X size={15} />
                  </button>
                </div>

                {/* Row 2: Badges and Action buttons */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
                  {/* Badges */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ fontSize: '9px', color: 'var(--color-text-muted)', background: 'var(--color-surface-offset)', padding: '2px 8px', borderRadius: '10px', fontWeight: '500' }}>
                      Context: {activeContext}
                    </span>
                    <span style={{ fontSize: '10px', color: '#a855f7', background: 'rgba(168,85,247,0.1)', padding: '2px 8px', borderRadius: '10px', fontWeight: 'bold' }}>
                      {memories.length} memories
                    </span>
                  </div>

                  {/* Actions */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <button
                      onClick={() => setShowAddMemoryForm(v => !v)}
                      style={{
                        background: showAddMemoryForm ? 'var(--color-secondary)' : 'rgba(168,85,247,0.12)',
                        border: '1px solid rgba(168,85,247,0.3)',
                        color: showAddMemoryForm ? '#fff' : '#a855f7',
                        borderRadius: 'var(--radius-sm)', padding: '4px 10px',
                        fontSize: '10px', fontWeight: 'bold', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', gap: '4px',
                        transition: 'all 150ms'
                      }}
                    >
                      <Plus size={10} /> Add Memory
                    </button>
                    <button
                      onClick={handleAuditMemories}
                      disabled={memoryLoading || memories.length === 0}
                      style={{
                        background: 'rgba(168,85,247,0.12)',
                        border: '1px solid rgba(168,85,247,0.3)',
                        color: '#a855f7',
                        borderRadius: 'var(--radius-sm)', padding: '4px 10px',
                        fontSize: '10px', fontWeight: 'bold', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', gap: '4px',
                        transition: 'all 150ms'
                      }}
                    >
                      <RefreshCw size={10} style={{ animation: memoryLoading ? 'spin 1s linear infinite' : 'none' }} />
                      Audit &amp; Prune
                    </button>
                  </div>
                </div>
              </div>

              {/* Search Bar */}
              <div style={{
                padding: '10px 16px',
                borderBottom: '1px solid var(--color-surface-offset)',
                background: 'var(--color-surface-1)',
                flexShrink: 0,
                position: 'relative',
                display: 'flex',
                alignItems: 'center'
              }}>
                <Search
                  size={12}
                  style={{
                    position: 'absolute',
                    left: '26px',
                    color: 'var(--color-text-faint)',
                    pointerEvents: 'none'
                  }}
                />
                <input
                  type="text"
                  placeholder="Search memories by keyword, fact, or type…"
                  value={memorySearchQuery}
                  onChange={e => setMemorySearchQuery(e.target.value)}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    background: 'var(--color-surface-2)',
                    border: '1px solid var(--color-surface-offset)',
                    borderRadius: 'var(--radius-md)',
                    color: 'var(--color-text-base)',
                    fontSize: '11px',
                    padding: '8px 12px 8px 30px',
                    outline: 'none',
                    transition: 'border-color 150ms ease, box-shadow 150ms ease'
                  }}
                />
                {memorySearchQuery && (
                  <button
                    onClick={() => setMemorySearchQuery('')}
                    style={{
                      position: 'absolute',
                      right: '26px',
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--color-text-muted)',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: '2px'
                    }}
                  >
                    <X size={10} />
                  </button>
                )}
              </div>

              {/* Add Memory Form */}
              {showAddMemoryForm && (
                <div style={{
                  padding: '12px 16px',
                  borderBottom: '1px solid var(--color-surface-offset)',
                  background: 'rgba(168,85,247,0.04)',
                  border: '1px dashed rgba(168,85,247,0.2)',
                  borderRadius: 'var(--radius-md)',
                  margin: '8px 16px 0 16px',
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
              <div style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
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
                      padding: '14px 16px',
                      background: mem.is_pinned
                        ? 'linear-gradient(135deg, rgba(168, 85, 247, 0.08) 0%, rgba(59, 130, 246, 0.03) 100%)'
                        : 'var(--color-surface-2)90',
                      border: mem.is_pinned ? '1px solid rgba(168, 85, 247, 0.35)' : '1px solid var(--color-surface-offset)',
                      borderLeft: mem.is_pinned ? '4px solid #a855f7' : '1px solid var(--color-surface-offset)',
                      borderRadius: 'var(--radius-md)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '8px',
                      transition: 'all 200ms ease',
                      boxShadow: '0 1px 3px rgba(0, 0, 0, 0.15)'
                    }}>
                      {/* Memory Header Row */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, overflow: 'hidden', minWidth: 0 }}>
                          <span style={{
                            fontSize: '9px',
                            fontWeight: 'var(--weight-bold)',
                            flexShrink: 0,
                            letterSpacing: '0.04em',
                            color: mem.category === 'semantic' ? '#60a5fa' : mem.category === 'episodic' ? '#fbbf24' : '#9ca3af',
                            background: mem.category === 'semantic' ? 'rgba(59, 130, 246, 0.1)' : mem.category === 'episodic' ? 'rgba(245, 158, 11, 0.1)' : 'rgba(107, 114, 128, 0.1)',
                            border: `1px solid ${mem.category === 'semantic' ? 'rgba(59, 130, 246, 0.2)' : mem.category === 'episodic' ? 'rgba(245, 158, 11, 0.2)' : 'rgba(107, 114, 128, 0.2)'}`,
                            padding: '2px 6px',
                            borderRadius: '4px'
                          }}>
                            {CATEGORY_LABELS[mem.category] || mem.category.toUpperCase()}
                          </span>
                          <span style={{
                            fontSize: '12px',
                            fontWeight: 'var(--weight-semibold)',
                            color: mem.is_pinned ? '#d8b4fe' : 'var(--color-text-base)',
                            fontFamily: 'var(--font-mono)',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap'
                          }}>
                            {mem.memory_key}
                          </span>
                        </div>
                        {/* Action Buttons */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                          <button
                            onClick={() => handleTogglePinMemory(mem.id)}
                            title={mem.is_pinned ? 'Unpin memory' : 'Pin memory (always recalled first)'}
                            style={{
                              background: 'transparent',
                              border: 'none',
                              color: mem.is_pinned ? '#a855f7' : 'var(--color-text-faint)',
                              cursor: 'pointer',
                              padding: '4px',
                              borderRadius: '4px',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              transition: 'color 150ms, background-color 150ms'
                            }}
                            onMouseEnter={e => {
                              e.currentTarget.style.backgroundColor = 'rgba(168, 85, 247, 0.15)'
                              e.currentTarget.style.color = '#a855f7'
                            }}
                            onMouseLeave={e => {
                              e.currentTarget.style.backgroundColor = 'transparent'
                              if (!mem.is_pinned) e.currentTarget.style.color = 'var(--color-text-faint)'
                            }}
                          >
                            <Pin size={11} fill={mem.is_pinned ? 'currentColor' : 'none'} style={{ transform: mem.is_pinned ? 'none' : 'rotate(45deg)' }} />
                          </button>
                          <button
                            onClick={() => editingMemoryId === mem.id ? setEditingMemoryId(null) : handleStartEditMemory(mem)}
                            title="Edit memory content"
                            style={{
                              background: 'transparent',
                              border: 'none',
                              color: 'var(--color-text-faint)',
                              cursor: 'pointer',
                              padding: '4px',
                              borderRadius: '4px',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              transition: 'color 150ms, background-color 150ms'
                            }}
                            onMouseEnter={e => {
                              e.currentTarget.style.backgroundColor = 'rgba(59, 130, 246, 0.15)'
                              e.currentTarget.style.color = '#3b82f6'
                            }}
                            onMouseLeave={e => {
                              e.currentTarget.style.backgroundColor = 'transparent'
                              e.currentTarget.style.color = 'var(--color-text-faint)'
                            }}
                          >
                            <Edit2 size={11} />
                          </button>
                          <button
                            onClick={() => handleDeleteMemory(mem.id)}
                            title="Delete memory"
                            style={{
                              background: 'transparent',
                              border: 'none',
                              color: 'var(--color-text-faint)',
                              cursor: 'pointer',
                              padding: '4px',
                              borderRadius: '4px',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              transition: 'color 150ms, background-color 150ms'
                            }}
                            onMouseEnter={e => {
                              e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.15)'
                              e.currentTarget.style.color = '#ef4444'
                            }}
                            onMouseLeave={e => {
                              e.currentTarget.style.backgroundColor = 'transparent'
                              e.currentTarget.style.color = 'var(--color-text-faint)'
                            }}
                          >
                            <Trash2 size={11} />
                          </button>
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
                        <div style={{ fontSize: '11px', color: 'var(--color-text-muted)', lineHeight: 1.5, paddingLeft: '2px' }}>
                          {mem.content}
                        </div>
                      )}

                      {/* Footer meta */}
                      <div style={{ fontSize: '9px', color: 'var(--color-text-faint)', display: 'flex', gap: '8px', paddingLeft: '2px' }}>
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
                    await revertAICreatedEntities(data.cardTitles, data.columnNames)
                    setMessages(prev => prev.slice(0, data.index))
                  } catch (err) {
                    console.error('Failed to revert AI changes:', err)
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

      {/* Custom Model Prompt Modal */}
      {showCustomModelPrompt && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 1000,
          background: 'rgba(10, 12, 18, 0.75)', backdropFilter: 'blur(3px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '16px'
        }}>
          <div style={{
            background: 'var(--color-surface-1)',
            border: '1px solid var(--color-surface-offset)',
            borderRadius: 'var(--radius-md)',
            padding: '16px', width: '100%', maxWidth: '320px',
            display: 'flex', flexDirection: 'column', gap: '12px',
            boxShadow: 'var(--shadow-lg)'
          }}>
            <div style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--color-text-base)' }}>
              Enter Model Name
            </div>
            <div style={{ fontSize: '10px', color: 'var(--color-text-muted)' }}>
              Specify any custom cloud model (e.g. <code>gemini-2.5-flash</code>, <code>gpt-4o</code>, <code>deepseek-chat</code>).
            </div>
            <input
              type="text"
              value={customModelInput}
              onChange={e => setCustomModelInput(e.target.value)}
              placeholder="e.g. gemini-2.5-flash"
              autoFocus
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  const val = customModelInput.trim()
                  if (val) applyModel(val)
                  setShowCustomModelPrompt(false)
                } else if (e.key === 'Escape') {
                  setShowCustomModelPrompt(false)
                }
              }}
              style={{
                width: '100%',
                background: 'var(--color-surface-2)',
                border: '1px solid var(--color-surface-offset)',
                borderRadius: 'var(--radius-sm)',
                padding: '6px 10px',
                fontSize: '11px',
                color: 'var(--color-text-base)',
                outline: 'none',
                boxSizing: 'border-box'
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '4px' }}>
              <button
                onClick={() => setShowCustomModelPrompt(false)}
                style={{
                  background: 'var(--color-surface-offset)',
                  color: 'var(--color-text-base)',
                  border: 'none',
                  borderRadius: 'var(--radius-sm)',
                  padding: '5px 12px',
                  fontSize: '11px',
                  cursor: 'pointer',
                  fontWeight: 'bold'
                }}
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  const val = customModelInput.trim()
                  if (val) await applyModel(val)
                  setShowCustomModelPrompt(false)
                }}
                style={{
                  background: 'var(--color-secondary)',
                  color: '#000',
                  border: 'none',
                  borderRadius: 'var(--radius-sm)',
                  padding: '5px 12px',
                  fontSize: '11px',
                  cursor: 'pointer',
                  fontWeight: 'bold'
                }}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}