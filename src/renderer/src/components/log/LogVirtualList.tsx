import React, { useEffect, useRef, useState, useLayoutEffect } from 'react'
import LogEntry from './LogEntry'
import type { Item } from '../../../../shared/types'
import { Calendar } from 'lucide-react'

interface LogVirtualListProps {
  items: Item[]
  hasMore: boolean
  onLoadMore: () => Promise<void>
  onTogglePin: (id: string, currentPriority: number) => void
  onDelete: (id: string) => void
  onConvertToCard: (id: string, title: string, tagIds: string[]) => void
  activeWorkspace: string
}

export default function LogVirtualList({
  items,
  hasMore,
  onLoadMore,
  onTogglePin,
  onDelete,
  onConvertToCard,
  activeWorkspace
}: LogVirtualListProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  
  const [loadingMore, setLoadingMore] = useState(false)
  const [prevScrollHeight, setPrevScrollHeight] = useState<number | null>(null)
  const [prevScrollTop, setPrevScrollTop] = useState<number | null>(null)

  // scroll to bottom once page 1 loads
  const [hasInitialScrolled, setHasInitialScrolled] = useState(false)

  useEffect(() => {
    setHasInitialScrolled(false)
  }, [activeWorkspace])

  useEffect(() => {
    if (items.length > 0 && !hasInitialScrolled && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight
      setHasInitialScrolled(true)
    }
  }, [items, hasInitialScrolled])

  // keep the scroll position when older logs prepend
  useLayoutEffect(() => {
    if (prevScrollHeight !== null && prevScrollTop !== null && containerRef.current) {
      const container = containerRef.current
      const newScrollHeight = container.scrollHeight
      const heightDifference = newScrollHeight - prevScrollHeight
      
      container.scrollTop = prevScrollTop + heightDifference
      
      setPrevScrollHeight(null)
      setPrevScrollTop(null)
    }
  }, [items, prevScrollHeight, prevScrollTop])

  // scroll-up loading
  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel || !hasMore || loadingMore) return

    const observer = new IntersectionObserver(
      async (entries) => {
        const entry = entries[0]
        if (entry.isIntersecting && containerRef.current) {
          setPrevScrollHeight(containerRef.current.scrollHeight)
          setPrevScrollTop(containerRef.current.scrollTop)
          
          setLoadingMore(true)
          try {
            await onLoadMore()
          } catch (err) {
            console.error('Failed to load more logs:', err)
          } finally {
            setLoadingMore(false)
          }
        }
      },
      {
        root: containerRef.current,
        threshold: 0.1,
        rootMargin: '100px 0px 0px 0px' // fire a little before the top
      }
    )

    observer.observe(sentinel)
    return () => {
      observer.unobserve(sentinel)
    }
  }, [hasMore, loadingMore, onLoadMore, items])

  return (
    <div
      ref={containerRef}
      style={{
        flex: 1,
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--color-background)'
      }}
    >
      <div ref={sentinelRef} style={{ height: '1px' }} />

      {!hasMore && items.length > 0 && (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 'var(--space-8) var(--space-6)',
          borderBottom: '1px dashed var(--color-surface-offset)',
          background: 'var(--color-surface-1)',
          color: 'var(--color-text-muted)',
          textAlign: 'center',
          gap: 'var(--space-2)'
        }}>
          <div style={{
            width: '40px',
            height: '40px',
            borderRadius: '50%',
            background: 'var(--color-surface-2)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--color-secondary)'
          }}>
            <Calendar size={18} />
          </div>
          <span className="text-item-strong">
            Beginning of Workspace History
          </span>
          <span style={{ fontSize: 'var(--text-xs)', maxWidth: '320px' }}>
            This is the very first entry in <strong>"{activeWorkspace}"</strong>.
          </span>
        </div>
      )}

      {loadingMore && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 'var(--space-3)',
          background: 'var(--color-surface-1)',
          color: 'var(--color-text-muted)',
          fontSize: 'var(--text-xs)',
          gap: 'var(--space-2)'
        }}>
          <span className="spinner" style={{
            width: '12px',
            height: '12px',
            border: '2px solid var(--color-secondary-muted)',
            borderTopColor: 'var(--color-secondary)',
            borderRadius: '50%',
            animation: 'spin 0.6s linear infinite'
          }} />
          Loading historical entries...
        </div>
      )}

      {items.length === 0 ? (
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--color-text-muted)',
          gap: 'var(--space-2)',
          padding: 'var(--space-10)'
        }}>
          <p className="heading-sm-strong">
            No logs in this workspace yet
          </p>
          <p style={{ margin: 0, fontSize: 'var(--text-xs)', textAlign: 'center', maxWidth: '300px' }}>
            Write down your thoughts, tasks, or code snippets in the input bar below to create your first log entry.
          </p>
        </div>
      ) : (
        items.map(item => (
          <LogEntry
            key={item.id}
            item={item}
            onTogglePin={onTogglePin}
            onDelete={onDelete}
            onConvertToCard={onConvertToCard}
          />
        ))
      )}
    </div>
  )
}
