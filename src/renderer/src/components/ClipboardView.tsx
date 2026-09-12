import React, { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Search,
  Trash2,
  Star,
  Copy,
  Plus,
  Edit2,
  Check,
  Clipboard,
  Info,
  Send,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  X
} from 'lucide-react'
import type { ClipboardItem } from '../../../shared/types'
import ConfirmDialog from './ui/ConfirmDialog'
import { useToast } from './ui/Toast'
import { COPIED_FEEDBACK_MS } from '../lib/timings'

// Keep in sync with the DELETE ... LIMIT in db/clipboard.ts (stmtDeleteClipboardHistoryOverflow).
const HISTORY_LIMIT = 200

// Content-type detection
// Best-practice clipboard managers classify each entry so the list is scannable
// at a glance and can offer type-specific actions (e.g. open a link).
type ContentKind = 'link' | 'email' | 'color' | 'number' | 'code' | 'text'

interface ContentMeta {
  kind: ContentKind
  label: string
  accent: string // badge/strip accent. For colors this is the colour itself
}

function looksLikeCode(text: string): boolean {
  if (/\n/.test(text) && /[{}();=]|=>|:\s|<\/?[a-z]/i.test(text)) return true
  if (/^\s*(function|const|let|var|import|export|class|def|public|private|return|#include|SELECT |<[a-z!/])/m.test(text)) return true
  const lines = text.split('\n')
  return lines.length > 2 && lines.some(l => /^\s{2,}\S/.test(l))
}

function analyzeContent(raw: string): ContentMeta {
  const text = raw.trim()
  if (/^(https?:\/\/|www\.)\S+$/i.test(text) && !/\s/.test(text)) {
    return { kind: 'link', label: 'Link', accent: '#3b82f6' }
  }
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) {
    return { kind: 'email', label: 'Email', accent: '#8b5cf6' }
  }
  if (/^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(text)) {
    return { kind: 'color', label: 'Color', accent: text }
  }
  if (text.length <= 24 && /^[-+]?\$?\d[\d,\s]*(\.\d+)?%?$/.test(text)) {
    return { kind: 'number', label: 'Number', accent: '#f59e0b' }
  }
  if (looksLikeCode(text)) {
    return { kind: 'code', label: 'Code', accent: '#22c55e' }
  }
  return { kind: 'text', label: 'Text', accent: 'var(--color-text-faint)' }
}

function normalizeUrl(text: string): string {
  const t = text.trim()
  return /^https?:\/\//i.test(t) ? t : `https://${t}`
}

const countLines = (text: string): number => text.split('\n').length

export default function ClipboardView() {
  const { toast } = useToast()
  const [history, setHistory] = useState<ClipboardItem[]>([])
  const [loading, setLoading] = useState(true)
  const [searchHistory, setSearchHistory] = useState('')
  const [searchSnippets, setSearchSnippets] = useState('')

  // Add snippet form state
  const [newLabel, setNewLabel] = useState('')
  const [newContent, setNewContent] = useState('')
  const [isAdding, setIsAdding] = useState(false)

  // Label inline editing state
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editLabelText, setEditLabelText] = useState('')

  // Transient "copied" checkmark feedback
  const [copiedId, setCopiedId] = useState<string | null>(null)

  // Which long items are expanded to full height
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())

  // Clear unpinned history confirm state
  const [isClearConfirmOpen, setIsClearConfirmOpen] = useState(false)

  // Load history from DB
  const loadHistory = useCallback(async () => {
    try {
      const data = await window.electronAPI.clipboard.getHistory()
      setHistory(data)
    } catch (err) {
      console.error('Failed to load clipboard history:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadHistory()
    // Instant refresh the moment the background watcher captures something new…
    const unsubscribe = window.electronAPI.clipboard.onHistoryChanged(loadHistory)
    // …plus a relaxed fallback poll in case an event is ever missed.
    const interval = setInterval(loadHistory, 5000)
    return () => {
      unsubscribe()
      clearInterval(interval)
    }
  }, [loadHistory])

  // Actions
  const handleTogglePin = async (id: string, isPinned: boolean) => {
    try {
      await window.electronAPI.clipboard.togglePin(id, !isPinned)
      loadHistory()
    } catch (err) {
      console.error('Failed to toggle pin:', err)
    }
  }

  const handleStartEditLabel = (id: string, currentLabel: string | null, content: string) => {
    setEditingId(id)
    setEditLabelText(currentLabel || content.slice(0, 20))
  }

  const handleSaveLabel = async (id: string) => {
    try {
      await window.electronAPI.clipboard.updateLabel(id, editLabelText.trim() || null)
      setEditingId(null)
      loadHistory()
    } catch (err) {
      console.error('Failed to update label:', err)
    }
  }

  const handleDeleteItem = async (id: string) => {
    try {
      const targetItem = history.find(item => item.id === id)
      if (!targetItem) return

      await window.electronAPI.clipboard.deleteItem(id)
      loadHistory()

      toast('Clipboard item deleted.', {
        action: {
          label: 'Undo',
          onClick: async () => {
            try {
              await window.electronAPI.clipboard.restoreItem(
                targetItem.content,
                targetItem.is_pinned === 1,
                targetItem.label
              )
              loadHistory()
              toast('Clipboard item restored.')
            } catch (err) {
              console.error('Failed to restore clipboard item:', err)
            }
          }
        }
      })
    } catch (err) {
      console.error('Failed to delete item:', err)
    }
  }

  const handleClearHistory = () => setIsClearConfirmOpen(true)

  const performClearHistory = async () => {
    setIsClearConfirmOpen(false)
    try {
      await window.electronAPI.clipboard.clearHistory()
      loadHistory()
    } catch (err) {
      console.error('Failed to clear clipboard history:', err)
    }
  }

  // Copy to OS clipboard with transient checkmark feedback
  const handleCopyOnly = async (id: string, content: string) => {
    try {
      await navigator.clipboard.writeText(content)
      setCopiedId(id)
      setTimeout(() => setCopiedId(prev => (prev === id ? null : prev)), COPIED_FEEDBACK_MS)
    } catch (err) {
      console.error('Failed to copy item:', err)
    }
  }

  // Copy & hide the window (quick-paste flow via the global hotkey panel)
  const handleCopyAndClose = async (content: string) => {
    try {
      await window.electronAPI.clipboard.paste(content)
    } catch (err) {
      console.error('Failed to copy and close:', err)
    }
  }

  const handleOpenLink = async (content: string) => {
    try {
      await window.electronAPI.app.openExternal(normalizeUrl(content))
    } catch (err) {
      console.error('Failed to open link:', err)
    }
  }

  const toggleExpand = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Create a new pinned snippet. Unlike copying, saving a snippet should NOT
  // clobber whatever is currently on the OS clipboard. It's saved for later.
  const handleCreateSnippet = async (e: React.FormEvent) => {
    e.preventDefault()
    const contentTrimmed = newContent.trim()
    if (!contentTrimmed) return

    try {
      await window.electronAPI.clipboard.createSnippet(contentTrimmed, newLabel.trim() || null)
      setNewLabel('')
      setNewContent('')
      setIsAdding(false)
      loadHistory()
      toast('Snippet saved.', { type: 'success' })
    } catch (err) {
      console.error('Failed to create snippet:', err)
      toast('Failed to save snippet.', { type: 'error' })
    }
  }

  // Helpers
  const formatTime = (ts: number) => {
    const diffMs = Date.now() - ts
    if (diffMs < 60000) return 'Just now'
    const diffMins = Math.floor(diffMs / 60000)
    if (diffMins < 60) return `${diffMins}m ago`
    const diffHours = Math.floor(diffMins / 60)
    if (diffHours < 24) return `${diffHours}h ago`
    return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  }

  const pinnedItems = useMemo(() => history.filter(item => item.is_pinned === 1), [history])
  const unpinnedItems = useMemo(() => history.filter(item => item.is_pinned === 0), [history])

  const filteredHistory = useMemo(() => {
    const q = searchHistory.toLowerCase()
    return unpinnedItems.filter(item => item.content.toLowerCase().includes(q))
  }, [unpinnedItems, searchHistory])

  const filteredSnippets = useMemo(() => {
    const q = searchSnippets.toLowerCase()
    return pinnedItems.filter(item =>
      (item.label?.toLowerCase().includes(q) ?? false) || item.content.toLowerCase().includes(q)
    )
  }, [pinnedItems, searchSnippets])

  // Shared card renderer
  const renderCard = (item: ClipboardItem, variant: 'history' | 'snippet') => {
    const isCopied = copiedId === item.id
    const isEditing = editingId === item.id
    const isExpanded = expandedIds.has(item.id)
    const meta = analyzeContent(item.content)
    const codeMode = meta.kind === 'code'
    const lineCount = countLines(item.content)
    const isLong = lineCount > 6 || item.content.length > 400
    const isSnippet = variant === 'snippet'
    const accentIsColor = meta.kind === 'color'

    return (
      <div
        key={item.id}
        style={{
          position: 'relative',
          flexShrink: 0,
          background: 'var(--color-surface-1)',
          border: '1px solid var(--color-surface-offset)',
          borderRadius: 'var(--radius-lg)',
          overflow: 'hidden',
          transition: 'border-color var(--duration-fast), box-shadow var(--duration-fast)'
        }}
        onMouseEnter={e => {
          e.currentTarget.style.borderColor = 'rgba(30, 69, 252, 0.35)'
          e.currentTarget.style.boxShadow = '0 2px 10px -6px rgba(0,0,0,0.4)'
        }}
        onMouseLeave={e => {
          e.currentTarget.style.borderColor = 'var(--color-surface-offset)'
          e.currentTarget.style.boxShadow = 'none'
        }}
      >
        {/* Content-kind accent strip */}
        <div style={{ position: 'absolute', top: 0, left: 0, bottom: 0, width: '3px', background: meta.accent }} />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', padding: 'var(--space-3) var(--space-3) var(--space-3) calc(var(--space-3) + 3px)' }}>
          {/* Header row */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-2)' }}>
            {/* Left: label (snippet) or type badge + timestamp (history) */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0, flex: 1 }}>
              {isSnippet && isEditing ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flex: 1 }}>
                  <input
                    autoFocus
                    value={editLabelText}
                    onChange={e => setEditLabelText(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') handleSaveLabel(item.id)
                      if (e.key === 'Escape') setEditingId(null)
                    }}
                    style={{
                      background: 'var(--color-surface-1)',
                      border: '1px solid var(--color-secondary)',
                      color: 'var(--color-text-base)',
                      fontSize: '11px',
                      borderRadius: '4px',
                      padding: '2px 6px',
                      outline: 'none',
                      flex: 1,
                      minWidth: 0
                    }}
                  />
                  <button onClick={() => handleSaveLabel(item.id)} className="btn-icon" style={{ width: '20px', height: '20px' }} title="Save label">
                    <Check size={11} color="var(--color-success)" />
                  </button>
                </div>
              ) : isSnippet ? (
                <div
                  style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'text', minWidth: 0, flex: 1 }}
                  onDoubleClick={() => handleStartEditLabel(item.id, item.label, item.content)}
                  title="Double-click to rename"
                >
                  <span style={{
                    fontSize: 'var(--text-xs)',
                    fontWeight: 'var(--weight-semibold)',
                    color: 'var(--color-text-base)',
                    textOverflow: 'ellipsis',
                    overflow: 'hidden',
                    whiteSpace: 'nowrap'
                  }}>
                    {item.label || <em style={{ color: 'var(--color-text-faint)', fontWeight: 'var(--weight-regular)' }}>Untitled snippet</em>}
                  </span>
                  <button
                    onClick={() => handleStartEditLabel(item.id, item.label, item.content)}
                    style={{ background: 'transparent', border: 'none', color: 'var(--color-text-faint)', cursor: 'pointer', padding: 0, display: 'flex', flexShrink: 0 }}
                    title="Rename"
                  >
                    <Edit2 size={10} />
                  </button>
                </div>
              ) : (
                <>
                  {accentIsColor && (
                    <span style={{ width: '12px', height: '12px', borderRadius: '3px', background: meta.accent, border: '1px solid rgba(255,255,255,0.2)', flexShrink: 0 }} />
                  )}
                  <span style={{
                    fontSize: '9px',
                    fontWeight: 'var(--weight-bold)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                    color: accentIsColor ? 'var(--color-text-muted)' : meta.accent,
                    background: accentIsColor ? 'var(--color-surface-offset)' : `${meta.accent}1a`,
                    padding: '1px 6px',
                    borderRadius: 'var(--radius-full)',
                    flexShrink: 0
                  }}>
                    {meta.label}
                  </span>
                  <span style={{ fontSize: '10px', color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
                    {formatTime(item.created_at)}
                  </span>
                </>
              )}
            </div>

            {/* Right: action buttons */}
            <div style={{ display: 'flex', gap: '2px', flexShrink: 0 }}>
              {meta.kind === 'link' && (
                <button
                  onClick={() => handleOpenLink(item.content)}
                  className="btn-icon"
                  style={{ width: '24px', height: '24px', color: '#3b82f6' }}
                  title="Open link in browser"
                >
                  <ExternalLink size={12} />
                </button>
              )}
              <button
                onClick={() => handleTogglePin(item.id, isSnippet)}
                className="btn-icon"
                style={{ width: '24px', height: '24px', color: isSnippet ? 'var(--color-secondary)' : 'var(--color-text-faint)' }}
                title={isSnippet ? 'Unpin snippet' : 'Pin as snippet'}
              >
                <Star size={12} fill={isSnippet ? 'var(--color-secondary)' : 'none'} />
              </button>
              <button
                onClick={() => handleCopyOnly(item.id, item.content)}
                className="btn-icon"
                style={{ width: '24px', height: '24px', color: isCopied ? 'var(--color-success)' : 'var(--color-text-muted)' }}
                title={isCopied ? 'Copied!' : 'Copy to clipboard'}
              >
                {isCopied ? <Check size={12} /> : <Copy size={12} />}
              </button>
              <button
                onClick={() => handleCopyAndClose(item.content)}
                className="btn-icon"
                style={{ width: '24px', height: '24px', color: 'var(--color-primary)' }}
                title="Paste & hide window"
              >
                <Send size={12} />
              </button>
              <button
                onClick={() => handleDeleteItem(item.id)}
                className="btn-icon"
                style={{ width: '24px', height: '24px', color: 'var(--color-error)' }}
                title={isSnippet ? 'Delete snippet' : 'Delete entry'}
              >
                <Trash2 size={12} />
              </button>
            </div>
          </div>

          {/* Content, click to copy */}
          <pre
            onClick={() => {
              if ((window.getSelection()?.toString() ?? '').length > 0) return
              handleCopyOnly(item.id, item.content)
            }}
            title="Click to copy"
            style={{
              margin: 0,
              padding: codeMode ? 'var(--space-2)' : '2px 0',
              background: codeMode ? 'var(--color-surface-2)' : 'transparent',
              border: codeMode ? '1px solid var(--color-surface-offset)' : 'none',
              borderRadius: codeMode ? 'var(--radius-sm)' : 0,
              fontSize: 'var(--text-xs)',
              fontFamily: codeMode ? 'var(--font-mono)' : 'inherit',
              color: isSnippet ? 'var(--color-text-muted)' : 'var(--color-text-base)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              overflow: isExpanded ? 'auto' : 'hidden',
              maxHeight: isExpanded ? '340px' : '130px',
              display: isExpanded ? 'block' : '-webkit-box',
              WebkitLineClamp: isExpanded ? 'unset' : 6,
              WebkitBoxOrient: 'vertical',
              lineHeight: 1.45,
              cursor: 'pointer'
            }}
          >
            {item.content}
          </pre>

          {/* Footer meta */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-2)' }}>
            <span style={{ fontSize: '9px', color: 'var(--color-text-faint)', whiteSpace: 'nowrap' }}>
              {item.content.length.toLocaleString()} chars{lineCount > 1 ? ` · ${lineCount} lines` : ''}
            </span>
            {isLong && (
              <button
                onClick={() => toggleExpand(item.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '3px',
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--color-primary)',
                  fontSize: '10px',
                  fontWeight: 'var(--weight-semibold)',
                  cursor: 'pointer',
                  padding: 0
                }}
              >
                {isExpanded ? <>Show less <ChevronUp size={11} /></> : <>Show more <ChevronDown size={11} /></>}
              </button>
            )}
          </div>
        </div>
      </div>
    )
  }

  const searchInputStyle: React.CSSProperties = {
    width: '100%',
    background: 'var(--color-surface-2)',
    border: '1px solid var(--color-surface-offset)',
    color: 'var(--color-text-base)',
    borderRadius: 'var(--radius-md)',
    padding: 'var(--space-2) var(--space-3) var(--space-2) var(--space-8)',
    fontSize: 'var(--text-sm)',
    outline: 'none',
    boxSizing: 'border-box'
  }

  return (
    <div style={{
      display: 'flex',
      flex: 1,
      height: '100%',
      overflow: 'hidden',
      background: 'var(--color-background)',
      color: 'var(--color-text-base)',
      fontFamily: 'var(--font-sans)'
    }}>

      {/* LEFT COLUMN: Clipboard History (Unpinned) */}
      <div style={{
        flex: 1.5,
        display: 'flex',
        flexDirection: 'column',
        borderRight: '1px solid var(--color-surface-offset)',
        height: '100%',
        overflow: 'hidden'
      }}>
        {/* Header section */}
        <div style={{
          padding: 'var(--space-4)',
          borderBottom: '1px solid var(--color-surface-offset)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-3)',
          background: 'var(--color-surface-1)'
        }}>
          <div className="row-between">
            <h2 style={{ fontSize: 'var(--text-base)', fontWeight: 'var(--weight-semibold)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)', margin: 0 }}>
              <Clipboard size={18} color="var(--color-primary)" />
              Clipboard History
              <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--color-text-muted)', background: 'var(--color-surface-offset)', padding: '2px 6px', borderRadius: 'var(--radius-full)' }}>
                {unpinnedItems.length}/{HISTORY_LIMIT}
              </span>
            </h2>
            {unpinnedItems.length > 0 && (
              <button
                onClick={handleClearHistory}
                style={{
                  fontSize: 'var(--text-xs)',
                  color: 'var(--color-error)',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--space-1)',
                  padding: '4px 8px',
                  borderRadius: 'var(--radius-sm)'
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--color-error-muted)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                <Trash2 size={12} />
                Clear Unpinned
              </button>
            )}
          </div>

          {/* Search bar */}
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <Search size={14} style={{ position: 'absolute', left: '10px', color: 'var(--color-text-faint)' }} />
            <input
              type="text"
              placeholder="Search history…"
              value={searchHistory}
              onChange={e => setSearchHistory(e.target.value)}
              onKeyDown={e => { if (e.key === 'Escape') setSearchHistory('') }}
              style={searchInputStyle}
            />
            {searchHistory && (
              <button
                onClick={() => setSearchHistory('')}
                className="btn-icon"
                style={{ position: 'absolute', right: '6px', width: '22px', height: '22px', color: 'var(--color-text-faint)' }}
                title="Clear search"
              >
                <X size={13} />
              </button>
            )}
          </div>
        </div>

        {/* History items container */}
        <div style={{ flex: 1, overflow: 'auto', padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {loading ? (
            <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)', textAlign: 'center', padding: 'var(--space-6)' }}>
              Loading history…
            </div>
          ) : filteredHistory.length === 0 ? (
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              textAlign: 'center',
              gap: 'var(--space-3)',
              color: 'var(--color-text-faint)',
              padding: 'var(--space-12)'
            }}>
              <Clipboard size={32} />
              <div>
                <p style={{ margin: '0 0 4px 0', fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)' }}>
                  {searchHistory ? 'No matches' : 'No history yet'}
                </p>
                <p style={{ margin: 0, fontSize: 'var(--text-xs)', maxWidth: '240px' }}>
                  {searchHistory ? 'Try a different search term.' : 'Anything you copy will appear here automatically.'}
                </p>
              </div>
            </div>
          ) : (
            filteredHistory.map(item => renderCard(item, 'history'))
          )}
        </div>
      </div>

      {/* RIGHT COLUMN: Pinned Snippets */}
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden',
        background: 'var(--color-surface-1)'
      }}>

        {/* Snippets header */}
        <div style={{
          padding: 'var(--space-4)',
          borderBottom: '1px solid var(--color-surface-offset)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-3)'
        }}>
          <div className="row-between">
            <h2 style={{ fontSize: 'var(--text-base)', fontWeight: 'var(--weight-semibold)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)', margin: 0 }}>
              <Star size={16} color="var(--color-secondary)" fill="var(--color-secondary)" />
              Pinned Snippets
              <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--color-text-muted)', background: 'var(--color-surface-offset)', padding: '2px 6px', borderRadius: 'var(--radius-full)' }}>
                {pinnedItems.length}
              </span>
            </h2>
            <button
              onClick={() => setIsAdding(!isAdding)}
              className="btn-icon"
              style={{
                width: '28px',
                height: '28px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--color-surface-offset)',
                background: isAdding ? 'var(--color-surface-offset)' : 'transparent'
              }}
              title={isAdding ? 'Close' : 'Add snippet manually'}
            >
              {isAdding ? <X size={15} /> : <Plus size={15} />}
            </button>
          </div>

          {/* Add form */}
          {isAdding && (
            <form onSubmit={handleCreateSnippet} style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-2)',
              padding: 'var(--space-3)',
              background: 'var(--color-surface-2)',
              border: '1px solid var(--color-surface-offset)',
              borderRadius: 'var(--radius-md)',
              animation: 'slide-down 150ms var(--ease-enter)'
            }}>
              <input
                autoFocus
                type="text"
                placeholder="Label (optional, e.g. Unity API URL)"
                value={newLabel}
                onChange={e => setNewLabel(e.target.value)}
                style={{
                  background: 'var(--color-surface-1)',
                  border: '1px solid var(--color-surface-offset)',
                  color: 'var(--color-text-base)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '6px 8px',
                  fontSize: 'var(--text-xs)',
                  outline: 'none'
                }}
              />
              <textarea
                placeholder="Snippet content…"
                required
                rows={4}
                value={newContent}
                onChange={e => setNewContent(e.target.value)}
                onKeyDown={e => {
                  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') handleCreateSnippet(e)
                  if (e.key === 'Escape') setIsAdding(false)
                }}
                style={{
                  background: 'var(--color-surface-1)',
                  border: '1px solid var(--color-surface-offset)',
                  color: 'var(--color-text-base)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '6px 8px',
                  fontSize: 'var(--text-xs)',
                  outline: 'none',
                  resize: 'vertical',
                  fontFamily: 'var(--font-mono)'
                }}
              />
              <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end', alignItems: 'center' }}>
                <span style={{ marginRight: 'auto', fontSize: '9px', color: 'var(--color-text-faint)' }}>⌘/Ctrl+Enter to save</span>
                <button
                  type="button"
                  onClick={() => setIsAdding(false)}
                  className="btn-secondary"
                  style={{ fontSize: '11px', padding: '5px 12px', height: '28px' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={!newContent.trim()}
                  style={{ fontSize: '11px', padding: '5px 12px', height: '28px', opacity: newContent.trim() ? 1 : 0.5, cursor: newContent.trim() ? 'pointer' : 'not-allowed' }}
                >
                  Save Snippet
                </button>
              </div>
            </form>
          )}

          {/* Snippets search bar */}
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <Search size={14} style={{ position: 'absolute', left: '10px', color: 'var(--color-text-faint)' }} />
            <input
              type="text"
              placeholder="Search snippets…"
              value={searchSnippets}
              onChange={e => setSearchSnippets(e.target.value)}
              onKeyDown={e => { if (e.key === 'Escape') setSearchSnippets('') }}
              style={searchInputStyle}
            />
            {searchSnippets && (
              <button
                onClick={() => setSearchSnippets('')}
                className="btn-icon"
                style={{ position: 'absolute', right: '6px', width: '22px', height: '22px', color: 'var(--color-text-faint)' }}
                title="Clear search"
              >
                <X size={13} />
              </button>
            )}
          </div>
        </div>

        {/* Snippets container */}
        <div style={{ flex: 1, overflow: 'auto', padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {filteredSnippets.length === 0 ? (
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              textAlign: 'center',
              gap: 'var(--space-2)',
              color: 'var(--color-text-faint)',
              padding: 'var(--space-8)',
              marginTop: 'var(--space-4)'
            }}>
              <Star size={24} />
              <div>
                <p style={{ margin: '0 0 2px 0', fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semibold)' }}>
                  {searchSnippets ? 'No matches' : 'No pinned snippets'}
                </p>
                <p style={{ margin: 0, fontSize: '10px', maxWidth: '210px' }}>
                  {searchSnippets ? 'Try a different search term.' : 'Star a history item, or add one manually with the + button.'}
                </p>
              </div>
            </div>
          ) : (
            filteredSnippets.map(item => renderCard(item, 'snippet'))
          )}
        </div>

        {/* Tip panel at bottom */}
        <div style={{
          padding: 'var(--space-3)',
          borderTop: '1px solid var(--color-surface-offset)',
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-2)',
          fontSize: '10px',
          color: 'var(--color-text-faint)',
          background: 'var(--color-surface-2)'
        }}>
          <Info size={12} color="var(--color-primary)" style={{ flexShrink: 0 }} />
          <span>Click any entry's text to copy it. Double-click a snippet title to rename.</span>
        </div>

        <ConfirmDialog
          isOpen={isClearConfirmOpen}
          title="Clear History"
          message="Clear all unpinned clipboard history? Pinned snippets are kept."
          confirmText="Clear History"
          isDestructive
          onConfirm={performClearHistory}
          onCancel={() => setIsClearConfirmOpen(false)}
        />
      </div>
    </div>
  )
}
