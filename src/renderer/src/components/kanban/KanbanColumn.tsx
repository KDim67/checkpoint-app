import React, { useState } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import KanbanCard from './KanbanCard'
import { Trash2, Edit2, Check, Plus, X, GripVertical } from 'lucide-react'
import type { Item } from '../../../../shared/types'

interface KanbanColumnProps {
  id: string
  name: string
  wipLimit: number | null
  cards: Item[]
  onRename: (id: string, newName: string) => void
  onDelete: (id: string) => void
  onCardClick: (id: string) => void
  onCardDelete: (id: string) => void
  onCardConvertToTask: (id: string) => void
  onAddCard?: (columnId: string) => void
  dragHandleProps?: React.HTMLAttributes<HTMLDivElement>
}

export default function KanbanColumn({
  id,
  name,
  wipLimit,
  cards,
  onRename,
  onDelete,
  onCardClick,
  onCardDelete,
  onCardConvertToTask,
  onAddCard,
  dragHandleProps
}: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id })

  const [isEditing, setIsEditing] = useState(false)
  const [editName, setEditName] = useState(name)
  const [headerHover, setHeaderHover] = useState(false)

  const handleRenameSubmit = () => {
    setIsEditing(false)
    if (editName.trim() && editName.trim() !== name) {
      onRename(id, editName.trim())
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') handleRenameSubmit()
    if (e.key === 'Escape') {
      setIsEditing(false)
      setEditName(name)
    }
  }

  const isWipExceeded = wipLimit !== null && cards.length > wipLimit
  const cardIds = cards.map(c => c.id)

  // System default columns cannot be deleted
  const isDefaultCol = id === 'open' || id === 'done' || id === 'in_progress' || id === 'in_review'

  // Column status color accent
  const statusAccent: Record<string, string> = {
    open:        '#535e85',
    in_progress: '#3b82f6',
    in_review:   '#f97316',
    done:        '#10b981'
  }
  const accentColor = isWipExceeded
    ? 'var(--color-warning)'
    : (statusAccent[id] ?? 'var(--color-primary)')

  return (
    <div
      style={{
        width: '300px',
        minWidth: '280px',
        maxWidth: '340px',
        flex: '0 0 300px',
        background: isOver
          ? 'var(--color-surface-2)'
          : 'var(--color-surface-1)',
        borderRadius: 'var(--radius-lg)',
        border: isOver
          ? `1px solid ${accentColor}`
          : '1px solid var(--color-surface-offset)',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        maxHeight: '100%',
        transition: 'background 150ms ease, border-color 150ms ease',
        overflow: 'hidden',
        boxShadow: isOver
          ? `0 0 0 2px ${accentColor}30, var(--shadow-sm)`
          : 'var(--shadow-sm)'
      }}
    >
      {/* Column top accent bar */}
      <div style={{
        height: '3px',
        background: accentColor,
        flexShrink: 0,
        borderRadius: 'var(--radius-lg) var(--radius-lg) 0 0'
      }} />

      {/* Column Header */}
      <div
        onMouseEnter={() => setHeaderHover(true)}
        onMouseLeave={() => setHeaderHover(false)}
        style={{
          padding: '10px var(--space-4) 10px var(--space-3)',
          borderBottom: '1px solid var(--color-surface-offset)',
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-2)',
          background: 'transparent',
          flexShrink: 0
        }}
      >
        {/* Column drag handle */}
        <div
          {...dragHandleProps}
          style={{
            color: headerHover ? 'var(--color-balance)' : 'transparent',
            cursor: 'grab',
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            transition: 'color 100ms ease'
          }}
        >
          <GripVertical size={14} />
        </div>

        {/* Title / Edit Input */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {isEditing ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <input
                type="text"
                value={editName}
                onChange={e => setEditName(e.target.value)}
                onBlur={handleRenameSubmit}
                onKeyDown={handleKeyDown}
                autoFocus
                style={{
                  background: 'var(--color-surface-2)',
                  border: `1px solid ${accentColor}`,
                  color: 'var(--color-text-base)',
                  borderRadius: '4px',
                  padding: '3px 8px',
                  fontSize: 'var(--text-xs)',
                  fontWeight: 'var(--weight-bold)',
                  outline: 'none',
                  width: '100%',
                  letterSpacing: 'var(--tracking-wide)',
                  textTransform: 'uppercase'
                }}
              />
              <button
                onMouseDown={handleRenameSubmit}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--color-secondary)',
                  cursor: 'pointer',
                  display: 'flex',
                  padding: '2px',
                  flexShrink: 0
                }}
              >
                <Check size={13} />
              </button>
              <button
                onMouseDown={() => { setIsEditing(false); setEditName(name) }}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--color-text-muted)',
                  cursor: 'pointer',
                  display: 'flex',
                  padding: '2px',
                  flexShrink: 0
                }}
              >
                <X size={13} />
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <h3
                onDoubleClick={() => setIsEditing(true)}
                title="Double-click to rename"
                style={{
                  margin: 0,
                  fontSize: 'var(--text-2xs)',
                  fontWeight: 'var(--weight-bold)',
                  color: isWipExceeded ? 'var(--color-warning)' : 'var(--color-text-muted)',
                  textTransform: 'uppercase',
                  letterSpacing: 'var(--tracking-widest)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  cursor: 'pointer',
                  userSelect: 'none'
                }}
              >
                {name}
              </h3>

              {/* Card count badge */}
              <span style={{
                fontSize: '10px',
                fontWeight: 'var(--weight-bold)',
                background: isWipExceeded
                  ? 'var(--color-warning)'
                  : 'var(--color-surface-offset)',
                color: isWipExceeded
                  ? 'var(--color-text-inverted)'
                  : 'var(--color-text-muted)',
                padding: '1px 6px',
                borderRadius: 'var(--radius-full)',
                flexShrink: 0,
                lineHeight: '16px'
              }}>
                {cards.length}
                {wipLimit !== null && ` / ${wipLimit}`}
              </span>
            </div>
          )}
        </div>

        {/* Column action buttons (visible on header hover) */}
        {!isEditing && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '2px',
            opacity: headerHover ? 1 : 0,
            transition: 'opacity 100ms ease',
            flexShrink: 0
          }}>
            <HeaderBtn title="Rename" onClick={() => setIsEditing(true)}>
              <Edit2 size={11} />
            </HeaderBtn>
            {!isDefaultCol && (
              <HeaderBtn title="Delete Column" onClick={() => onDelete(id)} danger>
                <Trash2 size={11} />
              </HeaderBtn>
            )}
          </div>
        )}
      </div>

      {/* Cards Area */}
      <div
        ref={setNodeRef}
        style={{
          flex: 1,
          padding: 'var(--space-3)',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-2)',
          minHeight: '80px'
        }}
      >
        <SortableContext items={cardIds} strategy={verticalListSortingStrategy}>
          {cards.map(card => (
            <KanbanCard
              key={card.id}
              card={card}
              onClick={onCardClick}
              onDelete={onCardDelete}
              onConvertToTask={onCardConvertToTask}
            />
          ))}
        </SortableContext>

        {cards.length === 0 && (
          <div style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: `2px dashed var(--color-surface-offset)`,
            borderRadius: 'var(--radius-md)',
            color: 'var(--color-text-faint)',
            fontSize: 'var(--text-xs)',
            textAlign: 'center',
            padding: 'var(--space-8) var(--space-4)',
            userSelect: 'none',
            minHeight: '80px',
            background: isOver ? `${accentColor}08` : 'transparent',
            transition: 'background 150ms ease, border-color 150ms ease',
            borderColor: isOver ? `${accentColor}60` : undefined
          }}>
            {isOver ? '✦ Drop here' : 'No cards yet'}
          </div>
        )}
      </div>

      {/* Add Card Footer */}
      {onAddCard && (
        <AddCardFooter onAdd={() => onAddCard(id)} accentColor={accentColor} />
      )}
    </div>
  )
}

function HeaderBtn({
  children, title, onClick, danger = false
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
        padding: '4px',
        borderRadius: '4px',
        display: 'flex',
        alignItems: 'center',
        transition: 'background 100ms ease, color 100ms ease'
      }}
    >
      {children}
    </button>
  )
}

function AddCardFooter({ onAdd, accentColor }: { onAdd: () => void; accentColor: string }) {
  const [hover, setHover] = useState(false)
  return (
    <button
      onClick={onAdd}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        margin: 'var(--space-2) var(--space-3) var(--space-3)',
        padding: 'var(--space-2)',
        background: hover ? 'var(--color-surface-2)' : 'transparent',
        border: `1px dashed ${hover ? accentColor + '80' : 'var(--color-surface-offset)'}`,
        borderRadius: 'var(--radius-md)',
        color: hover ? 'var(--color-text-muted)' : 'var(--color-text-faint)',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 'var(--space-1-5)',
        fontSize: 'var(--text-xs)',
        fontWeight: 'var(--weight-medium)',
        transition: 'background 120ms ease, border-color 120ms ease, color 120ms ease',
        flexShrink: 0
      }}
    >
      <Plus size={13} />
      Add card
    </button>
  )
}
