import React, { useEffect, useState, useCallback, useRef } from 'react'
import LogVirtualList from './log/LogVirtualList'
import LogInput from './log/LogInput'
import { useAppStore } from '../store/appStore'
import type { Item } from '../../../shared/types'
import { RotateCcw } from 'lucide-react'

export default function LogView() {
  const [items, setItems] = useState<Item[]>([])
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(true)
  const [undoItem, setUndoItem] = useState<Item | null>(null)
  const [showUndo, setShowUndo] = useState(false)
  const [toastMessage, setToastMessage] = useState<string | null>(null)

  const activeContext = useAppStore(s => s.activeContext)
  const undoTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Load page 1 of logs for the active context
  const loadInitialFeed = useCallback(async () => {
    try {
      const res = await window.electronAPI.db.getItems(activeContext, 'log', 1, 50)
      
      // SQLite returns sorted by position ASC, created_at DESC (which is newest first).
      // For a Slack-like chronological feed (oldest at the top, newest at the bottom),
      // we reverse the array of items before putting it in state.
      const reversed = [...res.items].reverse()
      setItems(reversed)
      setPage(1)
      
      // If we got exactly 50 items and there are more total logs, we have historical entries to load
      setHasMore(res.items.length === 50 && reversed.length < res.total)
    } catch (err) {
      console.error('Failed to load initial log feed:', err)
    }
  }, [activeContext])

  useEffect(() => {
    loadInitialFeed()
  }, [loadInitialFeed])

  // Load more historical entries (scroll up pagination)
  const handleLoadMore = useCallback(async () => {
    const nextPage = page + 1
    try {
      const res = await window.electronAPI.db.getItems(activeContext, 'log', nextPage, 50)
      if (res.items.length > 0) {
        const reversed = [...res.items].reverse()
        setItems(prev => [...reversed, ...prev])
        setPage(nextPage)
      }
      
      // Check if there are still more items in the DB
      setHasMore(res.items.length === 50 && items.length + res.items.length < res.total)
    } catch (err) {
      console.error('Failed to load more logs:', err)
    }
  }, [activeContext, page, items.length])

  // Clean up timer on unmount
  useEffect(() => {
    return () => {
      if (undoTimeoutRef.current) {
        clearTimeout(undoTimeoutRef.current)
      }
    }
  }, [])

  // Create Log Entry
  const handleSubmitLog = async (body: string, tagIds: string[]) => {
    try {
      const title = body.split('\n')[0].replace(/^[#\s*>-]+/, '').trim().substring(0, 80) || 'Untitled Log'
      const newItem = await window.electronAPI.db.createItem({
        type: 'log',
        context: activeContext,
        title,
        body,
        status: 'open',
        priority: 0,
        position: Date.now(),
        due_at: null,
        metadata: '{}'
      }, tagIds)

      // Append new items at the bottom (newest)
      setItems(prev => [...prev, newItem])
    } catch (err) {
      console.error('Failed to create log entry:', err)
    }
  }

  // Toggle Pinned status (Priority = 3 represents pinned, 0 represents normal)
  const handleTogglePin = async (id: string, currentPriority: number) => {
    const newPriority = currentPriority === 3 ? 0 : 3
    try {
      await window.electronAPI.db.updateItem(id, { priority: newPriority })
      setItems(prev => prev.map(item => item.id === id ? { ...item, priority: newPriority } : item))
    } catch (err) {
      console.error('Failed to toggle log pin:', err)
    }
  }

  // Soft Delete Log Entry (archives it)
  const handleDeleteLog = async (id: string) => {
    try {
      const targetItem = items.find(item => item.id === id)
      if (!targetItem) return

      // Cancel any running undo timers
      if (undoTimeoutRef.current) {
        clearTimeout(undoTimeoutRef.current)
      }

      // Archive in DB
      await window.electronAPI.db.updateItem(id, { status: 'archived' })
      
      // Update UI state
      setItems(prev => prev.filter(item => item.id !== id))
      setUndoItem(targetItem)
      setShowUndo(true)

      // Automatically hide undo snackbar after 3 seconds
      undoTimeoutRef.current = setTimeout(() => {
        setShowUndo(false)
        setUndoItem(null)
      }, 3000)
    } catch (err) {
      console.error('Failed to soft delete log:', err)
    }
  }

  // Restore deleted Log Entry
  const handleUndoDelete = async () => {
    if (!undoItem) return
    
    if (undoTimeoutRef.current) {
      clearTimeout(undoTimeoutRef.current)
      undoTimeoutRef.current = null
    }

    try {
      // Restore status to open
      await window.electronAPI.db.updateItem(undoItem.id, { status: 'open' })
      
      // Reinsert log chronologically back into local list
      setItems(prev => {
        const updated = [...prev, undoItem]
        return updated.sort((a, b) => a.created_at - b.created_at)
      })
      
      setShowUndo(false)
      setUndoItem(null)
      triggerToast('Log entry restored')
    } catch (err) {
      console.error('Failed to restore log entry:', err)
    }
  }

  // Convert Log Entry into Kanban Card
  const handleConvertToCard = async (id: string, title: string, tagIds: string[]) => {
    try {
      await window.electronAPI.db.updateItem(id, {
        type: 'card',
        status: 'open',
        title
      }, tagIds)

      // Remove from Log feed
      setItems(prev => prev.filter(item => item.id !== id))
      triggerToast(`Promoted to Kanban Card: "${title}"`)
    } catch (err) {
      console.error('Failed to promote log to card:', err)
    }
  }

  const triggerToast = (msg: string) => {
    setToastMessage(msg)
    setTimeout(() => setToastMessage(null), 3000)
  }

  // Pinned items (priority 3) float to the top, others remain sorted chronologically
  // Because JavaScript's Array.prototype.sort is stable in V8, this maintains relative chronological ordering
  const displayedItems = [...items].sort((a, b) => b.priority - a.priority)

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      position: 'relative',
      background: 'var(--color-background)'
    }}>
      {/* Header Bar */}
      <header style={{
        height: '48px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 var(--space-6)',
        borderBottom: '1px solid var(--color-surface-offset)',
        background: 'var(--color-surface-1)',
        flexShrink: 0
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <h1 style={{
            fontSize: 'var(--text-md)',
            fontWeight: 'var(--weight-semibold)',
            color: 'var(--color-text-base)',
            margin: 0
          }}>
            Context Feed
          </h1>
          <span style={{
            fontSize: 'var(--text-xs)',
            color: 'var(--color-text-muted)',
            background: 'var(--color-surface-2)',
            padding: '2px 8px',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--color-surface-offset)'
          }}>
            #{activeContext}
          </span>
        </div>
      </header>

      {/* Main Scrollable chronological feed */}
      <LogVirtualList
        items={displayedItems}
        hasMore={hasMore}
        onLoadMore={handleLoadMore}
        onTogglePin={handleTogglePin}
        onDelete={handleDeleteLog}
        onConvertToCard={handleConvertToCard}
        activeContext={activeContext}
      />

      {/* Pinned compose bar */}
      <LogInput
        context={activeContext}
        onSubmit={handleSubmitLog}
      />

      {/* Soft Delete Undo Snackbar */}
      {showUndo && (
        <div style={{
          position: 'absolute',
          bottom: '100px',
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'var(--color-surface-elevated)',
          border: '1px solid var(--color-surface-offset)',
          boxShadow: '0 10px 15px -3px rgba(0,0,0,0.5)',
          borderRadius: 'var(--radius-md)',
          padding: 'var(--space-3) var(--space-4)',
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-4)',
          zIndex: 100,
          color: 'var(--color-text-base)',
          fontSize: 'var(--text-sm)',
          animation: 'toast-in var(--duration-fast) var(--ease-default)'
        }}>
          <span>Log entry deleted.</span>
          <button
            onClick={handleUndoDelete}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--color-secondary)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              fontWeight: 'var(--weight-bold)',
              padding: 0
            }}
            onMouseEnter={e => (e.currentTarget.style.filter = 'brightness(1.15)')}
            onMouseLeave={e => (e.currentTarget.style.filter = 'none')}
          >
            <RotateCcw size={14} /> Undo
          </button>
        </div>
      )}

      {/* Action Notification Toast */}
      {toastMessage && (
        <div style={{
          position: 'absolute',
          bottom: '100px',
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'var(--color-surface-elevated)',
          border: '1px solid var(--color-surface-offset)',
          boxShadow: '0 10px 15px -3px rgba(0,0,0,0.5)',
          borderRadius: 'var(--radius-md)',
          padding: 'var(--space-3) var(--space-4)',
          zIndex: 100,
          color: 'var(--color-text-base)',
          fontSize: 'var(--text-sm)',
          animation: 'toast-in var(--duration-fast) var(--ease-default)'
        }}>
          {toastMessage}
        </div>
      )}
    </div>
  )
}
