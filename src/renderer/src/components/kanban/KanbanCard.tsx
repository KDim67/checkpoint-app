import React, { useState } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Edit2, Trash2, ArrowRightLeft, Calendar, GripVertical, Play, Check, CheckSquare } from 'lucide-react'
import { useAppStore } from '../../store/appStore'
import type { Item } from '../../../../shared/types'

interface KanbanCardProps {
  card: Item
  onClick: (id: string) => void
  onDelete: (id: string) => void
  onConvertToTask: (id: string) => void
  onUpdate?: (id: string, patch: Partial<Item>) => Promise<void>
  isOverlay?: boolean
}

const PRIORITY_COLORS: Record<number, { bar: string; label: string; bg: string }> = {
  3: { bar: '#ef4444', label: 'High',   bg: 'rgba(239,68,68,0.08)' },
  2: { bar: '#eab308', label: 'Med',    bg: 'rgba(234,179,8,0.12)' },
  1: { bar: '#3b82f6', label: 'Low',    bg: 'rgba(59,130,246,0.08)' },
  0: { bar: 'transparent', label: '', bg: 'transparent' }
}

function stripMarkdown(md: string): string {
  if (!md) return ''
  return md
    // Remove headers
    .replace(/^#+\s+/gm, '')
    // Remove bold/italic formatting
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    // Remove inline code block ticks
    .replace(/`([^`]+)`/g, '$1')
    // Remove code blocks
    .replace(/```[\s\S]*?```/g, '')
    // Remove links [text](url) -> text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // Remove images ![alt](url) -> alt
    .replace(/!\[([^\]]+)\]\([^)]+\)/g, '$1')
    // Remove blockquotes
    .replace(/^\s*>\s+/gm, '')
    // Remove bullet points
    .replace(/^\s*[-*+]\s+/gm, '')
    // Remove numbered lists
    .replace(/^\s*\d+\.\s+/gm, '')
    // Clean up multiple spaces/newlines
    .replace(/\s+/g, ' ')
    .trim()
}

function getTextColorForBackground(bgColor?: string): string {
  if (!bgColor) return 'var(--color-text-base)'
  const hex = bgColor.replace('#', '')
  if (hex.length !== 6) return '#ffffff'
  const r = parseInt(hex.substring(0, 2), 16)
  const g = parseInt(hex.substring(2, 4), 16)
  const b = parseInt(hex.substring(4, 6), 16)
  const yiq = (r * 299 + g * 587 + b * 114) / 1000
  return yiq >= 115 ? '#0f172a' : '#ffffff'
}

function KanbanCard({ card, onClick, onDelete, onConvertToTask, onUpdate, isOverlay = false }: KanbanCardProps) {
  const [hovered, setHovered] = useState(false)

  const sortable = useSortable({ id: card.id, disabled: isOverlay })
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = isOverlay
    ? { attributes: {}, listeners: {}, setNodeRef: null, transform: null, transition: undefined, isDragging: false }
    : sortable

  const priority = PRIORITY_COLORS[card.priority] ?? PRIORITY_COLORS[0]

  // Parse Trello Metadata properties
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let meta: any = {}
  try {
    meta = JSON.parse(card.metadata || '{}')
  } catch {}

  const rawCover = meta.cover || null
  let cover = rawCover
  if (!cover && card.body) {
    const imgMatch = card.body.match(/!\[.*?\]\((.*?)\)/)
    if (imgMatch) {
      cover = {
        type: 'image',
        value: imgMatch[1]
      }
    }
  }

  const checklist = meta.checklist || []
  const isTemplate = meta.isTemplate === true
  const dueDateCompleted = meta.dueDateCompleted === true

  const totalChecklist = checklist.length
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const completedChecklist = checklist.filter((i: any) => i.done).length
  const isFullCover = cover && cover.type === 'color' && cover.size === 'full'
  const isHeaderCover = cover && cover.type === 'color' && cover.size !== 'full'
  const coverTextColor = isFullCover ? getTextColorForBackground(cover.value) : 'var(--color-text-base)'

  const cardStyle: React.CSSProperties = {
    transform: CSS.Transform.toString(transform) ?? undefined,
    transition: transition && transition !== 'none'
      ? `${transition}, height 250ms cubic-bezier(0.4, 0, 0.2, 1), border-color 150ms ease, box-shadow 150ms ease`
      : 'height 250ms cubic-bezier(0.4, 0, 0.2, 1), border-color 150ms ease, box-shadow 150ms ease',
    opacity: isDragging ? 0.4 : 1,
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    cursor: isDragging ? 'grabbing' : 'pointer',
    borderRadius: 'var(--radius-md)',
    border: isDragging
      ? '2px dashed var(--color-secondary)'
      : hovered && !isDragging
        ? '1px solid var(--color-balance)'
        : '1px solid var(--color-surface-offset)',
    backgroundColor: isFullCover ? cover.value : (isDragging ? 'var(--color-surface-2)' : 'var(--color-surface-1)'),
    boxShadow: hovered && !isDragging
      ? '0 4px 16px rgba(0,0,0,0.3), 0 1px 4px rgba(0,0,0,0.2)'
      : '0 1px 3px rgba(0,0,0,0.2)',
    zIndex: isDragging ? 999 : 1,
    overflow: 'hidden',
    flexShrink: 0
  }

  const plainText = stripMarkdown(card.body)
  const truncatedBody = plainText.length > 100
    ? `${plainText.substring(0, 100)}...`
    : plainText

  const isOverdue = card.due_at && card.due_at < Date.now() && card.status !== 'done' && !dueDateCompleted
  const dueDateStr = card.due_at
    ? new Date(card.due_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    : null

  const handleKeyDown = async (e: React.KeyboardEvent) => {
    if (e.target !== e.currentTarget) return

    // Space: Start Pomodoro Focus Session
    if (e.key === ' ') {
      e.preventDefault()
      useAppStore.getState().setPreselectedTaskId(card.id)
      useAppStore.getState().setView('focus')
      return
    }

    // Enter or e: Open Details Modal
    if (e.key === 'Enter' || e.key === 'e') {
      e.preventDefault()
      onClick(card.id)
      return
    }

    // d: Toggle Due Date Completed
    if (e.key === 'd' && card.due_at) {
      e.preventDefault()
      const nextVal = !dueDateCompleted
      const updatedMeta = { ...meta, dueDateCompleted: nextVal }
      if (onUpdate) {
        await onUpdate(card.id, { metadata: JSON.stringify(updatedMeta) })
      }
      return
    }

    // t: Toggle Template Status
    if (e.key === 't') {
      e.preventDefault()
      const nextVal = !isTemplate
      const updatedMeta = { ...meta, isTemplate: nextVal }
      if (onUpdate) {
        await onUpdate(card.id, { metadata: JSON.stringify(updatedMeta) })
      }
      return
    }

    // c: Archive (Delete) Card
    if (e.key === 'c') {
      e.preventDefault()
      onDelete(card.id)
      return
    }

    // x: Toggle Done status of card
    if (e.key === 'x') {
      e.preventDefault()
      if (onUpdate) {
        const isCurrentlyDone = card.status === 'done'
        let newStatus = 'done'
        let nextMeta = { ...meta }
        if (isCurrentlyDone) {
          newStatus = meta.prevStatus || 'backlog'
          delete nextMeta.prevStatus
        } else {
          nextMeta.prevStatus = card.status
        }
        await onUpdate(card.id, {
          status: newStatus,
          metadata: JSON.stringify(nextMeta)
        })
      }
      return
    }
  }

  return (
    <div
      ref={setNodeRef}
      style={{ ...cardStyle, outline: 'none' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => onClick(card.id)}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
      className="kanban-card"
    >
      {/* Cover Header Banner */}
      {isHeaderCover && (
        <div style={{ height: '28px', backgroundColor: cover.value, width: '100%', flexShrink: 0 }} />
      )}
      {cover && cover.type === 'image' && (
        <div style={{
          height: '50px',
          backgroundImage: `url(${cover.value})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          width: '100%',
          flexShrink: 0
        }} />
      )}

      <div style={{ display: 'flex', flex: 1, minWidth: 0 }}>
        {/* Priority accent bar on left edge */}
        {card.priority > 0 && (
          <div style={{
            width: '3px',
            flexShrink: 0,
            background: priority.bar
          }} />
        )}

        {/* Main content */}
        <div style={{
          flex: 1,
          padding: 'var(--space-3)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-2)',
          minWidth: 0
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-2)', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', flex: 1, minWidth: 0 }}>
              {/* Quick Completion Checkbox */}
              <button
                title={card.status === 'done' ? "Mark as Incomplete (X)" : "Mark as Done (X)"}
                onClick={async (e) => {
                  e.stopPropagation()
                  if (onUpdate) {
                    const isCurrentlyDone = card.status === 'done'
                    let newStatus = 'done'
                    let nextMeta = { ...meta }
                    if (isCurrentlyDone) {
                      newStatus = meta.prevStatus || 'backlog'
                      delete nextMeta.prevStatus
                    } else {
                      nextMeta.prevStatus = card.status
                    }
                    await onUpdate(card.id, {
                      status: newStatus,
                      metadata: JSON.stringify(nextMeta)
                    })
                  }
                }}
                style={{
                  background: 'transparent',
                  border: 'none',
                  padding: 0,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  marginTop: '2px',
                  color: card.status === 'done' ? '#22c55e' : 'var(--color-text-faint)',
                  transition: 'all 250ms cubic-bezier(0.4, 0, 0.2, 1)',
                  opacity: (hovered || card.status === 'done') ? 1 : 0,
                  width: (hovered || card.status === 'done') ? '14px' : '0px',
                  marginRight: (hovered || card.status === 'done') ? '8px' : '0px',
                  overflow: 'hidden',
                  pointerEvents: (hovered || card.status === 'done') ? 'auto' : 'none',
                  flexShrink: 0
                }}
                onMouseEnter={e => {
                  if (card.status !== 'done') e.currentTarget.style.color = 'var(--color-text-muted)'
                }}
                onMouseLeave={e => {
                  if (card.status !== 'done') e.currentTarget.style.color = 'var(--color-text-faint)'
                }}
              >
                <div style={{
                  width: '14px',
                  height: '14px',
                  borderRadius: '50%',
                  border: `1.5px solid ${card.status === 'done' ? '#22c55e' : 'var(--color-text-faint)'}`,
                  background: card.status === 'done' ? '#22c55e' : 'transparent',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 150ms ease',
                  flexShrink: 0
                }}>
                  {card.status === 'done' && <Check size={10} color="#fff" strokeWidth={4} />}
                </div>
              </button>

              <h4 style={{
                margin: 0,
                fontSize: 'var(--text-sm)',
                fontWeight: 'var(--weight-semibold)',
                color: coverTextColor,
                lineHeight: 1.35,
                wordBreak: 'break-word',
                flex: 1
              }}>
                {card.title}
              </h4>
            </div>

            {/* Top Right Quick Actions & Drag Handle */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '2px',
                flexShrink: 0
              }}
              onClick={e => e.stopPropagation()}
              onMouseDown={e => e.stopPropagation()}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '2px',
                  opacity: hovered ? 1 : 0,
                  transition: 'opacity 150ms ease'
                }}
              >
                <ActionBtn
                  title="Start Pomodoro Focus Session (Space)"
                  textColor={isFullCover ? coverTextColor : undefined}
                  onClick={() => {
                    useAppStore.getState().setPreselectedTaskId(card.id)
                    useAppStore.getState().setView('focus')
                  }}
                >
                  <Play size={11} fill="currentColor" />
                </ActionBtn>
                <ActionBtn title="Edit Card (E / Enter)" textColor={isFullCover ? coverTextColor : undefined} onClick={() => onClick(card.id)}>
                  <Edit2 size={11} />
                </ActionBtn>
                <ActionBtn title="Convert to Task" textColor={isFullCover ? coverTextColor : undefined} onClick={() => onConvertToTask(card.id)}>
                  <ArrowRightLeft size={11} />
                </ActionBtn>
                <ActionBtn title="Delete Card (C)" textColor={isFullCover ? coverTextColor : undefined} onClick={() => onDelete(card.id)} danger>
                  <Trash2 size={11} />
                </ActionBtn>
              </div>

              <div
                {...attributes}
                {...listeners}
                style={{
                  color: hovered ? (isFullCover ? coverTextColor : 'var(--color-text-muted)') : 'transparent',
                  cursor: 'grab',
                  padding: '2px',
                  borderRadius: 'var(--radius-sm)',
                  display: 'flex',
                  alignItems: 'center'
                }}
                title="Drag to reorder card"
              >
                <GripVertical size={14} />
              </div>
            </div>
          </div>

          {/* Body preview */}
          {card.body && (
            <p style={{
              margin: 0,
              fontSize: 'var(--text-xs)',
              color: isFullCover ? coverTextColor : 'var(--color-text-muted)',
              opacity: isFullCover ? 0.9 : 1,
              lineHeight: 1.45,
              wordBreak: 'break-word',
              whiteSpace: 'pre-wrap'
            }}>
              {truncatedBody}
            </p>
          )}

          {/* Tags */}
          {card.tags && card.tags.length > 0 && (
            <div style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '6px',
              marginTop: '2px'
            }}>
              {card.tags.map(tag => (
                <span
                  key={tag.id}
                  style={{
                    fontSize: '10px',
                    fontWeight: 'var(--weight-bold)',
                    color: tag.color,
                    backgroundColor: isFullCover ? (coverTextColor === '#ffffff' ? '#0f172a' : '#ffffff') : `${tag.color}18`,
                    border: isFullCover ? `1.5px solid ${tag.color}` : `1px solid ${tag.color}30`,
                    boxShadow: isFullCover ? '0 1px 3px rgba(0,0,0,0.15)' : undefined,
                    padding: '2px 6px',
                    borderRadius: '4px',
                    whiteSpace: 'nowrap',
                    letterSpacing: '0.02em'
                  }}
                >
                  {tag.name}
                </span>
              ))}
            </div>
          )}

          {/* Footer: due date & checklists */}
          {(dueDateStr || totalChecklist > 0 || isTemplate) && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-start',
              minHeight: '20px',
              marginTop: '4px',
              gap: '6px',
              flexWrap: 'wrap'
            }}>
              {dueDateStr && (
                <span style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  fontSize: '10px',
                  fontWeight: 'var(--weight-medium)',
                  color: isFullCover ? coverTextColor : (dueDateCompleted ? 'var(--color-text-inverted)' : (isOverdue ? 'white' : 'var(--color-text-faint)')),
                  backgroundColor: isFullCover 
                    ? (coverTextColor === '#ffffff' ? 'rgba(0,0,0,0.35)' : 'rgba(255,255,255,0.6)')
                    : (dueDateCompleted ? 'var(--color-secondary)' : (isOverdue ? 'var(--color-error)' : 'var(--color-surface-2)')),
                  padding: '2px 6px',
                  borderRadius: '4px',
                  border: isFullCover ? `1px solid ${coverTextColor === '#ffffff' ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.2)'}` : ((dueDateCompleted || isOverdue) ? 'none' : '1px solid var(--color-surface-offset)')
                }}>
                  {dueDateCompleted ? <Check size={10} strokeWidth={3} /> : <Calendar size={10} />}
                  {dueDateStr}
                </span>
              )}

              {totalChecklist > 0 && (
                <span style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  fontSize: '10px',
                  fontWeight: 'var(--weight-medium)',
                  color: isFullCover ? coverTextColor : (completedChecklist === totalChecklist ? 'var(--color-text-inverted)' : 'var(--color-text-faint)'),
                  backgroundColor: isFullCover
                    ? (coverTextColor === '#ffffff' ? 'rgba(0,0,0,0.35)' : 'rgba(255,255,255,0.6)')
                    : (completedChecklist === totalChecklist ? 'var(--color-secondary)' : 'var(--color-surface-2)'),
                  padding: '2px 6px',
                  borderRadius: '4px',
                  border: isFullCover ? `1px solid ${coverTextColor === '#ffffff' ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.2)'}` : (completedChecklist === totalChecklist ? 'none' : '1px solid var(--color-surface-offset)')
                }}>
                  <CheckSquare size={10} />
                  {completedChecklist}/{totalChecklist}
                </span>
              )}

              {isTemplate && (
                <span style={{
                  fontSize: '9px',
                  fontWeight: 'var(--weight-bold)',
                  backgroundColor: isFullCover ? (coverTextColor === '#ffffff' ? 'rgba(0,0,0,0.35)' : 'rgba(255,255,255,0.6)') : 'var(--color-surface-offset)',
                  border: isFullCover ? `1px solid ${coverTextColor === '#ffffff' ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.2)'}` : '1px solid var(--color-surface-offset)',
                  color: isFullCover ? coverTextColor : 'var(--color-secondary)',
                  padding: '2px 6px',
                  borderRadius: '4px',
                  letterSpacing: '0.02em',
                  textTransform: 'uppercase'
                }}>
                  Template
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      <style>{`
        .kanban-card:focus-visible {
          outline: 1.5px solid var(--color-secondary) !important;
          outline-offset: -1.5px;
          border-color: var(--color-secondary) !important;
        }
      `}</style>
    </div>
  )
}

function ActionBtn({
  children,
  title,
  onClick,
  danger = false,
  textColor
}: {
  children: React.ReactNode
  title: string
  onClick: () => void
  danger?: boolean
  textColor?: string
}) {
  const [hover, setHover] = useState(false)
  return (
    <button
      title={title}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        backgroundColor: hover
          ? (danger ? 'rgba(239,68,68,0.25)' : 'rgba(255,255,255,0.25)')
          : 'transparent',
        border: 'none',
        color: danger ? (hover ? 'var(--color-error)' : (textColor || 'var(--color-error)')) : (textColor || (hover ? 'var(--color-text-base)' : 'var(--color-text-muted)')),
        cursor: 'pointer',
        padding: '3px 4px',
        borderRadius: '4px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}
    >
      {children}
    </button>
  )
}

export default React.memo(KanbanCard)
