import React, { useState, useEffect, useRef } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import KanbanCard from './KanbanCard'
import ColorPicker from '../ui/ColorPicker'
import { Trash2, Edit2, Check, Plus, X, GripVertical, MoreHorizontal, ChevronRight } from 'lucide-react'
import type { Item } from '../../../../shared/types'
import { sameCardDisplay, type CardDisplay, type ColumnSort } from '../../lib/boardConfig'
import { getTextColorForBackground } from '../../lib/contrast'
import { useConfirm } from '../ui/ConfirmDialog'

interface KanbanColumnProps {
  id: string
  name: string
  wipLimit: number | null
  color?: string
  colorMode?: 'header' | 'full'
  cards: Item[]
  onRename: (id: string, newName: string, newWipLimit: number | null, color?: string, colorMode?: 'header' | 'full') => void
  onDelete: (id: string) => void
  onCardClick: (id: string) => void
  onCardDelete: (id: string) => void
  onCardConvertToTask: (id: string) => void
  onAddCard?: (columnId: string) => void
  dragHandleProps?: React.HTMLAttributes<HTMLDivElement>
  onCardUpdate?: (id: string, patch: Partial<Item>) => Promise<void>
  onClearColumn?: (columnId: string) => void
  onArchiveColumn?: (columnId: string) => void
  isReadOnly?: boolean
  /** Collapsed to a narrow strip; cards stay in place, just hidden. */
  collapsed?: boolean
  onToggleCollapse?: (columnId: string) => void
  /** Persistent display order for this column. */
  sort?: ColumnSort
  onSetSort?: (columnId: string, sort: ColumnSort) => void
  /** Definition of done, shown under the column name. */
  description?: string
  /** Board-level card face switches, forwarded to every card. */
  cardDisplay?: CardDisplay
  /** Where to hold a gap open for the card in the air. null for nowhere. */
  dropSlot?: number | null
  /** The height that card had, so the gap is the footprint it will take. */
  dropHeight?: number
}

function MenuItem({ label, onClick, danger = false }: { label: string; onClick: () => void; danger?: boolean }) {
  const [hover, setHover] = useState(false)
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: hover ? 'var(--color-surface-offset)' : 'transparent',
        border: 'none',
        padding: '6px 12px',
        fontSize: '11px',
        color: danger ? 'var(--color-error)' : hover ? 'var(--color-text-base)' : 'var(--color-text-muted)',
        textAlign: 'left',
        cursor: 'pointer',
        display: 'block',
        width: '100%',
        outline: 'none',
        transition: 'background var(--duration-fast), color var(--duration-fast)'
      }}
    >
      {label}
    </button>
  )
}

/**
 * The space the card will land in.
 *
 * Cross-column dragging used to show nothing at all: the target column lit up
 * and the card teleported into place on drop. This is the missing half, drawn
 * as the same dashed outline the card leaves behind at its origin, so the two
 * ends of the move look like one gesture.
 *
 * Sized from the card actually being dragged rather than a guess, so the gap
 * is the footprint the card will really take.
 *
 * `warn` is the column saying the card will not fit under its WIP limit. Said
 * here rather than after the drop, while there is still a chance to aim
 * somewhere else.
 */
function DropPlaceholder({ height, warn }: { height: number; warn: boolean }) {
  return (
    <div
      aria-hidden
      className="card-drop-slot"
      style={{
        height: `${height}px`,
        flexShrink: 0,
        borderRadius: 'var(--radius-md)',
        border: `2px dashed ${warn ? 'var(--color-warning)' : 'var(--color-secondary)'}`,
        background: warn ? 'var(--color-warning-muted)' : 'var(--color-secondary-muted)'
      }}
    />
  )
}

