import React, { useState, useEffect, useCallback } from 'react'
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
  Send
} from 'lucide-react'
import type { ClipboardItem } from '../../../shared/types'
import ConfirmDialog from './ui/ConfirmDialog'
import { useToast } from './ui/Toast'

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

  // Copied state (for transient checkmark feedback)
  const [copiedId, setCopiedId] = useState<string | null>(null)

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
    // Poll updates every 2 seconds to reflect background watcher captures
    const interval = setInterval(loadHistory, 2000)
    return () => clearInterval(interval)
  }, [loadHistory])

  // Toggle pin
  const handleTogglePin = async (id: string, isPinned: boolean) => {
    try {
      await window.electronAPI.clipboard.togglePin(id, !isPinned)
      loadHistory()
    } catch (err) {
      console.error('Failed to toggle pin:', err)
    }
  }

  // Edit label
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

  // Delete item
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

  // Clear unpinned history
  const handleClearHistory = async () => {
    setIsClearConfirmOpen(true)
  }

  const performClearHistory = async () => {
    setIsClearConfirmOpen(false)
    try {
      await window.electronAPI.clipboard.clearHistory()
      loadHistory()
    } catch (err) {
      console.error('Failed to clear clipboard history:', err)
    }
  }

  // Copy-only action
  const handleCopyOnly = async (id: string, content: string) => {
    try {
      // Just copy to system paste-register (calls navigator.clipboard.writeText)
      await navigator.clipboard.writeText(content)
      setCopiedId(id)
      setTimeout(() => setCopiedId(null), 1500)
    } catch (err) {
      console.error('Failed to copy item:', err)
    }
  }

  // Copy & Close (Paste register trigger)
  const handleCopyAndClose = async (content: string) => {
    try {
      await window.electronAPI.clipboard.paste(content)
    } catch (err) {
      console.error('Failed to copy and close:', err)
    }
  }

  // Create new pinned snippet directly
  const handleCreateSnippet = async (e: React.FormEvent) => {
    e.preventDefault()
    const contentTrimmed = newContent.trim()
    if (!contentTrimmed) return

    try {
      // Write to OS clipboard so it's ready to paste
      try {
        await navigator.clipboard.writeText(contentTrimmed)
      } catch (err) {
        console.warn('Failed to write to OS clipboard:', err)
      }
      
      // Directly insert to DB to avoidwatcher poll race condition
      await window.electronAPI.clipboard.createSnippet(contentTrimmed, newLabel.trim() || null)

      setNewLabel('')
      setNewContent('')
      setIsAdding(false)
      loadHistory()
    } catch (err) {
      console.error('Failed to create snippet:', err)
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

  // Split history into pinned (snippets) and unpinned (history) lists
  const pinnedItems = history.filter(item => item.is_pinned === 1)
  const unpinnedItems = history.filter(item => item.is_pinned === 0)

  // Filtered lists
  const filteredHistory = unpinnedItems.filter(item =>
    item.content.toLowerCase().includes(searchHistory.toLowerCase())
  )

  const filteredSnippets = pinnedItems.filter(item => {
    const labelMatch = item.label?.toLowerCase().includes(searchSnippets.toLowerCase()) ?? false
    const contentMatch = item.content.toLowerCase().includes(searchSnippets.toLowerCase())
    return labelMatch || contentMatch
  })

  // Check if content looks like code block (multiple lines or brackets)
  const isLikelyCode = (text: string) => {
    return text.includes('\n') || text.includes('{') || text.includes('}') || text.includes('function ')
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
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ fontSize: 'var(--text-base)', fontWeight: 'var(--weight-semibold)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)', margin: 0 }}>
              <Clipboard size={18} color="var(--color-primary)" />
              Clipboard History
              <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--color-text-muted)', background: 'var(--color-surface-offset)', padding: '2px 6px', borderRadius: 'var(--radius-full)' }}>
                {unpinnedItems.length}/200
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
              placeholder="Search history content..."
              value={searchHistory}
              onChange={e => setSearchHistory(e.target.value)}
              style={{
                width: '100%',
                background: 'var(--color-surface-2)',
                border: '1px solid var(--color-surface-offset)',
                color: 'var(--color-text-base)',
                borderRadius: 'var(--radius-md)',
                padding: 'var(--space-2) var(--space-3) var(--space-2) var(--space-8)',
                fontSize: 'var(--text-sm)',
                outline: 'none',
                boxSizing: 'border-box'
              }}
            />
          </div>
        </div>

        {/* History items container */}
        <div style={{ flex: 1, overflow: 'auto', padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {loading ? (
            <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)', textAlign: 'center', padding: 'var(--space-6)' }}>
              Loading history...
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
                <p style={{ margin: '0 0 4px 0', fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)' }}>No history items</p>
                <p style={{ margin: 0, fontSize: 'var(--text-xs)', maxWidth: '240px' }}>
                  {searchHistory ? 'Try adjusting your search criteria.' : 'Text copied to your system clipboard will automatically appear here.'}
                </p>
              </div>
            </div>
          ) : (
            filteredHistory.map(item => {
              const isCopied = copiedId === item.id
              const codeMode = isLikelyCode(item.content)
              return (
                <div
                  key={item.id}
                  style={{
                    background: 'var(--color-surface-1)',
                    border: '1px solid var(--color-surface-offset)',
                    borderRadius: 'var(--radius-lg)',
                    padding: 'var(--space-3-5)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 'var(--space-2)',
                    transition: 'border-color var(--duration-fast)',
                    position: 'relative'
                  }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = 'rgba(30, 69, 252, 0.3)'}
                  onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--color-surface-offset)'}
                >
                  {/* Timestamp and controls */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '10px', color: 'var(--color-text-muted)' }}>
                    <span>{formatTime(item.created_at)}</span>
                    <div style={{ display: 'flex', gap: '4px' }}>
                      <button
                        onClick={() => handleTogglePin(item.id, false)}
                        className="btn-icon"
                        style={{ width: '22px', height: '22px', color: 'var(--color-text-faint)' }}
                        title="Pin snippet"
                      >
                        <Star size={11} />
                      </button>
                      <button
                        onClick={() => handleCopyOnly(item.id, item.content)}
                        className="btn-icon"
                        style={{ width: '22px', height: '22px', color: isCopied ? 'var(--color-success)' : 'var(--color-text-muted)' }}
                        title={isCopied ? 'Copied!' : 'Copy to clipboard'}
                      >
                        {isCopied ? <Check size={11} /> : <Copy size={11} />}
                      </button>
                      <button
                        onClick={() => handleCopyAndClose(item.content)}
                        className="btn-icon"
                        style={{ width: '22px', height: '22px', color: 'var(--color-secondary)' }}
                        title="Copy & Close Checkpoint"
                      >
                        <Send size={11} />
                      </button>
                      <button
                        onClick={() => handleDeleteItem(item.id)}
                        className="btn-icon"
                        style={{ width: '22px', height: '22px', color: 'var(--color-error)' }}
                        title="Delete entry"
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  </div>

                  {/* Content block */}
                  <pre style={{
                    margin: 0,
                    padding: codeMode ? 'var(--space-2)' : 0,
                    background: codeMode ? 'var(--color-surface-2)' : 'transparent',
                    border: codeMode ? '1px solid var(--color-surface-offset)' : 'none',
                    borderRadius: codeMode ? 'var(--radius-sm)' : 0,
                    fontSize: 'var(--text-xs)',
                    fontFamily: codeMode ? 'var(--font-mono)' : 'inherit',
                    color: 'var(--color-text-base)',
                    whiteSpace: 'pre-wrap',
                    overflow: 'hidden',
                    maxHeight: '120px',
                    display: '-webkit-box',
                    WebkitLineClamp: 6,
                    WebkitBoxOrient: 'vertical',
                    lineHeight: '1.4'
                  }}>
                    {item.content}
                  </pre>
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* RIGHT COLUMN: Pinned Snippets (Star Icons) */}
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
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ fontSize: 'var(--text-base)', fontWeight: 'var(--weight-semibold)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)', margin: 0 }}>
              <Star size={16} color="var(--color-secondary)" fill="var(--color-secondary)" />
              Pinned Snippets
            </h2>
            <button
              onClick={() => setIsAdding(!isAdding)}
              className="btn-icon"
              style={{
                width: '26px',
                height: '26px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--color-surface-offset)',
                background: isAdding ? 'var(--color-surface-offset)' : 'transparent'
              }}
              title="Add Snippet manually"
            >
              <Plus size={14} />
            </button>
          </div>

          {/* Add form overlay */}
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
                type="text"
                placeholder="Snippet Label (e.g. Unity API URL)"
                value={newLabel}
                onChange={e => setNewLabel(e.target.value)}
                style={{
                  background: 'var(--color-surface-1)',
                  border: '1px solid var(--color-surface-offset)',
                  color: 'var(--color-text-base)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '4px 8px',
                  fontSize: 'var(--text-xs)',
                  outline: 'none'
                }}
              />
              <textarea
                placeholder="Snippet Content..."
                required
                rows={4}
                value={newContent}
                onChange={e => setNewContent(e.target.value)}
                style={{
                  background: 'var(--color-surface-1)',
                  border: '1px solid var(--color-surface-offset)',
                  color: 'var(--color-text-base)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '6px 8px',
                  fontSize: 'var(--text-xs)',
                  outline: 'none',
                  resize: 'none',
                  fontFamily: 'var(--font-mono)'
                }}
              />
              <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
                <button
                  type="submit"
                  className="btn-primary"
                  style={{ fontSize: '10px', padding: '4px 10px', height: '24px' }}
                >
                  Save Pinned
                </button>
                <button
                  type="button"
                  onClick={() => setIsAdding(false)}
                  className="btn-secondary"
                  style={{ fontSize: '10px', padding: '4px 10px', height: '24px' }}
                >
                  Cancel
                </button>
              </div>
            </form>
          )}

          {/* Snippets search bar */}
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <Search size={12} style={{ position: 'absolute', left: '10px', color: 'var(--color-text-faint)' }} />
            <input
              type="text"
              placeholder="Search pinned snippets..."
              value={searchSnippets}
              onChange={e => setSearchSnippets(e.target.value)}
              style={{
                width: '100%',
                background: 'var(--color-surface-2)',
                border: '1px solid var(--color-surface-offset)',
                color: 'var(--color-text-base)',
                borderRadius: 'var(--radius-md)',
                padding: 'var(--space-1-5) var(--space-3) var(--space-1-5) var(--space-8)',
                fontSize: 'var(--text-xs)',
                outline: 'none',
                boxSizing: 'border-box'
              }}
            />
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
                <p style={{ margin: '0 0 2px 0', fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semibold)' }}>No pinned snippets</p>
                <p style={{ margin: 0, fontSize: '10px', maxWidth: '200px' }}>
                  Click the star icon on clipboard history items to pin them here for easy access.
                </p>
              </div>
            </div>
          ) : (
            filteredSnippets.map(item => {
              const isCopied = copiedId === item.id
              const isEditing = editingId === item.id
              const codeMode = isLikelyCode(item.content)
              return (
                <div
                  key={item.id}
                  style={{
                    background: 'var(--color-surface-2)',
                    border: '1px solid var(--color-surface-offset)',
                    borderRadius: 'var(--radius-lg)',
                    padding: 'var(--space-3)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 'var(--space-2)'
                  }}
                >
                  {/* Label / edit controls */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    {isEditing ? (
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
                            borderRadius: '3px',
                            padding: '1px 6px',
                            outline: 'none',
                            flex: 1
                          }}
                        />
                        <button
                          onClick={() => handleSaveLabel(item.id)}
                          className="btn-icon"
                          style={{ width: '18px', height: '18px' }}
                        >
                          <Check size={10} color="var(--color-success)" />
                        </button>
                      </div>
                    ) : (
                      <div
                        style={{
                          fontSize: 'var(--text-xs)',
                          fontWeight: 'var(--weight-semibold)',
                          color: 'var(--color-text-base)',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          cursor: 'pointer',
                          minWidth: 0,
                          flex: 1
                        }}
                        onDoubleClick={() => handleStartEditLabel(item.id, item.label, item.content)}
                        title="Double-click to edit label"
                      >
                        <span style={{
                          textOverflow: 'ellipsis',
                          overflow: 'hidden',
                          whiteSpace: 'nowrap',
                          maxWidth: '90%'
                        }}>
                          {item.label || <em style={{ color: 'var(--color-text-faint)', fontWeight: 'var(--weight-normal)' }}>Untitled Snippet</em>}
                        </span>
                        <button
                          onClick={() => handleStartEditLabel(item.id, item.label, item.content)}
                          style={{ background: 'transparent', border: 'none', color: 'var(--color-text-faint)', cursor: 'pointer', padding: 0 }}
                        >
                          <Edit2 size={9} />
                        </button>
                      </div>
                    )}

                    <div style={{ display: 'flex', gap: '2px', marginLeft: 'var(--space-2)' }}>
                      <button
                        onClick={() => handleTogglePin(item.id, true)}
                        className="btn-icon"
                        style={{ width: '22px', height: '22px', color: 'var(--color-secondary)' }}
                        title="Unpin snippet"
                      >
                        <Star size={11} fill="var(--color-secondary)" />
                      </button>
                      <button
                        onClick={() => handleCopyOnly(item.id, item.content)}
                        className="btn-icon"
                        style={{ width: '22px', height: '22px', color: isCopied ? 'var(--color-success)' : 'var(--color-text-muted)' }}
                        title={isCopied ? 'Copied!' : 'Copy snippet'}
                      >
                        {isCopied ? <Check size={11} /> : <Copy size={11} />}
                      </button>
                      <button
                        onClick={() => handleCopyAndClose(item.content)}
                        className="btn-icon"
                        style={{ width: '22px', height: '22px', color: 'var(--color-primary)' }}
                        title="Copy & Close"
                      >
                        <Send size={11} />
                      </button>
                      <button
                        onClick={() => handleDeleteItem(item.id)}
                        className="btn-icon"
                        style={{ width: '22px', height: '22px', color: 'var(--color-error)' }}
                        title="Delete snippet"
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  </div>

                  {/* Snippet Content */}
                  <pre style={{
                    margin: 0,
                    padding: codeMode ? 'var(--space-2)' : 0,
                    background: codeMode ? 'var(--color-surface-1)' : 'transparent',
                    border: codeMode ? '1px solid var(--color-surface-offset)' : 'none',
                    borderRadius: codeMode ? 'var(--radius-sm)' : 0,
                    fontSize: 'var(--text-xs)',
                    fontFamily: codeMode ? 'var(--font-mono)' : 'inherit',
                    color: 'var(--color-text-muted)',
                    whiteSpace: 'pre-wrap',
                    overflow: 'hidden',
                    maxHeight: '100px',
                    display: '-webkit-box',
                    WebkitLineClamp: 5,
                    WebkitBoxOrient: 'vertical',
                    lineHeight: '1.4'
                  }}>
                    {item.content}
                  </pre>
                </div>
              )
            })
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
          <span>Double-click a snippet's title to rename.</span>
        </div>

        <ConfirmDialog
          isOpen={isClearConfirmOpen}
          title="Clear History"
          message="Are you sure you want to clear all unpinned clipboard history items?"
          confirmText="Clear History"
          isDestructive
          onConfirm={performClearHistory}
          onCancel={() => setIsClearConfirmOpen(false)}
        />
      </div>
    </div>
  )
}
