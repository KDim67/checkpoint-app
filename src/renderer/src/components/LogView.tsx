import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import LogVirtualList from './log/LogVirtualList'
import LogInput from './log/LogInput'
import { useAppStore } from '../store/appStore'
import type { Item } from '../../../shared/types'
import Skeleton from './ui/Skeleton'
import EmptyState from './ui/EmptyState'
import { useToast } from './ui/Toast'
import { FileText } from 'lucide-react'
import StandupTranslatorView from './StandupTranslatorView'

export default function LogView() {
  const [items, setItems] = useState<Item[]>([])
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(true)
  const [loading, setLoading] = useState(true)
  const [showStandupModal, setShowStandupModal] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  const activeContext = useAppStore(s => s.activeContext)
  const availableContexts = useAppStore(s => s.availableContexts)
  const setContext = useAppStore(s => s.setContext)
  const setView = useAppStore(s => s.setView)
  const setSettingsTab = useAppStore(s => s.setSettingsTab)

  const [dropdownOpen, setDropdownOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!dropdownOpen) return
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [dropdownOpen])

  const { toast } = useToast()

  // Load page 1 of logs for the active context
  const loadInitialFeed = useCallback(async () => {
    setLoading(true)
    try {
      const res = await window.electronAPI.db.getItems(activeContext, 'log', 1, 50)
      
      // SQLite returns sorted by position ASC, created_at DESC (which is newest first).
      // For a Slack-like chronological feed (oldest at the top, newest at the bottom),
      // we reverse the array of items before putting it in state.
      const reversed = [...res.items].reverse()
      setItems(reversed)
      setPage(1)
      
      // If we got a full page (50 items), there may be more historical entries to load
      setHasMore(res.items.length === 50)
    } catch (err) {
      console.error('Failed to load initial log feed:', err)
    } finally {
      setLoading(false)
    }
  }, [activeContext])

  useEffect(() => {
    loadInitialFeed()
  }, [loadInitialFeed])

  useEffect(() => {
    const handleItemUpdated = () => {
      loadInitialFeed()
    }
    window.addEventListener('item-updated', handleItemUpdated)
    return () => window.removeEventListener('item-updated', handleItemUpdated)
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
      toast(newPriority === 3 ? 'Log entry pinned to top' : 'Log entry unpinned')
    } catch (err) {
      console.error('Failed to toggle log pin:', err)
    }
  }

  // Soft Delete Log Entry (archives it)
  const handleDeleteLog = async (id: string) => {
    try {
      const targetItem = items.find(item => item.id === id)
      if (!targetItem) return

      // Archive in DB
      await window.electronAPI.db.updateItem(id, { status: 'archived' })
      
      // Update UI state
      setItems(prev => prev.filter(item => item.id !== id))

      // Trigger Toast notification with Undo Action
      toast('Log entry deleted.', {
        action: {
          label: 'Undo',
          onClick: async () => {
            try {
              await window.electronAPI.db.updateItem(id, { status: 'open' })
              setItems(prev => {
                const updated = [...prev, targetItem]
                return updated.sort((a, b) => a.created_at - b.created_at)
              })
              toast('Log entry restored')
            } catch (err) {
              console.error('Failed to restore log entry:', err)
            }
          }
        }
      })
    } catch (err) {
      console.error('Failed to soft delete log:', err)
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
      toast(`Promoted to Kanban Card: "${title}"`)
    } catch (err) {
      console.error('Failed to promote log to card:', err)
    }
  }

  // Filter by search (title/body/tags) then float pinned items (priority 3) to top.
  const displayedItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    const filtered = q
      ? items.filter(i =>
          i.title.toLowerCase().includes(q) ||
          i.body.toLowerCase().includes(q) ||
          (i.tags && i.tags.some((t) => t.name.toLowerCase().includes(q)))
        )
      : items
    return [...filtered].sort((a, b) => b.priority - a.priority)
  }, [items, searchQuery])

  // Loading skeleton view
  if (loading) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: 'var(--color-background)'
      }}>
        <header style={{
          height: '48px',
          display: 'flex',
          alignItems: 'center',
          padding: '0 var(--space-6)',
          borderBottom: '1px solid var(--color-surface-offset)',
          background: 'var(--color-surface-1)',
          flexShrink: 0
        }}>
          <Skeleton width={140} height={20} />
        </header>
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden'
        }}>
          {[1, 2, 3, 4].map(i => (
            <div key={i} style={{
              padding: 'var(--space-4) var(--space-6)',
              borderBottom: '1px solid var(--color-surface-offset)',
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-2)'
            }}>
              {/* Header block (timestamp) */}
              <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                <Skeleton width={80} height={12} />
              </div>
              {/* Body block (varying lines) */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', marginTop: '4px' }}>
                <Skeleton width={i === 1 ? '90%' : i === 2 ? '75%' : i === 3 ? '60%' : '80%'} height={14} />
                <Skeleton width={i === 1 ? '45%' : i === 2 ? '30%' : i === 3 ? '40%' : '50%'} height={14} />
              </div>
              {/* Tags block */}
              <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
                <Skeleton width={50} height={16} borderRadius="var(--radius-sm)" />
                {i % 2 === 0 && <Skeleton width={65} height={16} borderRadius="var(--radius-sm)" />}
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

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
          <div style={{ position: 'relative' }} ref={dropdownRef}>
            <button
              onClick={() => setDropdownOpen(v => !v)}
              style={{
                fontSize: 'var(--text-xs)',
                color: 'var(--color-secondary)',
                background: 'var(--color-surface-2)',
                padding: '2px 8px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--color-surface-offset)',
                cursor: 'pointer',
                fontWeight: 'var(--weight-semibold)',
                transition: 'background var(--duration-fast), border-color var(--duration-fast)',
                display: 'flex',
                alignItems: 'center',
                gap: '4px'
              }}
              onMouseEnter={e => {
                e.currentTarget.style.background = 'var(--color-surface-offset)'
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = 'var(--color-surface-2)'
              }}
            >
              #{activeContext}
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transform: dropdownOpen ? 'rotate(180deg)' : 'none', transition: 'transform 150ms ease' }}>
                <path d="m6 9 6 6 6-6"/>
              </svg>
            </button>
            
            {dropdownOpen && (
              <div
                style={{
                  position: 'absolute',
                  top: 'calc(100% + 4px)',
                  left: 0,
                  zIndex: 100,
                  background: 'var(--color-surface-elevated)',
                  border: '1px solid var(--color-surface-offset)',
                  borderRadius: 'var(--radius-md)',
                  boxShadow: 'var(--shadow-md)',
                  minWidth: '180px',
                  padding: '4px 0',
                  animation: 'dropdown-in 150ms var(--ease-enter)'
                }}
              >
                {availableContexts.map(ctx => (
                  <button
                    key={ctx}
                    onClick={() => {
                      setContext(ctx)
                      setDropdownOpen(false)
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 'var(--space-2)',
                      width: '100%',
                      padding: '6px 12px',
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      fontSize: 'var(--text-sm)',
                      color: ctx === activeContext ? 'var(--color-secondary)' : 'var(--color-text-base)',
                      textAlign: 'left',
                      transition: 'background var(--duration-fast) var(--ease-default)'
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-surface-offset)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                  >
                    <span style={{
                      width: '8px',
                      height: '8px',
                      borderRadius: '50%',
                      background: ctx === activeContext ? 'var(--color-secondary)' : 'var(--color-balance)',
                      flexShrink: 0
                    }} />
                    {ctx.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                  </button>
                ))}
                <div style={{ height: '1px', background: 'var(--color-surface-offset)', margin: '4px 0' }} />
                <button
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-2)',
                    width: '100%',
                    padding: '6px 12px',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: 'var(--text-sm)',
                    color: 'var(--color-text-muted)',
                    textAlign: 'left'
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-surface-offset)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                  onClick={() => {
                    setView('settings')
                    setSettingsTab('contexts')
                    setDropdownOpen(false)
                  }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '2px', opacity: 0.7 }}>
                    <path d="M5 12h14M12 5v14"/>
                  </svg>
                  New Context
                </button>
              </div>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          {/* Search */}
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ position: 'absolute', left: '9px', color: 'var(--color-text-faint)', pointerEvents: 'none' }}>
              <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
            </svg>
            <input
              type="text"
              placeholder="Search this feed…"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              style={{
                width: searchQuery ? '220px' : '180px',
                background: 'var(--color-surface-2)',
                border: '1px solid var(--color-surface-offset)',
                borderRadius: 'var(--radius-md)',
                color: 'var(--color-text-base)',
                fontSize: 'var(--text-xs)',
                padding: '6px 26px 6px 28px',
                outline: 'none',
                transition: 'width var(--duration-fast) var(--ease-default)'
              }}
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                title="Clear search"
                aria-label="Clear search"
                style={{ position: 'absolute', right: '7px', background: 'none', border: 'none', color: 'var(--color-text-faint)', cursor: 'pointer', display: 'flex', padding: 0 }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            )}
          </div>

          <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--color-text-faint)', whiteSpace: 'nowrap', minWidth: 'fit-content' }}>
            {searchQuery ? `${displayedItems.length} of ${items.length}` : `${items.length} log${items.length === 1 ? '' : 's'}`}
          </span>

          <button
            onClick={() => setShowStandupModal(true)}
            style={{
              background: 'var(--color-secondary-muted)',
              border: '1px solid var(--color-secondary)',
              color: 'var(--color-secondary)',
              borderRadius: 'var(--radius-md)',
              padding: 'var(--space-2) var(--space-3)',
              fontSize: 'var(--text-xs)',
              fontWeight: 'var(--weight-bold)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-2)',
              whiteSpace: 'nowrap',
              transition: 'filter var(--duration-fast)'
            }}
            onMouseEnter={e => (e.currentTarget.style.filter = 'brightness(1.15)')}
            onMouseLeave={e => (e.currentTarget.style.filter = 'none')}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/>
            </svg>
            AI Standup
          </button>
        </div>
      </header>

      {/* Main feed container */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {items.length === 0 ? (
          <EmptyState
            icon={<FileText size={48} />}
            title="Context Feed is Empty"
            description={`No logs recorded for context "#${activeContext}" yet. Write a quick note below to start capturing context.`}
          />
        ) : displayedItems.length === 0 ? (
          <EmptyState
            icon={<FileText size={48} />}
            title="No matching logs"
            description={`No logs in this feed match “${searchQuery}”. Older entries load as you scroll up.`}
          />
        ) : (
          <LogVirtualList
            items={displayedItems}
            hasMore={hasMore}
            onLoadMore={handleLoadMore}
            onTogglePin={handleTogglePin}
            onDelete={handleDeleteLog}
            onConvertToCard={handleConvertToCard}
            activeContext={activeContext}
          />
        )}
      </div>

      {/* Pinned compose bar */}
      <LogInput
        context={activeContext}
        onSubmit={handleSubmitLog}
      />

      <StandupTranslatorView
        isOpen={showStandupModal}
        onClose={() => setShowStandupModal(false)}
        onReportPosted={loadInitialFeed}
      />
    </div>
  )
}