function KanbanColumn({
  id,
  name,
  wipLimit,
  color,
  colorMode,
  cards,
  onRename,
  onDelete,
  onCardClick,
  onCardDelete,
  onCardConvertToTask,
  onAddCard,
  dragHandleProps,
  onCardUpdate,
  onClearColumn,
  onArchiveColumn,
  isReadOnly = false,
  collapsed = false,
  onToggleCollapse,
  sort = 'manual',
  onSetSort,
  description,
  cardDisplay,
  dropSlot = null,
  dropHeight = 0
}: KanbanColumnProps) {
  const { setNodeRef, isOver: pointedAt } = useDroppable({ id })
  const confirm = useConfirm()

  const [isEditing, setIsEditing] = useState(false)
  const [editName, setEditName] = useState(name)
  const [editWip, setEditWip] = useState<number | null>(wipLimit)
  const [editColor, setEditColor] = useState<string | undefined>(color)
  const [editColorMode, setEditColorMode] = useState<'header' | 'full'>(colorMode || 'header')
  const [headerHover, setHeaderHover] = useState(false)
  const [showMenu, setShowMenu] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // Guard against double-submit (onBlur + onMouseDown both firing on confirm click)
  const saveInProgressRef = React.useRef(false)

  // Close dropdown on click outside
  useEffect(() => {
    if (!showMenu) return
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showMenu])

  // Keep editName in sync if parent renames column externally
  useEffect(() => { setEditName(name) }, [name])
  useEffect(() => { setEditWip(wipLimit) }, [wipLimit])
  useEffect(() => { setEditColor(color) }, [color])
  useEffect(() => { setEditColorMode(colorMode || 'header') }, [colorMode])

  const handleRenameSubmit = () => {
    if (saveInProgressRef.current) return
    saveInProgressRef.current = true
    setIsEditing(false)
    if (editName.trim()) {
      onRename(id, editName.trim(), editWip, editColor, editColorMode)
    } else {
      setEditName(name)
      setEditWip(wipLimit)
      setEditColor(color)
      setEditColorMode(colorMode || 'header')
    }
    // Reset guard after a tick so next edit session works
    setTimeout(() => { saveInProgressRef.current = false }, 0)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') handleRenameSubmit()
    if (e.key === 'Escape') {
      setIsEditing(false)
      setEditName(name)
      setEditWip(wipLimit)
      setEditColor(color)
      setEditColorMode(colorMode || 'header')
    }
  }

  const isWipExceeded = wipLimit !== null && cards.length > wipLimit
  const cardIds = cards.map(c => c.id)

  /**
   * This column is where the card would land.
   *
   * The droppable only counts the pointer as being on the column when it is not
   * on one of the cards, which past the first card is almost never. Holding a
   * gap open is the same statement, so the column lights up for both and a drag
   * across the board reads the same wherever in a column it is aimed.
   */
  const isOver = pointedAt || dropSlot !== null

  // A card is on its way in and the column is already at its limit. Warned on
  // the gap itself rather than only counted afterwards.
  const dropExceedsWip = dropSlot !== null && wipLimit !== null && cards.length >= wipLimit

  // Roughly one line of card, for a drag whose rect was never measured.
  const slotHeight = dropHeight > 0 ? dropHeight : 56

  // System default columns cannot be deleted
  const isDefaultCol = id === 'open' || id === 'done' || id === 'in_progress' || id === 'in_review'

  // Column status color accent
  const statusAccent: Record<string, string> = {
    open:        '#535e85',
    in_progress: '#3b82f6',
    in_review:   '#f97316',
    done:        '#10b981'
  }

  const activeColor = editColor !== undefined ? editColor : color
  const activeColorMode = editColorMode || colorMode || 'header'
  const isFullCol = activeColorMode === 'full' && !!activeColor
  const accentColor = isWipExceeded
    ? 'var(--color-warning)'
    : (activeColor || statusAccent[id] || 'var(--color-primary)')
  const colTextColor = isFullCol ? getTextColorForBackground(activeColor) : 'var(--color-text-muted)'

  // Collapsed: a narrow vertical strip carrying only the name and count. The
  // droppable ref stays attached so a card can still be dragged onto a
  // collapsed column rather than forcing the user to expand it first.
  if (collapsed) {
    return (
      <div
        ref={setNodeRef}
        id={`kanban-col-${id}`}
        style={{
          width: '48px',
          minWidth: '48px',
          flex: '0 0 48px',
          backgroundColor: isOver ? 'var(--color-surface-2)' : 'var(--color-surface-1)',
          borderRadius: 'var(--radius-lg)',
          border: isOver ? `1px solid ${accentColor}` : '1px solid var(--color-surface-offset)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          height: '100%',
          overflow: 'hidden',
          boxShadow: 'var(--shadow-sm)'
        }}
      >
        <div style={{ height: '3px', width: '100%', backgroundColor: accentColor, flexShrink: 0 }} />
        <button
          onClick={() => onToggleCollapse?.(id)}
          aria-label={`Expand ${name} column`}
          title={`Expand ${name}`}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--color-text-muted)',
            cursor: 'pointer',
            padding: 'var(--space-2) 0',
            width: '100%',
            display: 'flex',
            justifyContent: 'center'
          }}
        >
          <ChevronRight size={14} />
        </button>
        <div
          style={{
            fontSize: 'var(--text-xs)',
            fontWeight: 'var(--weight-semibold)',
            color: 'var(--color-text-base)',
            // Rotated so a long column name still reads in a 48px strip.
            writingMode: 'vertical-rl',
            transform: 'rotate(180deg)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            maxHeight: '60%',
            marginTop: 'var(--space-2)'
          }}
        >
          {name}
        </div>
        <div style={{
          marginTop: 'auto',
          marginBottom: 'var(--space-3)',
          fontSize: 'var(--text-xs)',
          fontWeight: 'var(--weight-semibold)',
          color: 'var(--color-text-muted)',
          fontVariantNumeric: 'tabular-nums'
        }}>
          {cards.length}
        </div>
      </div>
    )
  }

  return (
    <div
      // The whole column, not just the list inside it. A pointer over the
      // header or the Add card button is still aimed at this column, and the
      // drop logic reads the column's rectangle to decide which one that is.
      ref={setNodeRef}
      id={`kanban-col-${id}`}
      style={{
        width: '300px',
        minWidth: '280px',
        maxWidth: '340px',
        flex: '0 0 300px',
        backgroundColor: isOver
          ? 'var(--color-surface-2)'
          : (isFullCol ? activeColor : 'var(--color-surface-1)'),
        borderRadius: 'var(--radius-lg)',
        border: isOver
          ? `1px solid ${accentColor}`
          : (isFullCol ? `1px solid ${activeColor}` : '1px solid var(--color-surface-offset)'),
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        maxHeight: '100%',
        minHeight: 0,
        transition: isOver ? 'none' : 'background-color 150ms ease, border-color 150ms ease',
        overflow: 'hidden',
        boxShadow: isOver
          ? `0 0 0 2px ${accentColor}30, var(--shadow-sm)`
          : 'var(--shadow-sm)'
      }}
    >
      {/* Column top accent bar */}
      <div
        className="col-top-bar"
        style={{
          height: '3px',
          backgroundColor: isFullCol ? 'transparent' : accentColor,
          flexShrink: 0,
          borderRadius: 'var(--radius-lg) var(--radius-lg) 0 0'
        }}
      />

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
            color: headerHover ? (isFullCol ? colTextColor : 'var(--color-balance)') : (isFullCol ? colTextColor + '80' : 'transparent'),
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%', padding: '2px 0' }}>
              {/* Row 1: Name, WIP, Save, Cancel */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', width: '100%' }}>
                <input
                  type="text"
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                  onKeyDown={handleKeyDown}
                  autoFocus
                  placeholder="Column Name"
                  style={{
                    flex: 1,
                    background: 'var(--color-surface-2)',
                    border: `1px solid ${accentColor}`,
                    color: 'var(--color-text-base)',
                    borderRadius: '4px',
                    padding: '4px 8px',
                    fontSize: 'var(--text-xs)',
                    fontWeight: 'var(--weight-bold)',
                    outline: 'none',
                    letterSpacing: 'var(--tracking-wide)',
                    textTransform: 'uppercase'
                  }}
                />
                <input
                  type="number"
                  value={editWip ?? ''}
                  onChange={e => {
                    const val = e.target.value
                    setEditWip(val === '' ? null : Math.max(0, parseInt(val)))
                  }}
                  onKeyDown={handleKeyDown}
                  placeholder="WIP"
                  title="WIP Limit (optional)"
                  style={{
                    width: '50px',
                    background: 'var(--color-surface-2)',
                    border: `1px solid ${accentColor}`,
                    color: 'var(--color-text-base)',
                    borderRadius: '4px',
                    padding: '4px 4px',
                    fontSize: 'var(--text-xs)',
                    fontWeight: 'var(--weight-bold)',
                    outline: 'none'
                  }}
                />
                <button
                  onMouseDown={handleRenameSubmit}
                  title="Save Column Changes"
                  style={{
                    background: 'var(--color-secondary)',
                    border: 'none',
                    color: '#ffffff',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '4px 6px',
                    borderRadius: '4px',
                    flexShrink: 0
                  }}
                >
                  <Check size={13} strokeWidth={2.5} />
                </button>
                <button
                  onMouseDown={() => {
                    setIsEditing(false)
                    setEditName(name)
                    setEditWip(wipLimit)
                    setEditColor(color)
                    setEditColorMode(colorMode || 'header')
                  }}
                  title="Cancel"
                  style={{
                    background: 'transparent',
                    border: '1px solid var(--color-surface-offset)',
                    color: 'var(--color-text-muted)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '4px 6px',
                    borderRadius: '4px',
                    flexShrink: 0
                  }}
                >
                  <X size={13} />
                </button>
              </div>

              {/* Row 2: Display Mode & Color Swatches */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', background: 'var(--color-surface-2)', padding: '6px 8px', borderRadius: '6px', border: '1px solid var(--color-surface-offset)' }}>
                <div className="row-between">
                  <span style={{ fontSize: '9px', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    Theme & Display Mode
                  </span>
                </div>

                <div style={{ display: 'flex', gap: '4px' }}>
                  <button
                    type="button"
                    onClick={() => {
                      setEditColorMode('header')
                      onRename(id, editName.trim() || name, editWip, editColor, 'header')
                    }}
                    style={{
                      flex: 1,
                      padding: '3px 6px',
                      fontSize: '10px',
                      fontWeight: 'var(--weight-bold)',
                      borderRadius: '4px',
                      border: (editColorMode !== 'full') ? '1px solid var(--color-secondary)' : '1px solid var(--color-surface-offset)',
                      background: (editColorMode !== 'full') ? 'var(--color-secondary)' : 'transparent',
                      color: (editColorMode !== 'full') ? '#0f172a' : 'var(--color-text-base)',
                      cursor: 'pointer'
                    }}
                  >
                    Header Accent
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditColorMode('full')
                      onRename(id, editName.trim() || name, editWip, editColor, 'full')
                    }}
                    style={{
                      flex: 1,
                      padding: '3px 6px',
                      fontSize: '10px',
                      fontWeight: 'var(--weight-bold)',
                      borderRadius: '4px',
                      border: (editColorMode === 'full') ? '1px solid var(--color-secondary)' : '1px solid var(--color-surface-offset)',
                      background: (editColorMode === 'full') ? 'var(--color-secondary)' : 'transparent',
                      color: (editColorMode === 'full') ? '#0f172a' : 'var(--color-text-base)',
                      cursor: 'pointer'
                    }}
                  >
                    Full Column Fill
                  </button>
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', alignItems: 'center', marginTop: '2px' }}>
                  {['none', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#a855f7', '#ec4899'].map(cVal => (
                    <button
                      type="button"
                      key={cVal}
                      onClick={() => {
                        const nextCol = cVal === 'none' ? undefined : cVal
                        setEditColor(nextCol)
                        onRename(id, editName.trim() || name, editWip, nextCol, editColorMode)
                      }}
                      style={{
                        width: '18px',
                        height: '18px',
                        borderRadius: '4px',
                        background: cVal === 'none' ? 'transparent' : cVal,
                        border: (editColor === cVal || (cVal === 'none' && !editColor)) ? '2px solid var(--color-text-base)' : (cVal === 'none' ? '1px dashed var(--color-text-muted)' : '1px solid transparent'),
                        cursor: 'pointer',
                        padding: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '9px',
                        color: 'var(--color-text-base)'
                      }}
                      title={cVal === 'none' ? 'Default Accent' : cVal}
                    >
                      {cVal === 'none' && '×'}
                    </button>
                  ))}
                  <ColorPicker
                    value={editColor || ''}
                    onLiveDomUpdate={cVal => {
                      const colEl = document.getElementById(`kanban-col-${id}`)
                      if (colEl) {
                        if (editColorMode === 'full') colEl.style.backgroundColor = cVal
                        else {
                          const bar = colEl.querySelector('.col-top-bar') as HTMLElement
                          if (bar) bar.style.backgroundColor = cVal
                        }
                      }
                    }}
                    onCommit={cVal => {
                      const nextCol = cVal || undefined
                      setEditColor(nextCol)
                      onRename(id, editName.trim() || name, editWip, nextCol, editColorMode)
                    }}
                    swatchSize={20}
                    hexInputWidth={58}
                  />
                </div>
              </div>

              {!isDefaultCol && (
                <div style={{ marginTop: '6px', paddingTop: '6px', borderTop: '1px solid var(--color-surface-offset)', display: 'flex', justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    onClick={async () => {
                      const confirmed = await confirm({
                        title: 'Delete column',
                        message: `Are you sure you want to delete the column "${name}"?`,
                        confirmText: 'Delete Column',
                        isDestructive: true
                      })
                      if (confirmed) {
                        onDelete(id)
                        setIsEditing(false)
                      }
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      padding: '4px 8px',
                      fontSize: '10px',
                      fontWeight: 'bold',
                      color: 'var(--color-error)',
                      background: 'rgba(239, 68, 68, 0.1)',
                      border: '1px solid rgba(239, 68, 68, 0.3)',
                      borderRadius: '4px',
                      cursor: 'pointer'
                    }}
                  >
                    <Trash2 size={11} />
                    <span>Delete Column</span>
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="row">
              <h3
                onDoubleClick={() => setIsEditing(true)}
                style={{
                  margin: 0,
                  fontSize: 'var(--text-2xs)',
                  fontWeight: 'var(--weight-bold)',
                  color: isWipExceeded ? 'var(--color-warning)' : colTextColor,
                  textTransform: 'uppercase',
                  letterSpacing: 'var(--tracking-widest)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  cursor: 'pointer',
                  userSelect: 'none'
                }}
                // The definition of done rides on the name's tooltip rather
                // than taking a second header row, which would cost vertical
                // space on every column to serve an occasional glance. The
                // rename affordance stays in the tooltip when there is no
                // description to show instead.
                title={description ? `${name}, ${description}` : 'Double-click to rename'}
              >
                {name}
              </h3>

              {/* Card count badge */}
              <span style={{
                fontSize: '10px',
                fontWeight: 'var(--weight-bold)',
                background: isWipExceeded
                  ? 'var(--color-warning)'
                  : (isFullCol ? (colTextColor === '#ffffff' ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.15)') : 'var(--color-surface-offset)'),
                color: isWipExceeded
                  ? 'var(--color-text-inverted)'
                  : colTextColor,
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
        {!isEditing && !isReadOnly && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '2px',
            opacity: headerHover || showMenu ? 1 : 0,
            transition: 'opacity 100ms ease',
            flexShrink: 0
          }}>
            <HeaderBtn title="Rename & Settings" onClick={() => setIsEditing(true)} colTextColor={isFullCol ? colTextColor : undefined}>
              <Edit2 size={11} />
            </HeaderBtn>
            
            {/* Column Actions Dropdown */}
            <div style={{ position: 'relative' }} ref={menuRef}>
              <HeaderBtn title="List Actions" onClick={() => setShowMenu(!showMenu)} colTextColor={isFullCol ? colTextColor : undefined}>
                <MoreHorizontal size={11} />
              </HeaderBtn>
              
              {showMenu && (
                <div style={{
                  position: 'absolute',
                  top: '100%',
                  right: 0,
                  marginTop: '4px',
                  background: 'var(--color-surface-elevated)',
                  border: '1px solid var(--color-surface-offset)',
                  borderRadius: 'var(--radius-md)',
                  boxShadow: 'var(--shadow-md)',
                  minWidth: '180px',
                  zIndex: 150,
                  display: 'flex',
                  flexDirection: 'column',
                  padding: '6px 0'
                }}>
                  {/* A persistent view order, not a one-off reshuffle. The
                      previous entries here rewrote every card's position, so
                      picking a sort permanently destroyed the manual order and
                      there was no way back to it. */}
                  <MenuItem
                    label={`${sort === 'manual' ? '✓ ' : ''}Order: Manual`}
                    onClick={() => { onSetSort?.(id, 'manual'); setShowMenu(false) }}
                  />
                  <MenuItem
                    label={`${sort === 'priority' ? '✓ ' : ''}Order: Priority`}
                    onClick={() => { onSetSort?.(id, 'priority'); setShowMenu(false) }}
                  />
                  <MenuItem
                    label={`${sort === 'due' ? '✓ ' : ''}Order: Due Date`}
                    onClick={() => { onSetSort?.(id, 'due'); setShowMenu(false) }}
                  />
                  <div style={{ height: '1px', background: 'var(--color-surface-offset)', margin: '4px 0' }} />
                  <MenuItem
                    label="Collapse Column"
                    onClick={() => { onToggleCollapse?.(id); setShowMenu(false) }}
                  />
                  <div style={{ height: '1px', background: 'var(--color-surface-offset)', margin: '4px 0' }} />
                  <MenuItem
                    label="Archive All Cards"
                    onClick={async () => {
                      const confirmed = await confirm({
                        title: 'Archive column',
                        message: 'Archive all cards in this column?',
                        confirmText: 'Archive'
                      })
                      if (confirmed) {
                        onClearColumn?.(id)
                        setShowMenu(false)
                      }
                    }}
                  />
                  <MenuItem
                    label="Archive List"
                    onClick={() => { onArchiveColumn?.(id); setShowMenu(false) }}
                  />
                  {!isDefaultCol && (
                    <>
                      <div style={{ height: '1px', background: 'var(--color-surface-offset)', margin: '4px 0' }} />
                      <MenuItem
                        label="Delete Column"
                        onClick={() => { onDelete(id); setShowMenu(false) }}
                        danger
                      />
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* WIP-limit progress bar. Visualizes how full the column is vs its limit */}
      {wipLimit !== null && wipLimit > 0 && (
        <div style={{ height: '3px', margin: '0 var(--space-3) 2px', background: 'var(--color-surface-offset)', borderRadius: '2px', overflow: 'hidden', flexShrink: 0 }}>
          <div style={{
            height: '100%',
            width: `${Math.min(100, (cards.length / wipLimit) * 100)}%`,
            background: isWipExceeded ? 'var(--color-warning)' : accentColor,
            transition: 'width 200ms ease, background-color 200ms ease'
          }} />
        </div>
      )}

      {/* Cards Area */}
      <div
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
          {cards.map((card, i) => (
            <React.Fragment key={card.id}>
              {dropSlot === i && <DropPlaceholder height={slotHeight} warn={dropExceedsWip} />}
              <KanbanCard
                card={card}
                onClick={onCardClick}
                onDelete={onCardDelete}
                onConvertToTask={onCardConvertToTask}
                onUpdate={onCardUpdate}
                display={cardDisplay}
              />
            </React.Fragment>
          ))}
          {dropSlot === cards.length && <DropPlaceholder height={slotHeight} warn={dropExceedsWip} />}
        </SortableContext>


        {cards.length === 0 && (
          <div style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: `2px dashed ${isFullCol ? (colTextColor === '#ffffff' ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.2)') : 'var(--color-surface-offset)'}`,
            borderRadius: 'var(--radius-md)',
            color: isFullCol ? colTextColor : 'var(--color-text-faint)',
            fontSize: 'var(--text-xs)',
            fontWeight: isFullCol ? 'var(--weight-medium)' : 'normal',
            textAlign: 'center',
            padding: 'var(--space-8) var(--space-4)',
            userSelect: 'none',
            minHeight: '80px',
            background: isOver ? `${accentColor}08` : 'transparent',
            transition: isOver ? 'none' : 'background 150ms ease, border-color 150ms ease',
            borderColor: isOver ? `${accentColor}60` : undefined
          }}>
            {isOver ? '✦ Drop here' : 'No cards yet'}
          </div>
        )}
      </div>

      {/* Add Card Footer */}
      {onAddCard && !isReadOnly && (
        <AddCardFooter onAdd={() => onAddCard(id)} accentColor={accentColor} colTextColor={isFullCol ? colTextColor : undefined} isFullCol={isFullCol} />
      )}
    </div>
  )
}

function HeaderBtn({
  children, title, onClick, danger = false, colTextColor
}: {
  children: React.ReactNode
  title: string
  onClick: () => void
  danger?: boolean
  colTextColor?: string
}) {
  const [hover, setHover] = useState(false)
  const textColor = colTextColor || 'var(--color-text-muted)'
  return (
    <button
      title={title}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: hover
          ? (danger ? 'rgba(239,68,68,0.15)' : (colTextColor ? (colTextColor === '#ffffff' ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.15)') : 'var(--color-surface-offset)'))
          : 'transparent',
        border: 'none',
        color: hover
          ? (danger ? 'var(--color-error)' : (colTextColor || 'var(--color-text-base)'))
          : textColor,
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

function AddCardFooter({ onAdd, accentColor, colTextColor, isFullCol }: { onAdd: () => void; accentColor: string; colTextColor?: string; isFullCol?: boolean }) {
  const [hover, setHover] = useState(false)
  const textColor = isFullCol ? colTextColor : (hover ? 'var(--color-text-muted)' : 'var(--color-text-faint)')
  const borderColor = isFullCol
    ? (colTextColor === '#ffffff' ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.3)')
    : (hover ? accentColor + '80' : 'var(--color-surface-offset)')
  const bg = hover
    ? (isFullCol ? (colTextColor === '#ffffff' ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.1)') : 'var(--color-surface-2)')
    : 'transparent'

  return (
    <button
      onClick={onAdd}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        margin: 'var(--space-2) var(--space-3) var(--space-3)',
        padding: 'var(--space-2)',
        background: bg,
        border: `1px dashed ${borderColor}`,
        borderRadius: 'var(--radius-md)',
        color: textColor,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 'var(--space-1-5)',
        fontSize: 'var(--text-xs)',
        fontWeight: 'var(--weight-bold)',
        transition: 'background 120ms ease, border-color 120ms ease, color 120ms ease',
        flexShrink: 0
      }}
    >
      <Plus size={13} strokeWidth={2.5} />
      Add card
    </button>
  )
}

function areKanbanColumnPropsEqual(prev: KanbanColumnProps, next: KanbanColumnProps) {
  if (prev.isReadOnly !== next.isReadOnly) return false
  // Only the column under the pointer is given a slot, so a drag re-renders
  // that one column rather than every column on the board.
  if (prev.dropSlot !== next.dropSlot || prev.dropHeight !== next.dropHeight) return false
  if (prev.id !== next.id || prev.name !== next.name || prev.wipLimit !== next.wipLimit) return false
  if (prev.color !== next.color || prev.colorMode !== next.colorMode) return false
  // The second memo, and it dropped the same props the outer one did.
  if (prev.collapsed !== next.collapsed) return false
  if (prev.sort !== next.sort || prev.description !== next.description) return false
  if (!sameCardDisplay(prev.cardDisplay, next.cardDisplay)) return false
  if (prev.cards.length !== next.cards.length) return false
  for (let i = 0; i < prev.cards.length; i++) {
    if (prev.cards[i] !== next.cards[i]) return false
  }
  return true
}

export default React.memo(KanbanColumn, areKanbanColumnPropsEqual)
