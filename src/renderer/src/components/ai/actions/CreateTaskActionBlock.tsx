import React, { useState, useEffect, useRef } from 'react'
import { CheckCircle2, RefreshCw } from 'lucide-react'
import { useAppStore } from '../../../store/appStore'
import { withLock } from '../../../lib/asyncMutex'
import { readBoardConfigUnlocked, loadBoardConfig } from '../../../lib/boardConfig'
import { asArray, tagColorOf, tagNameOf } from '../aiActionTypes'
import type { Item, Tag } from '@shared/types'
import { normalizeCardJson } from '../aiActionParse'
import { tagResolver } from '../../../data/tags'
import { createItem, readItems } from '../../../data/items'
import { executedActionSignaturesSet, createdItemsCacheMap, errorText } from './shared'
import ViewOnKanbanButton from './ViewOnKanbanButton'

export default function CreateTaskActionBlock({ jsonString }: { jsonString: string }) {
  const activeWorkspace = useAppStore(s => s.activeWorkspace)
  const selectItem = useAppStore(s => s.selectItem)
  const setView = useAppStore(s => s.setView)
  const [createdItem, setCreatedItem] = useState<Item | null>(null)
  const [itemTags, setItemTags] = useState<Tag[]>([])
  const [error, setError] = useState<string | null>(null)

  const normalized = normalizeCardJson(jsonString)
  const title = normalized?.title || ''
  const signature = title ? `card::${activeWorkspace || 'default'}::${title.toLowerCase()}` : ''

  const cached = signature ? createdItemsCacheMap.get(signature) : null
  const currentItem = createdItem || cached?.item
  const currentTags = itemTags.length > 0 ? itemTags : (cached?.tags || [])

  const previewData = normalized ? {
    title: normalized.title,
    body: normalized.body,
    status: normalized.status,
    priority: normalized.priority,
    tags: normalized.tags
  } : null

  const data = currentItem || previewData

  // Rebuilt from the JSON on every render, so read through a ref rather than
  // listed: listing them would run the effect on every render.
  const parsedRef = useRef({ normalized, title, cached })
  parsedRef.current = { normalized, title, cached }

  useEffect(() => {
    let isMounted = true
    const { normalized, title, cached } = parsedRef.current
    const autoCreate = async () => {
      try {
        if (!normalized || !title || !signature) return

        if (cached) {
          if (isMounted) {
            setCreatedItem(cached.item)
            setItemTags(cached.tags)
          }
          return
        }

        if (executedActionSignaturesSet.has(signature)) {
          return
        }
        executedActionSignaturesSet.add(signature)

        const validContext = activeWorkspace || 'default'

        const created = await withLock(`kanban-cards:${validContext}`, async () => {
          const existingCards = await readItems(validContext, 'card').catch(() => [])
          const existingCard = existingCards.find(ci => ci.status !== 'archived' && ci.title.trim().toLowerCase() === title.trim().toLowerCase())

          if (existingCard) {
            createdItemsCacheMap.set(signature, { item: existingCard, tags: [] })
            return { item: existingCard, tags: [], isNew: false }
          }

          const body = normalized.body || ''
          const priority = normalized.priority ?? 2

          // Resolve status to match existing board column IDs
          let finalStatus = 'open'
          // Unified board document; read unlocked inside the existing lock.
          const { columns: cols } = await readBoardConfigUnlocked(validContext)

          const rawStatus = (normalized.status || '').trim().toLowerCase()
          let matchedCol = cols.find(c => c.id.toLowerCase() === rawStatus)
          if (!matchedCol) {
            matchedCol = cols.find(c => c.name.toLowerCase() === rawStatus || c.name.toLowerCase().replace(/\s+/g, '_') === rawStatus || c.name.toLowerCase().replace(/\s+/g, '') === rawStatus.replace(/\s+/g, ''))
          }
          if (!matchedCol) {
            if (rawStatus.includes('todo') || rawStatus.includes('backlog') || rawStatus.includes('open')) {
              matchedCol = cols.find(c => c.id === 'open') || cols[0]
            } else if (rawStatus.includes('progress') || rawStatus.includes('doing') || rawStatus.includes('work')) {
              matchedCol = cols.find(c => c.id === 'in_progress') || cols[1] || cols[0]
            } else if (rawStatus.includes('review') || rawStatus.includes('qa') || rawStatus.includes('test')) {
              matchedCol = cols.find(c => c.id === 'in_review') || cols[2] || cols[0]
            } else if (rawStatus.includes('done') || rawStatus.includes('complete') || rawStatus.includes('finish')) {
              matchedCol = cols.find(c => c.id === 'done') || cols[cols.length - 1] || cols[0]
            }
          }
          finalStatus = matchedCol ? matchedCol.id : (cols[0]?.id || 'open')

          // Handle Tags if provided
          // Nameless tags are skipped rather than thrown on: reading `.name` off
          // whatever the model sent used to fail the whole card.
          const createdTagsList: Tag[] = Array.isArray(normalized.tags)
            ? await (await tagResolver())(
                normalized.tags
                  .map(t => ({ name: tagNameOf(t) ?? '', color: tagColorOf(t, '#3b82f6') }))
                  .filter(t => t.name)
              )
            : []
          const tagIds = createdTagsList.map(tag => tag.id)

          const newItem = await createItem({
            context: validContext,
            type: 'card',
            title,
            body,
            status: finalStatus,
            priority,
            // Explicit position. Omitting it defaults to 0 in the IPC validator,
            // pinning the card above everything and breaking drag-reordering.
            position: Date.now(),
            due_at: null,
            metadata: '{}'
          }, tagIds)

          // Cache the result permanently in memory
          createdItemsCacheMap.set(signature, { item: newItem, tags: createdTagsList })

          return { item: newItem, tags: createdTagsList, isNew: true }
        })

        // Dispatch live update event to reload Kanban board instantly
        window.dispatchEvent(new CustomEvent('kanban-refresh'))
        window.dispatchEvent(new CustomEvent('item-updated'))

        if (isMounted) {
          setCreatedItem(created.item)
          setItemTags(created.tags)
        }
      } catch (e) {
        if (isMounted) setError(errorText(e))
      }
    }
    autoCreate()
    return () => { isMounted = false }
  }, [jsonString, activeWorkspace, signature])

  // Look up the human-readable column name for whatever status ID this card has.
  // Must stay above the early returns below: this block renders a "generating"
  // placeholder while `data` is still streaming in, so hooks placed after those
  // returns would change in count once the card resolves, and React would throw.
  const [colDisplayName, setColDisplayName] = React.useState<string>('')
  const dataStatus = data?.status
  React.useEffect(() => {
    if (dataStatus === undefined) return
    const lookup = async () => {
      try {
        const ctx = activeWorkspace || 'default'
        const { columns: cols } = await loadBoardConfig(ctx)
        const match = cols.find(c =>
          c.id === dataStatus || c.name?.toLowerCase() === String(dataStatus).toLowerCase()
        )
        if (match) setColDisplayName(match.name)
        else {
          // Friendly label for default column IDs
          const labels: Record<string, string> = {
            open: 'To Do', in_progress: 'In Progress', in_review: 'In Review', done: 'Done'
          }
          setColDisplayName(labels[dataStatus] || String(dataStatus))
        }
      } catch { setColDisplayName(String(dataStatus)) }
    }
    lookup()
  }, [dataStatus, activeWorkspace])

  if (error) {
    return (
      <div style={{ padding: '8px 10px', color: 'var(--color-error)', fontSize: '11px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 'var(--radius-sm)', margin: '8px 0', display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span>⚠ Failed to create card: {error}</span>
        <button
          onClick={() => { executedActionSignaturesSet.delete(signature); setError(null) }}
          style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', color: 'var(--color-error)', borderRadius: '4px', padding: '2px 8px', fontSize: '10px', cursor: 'pointer' }}
        >Retry</button>
      </div>
    )
  }

  if (!data) {
    return (
      <div style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-surface-offset)', borderRadius: 'var(--radius-md)', padding: 'var(--space-3)', margin: '8px 0' }}>
        <div style={{ padding: '4px 0', color: 'var(--color-text-muted)', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <RefreshCw size={12} className="animate-spin" />
          <span>Generating card block...</span>
        </div>
      </div>
    )
  }


  const priorityColor = data.priority === 3 ? '#ef4444' : data.priority === 2 ? '#eab308' : 'var(--color-text-muted)'
  const priorityLabel = data.priority === 3 ? 'High' : data.priority === 2 ? 'Medium' : 'Low'

  return (
    <div
      style={{
        background: 'linear-gradient(135deg, var(--color-surface-2) 0%, var(--color-surface-1) 100%)',
        border: '1px solid rgba(59, 130, 246, 0.3)',
        borderRadius: 'var(--radius-lg)',
        padding: 'var(--space-4)',
        margin: '12px 0',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        boxShadow: '0 4px 20px rgba(0, 0, 0, 0.25)',
        position: 'relative',
        overflow: 'hidden'
      }}
    >
      {/* Top Header Badge */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--color-primary-soft)', fontSize: '11px', fontWeight: 'bold', letterSpacing: '0.02em', flexShrink: 0 }}>
          <CheckCircle2 size={14} style={{ color: '#3b82f6', flexShrink: 0 }} />
          <span>Added to board</span>
        </div>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexShrink: 0, minWidth: 0 }}>
          <span
            style={{
              fontSize: '10px',
              padding: '2px 8px',
              borderRadius: '12px',
              fontWeight: 'bold',
              background: 'rgba(59, 130, 246, 0.15)',
              color: 'var(--color-primary-soft)',
              border: '1px solid rgba(59, 130, 246, 0.3)',
              maxWidth: '120px',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            }}
          >
            {colDisplayName || data.status}
          </span>
          <span
            style={{
              fontSize: '10px',
              padding: '2px 8px',
              borderRadius: '12px',
              fontWeight: 'bold',
              background: `${priorityColor}22`,
              color: priorityColor,
              border: `1px solid ${priorityColor}44`
            }}
          >
            {priorityLabel} Priority
          </span>
        </div>
      </div>

      {/* Card Details */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 0 }}>
        <div style={{ fontSize: '13px', fontWeight: 'bold', color: 'var(--color-text-base)', lineHeight: 1.4, wordBreak: 'break-word' }}>
          {data.title}
        </div>
        {data.body && (
          <div style={{ fontSize: '11px', color: 'var(--color-text-muted)', lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            {data.body}
          </div>
        )}
      </div>

      {/* Tags Chips */}
      {((currentTags && currentTags.length > 0) || (data.tags && data.tags.length > 0)) && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '2px' }}>
          {(currentTags.length > 0 ? currentTags : asArray(data.tags)).map((t, idx) => {
            const tagName = tagNameOf(t)
            const tagColor = tagColorOf(t, '#3b82f6')
            return (
              <span
                key={idx}
                style={{
                  fontSize: '9px',
                  padding: '2px 6px',
                  borderRadius: '4px',
                  fontWeight: 'bold',
                  background: `${tagColor}22`,
                  color: tagColor,
                  border: `1px solid ${tagColor}44`
                }}
              >
                #{tagName}
              </span>
            )
          })}
        </div>
      )}

      {/* View Action Button */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '4px', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '8px' }}>
        <ViewOnKanbanButton
          onClick={() => {
            if (currentItem) selectItem(currentItem.id)
            setView('kanban')
          }}
        />
      </div>
    </div>
  )
}
