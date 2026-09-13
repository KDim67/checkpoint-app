import React, { useState } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Edit2, Trash2, ArrowRightLeft, Calendar, GripVertical, Play, Check, CheckSquare } from 'lucide-react'
import { useAppStore } from '../../store/appStore'
import type { Item } from '../../../../shared/types'
import { getTextColorForBackground } from '../../lib/contrast'
import { PRIORITY_COLORS } from '../../lib/priority'
import { DEFAULT_CARD_DISPLAY, type CardDisplay } from '../../lib/boardConfig'
import { useViewShortcuts } from '../../lib/useViewShortcuts'

interface KanbanCardProps {
  card: Item
  onClick: (id: string) => void
  onDelete: (id: string) => void
  onConvertToTask: (id: string) => void
  onUpdate?: (id: string, patch: Partial<Item>) => Promise<void>
  isOverlay?: boolean
  /** board-level card face switches */
  display?: CardDisplay
}

function stripMarkdown(md: string): string {
  if (!md) return ''
  return md
    // headers
    .replace(/^#+\s+/gm, '')
    // bold/italic
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    // inline code
    .replace(/`([^`]+)`/g, '$1')
    // code blocks
    .replace(/```[\s\S]*?```/g, '')
    // links
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // images
    .replace(/!\[([^\]]+)\]\([^)]+\)/g, '$1')
    // blockquotes
    .replace(/^\s*>\s+/gm, '')
    // bullets
    .replace(/^\s*[-*+]\s+/gm, '')
    // numbered lists
    .replace(/^\s*\d+\.\s+/gm, '')
    // collapse whitespace
    .replace(/\s+/g, ' ')
    .trim()
}

type Sortable = ReturnType<typeof useSortable>

interface CardFaceProps extends Omit<KanbanCardProps, 'isOverlay'> {
  dragAttributes?: Sortable['attributes']
  isDragging: boolean
}

function CardFace({
  card,
  onClick,
  onDelete,
  onConvertToTask,
  onUpdate,
  display = DEFAULT_CARD_DISPLAY,
  dragAttributes,
  isDragging
}: CardFaceProps) {
  const [hovered, setHovered] = useState(false)
  const { match: matchKey } = useViewShortcuts('kanban')

  const priority = PRIORITY_COLORS[card.priority] ?? PRIORITY_COLORS[0]

  // trello-style metadata
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let meta: any = {}
  try {
    meta = JSON.parse(card.metadata || '{}')
  } catch {}

  const rawCover = display.cover ? (meta.cover || null) : null
  let cover = rawCover
  // gated at the source: the cover also sets background and text colour
  if (!cover && display.cover && card.body) {
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
    transition: 'height 250ms cubic-bezier(0.4, 0, 0.2, 1), border-color 150ms ease, box-shadow 150ms ease',
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
    overflow: 'hidden',
    flexShrink: 0,
    // the whole card drags, so no text selection sweeping the board
    userSelect: 'none'
  }

  const plainText = stripMarkdown(card.body)
  const truncatedBody = plainText.length > 100
    ? `${plainText.substring(0, 100)}...`
    : plainText

  const isOverdue = card.due_at && card.due_at < Date.now() && card.status !== 'done' && !dueDateCompleted
  const dueDateStr = card.due_at
    ? new Date(card.due_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    : null

  // worked out once, an empty footer is still 20px
  const showDue = display.due && Boolean(dueDateStr)
  const showChecklist = display.checklist && totalChecklist > 0
  const showTemplate = display.template && isTemplate

  const handleKeyDown = async (e: React.KeyboardEvent) => {
    if (e.target !== e.currentTarget) return

    // Enter activates focus by convention; the rest come from Settings
    if (e.key === 'Enter') {
      e.preventDefault()
      onClick(card.id)
      return
    }

    const command = matchKey(e)

    if (command === 'kanban_focus_session') {
      e.preventDefault()
      useAppStore.getState().setPreselectedTaskId(card.id)
      useAppStore.getState().setView('focus')
      return
    }

    if (command === 'kanban_open_details') {
      e.preventDefault()
      onClick(card.id)
      return
    }

    if (command === 'kanban_toggle_due' && card.due_at) {
      e.preventDefault()
      const nextVal = !dueDateCompleted
      const updatedMeta = { ...meta, dueDateCompleted: nextVal }
      if (onUpdate) {
        await onUpdate(card.id, { metadata: JSON.stringify(updatedMeta) })
      }
      return
    }

    if (command === 'kanban_toggle_template') {
      e.preventDefault()
      const nextVal = !isTemplate
      const updatedMeta = { ...meta, isTemplate: nextVal }
      if (onUpdate) {
        await onUpdate(card.id, { metadata: JSON.stringify(updatedMeta) })
      }
      return
    }

    if (command === 'kanban_archive') {
      e.preventDefault()
      onDelete(card.id)
      return
    }

    if (command === 'kanban_toggle_done') {
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
      {...dragAttributes}
      style={{ ...cardStyle, outline: 'none' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => onClick(card.id)}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
      className="kanban-card"
    >
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
        {display.priority && card.priority > 0 && (
          <div style={{
            width: '3px',
            flexShrink: 0,
            background: priority.bar
          }} />
        )}

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
              {/* off hides the done marker too; the shortcut and modal still set status */}
              {display.doneCheckbox && (
              <button
                title={card.status === 'done' ? "Mark as Incomplete (X)" : "Mark as Done (X)"}
                // ticking never picks the card up
                onPointerDown={e => e.stopPropagation()}
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
                className="kanban-card-check"
                data-done={card.status === 'done' || undefined}
                style={{
                  background: 'transparent',
                  border: 'none',
                  padding: 0,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  marginTop: '2px',
                  transition: 'all 250ms cubic-bezier(0.4, 0, 0.2, 1)',
                  opacity: (hovered || card.status === 'done') ? 1 : 0,
                  width: (hovered || card.status === 'done') ? '14px' : '0px',
                  marginRight: (hovered || card.status === 'done') ? '8px' : '0px',
                  overflow: 'hidden',
                  pointerEvents: (hovered || card.status === 'done') ? 'auto' : 'none',
                  flexShrink: 0
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
              )}

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

              {/* the whole card drags, this only signals it */}
              <div
                aria-hidden
                style={{
                  color: hovered ? (isFullCover ? coverTextColor : 'var(--color-text-muted)') : 'transparent',
                  cursor: 'grab',
                  padding: '2px',
                  borderRadius: 'var(--radius-sm)',
                  display: 'flex',
                  alignItems: 'center'
                }}
                title="Drag from anywhere on the card"
              >
                <GripVertical size={14} />
              </div>
            </div>
          </div>

          {display.bodyPreview && card.body && (
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

          {display.tags && card.tags && card.tags.length > 0 && (
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

          {(showDue || showChecklist || showTemplate) && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-start',
              minHeight: '20px',
              marginTop: '4px',
              gap: '6px',
              flexWrap: 'wrap'
            }}>
              {showDue && (
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

              {showChecklist && (
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

              {showTemplate && (
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
      // drag never arms from a button, a shaky Delete press would pick the card up
      onPointerDown={e => e.stopPropagation()}
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

// memoized apart: dnd-kit re-renders every sortable when a drag starts and whenever the card under the pointer changes
const MemoCardFace = React.memo(CardFace)

function KanbanCard({ isOverlay = false, ...face }: KanbanCardProps) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({ id: face.card.id, disabled: isOverlay })
  // the overlay copy only borrows the look, it has no place in a list
  if (isOverlay) return <MemoCardFace {...face} isDragging={false} />
  return (
    // sorting restyles every card's transform and transition, so they live out here where the face memo can't see them
    <div
      ref={setNodeRef}
      // pointer only: the face's keydown always overrode dnd-kit's keyboard pickup
      onPointerDown={listeners?.onPointerDown as React.PointerEventHandler<HTMLDivElement> | undefined}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        position: 'relative',
        zIndex: isDragging ? 999 : 1,
        flexShrink: 0
      }}
    >
      <MemoCardFace {...face} dragAttributes={attributes} isDragging={isDragging} />
    </div>
  )
}

export default React.memo(KanbanCard)
