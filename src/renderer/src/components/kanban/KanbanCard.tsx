import React, { useState } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Edit2, Trash2, ArrowRightLeft, Calendar, GripVertical } from 'lucide-react'
import type { Item } from '../../../../shared/types'

interface KanbanCardProps {
  card: Item
  onClick: (id: string) => void
  onDelete: (id: string) => void
  onConvertToTask: (id: string) => void
}

const PRIORITY_COLORS: Record<number, { bar: string; label: string; bg: string }> = {
  3: { bar: '#ef4444', label: 'High',   bg: 'rgba(239,68,68,0.08)' },
  2: { bar: '#f97316', label: 'Med',    bg: 'rgba(249,115,22,0.08)' },
  1: { bar: '#3b82f6', label: 'Low',    bg: 'rgba(59,130,246,0.08)' },
  0: { bar: 'transparent', label: '', bg: 'transparent' }
}

export default function KanbanCard({ card, onClick, onDelete, onConvertToTask }: KanbanCardProps) {
  const [hovered, setHovered] = useState(false)

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id: card.id })

  const priority = PRIORITY_COLORS[card.priority] ?? PRIORITY_COLORS[0]

  const cardStyle: React.CSSProperties = {
    transform: isDragging
      ? `${CSS.Transform.toString(transform) ?? ''} scale(1.02)`.trim()
      : CSS.Transform.toString(transform) ?? undefined,
    transition: isDragging ? transition : `${transition ?? ''}, box-shadow 120ms ease, transform 120ms ease`.trim(),
    opacity: isDragging ? 0.35 : 1,
    position: 'relative',
    display: 'flex',
    cursor: isDragging ? 'grabbing' : 'pointer',
    borderRadius: 'var(--radius-md)',
    border: hovered && !isDragging
      ? '1px solid var(--color-balance)'
      : '1px solid var(--color-surface-offset)',
    background: 'var(--color-surface-1)',
    boxShadow: isDragging
      ? '0 16px 32px rgba(0,0,0,0.5), 0 4px 8px rgba(0,0,0,0.3)'
      : hovered
        ? '0 4px 16px rgba(0,0,0,0.3), 0 1px 4px rgba(0,0,0,0.2)'
        : '0 1px 3px rgba(0,0,0,0.2)',
    zIndex: isDragging ? 999 : 1,
    overflow: 'hidden'
  }

  const truncatedBody = card.body.length > 100
    ? `${card.body.substring(0, 100)}...`
    : card.body

  const isOverdue = card.due_at && card.due_at < Date.now() && card.status !== 'done'
  const dueDateStr = card.due_at
    ? new Date(card.due_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    : null

  return (
    <div
      ref={setNodeRef}
      style={cardStyle}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => onClick(card.id)}
    >
      {/* Priority accent bar on left edge */}
      {card.priority > 0 && (
        <div style={{
          width: '3px',
          flexShrink: 0,
          background: priority.bar,
          borderRadius: '8px 0 0 8px'
        }} />
      )}

      {/* Main content */}
      <div style={{
        flex: 1,
        padding: 'var(--space-3) var(--space-3) var(--space-2-5) var(--space-3)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-2)',
        minWidth: 0
      }}>
        {/* Drag handle + title row */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-1-5)' }}>
          {/* Drag handle */}
          <div
            {...attributes}
            {...listeners}
            onClick={e => e.stopPropagation()}
            style={{
              color: hovered ? 'var(--color-balance)' : 'transparent',
              cursor: 'grab',
              flexShrink: 0,
              marginTop: '2px',
              transition: 'color 100ms ease'
            }}
          >
            <GripVertical size={14} />
          </div>

          <h4 style={{
            margin: 0,
            fontSize: 'var(--text-sm)',
            fontWeight: 'var(--weight-semibold)',
            color: 'var(--color-text-base)',
            lineHeight: 1.4,
            wordBreak: 'break-word',
            flex: 1
          }}>
            {card.title}
          </h4>
        </div>

        {/* Body preview */}
        {card.body && (
          <p style={{
            margin: 0,
            fontSize: 'var(--text-xs)',
            color: 'var(--color-text-muted)',
            lineHeight: 1.5,
            wordBreak: 'break-word',
            whiteSpace: 'pre-wrap',
            paddingLeft: '22px'  // align with title (past drag handle)
          }}>
            {truncatedBody}
          </p>
        )}

        {/* Tags */}
        {card.tags && card.tags.length > 0 && (
          <div style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '4px',
            paddingLeft: '22px'
          }}>
            {card.tags.map(tag => (
              <span
                key={tag.id}
                style={{
                  fontSize: '10px',
                  fontWeight: 'var(--weight-semibold)',
                  color: tag.color,
                  background: `${tag.color}18`,
                  border: `1px solid ${tag.color}30`,
                  padding: '1px 6px',
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

        {/* Footer: due date + actions */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingLeft: '22px',
          minHeight: '22px',
          marginTop: 'var(--space-1)'
        }}>
          {/* Due date */}
          {dueDateStr ? (
            <span style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '3px',
              fontSize: '10px',
              fontWeight: 'var(--weight-medium)',
              color: isOverdue ? 'white' : 'var(--color-text-faint)',
              backgroundColor: isOverdue ? 'var(--color-error)' : 'var(--color-surface-2)',
              padding: '2px 6px',
              borderRadius: '4px',
              border: isOverdue ? 'none' : '1px solid var(--color-surface-offset)'
            }}>
              <Calendar size={9} />
              {dueDateStr}
            </span>
          ) : (
            <div />
          )}

          {/* Quick-action buttons - fade in on hover */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '2px',
              opacity: hovered ? 1 : 0,
              transition: 'opacity 100ms ease'
            }}
            onClick={e => e.stopPropagation()}
            onMouseDown={e => e.stopPropagation()}
          >
            <ActionBtn title="Edit Card" onClick={() => onClick(card.id)}>
              <Edit2 size={11} />
            </ActionBtn>
            <ActionBtn title="Convert to Task" onClick={() => onConvertToTask(card.id)}>
              <ArrowRightLeft size={11} />
            </ActionBtn>
            <ActionBtn title="Delete Card" onClick={() => onDelete(card.id)} danger>
              <Trash2 size={11} />
            </ActionBtn>
          </div>
        </div>
      </div>
    </div>
  )
}

function ActionBtn({
  children,
  title,
  onClick,
  danger = false
}: {
  children: React.ReactNode
  title: string
  onClick: () => void
  danger?: boolean
}) {
  const [hover, setHover] = useState(false)
  return (
    <button
      title={title}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: hover
          ? danger ? 'rgba(239,68,68,0.15)' : 'var(--color-surface-offset)'
          : 'transparent',
        border: 'none',
        color: hover
          ? danger ? 'var(--color-error)' : 'var(--color-text-base)'
          : 'var(--color-text-muted)',
        cursor: 'pointer',
        padding: '3px 4px',
        borderRadius: '4px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'background 100ms ease, color 100ms ease'
      }}
    >
      {children}
    </button>
  )
}
