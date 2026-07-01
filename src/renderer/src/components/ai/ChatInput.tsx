import React, { useRef, useEffect, useState } from 'react'
import { Send, Square, Plus, Mail, Sparkles, FileText, X, BookOpen, Mic } from 'lucide-react'
import type { Item } from '../../../../shared/types'

interface ChatInputProps {
  value: string
  onChange: (val: string) => void
  onSubmit: (options?: { mode?: string; cheatsheets?: string[] }) => void
  onAbort: () => void
  isStreaming: boolean
  contextItem: Item | null
  onTriggerPrompt: (prompt: string) => void
  activeSkill?: { id: string; label: string; shortLabel: string; color: string } | null
  onClearSkill?: () => void
}

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
  contextItem,
  onTriggerPrompt,
  activeSkill,
  onClearSkill
}: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [showPlusMenu, setShowPlusMenu] = useState(false)
  const [isEmailDraftMode, setIsEmailDraftMode] = useState(false)
  const [availableCheatsheets, setAvailableCheatsheets] = useState<CheatsheetFile[]>([])
  const [attachedCheatsheets, setAttachedCheatsheets] = useState<string[]>([])
  const [showCheatsheetSubmenu, setShowCheatsheetSubmenu] = useState(false)
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const [slashQuery, setSlashQuery] = useState<string | null>(null)
  const [isListening, setIsListening] = useState(false)

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
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SpeechRecognition) {
      alert('Speech recognition is not supported in this environment.')
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
      recognition.onresult = (event: any) => {
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

  // Load cheatsheets on mount & menu toggle
  useEffect(() => {
    const fetchCheatsheets = async () => {
      try {
        const list = await window.electronAPI.cheatsheets.list()
        setAvailableCheatsheets(list)
      } catch (err) {
        console.warn('Failed to fetch cheatsheets for AI input:', err)
      }
    }
    fetchCheatsheets()
  }, [showPlusMenu])

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

  const handleSelectMention = (csName: string) => {
    if (!attachedCheatsheets.includes(csName)) {
      setAttachedCheatsheets([...attachedCheatsheets, csName])
    }
    // Remove @query from textarea
    const textarea = textareaRef.current
    const cursor = textarea?.selectionStart || value.length
    const textBeforeCursor = value.slice(0, cursor)
    const lastAtIdx = textBeforeCursor.lastIndexOf('@')
    if (lastAtIdx !== -1) {
      const newVal = value.slice(0, lastAtIdx) + value.slice(cursor)
      onChange(newVal)
    }
    setMentionQuery(null)
    textareaRef.current?.focus()
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
    // FIX: Allow submission when cheatsheets are attached even with no text
    if ((!value.trim() && attachedCheatsheets.length === 0) || isStreaming) return
    const mode = isEmailDraftMode ? 'email_draft' : undefined
    onSubmit({ mode, cheatsheets: attachedCheatsheets.length > 0 ? attachedCheatsheets : undefined })
    // Save to prompt history
    if (value.trim()) {
      setPromptHistory(prev => [value.trim(), ...prev.slice(0, 49)])
    }
    setHistoryIndex(-1)
    setSavedInputBeforeHistory('')
    setIsEmailDraftMode(false)
    setAttachedCheatsheets([])
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
      if (mentionQuery !== null && filteredCheatsheets.length > 0) {
        e.preventDefault()
        handleSelectMention(filteredCheatsheets[0].name)
        return
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
  )

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

      {/* Mentions Auto-complete Popover */}
      {mentionQuery !== null && filteredCheatsheets.length > 0 && (
        <div
          style={{
            position: 'absolute',
            bottom: '100%',
            left: 0,
            marginBottom: '8px',
            width: '240px',
            maxHeight: '180px',
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
          <div style={{ padding: '4px 8px', fontSize: '9px', fontWeight: 'bold', color: 'var(--color-secondary)', textTransform: 'uppercase' }}>
            Mention Cheatsheet (@)
          </div>
          {filteredCheatsheets.map(cs => (
            <button
              key={cs.name}
              onClick={() => handleSelectMention(cs.name)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '6px 8px',
                background: attachedCheatsheets.includes(cs.name) ? 'var(--color-surface-offset)' : 'transparent',
                border: 'none',
                color: 'var(--color-text-base)',
                borderRadius: 'var(--radius-sm)',
                fontSize: '11px',
                cursor: 'pointer',
                textAlign: 'left'
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-surface-2)')}
              onMouseLeave={e => (e.currentTarget.style.background = attachedCheatsheets.includes(cs.name) ? 'var(--color-surface-offset)' : 'transparent')}
            >
              <BookOpen size={13} style={{ color: '#60a5fa' }} />
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cs.name}</span>
              {attachedCheatsheets.includes(cs.name) && (
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
                  <BookOpen size={13} style={{ color: '#60a5fa' }} />
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

              <div style={{ height: '1px', background: 'var(--color-surface-offset)', margin: '4px 0' }} />

              <button
                onClick={() => {
                  setShowPlusMenu(false)
                  onTriggerPrompt(
                    'Summarize all my tasks and current board progress in detail. (Note: Do NOT output any JSON blocks. Just return a plain text/markdown summary.)',
                    'Summarize Tasks'
                  )
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '6px 8px',
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--color-text-base)',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '11px',
                  cursor: 'pointer',
                  textAlign: 'left'
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-surface-2)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <FileText size={13} />
                <span>Scrape & Summarize Tasks</span>
              </button>

              <button
                onClick={() => {
                  setShowPlusMenu(false)
                  onTriggerPrompt(
                    'Suggest 3 actionable new tasks based on my current workspace items. Output them in a JSON block. CRITICAL: The JSON block must ONLY contain the "cards" array with the NEW cards. Do NOT include any "columns" array or any of the existing cards in the JSON, otherwise they will be duplicated on the board.',
                    'Suggest New Tasks'
                  )
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '6px 8px',
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--color-text-base)',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '11px',
                  cursor: 'pointer',
                  textAlign: 'left'
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-surface-2)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <Sparkles size={13} />
                <span>Suggest New Tasks</span>
              </button>

              <button
                onClick={() => {
                  setShowPlusMenu(false)
                  onTriggerPrompt(
                    'Explain the current state of my project and active tasks. (Note: Do NOT output any JSON blocks. Just return a plain text/markdown description.)',
                    'Explain Workspace'
                  )
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '6px 8px',
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--color-text-base)',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '11px',
                  cursor: 'pointer',
                  textAlign: 'left'
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-surface-2)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <Sparkles size={13} />
                <span>Explain Workspace</span>
              </button>
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
              color: '#60a5fa',
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
                color: '#60a5fa',
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
          placeholder={
            isStreaming
              ? 'Streaming completion...'
              : isEmailDraftMode
              ? 'Describe the email you want to draft...'
              : activeSkill
              ? `Ask the ${activeSkill.shortLabel}... (type @ to reference cheatsheets)`
              : 'Ask assistant... (type @ to reference cheatsheets)'
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
              background: 'var(--color-error, #ef4444)',
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
            disabled={(!value.trim() && attachedCheatsheets.length === 0)}
            style={{
              background: (value.trim() || attachedCheatsheets.length > 0) ? 'var(--color-secondary)' : 'var(--color-surface-offset)',
              border: 'none',
              color: (value.trim() || attachedCheatsheets.length > 0) ? 'var(--color-text-inverted)' : 'var(--color-text-faint)',
              borderRadius: 'var(--radius-md)',
              width: '28px',
              height: '28px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: (value.trim() || attachedCheatsheets.length > 0) ? 'pointer' : 'default',
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