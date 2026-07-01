import React, { useState, useEffect, useRef, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useAppStore } from '../store/appStore'
import type { Item } from '../../../shared/types'
import { useToast } from './ui/Toast'

// Zero-dependency SVG Icons
const SparklesIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/>
    <path d="m5 3 1 2.5L8.5 6 6 7 5 9.5 4 7 1.5 6 4 5.5z"/>
    <path d="m19 17 1 2.5 2.5.5-2.5 1-1 2.5-1-2.5-2.5-1 2.5-1z"/>
  </svg>
)

const CloseIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18"/>
    <line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
)

const CopyIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect width="14" height="14" x="8" y="8" rx="2" ry="2"/>
    <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>
  </svg>
)

const CheckIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12"/>
  </svg>
)

const SaveIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
    <polyline points="17 21 17 13 7 13 7 21"/>
    <polyline points="7 3 7 8 15 8"/>
  </svg>
)

const FeedIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>
    <polyline points="16 6 12 2 8 6"/>
    <line x1="12" y1="2" x2="12" y2="15"/>
  </svg>
)

const SYSTEM_PROMPT = `You are a professional Agile Scrum Master and an Executive AI Summarizer.
Your goal is to take informal, rough developer log entries and translate them into a structured daily standup report.

CRITICAL INSTRUCTIONS:
- You MUST sanitize and clean up the language. If there are curses, frustrations, venting, slang, or raw emotions in the developer logs, translate them into professional, constructive, business-appropriate terms (e.g. replace "fucking database lock again" with "addressing database transaction concurrency bottlenecks", "fuck this css issue" with "resolving styling layout alignment bug").
- Group your summary strictly into three sections (using Markdown headings):
  1. **Achievements**: Resolved issues, coded features, completed tasks.
  2. **In Progress**: Ongoing work, current objectives, and focus areas.
  3. **Impediments**: Blockers, critical bugs, delays, or dependencies.
- You must write the report in the requested style:
  - "Professional Corporate": Formal, well-written paragraphs and structured lists suitable for management reports.
  - "Bullet Point Agile": Concise, direct bullet points formatted for a team Slack channel or daily standup.
  - "High-Level Executive Summary": A concise 2-3 sentence overview paragraph for leadership, followed by 3-4 top-level key accomplishments.

Provide ONLY the markdown output. Do not output any preamble, introduction, or conversational filler like "Here is your report". Start immediately with the markdown content.`

interface StandupTranslatorViewProps {
  isOpen: boolean
  onClose: () => void
  onReportPosted?: () => void
}

