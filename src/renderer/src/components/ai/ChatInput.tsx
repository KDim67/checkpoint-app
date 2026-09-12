import React, { useRef, useEffect, useState } from 'react'

/**
 * The slice of the Web Speech API this uses. Declared here because the draft
 * spec is not in lib.dom and Chromium still ships it prefixed.
 */
interface SpeechRecognitionResultEvent {
  resultIndex: number
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>
}

interface SpeechRecognitionLike {
  continuous: boolean
  interimResults: boolean
  lang: string
  onstart: (() => void) | null
  onresult: ((event: SpeechRecognitionResultEvent) => void) | null
  onerror: ((event: unknown) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike
import { Send, Square, Plus, Mail, Sparkles, FileText, X, BookOpen, Mic, LayoutGrid, ListTree, ArrowUpDown, ShieldAlert, Image as ImageIcon, Settings2, FileCode } from 'lucide-react'
import type { Item } from '../../../../shared/types'
import { useToast } from '../ui/Toast'

interface CustomQuickAction {
  id: string
  label: string
  prompt: string
  intent: 'create' | 'analyze'
}

interface ChatInputProps {
  value: string
  onChange: (val: string) => void
  onSubmit: (options?: { mode?: string; cheatsheets?: string[]; notes?: string[]; files?: string[]; images?: string[] }) => void
  onAbort: () => void
  isStreaming: boolean
  contextItem: Item | null
  onTriggerPrompt: (prompt: string, displayContent?: string, intentHint?: 'create' | 'analyze') => void
  activeSkill?: { id: string; label: string; shortLabel: string; color: string } | null
  onClearSkill?: () => void
  /** Indexed files of the imported workspace folder (for @-mentions). */
  workspaceFiles?: Array<{ name: string; relativePath: string }>
  /** User-defined saved prompts, shown in the ＋ menu. */
  customActions?: CustomQuickAction[]
  onManageCustomActions?: () => void
  /** Whether the selected model accepts image input. Gates attach & paste. */
  visionCapable?: boolean
}

/** Downscale an image file to a reasonable size for model input (max 1280px). */
async function fileToDataUrl(file: File): Promise<string | null> {
  return new Promise(resolve => {
    const reader = new FileReader()
    reader.onerror = () => resolve(null)
    reader.onload = () => {
      const raw = reader.result as string
      const img = new Image()
      img.onerror = () => resolve(null)
      img.onload = () => {
        const MAX = 1280
        if (img.width <= MAX && img.height <= MAX && raw.length < 2_000_000) {
          resolve(raw)
          return
        }
        const scale = Math.min(1, MAX / Math.max(img.width, img.height))
        const canvas = document.createElement('canvas')
        canvas.width = Math.round(img.width * scale)
        canvas.height = Math.round(img.height * scale)
        const ctx = canvas.getContext('2d')
        if (!ctx) { resolve(raw); return }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/jpeg', 0.85))
      }
      img.src = raw
    }
    reader.readAsDataURL(file)
  })
}

// Data-driven quick actions. "create" actions produce board items via the
// structured generator; "analyze" actions return plain-text answers.
interface QuickAction {
  icon: React.ElementType
  label: string
  prompt: string
}
const CREATE_ACTIONS: QuickAction[] = [
  {
    icon: Sparkles, label: 'Suggest new tasks',
    prompt: 'Suggest a few actionable NEW tasks based on my current workspace items and goals. Only propose genuinely missing, high-value work, never duplicate existing cards. Give each a priority and topical tags.'
  },
  {
    icon: LayoutGrid, label: 'Set up a board',
    prompt: 'Design a Kanban board for this project: propose the workflow COLUMNS (each with a fitting color) and seed each column with a few well-scoped starter cards (with tags and priorities).'
  },
  {
    icon: ListTree, label: 'Break down a task',
    prompt: 'Break the most important item on my board down into 3–6 concrete, independently-completable subtask cards, each with a priority and topical tags.'
  }
]
const ANALYZE_ACTIONS: QuickAction[] = [
  {
    icon: FileText, label: 'Summarize progress',
    prompt: 'Summarize all my tasks and current board progress in detail. Do NOT output any JSON blocks. Return a plain markdown summary.'
  },
  {
    icon: ArrowUpDown, label: 'Prioritize backlog',
    prompt: 'Review my current board and tell me what to work on next and why. Do NOT output JSON. Give a prioritized, reasoned plain-text list.'
  },
  {
    icon: ShieldAlert, label: 'Find risks & gaps',
    prompt: 'Audit my board for risks, blockers, and missing work (testing, edge cases, docs, polish). Do NOT output JSON. Return a plain-text findings list grouped by theme.'
  },
  {
    icon: Sparkles, label: 'Explain workspace',
    prompt: 'Explain the current state of my project and active tasks. Do NOT output JSON. Return a plain markdown description.'
  }
]

interface CheatsheetFile {
  name: string
  path: string
}

export default function ChatInput({
  value,
  onChange,
  onSubmit,
  onAbort,
  isStreaming,
  onTriggerPrompt,
  activeSkill,
  onClearSkill,
  workspaceFiles = [],
  customActions = [],
  onManageCustomActions,
  visionCapable = false
}: ChatInputProps) {
  const { toast } = useToast()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const [showPlusMenu, setShowPlusMenu] = useState(false)
  const [isEmailDraftMode, setIsEmailDraftMode] = useState(false)
  const [availableCheatsheets, setAvailableCheatsheets] = useState<CheatsheetFile[]>([])
  const [attachedCheatsheets, setAttachedCheatsheets] = useState<string[]>([])
  const [availableNotes, setAvailableNotes] = useState<string[]>([])
  const [attachedNotes, setAttachedNotes] = useState<string[]>([])
  const [attachedFiles, setAttachedFiles] = useState<string[]>([])
  const [attachedImages, setAttachedImages] = useState<string[]>([])
  const [showCheatsheetSubmenu, setShowCheatsheetSubmenu] = useState(false)
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const [slashQuery, setSlashQuery] = useState<string | null>(null)
  const [isListening, setIsListening] = useState(false)

  const hasAnyAttachment =
    attachedCheatsheets.length > 0 || attachedNotes.length > 0 ||
    attachedFiles.length > 0 || attachedImages.length > 0

  const SLASH_COMMANDS = [
    { name: '/clear', desc: 'Clear the current chat thread' },
    { name: '/mem', desc: 'Open the Memory Vault panel' },
    { name: '/memory', desc: 'Open the Memory Vault panel' },
    { name: '/narrative', desc: 'Switch active skill to Narrative Specialist' },
    { name: '/kanban', desc: 'Switch active skill to Kanban Architect' },
    { name: '/plan', desc: 'Switch active skill to Implementation Planner' },
    { name: '/planner', desc: 'Switch active skill to Implementation Planner' },
    { name: '/help', desc: 'Show the slash command help menu' }
  ]

  const handleToggleListening = () => {
    // Not in lib.dom: the Web Speech API is still a draft, and Chromium
    // exposes it under the webkit prefix.
    const w = window as unknown as {
      SpeechRecognition?: SpeechRecognitionConstructor
      webkitSpeechRecognition?: SpeechRecognitionConstructor
    }
    const SpeechRecognition = w.SpeechRecognition || w.webkitSpeechRecognition
    if (!SpeechRecognition) {
      toast('Speech recognition is not supported in this environment.', { type: 'warning' })
      return
    }
    if (isListening) {
      setIsListening(false)
      return
    }
    try {
      const recognition = new SpeechRecognition()
      recognition.continuous = false
      recognition.interimResults = false
      recognition.lang = 'en-US'
      recognition.onstart = () => setIsListening(true)
      recognition.onend = () => setIsListening(false)
      recognition.onerror = () => setIsListening(false)
      recognition.onresult = (event: SpeechRecognitionResultEvent) => {
        const transcript = event.results[0][0].transcript
        if (transcript) {
          onChange(value ? `${value} ${transcript}` : transcript)
        }
      }
      recognition.start()
    } catch (e) {
      console.warn('Failed to start speech recognition:', e)
      setIsListening(false)
    }
  }

  // Load cheatsheets + note titles on mount & menu toggle
  useEffect(() => {
    const fetchSources = async () => {
      try {
        const list = await window.electronAPI.cheatsheets.list()
        setAvailableCheatsheets(list)
      } catch (err) {
        console.warn('Failed to fetch cheatsheets for AI input:', err)
      }
      try {
        const notes = await window.electronAPI.notes.listNotes()
        setAvailableNotes((notes || []).map(n => n.title))
      } catch (err) {
        console.warn('Failed to fetch notes for AI input:', err)
      }
    }
    fetchSources()
  }, [showPlusMenu])

  // External attach requests (e.g. the Cheatsheets page's "Ask AI" button)
  useEffect(() => {
    const handler = (e: Event) => {
      const name = (e as CustomEvent).detail?.name
      if (typeof name === 'string' && name) {
        setAttachedCheatsheets(prev => prev.includes(name) ? prev : [...prev, name])
        textareaRef.current?.focus()
      }
    }
    window.addEventListener('checkpoint-ai-attach-cheatsheet', handler)
    return () => window.removeEventListener('checkpoint-ai-attach-cheatsheet', handler)
  }, [])

  // Image attachment (picker + paste)
  const addImageFile = async (file: File) => {
    if (!file.type.startsWith('image/')) return
    const dataUrl = await fileToDataUrl(file)
    if (dataUrl) setAttachedImages(prev => prev.length >= 4 ? prev : [...prev, dataUrl])
  }

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = Array.from(e.clipboardData?.items || [])
    const imageItem = items.find(i => i.type.startsWith('image/'))
    if (imageItem) {
      if (!visionCapable) {
        e.preventDefault()
        toast('The selected model does not support image input. Switch to a vision model (e.g. llava, gpt-4o, gemini).', { type: 'warning' })
        return
      }
      const file = imageItem.getAsFile()
      if (file) {
        e.preventDefault()
        addImageFile(file)
      }
    }
  }

  // Auto-resize textarea height as user types
  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.style.height = 'auto'
    textarea.style.height = `${Math.min(180, textarea.scrollHeight)}px`

    // Detect @ trigger for mention popup
    const cursor = textarea.selectionStart || 0
    const textBeforeCursor = value.slice(0, cursor)
    const lastAtIdx = textBeforeCursor.lastIndexOf('@')

    if (lastAtIdx !== -1 && !textBeforeCursor.slice(lastAtIdx).includes(' ')) {
      const query = textBeforeCursor.slice(lastAtIdx + 1).toLowerCase()
      setMentionQuery(query)
    } else {
      setMentionQuery(null)
    }

    // Detect / trigger for slash command popup
    const lastSlashIdx = textBeforeCursor.lastIndexOf('/')
    if (
      lastSlashIdx !== -1 &&
      (lastSlashIdx === 0 || textBeforeCursor[lastSlashIdx - 1] === ' ') &&
      !textBeforeCursor.slice(lastSlashIdx).includes(' ')
    ) {
      const query = textBeforeCursor.slice(lastSlashIdx + 1).toLowerCase()
      setSlashQuery(query)
    } else {
      setSlashQuery(null)
    }
  }, [value])

  // Close plus menu on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowPlusMenu(false)
        setShowCheatsheetSubmenu(false)
      }
    }
    if (showPlusMenu) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showPlusMenu])

  const handleToggleCheatsheet = (csName: string) => {
    if (attachedCheatsheets.includes(csName)) {
      setAttachedCheatsheets(attachedCheatsheets.filter(c => c !== csName))
    } else {
      setAttachedCheatsheets([...attachedCheatsheets, csName])
    }
  }

  // Remove the @query fragment from the textarea after a mention is picked
  const stripMentionQuery = () => {
    const textarea = textareaRef.current
    const cursor = textarea?.selectionStart || value.length
    const textBeforeCursor = value.slice(0, cursor)
    const lastAtIdx = textBeforeCursor.lastIndexOf('@')
    if (lastAtIdx !== -1) {
      onChange(value.slice(0, lastAtIdx) + value.slice(cursor))
    }
    setMentionQuery(null)
    textareaRef.current?.focus()
  }

  const handleSelectMention = (csName: string) => {
    if (!attachedCheatsheets.includes(csName)) {
      setAttachedCheatsheets([...attachedCheatsheets, csName])
    }
    stripMentionQuery()
  }

  const handleSelectNoteMention = (title: string) => {
    if (!attachedNotes.includes(title)) {
      setAttachedNotes([...attachedNotes, title])
    }
    stripMentionQuery()
  }

  const handleSelectFileMention = (relativePath: string) => {
    if (!attachedFiles.includes(relativePath)) {
      setAttachedFiles([...attachedFiles, relativePath])
    }
    stripMentionQuery()
  }

  const handleSelectSlash = (cmd: string) => {
    const textarea = textareaRef.current
    const cursor = textarea?.selectionStart || value.length
    const textBeforeCursor = value.slice(0, cursor)
    const lastSlashIdx = textBeforeCursor.lastIndexOf('/')
    
    if (lastSlashIdx !== -1) {
      const newVal = value.slice(0, lastSlashIdx) + cmd + value.slice(cursor)
      onChange(newVal)
    }
    setSlashQuery(null)
    textareaRef.current?.focus()
  }

  const [promptHistory, setPromptHistory] = useState<string[]>([])
  const [historyIndex, setHistoryIndex] = useState<number>(-1)
  const [savedInputBeforeHistory, setSavedInputBeforeHistory] = useState<string>('')

  const handleFormSubmit = () => {
    // Allow submission with any attachment (docs, notes, files, images) even with no text
    if ((!value.trim() && !hasAnyAttachment) || isStreaming) return
    const mode = isEmailDraftMode ? 'email_draft' : undefined
    onSubmit({
      mode,
      cheatsheets: attachedCheatsheets.length > 0 ? attachedCheatsheets : undefined,
      notes: attachedNotes.length > 0 ? attachedNotes : undefined,
      files: attachedFiles.length > 0 ? attachedFiles : undefined,
      images: attachedImages.length > 0 ? attachedImages : undefined
    })
    // Save to prompt history
    if (value.trim()) {
      setPromptHistory(prev => [value.trim(), ...prev.slice(0, 49)])
    }
    setHistoryIndex(-1)
    setSavedInputBeforeHistory('')
    setIsEmailDraftMode(false)
    setAttachedCheatsheets([])
    setAttachedNotes([])
    setAttachedFiles([])
    setAttachedImages([])
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionQuery !== null && e.key === 'Escape') {
      setMentionQuery(null)
      return
    }

    if (slashQuery !== null && e.key === 'Escape') {
      setSlashQuery(null)
      return
    }

    // Prompt history navigation with Up/Down arrows (only on single-line input at boundaries)
    if (!isStreaming && mentionQuery === null) {
      if (e.key === 'ArrowUp' && !e.shiftKey) {
        const textarea = textareaRef.current
        const atTop = !textarea || textarea.selectionStart === 0
        if (atTop && promptHistory.length > 0) {
          e.preventDefault()
          if (historyIndex === -1) {
            setSavedInputBeforeHistory(value)
          }
          const nextIdx = Math.min(historyIndex + 1, promptHistory.length - 1)
          setHistoryIndex(nextIdx)
          onChange(promptHistory[nextIdx])
          setTimeout(() => {
            if (textareaRef.current) textareaRef.current.selectionStart = textareaRef.current.selectionEnd = 0
          }, 0)
          return
        }
      }
      if (e.key === 'ArrowDown' && !e.shiftKey) {
        if (historyIndex > -1) {
          e.preventDefault()
          const nextIdx = historyIndex - 1
          setHistoryIndex(nextIdx)
          onChange(nextIdx === -1 ? savedInputBeforeHistory : promptHistory[nextIdx])
          return
        }
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      if (mentionQuery !== null) {
        // Pick the first suggestion across all mention groups
        if (filteredCheatsheets.length > 0) {
          e.preventDefault()
          handleSelectMention(filteredCheatsheets[0].name)
          return
        }
        if (filteredNotes.length > 0) {
          e.preventDefault()
          handleSelectNoteMention(filteredNotes[0])
          return
        }
        if (filteredFiles.length > 0) {
          e.preventDefault()
          handleSelectFileMention(filteredFiles[0].relativePath)
          return
        }
      }
      if (slashQuery !== null && filteredSlashCommands.length > 0) {
        e.preventDefault()
        handleSelectSlash(filteredSlashCommands[0].name)
        return
      }
      e.preventDefault()
      handleFormSubmit()
    }
  }

  const filteredCheatsheets = availableCheatsheets.filter(cs =>
    mentionQuery === null ? true : cs.name.toLowerCase().includes(mentionQuery)
  ).slice(0, 6)

  const filteredNotes = availableNotes.filter(n =>
    mentionQuery === null ? true : n.toLowerCase().includes(mentionQuery)
  ).slice(0, 6)

  // Workspace files only appear once the user starts typing a query.
  // An unfiltered list of hundreds of files is pure noise.
  const filteredFiles = (mentionQuery && mentionQuery.length >= 1)
    ? workspaceFiles.filter(f =>
        f.name.toLowerCase().includes(mentionQuery) ||
        f.relativePath.toLowerCase().includes(mentionQuery)
      ).slice(0, 6)
    : []

  const hasMentionResults = filteredCheatsheets.length > 0 || filteredNotes.length > 0 || filteredFiles.length > 0

  const filteredSlashCommands = SLASH_COMMANDS.filter(cmd =>
    slashQuery === null ? true : cmd.name.slice(1).toLowerCase().includes(slashQuery)
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', width: '100%', position: 'relative' }}>
      {/* Slash Commands Auto-complete Popover */}
      {slashQuery !== null && filteredSlashCommands.length > 0 && (
        <div
          style={{
            position: 'absolute',
            bottom: '100%',
            left: 0,
            marginBottom: '8px',
            width: '260px',
            maxHeight: '220px',
            overflowY: 'auto',
            background: 'var(--color-surface-1)',
            border: '1px solid var(--color-secondary)',
            borderRadius: 'var(--radius-md)',
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.5)',
            padding: '4px',
            zIndex: 150,
            display: 'flex',
            flexDirection: 'column',
            gap: '2px'
          }}
        >
          <div style={{ padding: '4px 8px', fontSize: '9px', fontWeight: 'bold', color: 'var(--color-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Slash Commands (/)
          </div>
          {filteredSlashCommands.map(cmd => (
            <button
              key={cmd.name}
              onClick={() => handleSelectSlash(cmd.name)}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '2px',
                padding: '6px 8px',
                background: 'transparent',
                border: 'none',
                color: 'var(--color-text-base)',
                borderRadius: 'var(--radius-sm)',
                cursor: 'pointer',
                textAlign: 'left'
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-surface-2)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '11px', fontWeight: 'bold', color: 'var(--color-secondary)', fontFamily: 'var(--font-mono)' }}>
                  {cmd.name}
                </span>
              </div>
              <span style={{ fontSize: '9px', color: 'var(--color-text-muted)' }}>
                {cmd.desc}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Mentions Auto-complete Popover. Cheatsheets, notes and workspace files */}
      {mentionQuery !== null && hasMentionResults && (
        <div
          style={{
            position: 'absolute',
            bottom: '100%',
            left: 0,
            marginBottom: '8px',
            width: '270px',
            maxHeight: '260px',
            overflowY: 'auto',
            background: 'var(--color-surface-1)',
            border: '1px solid var(--color-secondary)',
            borderRadius: 'var(--radius-md)',
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.5)',
            padding: '4px',
            zIndex: 150,
            display: 'flex',
            flexDirection: 'column',
            gap: '2px'
          }}
        >
          {filteredCheatsheets.length > 0 && (
            <div style={{ padding: '4px 8px', fontSize: '9px', fontWeight: 'bold', color: 'var(--color-primary-soft)', textTransform: 'uppercase' }}>
              Cheatsheets
            </div>
          )}
          {filteredCheatsheets.map(cs => (
            <button
              key={`cs-${cs.name}`}
              onClick={() => handleSelectMention(cs.name)}
              style={{
                display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 8px',
                background: attachedCheatsheets.includes(cs.name) ? 'var(--color-surface-offset)' : 'transparent',
                border: 'none', color: 'var(--color-text-base)', borderRadius: 'var(--radius-sm)',
                fontSize: '11px', cursor: 'pointer', textAlign: 'left'
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-surface-2)')}
              onMouseLeave={e => (e.currentTarget.style.background = attachedCheatsheets.includes(cs.name) ? 'var(--color-surface-offset)' : 'transparent')}
            >
              <BookOpen size={13} style={{ color: 'var(--color-primary-soft)', flexShrink: 0 }} />
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cs.name}</span>
              {attachedCheatsheets.includes(cs.name) && (
                <span style={{ fontSize: '9px', color: 'var(--color-secondary)', fontWeight: 'bold' }}>Attached</span>
              )}
            </button>
          ))}

          {filteredNotes.length > 0 && (
            <div style={{ padding: '4px 8px', fontSize: '9px', fontWeight: 'bold', color: 'var(--color-success-soft)', textTransform: 'uppercase' }}>
              Notes
            </div>
          )}
          {filteredNotes.map(title => (
            <button
              key={`n-${title}`}
              onClick={() => handleSelectNoteMention(title)}
              style={{
                display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 8px',
                background: attachedNotes.includes(title) ? 'var(--color-surface-offset)' : 'transparent',
                border: 'none', color: 'var(--color-text-base)', borderRadius: 'var(--radius-sm)',
                fontSize: '11px', cursor: 'pointer', textAlign: 'left'
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-surface-2)')}
              onMouseLeave={e => (e.currentTarget.style.background = attachedNotes.includes(title) ? 'var(--color-surface-offset)' : 'transparent')}
            >
              <FileText size={13} style={{ color: 'var(--color-success-soft)', flexShrink: 0 }} />
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
              {attachedNotes.includes(title) && (
                <span style={{ fontSize: '9px', color: 'var(--color-secondary)', fontWeight: 'bold' }}>Attached</span>
              )}
            </button>
          ))}

          {filteredFiles.length > 0 && (
            <div style={{ padding: '4px 8px', fontSize: '9px', fontWeight: 'bold', color: 'var(--color-info)', textTransform: 'uppercase' }}>
              Workspace Files
            </div>
          )}
          {filteredFiles.map(f => (
            <button
              key={`f-${f.relativePath}`}
              onClick={() => handleSelectFileMention(f.relativePath)}
              title={f.relativePath}
              style={{
                display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 8px',
                background: attachedFiles.includes(f.relativePath) ? 'var(--color-surface-offset)' : 'transparent',
                border: 'none', color: 'var(--color-text-base)', borderRadius: 'var(--radius-sm)',
                fontSize: '11px', cursor: 'pointer', textAlign: 'left'
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-surface-2)')}
              onMouseLeave={e => (e.currentTarget.style.background = attachedFiles.includes(f.relativePath) ? 'var(--color-surface-offset)' : 'transparent')}
            >
              <FileCode size={13} style={{ color: 'var(--color-info)', flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                <span style={{ fontSize: '9px', color: 'var(--color-text-faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.relativePath}</span>
              </div>
              {attachedFiles.includes(f.relativePath) && (
                <span style={{ fontSize: '9px', color: 'var(--color-secondary)', fontWeight: 'bold' }}>Attached</span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Input Field Container */}
      <div
        style={{
          display: 'flex',
          gap: 'var(--space-2)',
          background: 'var(--color-surface-2)',
          border: '1px solid var(--color-surface-offset)',
          borderRadius: 'var(--radius-md)',
          padding: 'var(--space-2) var(--space-3)',
          alignItems: 'flex-end',
          boxSizing: 'border-box',
          position: 'relative',
          flexWrap: 'wrap'
        }}
      >
        {/* Left Plus Dropdown Button */}
        <div ref={menuRef} style={{ position: 'relative', alignSelf: 'center', display: 'flex', alignItems: 'center' }}>
          <button
            onClick={() => setShowPlusMenu(!showPlusMenu)}
            disabled={isStreaming}
            style={{
              background: showPlusMenu ? 'var(--color-secondary-muted)' : 'transparent',
              border: 'none',
              color: showPlusMenu ? 'var(--color-secondary)' : 'var(--color-text-muted)',
              borderRadius: 'var(--radius-sm)',
              width: '24px',
              height: '24px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: isStreaming ? 'default' : 'pointer',
              transition: 'all 150ms ease',
              flexShrink: 0
            }}
            onMouseEnter={e => {
              if (!isStreaming && !showPlusMenu) e.currentTarget.style.color = 'var(--color-text-base)'
            }}
            onMouseLeave={e => {
              if (!isStreaming && !showPlusMenu) e.currentTarget.style.color = 'var(--color-text-muted)'
            }}
            title="AI Features & Tools"
          >
            <Plus size={16} />
          </button>

          {/* Plus Features Menu Popover */}
          {showPlusMenu && (
            <div
              style={{
                position: 'absolute',
                bottom: '100%',
                left: 0,
                marginBottom: '8px',
                width: '210px',
                background: 'var(--color-surface-1)',
                border: '1px solid var(--color-surface-offset)',
                borderRadius: 'var(--radius-md)',
                boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)',
                padding: '4px',
                zIndex: 100,
                display: 'flex',
                flexDirection: 'column',
                gap: '2px'
              }}
            >
              <div style={{ padding: '4px 8px', fontSize: '9px', fontWeight: 'bold', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>
                AI Actions & Tools
              </div>

              <button
                onClick={() => {
                  setShowPlusMenu(false)
                  setIsEmailDraftMode(true)
                  textareaRef.current?.focus()
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '6px 8px',
                  background: isEmailDraftMode ? 'var(--color-surface-2)' : 'transparent',
                  border: 'none',
                  color: 'var(--color-text-base)',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '11px',
                  cursor: 'pointer',
                  textAlign: 'left'
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-surface-2)')}
                onMouseLeave={e => (e.currentTarget.style.background = isEmailDraftMode ? 'var(--color-surface-2)' : 'transparent')}
              >
                <Mail size={13} style={{ color: 'var(--color-secondary)' }} />
                <span>Draft Email Mode</span>
              </button>

              <button
                onClick={() => setShowCheatsheetSubmenu(!showCheatsheetSubmenu)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '6px 8px',
                  background: showCheatsheetSubmenu ? 'var(--color-surface-2)' : 'transparent',
                  border: 'none',
                  color: 'var(--color-text-base)',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '11px',
                  cursor: 'pointer',
                  textAlign: 'left'
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-surface-2)')}
                onMouseLeave={e => (e.currentTarget.style.background = showCheatsheetSubmenu ? 'var(--color-surface-2)' : 'transparent')}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <BookOpen size={13} style={{ color: 'var(--color-primary-soft)' }} />
                  <span>Attach Cheatsheet...</span>
                </div>
                <span style={{ fontSize: '9px', color: 'var(--color-text-faint)' }}>({attachedCheatsheets.length})</span>
              </button>

              {/* Submenu for Cheatsheet attachment selection */}
              {showCheatsheetSubmenu && (
                <div
                  style={{
                    background: 'var(--color-surface-2)',
                    border: '1px solid var(--color-surface-offset)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '4px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '2px',
                    maxHeight: '140px',
                    overflowY: 'auto'
                  }}
                >
                  {availableCheatsheets.length === 0 ? (
                    <div style={{ padding: '4px 8px', fontSize: '10px', color: 'var(--color-text-faint)' }}>
                      No uploaded cheatsheets found.
                    </div>
                  ) : (
                    availableCheatsheets.map(cs => (
                      <button
                        key={cs.name}
                        onClick={() => handleToggleCheatsheet(cs.name)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          padding: '4px 6px',
                          background: attachedCheatsheets.includes(cs.name) ? 'var(--color-secondary-muted)' : 'transparent',
                          border: 'none',
                          color: attachedCheatsheets.includes(cs.name) ? 'var(--color-secondary)' : 'var(--color-text-base)',
                          borderRadius: 'var(--radius-sm)',
                          fontSize: '10px',
                          cursor: 'pointer',
                          textAlign: 'left'
                        }}
                      >
                        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cs.name}</span>
                        {attachedCheatsheets.includes(cs.name) && <X size={10} />}
                      </button>
                    ))
                  )}
                </div>
              )}

              <button
                onClick={() => {
                  if (!visionCapable) {
                    toast('The selected model does not support image input. Switch to a vision model (e.g. llava, gpt-4o, gemini).', { type: 'warning' })
                    return
                  }
                  imageInputRef.current?.click()
                }}
                style={{
                  display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 8px',
                  background: 'transparent', border: 'none',
                  color: visionCapable ? 'var(--color-text-base)' : 'var(--color-text-faint)',
                  borderRadius: 'var(--radius-sm)', fontSize: '11px', cursor: 'pointer', textAlign: 'left'
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-surface-2)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                title={visionCapable
                  ? 'Attach an image. You can also paste one directly into the input.'
                  : 'The selected model does not support images. Switch to a vision model (llava, moondream, gpt-4o, gemini…).'}
              >
                <ImageIcon size={13} style={{ color: visionCapable ? '#f472b6' : 'var(--color-text-faint)' }} />
                <span>
                  Attach Image…{' '}
                  <span style={{ fontSize: '9px', color: 'var(--color-text-faint)' }}>
                    {visionCapable ? '(vision)' : '(model not vision-capable)'}
                  </span>
                </span>
              </button>

              {(customActions.length > 0 || onManageCustomActions) && (
                <>
                  <div style={{ height: '1px', background: 'var(--color-surface-offset)', margin: '4px 0' }} />
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '2px 8px 4px' }}>
                    <span style={{ fontSize: '9px', fontWeight: 'bold', color: 'var(--color-text-faint)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      My prompts
                    </span>
                    {onManageCustomActions && (
                      <button
                        onClick={() => { setShowPlusMenu(false); onManageCustomActions() }}
                        title="Add, edit or delete your saved prompts"
                        style={{ background: 'transparent', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', gap: '3px', fontSize: '9px' }}
                      >
                        <Settings2 size={11} />
                        <span>Manage</span>
                      </button>
                    )}
                  </div>
                  {customActions.map(a => (
                    <button
                      key={a.id}
                      onClick={() => { setShowPlusMenu(false); onTriggerPrompt(a.prompt, a.label, a.intent) }}
                      title={a.prompt}
                      style={{
                        display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 8px', width: '100%',
                        background: 'transparent', border: 'none', color: 'var(--color-text-base)',
                        borderRadius: 'var(--radius-sm)', fontSize: '11px', cursor: 'pointer', textAlign: 'left'
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-surface-2)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                    >
                      <Sparkles size={13} style={{ color: a.intent === 'create' ? 'var(--color-secondary)' : 'var(--color-text-muted)' }} />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.label}</span>
                    </button>
                  ))}
                </>
              )}

              <div style={{ height: '1px', background: 'var(--color-surface-offset)', margin: '4px 0' }} />
              <div style={{ padding: '2px 8px 4px', fontSize: '9px', fontWeight: 'bold', color: 'var(--color-text-faint)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Create on the board
              </div>
              {CREATE_ACTIONS.map(a => {
                const Icon = a.icon
                return (
                  <button
                    key={a.label}
                    onClick={() => { setShowPlusMenu(false); onTriggerPrompt(a.prompt, a.label, 'create') }}
                    style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 8px', width: '100%', background: 'transparent', border: 'none', color: 'var(--color-text-base)', borderRadius: 'var(--radius-sm)', fontSize: '11px', cursor: 'pointer', textAlign: 'left' }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-surface-2)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    <Icon size={13} style={{ color: 'var(--color-secondary)' }} />
                    <span>{a.label}</span>
                  </button>
                )
              })}

              <div style={{ height: '1px', background: 'var(--color-surface-offset)', margin: '4px 0' }} />
              <div style={{ padding: '2px 8px 4px', fontSize: '9px', fontWeight: 'bold', color: 'var(--color-text-faint)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Analyze &amp; advise
              </div>
              {ANALYZE_ACTIONS.map(a => {
                const Icon = a.icon
                return (
                  <button
                    key={a.label}
                    onClick={() => { setShowPlusMenu(false); onTriggerPrompt(a.prompt, a.label, 'analyze') }}
                    style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 8px', width: '100%', background: 'transparent', border: 'none', color: 'var(--color-text-base)', borderRadius: 'var(--radius-sm)', fontSize: '11px', cursor: 'pointer', textAlign: 'left' }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-surface-2)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    <Icon size={13} style={{ color: 'var(--color-text-muted)' }} />
                    <span>{a.label}</span>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Email Draft Attachment Pill */}
        {isEmailDraftMode && (
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
              background: 'var(--color-secondary-muted)',
              border: '1px solid var(--color-secondary)',
              borderRadius: 'var(--radius-sm)',
              padding: '2px 8px',
              fontSize: '11px',
              fontWeight: 'bold',
              color: 'var(--color-secondary)',
              alignSelf: 'center',
              flexShrink: 0
            }}
          >
            <Mail size={12} />
            <span>Draft Email</span>
            <button
              onClick={() => setIsEmailDraftMode(false)}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--color-secondary)',
                cursor: 'pointer',
                padding: 0,
                display: 'flex',
                alignItems: 'center',
                marginLeft: '2px'
              }}
              title="Remove Draft Email Mode"
            >
              <X size={12} />
            </button>
          </div>
        )}

        {/* Active Skill Pill */}
        {activeSkill && (
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
              background: `${activeSkill.color}18`,
              border: `1px solid ${activeSkill.color}50`,
              borderRadius: 'var(--radius-sm)',
              padding: '2px 8px',
              fontSize: '10px',
              fontWeight: 'bold',
              color: activeSkill.color,
              alignSelf: 'center',
              flexShrink: 0
            }}
          >
            <Sparkles size={10} />
            <span>{activeSkill.shortLabel}</span>
            <button
              onClick={onClearSkill}
              style={{
                background: 'transparent',
                border: 'none',
                color: activeSkill.color,
                cursor: 'pointer',
                padding: 0,
                display: 'flex',
                alignItems: 'center',
                marginLeft: '3px'
              }}
              title="Remove active skill"
            >
              <X size={11} />
            </button>
          </div>
        )}

        {/* Hidden image file input */}
        <input
          ref={imageInputRef}
          type="file"
          accept="image/*"
          multiple
          style={{ display: 'none' }}
          onChange={e => {
            const files = Array.from(e.target.files || [])
            files.slice(0, 4).forEach(f => addImageFile(f))
            e.target.value = ''
          }}
        />

        {/* Attached Note Pills */}
        {attachedNotes.map(title => (
          <div
            key={`np-${title}`}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '5px',
              background: 'rgba(34, 197, 94, 0.14)', border: '1px solid rgba(34, 197, 94, 0.4)',
              borderRadius: 'var(--radius-sm)', padding: '2px 8px',
              fontSize: '11px', fontWeight: 'bold', color: 'var(--color-success-soft)', alignSelf: 'center', flexShrink: 0
            }}
          >
            <FileText size={12} />
            <span style={{ maxWidth: '110px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
            <button
              onClick={() => setAttachedNotes(attachedNotes.filter(n => n !== title))}
              style={{ background: 'transparent', border: 'none', color: 'var(--color-success-soft)', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', marginLeft: '2px' }}
              title="Remove note"
            >
              <X size={12} />
            </button>
          </div>
        ))}

        {/* Attached Workspace File Pills */}
        {attachedFiles.map(relPath => (
          <div
            key={`fp-${relPath}`}
            title={relPath}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '5px',
              background: 'rgba(56, 189, 248, 0.14)', border: '1px solid rgba(56, 189, 248, 0.4)',
              borderRadius: 'var(--radius-sm)', padding: '2px 8px',
              fontSize: '11px', fontWeight: 'bold', color: 'var(--color-info)', alignSelf: 'center', flexShrink: 0
            }}
          >
            <FileCode size={12} />
            <span style={{ maxWidth: '110px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{relPath.split(/[\\/]/).pop()}</span>
            <button
              onClick={() => setAttachedFiles(attachedFiles.filter(f => f !== relPath))}
              style={{ background: 'transparent', border: 'none', color: 'var(--color-info)', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', marginLeft: '2px' }}
              title="Remove file"
            >
              <X size={12} />
            </button>
          </div>
        ))}

        {/* Attached Image Thumbnails */}
        {attachedImages.map((src, idx) => (
          <div key={`img-${idx}`} style={{ position: 'relative', alignSelf: 'center', flexShrink: 0 }}>
            <img
              src={src}
              alt={`attachment ${idx + 1}`}
              style={{ width: '34px', height: '34px', objectFit: 'cover', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(244, 114, 182, 0.5)', display: 'block' }}
            />
            <button
              onClick={() => setAttachedImages(attachedImages.filter((_, i) => i !== idx))}
              title="Remove image"
              style={{
                position: 'absolute', top: '-5px', right: '-5px',
                width: '14px', height: '14px', borderRadius: '50%',
                background: 'var(--color-surface-elevated)', border: '1px solid var(--color-surface-offset)',
                color: 'var(--color-text-base)', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0
              }}
            >
              <X size={9} />
            </button>
          </div>
        ))}

        {/* Attached Cheatsheets Pills */}
        {attachedCheatsheets.map(csName => (
          <div
            key={csName}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
              background: 'rgba(59, 130, 246, 0.15)',
              border: '1px solid rgba(59, 130, 246, 0.4)',
              borderRadius: 'var(--radius-sm)',
              padding: '2px 8px',
              fontSize: '11px',
              fontWeight: 'bold',
              color: 'var(--color-primary-soft)',
              alignSelf: 'center',
              flexShrink: 0
            }}
          >
            <BookOpen size={12} />
            <span style={{ maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{csName}</span>
            <button
              onClick={() => handleToggleCheatsheet(csName)}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--color-primary-soft)',
                cursor: 'pointer',
                padding: 0,
                display: 'flex',
                alignItems: 'center',
                marginLeft: '2px'
              }}
              title="Remove Cheatsheet"
            >
              <X size={12} />
            </button>
          </div>
        ))}

        <textarea
          ref={textareaRef}
          value={value}
          onChange={e => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={
            isStreaming
              ? 'Streaming completion...'
              : isEmailDraftMode
              ? 'Describe the email you want to draft...'
              : activeSkill
              ? `Ask the ${activeSkill.shortLabel}... (@ mentions docs, notes & files)`
              : 'Ask assistant... (@ mentions docs, notes & files · paste images)'
          }
          disabled={isStreaming}
          rows={1}
          style={{
            flex: 1,
            background: 'transparent',
            border: 'none',
            outline: 'none',
            color: 'var(--color-text-base)',
            fontSize: 'var(--text-xs)',
            lineHeight: 1.5,
            resize: 'none',
            padding: '4px 0',
            maxHeight: '180px',
            fontFamily: 'inherit',
            minWidth: '120px'
          }}
        />

        <button
          onClick={handleToggleListening}
          disabled={isStreaming}
          style={{
            background: isListening ? 'rgba(239, 68, 68, 0.2)' : 'transparent',
            border: isListening ? '1px solid #ef4444' : 'none',
            color: isListening ? '#ef4444' : 'var(--color-text-muted)',
            borderRadius: 'var(--radius-md)',
            width: '28px',
            height: '28px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            flexShrink: 0,
            animation: isListening ? 'pulse 1.5s infinite' : 'none'
          }}
          title={isListening ? 'Stop listening' : 'Start voice dictation'}
        >
          <Mic size={14} />
        </button>

        {/* Action Button: Send or Stop */}
        {isStreaming ? (
          <button
            onClick={onAbort}
            style={{
              background: 'var(--color-error)',
              border: 'none',
              color: 'var(--color-text-inverted)',
              borderRadius: 'var(--radius-md)',
              width: '28px',
              height: '28px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              flexShrink: 0
            }}
            title="Stop generating"
          >
            <Square size={12} fill="currentColor" />
          </button>
        ) : (
          <button
            onClick={handleFormSubmit}
            disabled={(!value.trim() && !hasAnyAttachment)}
            style={{
              background: (value.trim() || hasAnyAttachment) ? 'var(--color-secondary)' : 'var(--color-surface-offset)',
              border: 'none',
              color: (value.trim() || hasAnyAttachment) ? 'var(--color-text-inverted)' : 'var(--color-text-faint)',
              borderRadius: 'var(--radius-md)',
              width: '28px',
              height: '28px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: (value.trim() || hasAnyAttachment) ? 'pointer' : 'default',
              flexShrink: 0
            }}
          >
            <Send size={14} />
          </button>
        )}
      </div>
    </div>
  )
}