export default function StandupTranslatorView({
  isOpen,
  onClose,
  onReportPosted
}: StandupTranslatorViewProps) {
  const activeContext = useAppStore(s => s.activeContext)
  const { toast } = useToast()

  // State Management
  const [logs, setLogs] = useState<Item[]>([])
  const [loadingLogs, setLoadingLogs] = useState(false)
  const [timeRange, setTimeRange] = useState<number>(24)
  const [selectedLogIds, setSelectedLogIds] = useState<string[]>([])
  const [style, setStyle] = useState<'Corporate' | 'Agile' | 'Executive'>('Agile')

  // AI Configuration
  const [selectedModel, setSelectedModel] = useState('llama3')
  const [localModels, setLocalModels] = useState<string[]>([])
  const [useOllamaSelector, setUseOllamaSelector] = useState(false)
  const [temperature, setTemperature] = useState(0.5)
  const [maxTokens, setMaxTokens] = useState(2048)

  // AI Streaming State
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamingText, setStreamingText] = useState('')
  const chunkBufferRef = useRef('')
  const animationFrameRef = useRef<number | null>(null)
  const lastUpdateRef = useRef(0)
  const reportEndRef = useRef<HTMLDivElement>(null)

  // Action feedback states
  const [copied, setCopied] = useState(false)
  const [posting, setPosting] = useState(false)

  // 1. Load active contexts & logs when modal opens
  const fetchLogs = async () => {
    setLoadingLogs(true)
    try {
      const res = await window.electronAPI.db.getItems(activeContext, 'log', 1, 500)
      
      const now = Date.now()
      const hoursMs = timeRange * 60 * 60 * 1000
      
      // Filter logs by the time range (newest first as returned, we preserve this)
      const filtered = res.items.filter(item => {
        const diff = now - item.created_at
        return diff >= 0 && diff <= hoursMs
      })

      setLogs(filtered)
      setSelectedLogIds(filtered.map(l => l.id))
    } catch (err) {
      console.error('Failed to fetch logs for standup:', err)
      toast('Failed to load raw logs')
    } finally {
      setLoadingLogs(false)
    }
  }

  useEffect(() => {
    if (isOpen) {
      fetchLogs()
      setStreamingText('')
    }
  }, [isOpen, timeRange, activeContext])

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

        const list = await window.electronAPI.ollama.listLocal()
        if (list && list.length > 0) {
          setLocalModels(list)
          setUseOllamaSelector(true)
          if (!dbModel) {
            setSelectedModel(list[0])
          }
        } else {
          setUseOllamaSelector(false)
        }
      } catch {
        setUseOllamaSelector(false)
      }
    }
    loadAiConfig()
  }, [])

  // 3. Register IPC Streaming listeners
  useEffect(() => {
    const unsubscribeChunk = window.electronAPI.ai.onChunk((chunk) => {
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
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
        animationFrameRef.current = null
      }
      setStreamingText(chunkBufferRef.current)
      setIsStreaming(false)
    })

    const unsubscribeError = window.electronAPI.ai.onError((errMessage) => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
        animationFrameRef.current = null
      }
      setStreamingText(prev => prev + `\n\n**Error:** ${errMessage}`)
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

  // Auto-scroll streaming output
  useEffect(() => {
    if (isStreaming && reportEndRef.current) {
      reportEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [streamingText, isStreaming])

  // Defined before the ESC effect so it's always current when Escape fires
  const handleClose = useCallback(() => {
    if (isStreaming) {
      // handleAbort is called inline here to avoid circular dependency
      window.electronAPI.ai.abortStream().catch(() => {})
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
        animationFrameRef.current = null
      }
      setIsStreaming(false)
    }
    onClose()
  }, [isStreaming, onClose])

  // ESC key handler to close
  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, handleClose])

  // Lock body scroll when open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [isOpen])

  if (!isOpen) return null

  const handleToggleLog = (id: string) => {
    setSelectedLogIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    )
  }

  const handleSelectAll = () => {
    if (selectedLogIds.length === logs.length) {
      setSelectedLogIds([])
    } else {
      setSelectedLogIds(logs.map(l => l.id))
    }
  }

  const handleModelChange = (val: string) => {
    setSelectedModel(val)
  }

  const handleAbort = async () => {
    try {
      await window.electronAPI.ai.abortStream()
    } catch (err) {
      console.error('Failed to abort stream:', err)
    }
    setIsStreaming(false)
  }

  // handleClose is now defined above (before ESC effect) as a useCallback

  const handleGenerate = async () => {
    if (isStreaming) return

    const selectedLogs = logs.filter(l => selectedLogIds.includes(l.id))
    if (selectedLogs.length === 0) {
      toast('Please select at least one log entry to include.')
      return
    }

    setIsStreaming(true)
    chunkBufferRef.current = ''
    setStreamingText('')

    const styleDescriptions = {
      Corporate: 'Professional Corporate (Formal, well-written paragraphs and structured lists suitable for management reports)',
      Agile: 'Bullet Point Agile (Concise, direct bullet points formatted for a team Slack channel or daily standup)',
      Executive: 'High-Level Executive Summary (A concise 2-3 sentence overview paragraph for leadership, followed by 3-4 top-level key accomplishments)'
    }

    const messages = [
      {
        role: 'system' as const,
        content: SYSTEM_PROMPT
      },
      {
        role: 'user' as const,
        content: `Generate a daily standup report for the past ${timeRange} hours in the style of "${styleDescriptions[style]}".

Raw developer logs:
${selectedLogs.map(l => `- [Created: ${new Date(l.created_at).toLocaleString()}] ${l.title}\n${l.body}`).join('\n\n')}`
      }
    ]

    try {
      await window.electronAPI.ai.startStream({
        model: selectedModel,
        messages,
        temperature,
        maxTokens
      })
    } catch (err) {
      setIsStreaming(false)
      const error = err as Error
      setStreamingText(`**Failed to initiate stream:** ${error.message || String(err)}`)
    }
  }

  const handleCopy = async () => {
    if (!streamingText) return
    try {
      await navigator.clipboard.writeText(streamingText)
      setCopied(true)
      toast('Report copied to clipboard!')
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy text:', err)
      toast('Failed to copy to clipboard')
    }
  }

  const handleSaveToFile = async () => {
    if (!streamingText) return
    const defaultName = `standup_report_${activeContext}_${new Date().toISOString().slice(0, 10)}.md`
    try {
      const success = await window.electronAPI.app.saveFile(defaultName, streamingText)
      if (success) {
        toast('Report saved successfully!')
      }
    } catch (err) {
      console.error('Failed to save file:', err)
      toast('Failed to save file')
    }
  }

  const handlePostToFeed = async () => {
    if (!streamingText || posting) return
    setPosting(true)
    try {
      const title = `AI Daily Standup Report (${style})`
      await window.electronAPI.db.createItem({
        type: 'log',
        context: activeContext,
        title,
        body: streamingText,
        status: 'open',
        priority: 0,
        position: Date.now(),
        due_at: null,
        metadata: JSON.stringify({ isAiReport: true, reportStyle: style })
      })
      toast('Standup report posted to feed!')
      if (onReportPosted) {
        onReportPosted()
      }
      handleClose()
    } catch (err) {
      console.error('Failed to post standup report to feed:', err)
      toast('Failed to post standup report')
    } finally {
      setPosting(false)
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(7, 8, 12, 0.85)',
        backdropFilter: 'blur(10px)',
        zIndex: 10000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'var(--space-6)'
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="standup-modal-title"
    >
      <style>{`
        @keyframes modal-fade-in {
          from { opacity: 0; transform: scale(0.97); }
          to { opacity: 1; transform: scale(1); }
        }
        .pulse-caret::after {
          content: '▊';
          color: var(--color-secondary);
          animation: caret-blink 0.8s infinite;
          margin-left: 2px;
        }
        @keyframes caret-blink {
          0%, 100% { opacity: 0; }
          50% { opacity: 1; }
        }
      `}</style>

      <div
        style={{
          background: 'var(--color-surface-1)',
          border: '1px solid var(--color-surface-offset)',
          borderRadius: 'var(--radius-lg)',
          width: '100%',
          maxWidth: '950px',
          height: '85vh',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.7)',
          animation: 'modal-fade-in 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden'
        }}
      >
        {/* Header */}
        <header
          style={{
            padding: 'var(--space-4) var(--space-6)',
            borderBottom: '1px solid var(--color-surface-offset)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'rgba(19, 22, 34, 0.4)',
            flexShrink: 0
          }}
        >
          <div>
            <h2
              id="standup-modal-title"
              style={{
                fontSize: 'var(--text-md)',
                fontWeight: 'var(--weight-semibold)',
                color: 'var(--color-text-base)',
                margin: 0,
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-2)'
              }}
            >
              <SparklesIcon />
              AI Standup Translator
            </h2>
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
              Translate raw notes into structured agile logs for context <strong>#{activeContext}</strong>
            </span>
          </div>

          <button
            className="btn-icon"
            onClick={handleClose}
            aria-label="Close Standup Translator"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--color-text-muted)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '6px',
              borderRadius: 'var(--radius-sm)',
              transition: 'background var(--duration-fast), color var(--duration-fast)'
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = 'var(--color-surface-offset)'
              e.currentTarget.style.color = 'var(--color-text-base)'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'transparent'
              e.currentTarget.style.color = 'var(--color-text-muted)'
            }}
          >
            <CloseIcon />
          </button>
        </header>

        {/* Body columns */}
        <div style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden' }}>
          
          {/* Left Column: Controls & Checklist */}
          <div
            style={{
              width: '42%',
              borderRight: '1px solid var(--color-surface-offset)',
              display: 'flex',
              flexDirection: 'column',
              minHeight: 0,
              background: 'rgba(19, 22, 34, 0.2)'
            }}
          >
            {/* Timeframe & Style Options */}
            <div
              style={{
                padding: 'var(--space-4) var(--space-5)',
                borderBottom: '1px solid var(--color-surface-offset)',
                display: 'flex',
                flexDirection: 'column',
                gap: 'var(--space-4)',
                flexShrink: 0
              }}
            >
              {/* Time Range */}
              <div>
                <label style={{ fontSize: '10px', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-muted)', textTransform: 'uppercase', display: 'block', marginBottom: 'var(--space-2)' }}>
                  Timeframe
                </label>
                <div style={{ display: 'flex', background: 'var(--color-surface-2)', borderRadius: 'var(--radius-md)', padding: '2px', width: 'fit-content', gap: '2px' }}>
                  {[
                    { value: 24, label: 'Past 24h' },
                    { value: 48, label: 'Past 48h' },
                    { value: 72, label: 'Past 72h' },
                    { value: 168, label: 'Past 7d' }
                  ].map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => { if (!isStreaming) setTimeRange(opt.value) }}
                      disabled={isStreaming}
                      style={{
                        background: timeRange === opt.value ? 'var(--color-surface-offset)' : 'transparent',
                        border: 'none',
                        color: timeRange === opt.value ? 'var(--color-text-base)' : 'var(--color-text-muted)',
                        fontSize: '11px',
                        fontWeight: 'var(--weight-medium)',
                        padding: '4px 12px',
                        borderRadius: 'var(--radius-sm)',
                        cursor: isStreaming ? 'default' : 'pointer',
                        transition: 'all var(--duration-fast)'
                      }}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Style Selection */}
              <div>
                <label style={{ fontSize: '10px', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-muted)', textTransform: 'uppercase', display: 'block', marginBottom: 'var(--space-2)' }}>
                  Output Summary Format
                </label>
                <select
                  value={style}
                  onChange={e => setStyle(e.target.value as typeof style)}
                  disabled={isStreaming}
                  style={{
                    width: '100%',
                    background: 'var(--color-surface-2)',
                    border: '1px solid var(--color-surface-offset)',
                    color: 'var(--color-text-base)',
                    borderRadius: 'var(--radius-md)',
                    padding: 'var(--space-2) var(--space-3)',
                    fontSize: 'var(--text-xs)',
                    outline: 'none',
                    cursor: isStreaming ? 'default' : 'pointer'
                  }}
                >
                  <option value="Agile">Bullet Point Agile (Recommended)</option>
                  <option value="Corporate">Professional Corporate</option>
                  <option value="Executive">High-Level Executive Summary</option>
                </select>
              </div>

              {/* Model status selector */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 'var(--text-2xs)' }}>
                <span style={{ color: 'var(--color-text-muted)', textTransform: 'uppercase', fontWeight: 'var(--weight-bold)' }}>AI Model</span>
                {useOllamaSelector ? (
                  <select
                    value={selectedModel}
                    onChange={e => handleModelChange(e.target.value)}
                    disabled={isStreaming}
                    style={{
                      background: 'var(--color-surface-2)',
                      border: '1px solid var(--color-surface-offset)',
                      color: 'var(--color-text-base)',
                      borderRadius: 'var(--radius-sm)',
                      padding: '2px 6px',
                      fontSize: '10px',
                      outline: 'none',
                      cursor: isStreaming ? 'default' : 'pointer'
                    }}
                  >
                    {localModels.map(m => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                ) : (
                  <span style={{ color: 'var(--color-secondary)', fontFamily: 'var(--font-mono)' }}>{selectedModel}</span>
                )}
              </div>
            </div>

            {/* Checklist Header */}
            <div
              style={{
                padding: 'var(--space-3) var(--space-5)',
                borderBottom: '1px solid var(--color-surface-offset)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                background: 'rgba(27, 31, 48, 0.2)',
                flexShrink: 0
              }}
            >
              <span style={{ fontSize: '11px', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text-base)' }}>
                Include Logs ({selectedLogIds.length} of {logs.length})
              </span>
              {logs.length > 0 && (
                <button
                  onClick={handleSelectAll}
                  disabled={isStreaming}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--color-secondary)',
                    fontSize: '10px',
                    fontWeight: 'var(--weight-medium)',
                    cursor: isStreaming ? 'default' : 'pointer',
                    padding: 0
                  }}
                >
                  {selectedLogIds.length === logs.length ? 'Deselect All' : 'Select All'}
                </button>
              )}
            </div>

            {/* Logs List Scroll */}
            <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-3) var(--space-5)' }}>
              {loadingLogs ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', padding: 'var(--space-4) 0' }}>
                  <div className="skeleton" style={{ height: '38px', width: '100%' }} />
                  <div className="skeleton" style={{ height: '38px', width: '100%' }} />
                  <div className="skeleton" style={{ height: '38px', width: '100%' }} />
                </div>
              ) : logs.length === 0 ? (
                <div style={{ padding: 'var(--space-8) 0', textAlign: 'center', color: 'var(--color-text-muted)' }}>
                  <p style={{ fontSize: 'var(--text-xs)', margin: '0 0 var(--space-2)' }}>No logs found in the past {timeRange} hours.</p>
                  <span style={{ fontSize: '10px', opacity: 0.6 }}>Add scratchpad logs to populate the list.</span>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                  {logs.map(log => {
                    const isSelected = selectedLogIds.includes(log.id)
                    return (
                      <div
                        key={log.id}
                        onClick={() => { if (!isStreaming) handleToggleLog(log.id) }}
                        style={{
                          display: 'flex',
                          alignItems: 'flex-start',
                          gap: 'var(--space-3)',
                          padding: 'var(--space-2.5) var(--space-3)',
                          background: isSelected ? 'rgba(30, 69, 252, 0.05)' : 'transparent',
                          border: isSelected ? '1px solid rgba(30, 69, 252, 0.3)' : '1px solid var(--color-surface-offset)',
                          borderRadius: 'var(--radius-md)',
                          cursor: isStreaming ? 'default' : 'pointer',
                          transition: 'all var(--duration-fast)'
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => {}} // Controlled by wrapper div click
                          disabled={isStreaming}
                          style={{
                            marginTop: '2px',
                            cursor: isStreaming ? 'default' : 'pointer',
                            accentColor: 'var(--color-primary)'
                          }}
                        />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-2)', marginBottom: '4px' }}>
                            <span style={{ fontSize: '11px', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text-base)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {log.title}
                            </span>
                            <span style={{ fontSize: '9px', color: 'var(--color-text-faint)', whiteSpace: 'nowrap' }}>
                              {new Date(log.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                          <p style={{ fontSize: '10px', color: 'var(--color-text-muted)', margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {log.body}
                          </p>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Bottom Generate Trigger */}
            <div style={{ padding: 'var(--space-4) var(--space-5)', borderTop: '1px solid var(--color-surface-offset)', background: 'var(--color-surface-2)' }}>
              {isStreaming ? (
                <button
                  onClick={handleAbort}
                  style={{
                    width: '100%',
                    background: 'var(--color-error)',
                    color: 'white',
                    border: 'none',
                    borderRadius: 'var(--radius-md)',
                    padding: 'var(--space-2.5) 0',
                    fontSize: 'var(--text-xs)',
                    fontWeight: 'var(--weight-bold)',
                    cursor: 'pointer'
                  }}
                >
                  Cancel AI Stream
                </button>
              ) : (
                <button
                  onClick={handleGenerate}
                  disabled={logs.length === 0 || selectedLogIds.length === 0}
                  style={{
                    width: '100%',
                    background: logs.length === 0 || selectedLogIds.length === 0 ? 'var(--color-surface-offset)' : 'var(--color-secondary)',
                    color: logs.length === 0 || selectedLogIds.length === 0 ? 'var(--color-text-faint)' : 'var(--color-text-inverted)',
                    border: 'none',
                    borderRadius: 'var(--radius-md)',
                    padding: 'var(--space-2.5) 0',
                    fontSize: 'var(--text-xs)',
                    fontWeight: 'var(--weight-bold)',
                    cursor: logs.length === 0 || selectedLogIds.length === 0 ? 'default' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 'var(--space-2)'
                  }}
                >
                  <SparklesIcon />
                  Generate Standup Report
                </button>
              )}
            </div>
          </div>

          {/* Right Column: Markdown Output Summary */}
          <div style={{ width: '58%', display: 'flex', flexDirection: 'column', minHeight: 0, background: 'var(--color-background)' }}>
            
            {/* Header / Actions Bar */}
            <div
              style={{
                height: '42px',
                borderBottom: '1px solid var(--color-surface-offset)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '0 var(--space-5)',
                background: 'rgba(19, 22, 34, 0.1)',
                flexShrink: 0
              }}
            >
              <span style={{ fontSize: '11px', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text-muted)' }}>
                Report Output
              </span>

              {streamingText && !isStreaming && (
                <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                  <button
                    onClick={handleCopy}
                    style={{
                      background: 'transparent',
                      border: '1px solid var(--color-surface-offset)',
                      color: 'var(--color-text-base)',
                      borderRadius: 'var(--radius-sm)',
                      padding: '4px 10px',
                      fontSize: '10px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px'
                    }}
                  >
                    {copied ? <CheckIcon /> : <CopyIcon />}
                    {copied ? 'Copied!' : 'Copy'}
                  </button>
                  <button
                    onClick={handleSaveToFile}
                    style={{
                      background: 'transparent',
                      border: '1px solid var(--color-surface-offset)',
                      color: 'var(--color-text-base)',
                      borderRadius: 'var(--radius-sm)',
                      padding: '4px 10px',
                      fontSize: '10px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px'
                    }}
                  >
                    <SaveIcon />
                    Export file
                  </button>
                  <button
                    onClick={handlePostToFeed}
                    disabled={posting}
                    style={{
                      background: 'var(--color-primary-muted)',
                      border: '1px solid var(--color-primary)',
                      color: 'var(--color-text-base)',
                      borderRadius: 'var(--radius-sm)',
                      padding: '4px 10px',
                      fontSize: '10px',
                      cursor: posting ? 'default' : 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px'
                    }}
                  >
                    <FeedIcon />
                    {posting ? 'Posting...' : 'Post to Feed'}
                  </button>
                </div>
              )}
            </div>

            {/* Markdown rendering viewport */}
            <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-6)' }}>
              {isStreaming && !streamingText ? (
                <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-muted)', textAlign: 'center', gap: 'var(--space-2)' }}>
                  <div className="skeleton" style={{ width: '40px', height: '40px', borderRadius: '50%' }} />
                  <span style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text-base)' }}>Initiating AI stream...</span>
                  <span style={{ fontSize: '10px', color: 'var(--color-text-faint)' }}>Connecting to {selectedModel}</span>
                </div>
              ) : !streamingText && !isStreaming ? (
                <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-faint)', textAlign: 'center', padding: 'var(--space-6)' }}>
                  <SparklesIcon />
                  <p style={{ fontSize: 'var(--text-xs)', marginTop: 'var(--space-3)', color: 'var(--color-text-muted)' }}>
                    No report generated yet.
                  </p>
                  <span style={{ fontSize: '10px', maxWidth: '300px', lineHeight: 1.5 }}>
                    Select raw log entries in the checklist on the left, then click "Generate Standup Report" to stream the AI summary here.
                  </span>
                </div>
              ) : (
                <div className={`markdown-body ${isStreaming ? 'pulse-caret' : ''}`} style={{ fontSize: 'var(--text-xs)', lineHeight: 1.6, color: 'var(--color-text-base)' }}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {streamingText}
                  </ReactMarkdown>
                  <div ref={reportEndRef} />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
