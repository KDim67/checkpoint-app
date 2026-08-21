import React, { useState } from 'react'
import { Check, Calendar, Link2 } from 'lucide-react'
import { useAppStore } from '../../store/appStore'
import type { Item } from '../../../../shared/types'
import { PRIORITY_ICONS, PRIORITY_LABELS } from '../../lib/priority'

interface BacklogRowProps {
  item: Item
  columns: Array<{ id: string; name: string }>
  visibleColumns: Record<string, boolean>
  columnWidths: Record<string, number>
  columnOrder: string[]
  isSelected: boolean
  onSelectToggle: (id: string, e: React.MouseEvent) => void
  onRowDoubleClick: (id: string) => void
  onUpdateField: (id: string, patch: Partial<Item>) => void
}

export default function BacklogRow({
  item,
  columns,
  visibleColumns,
  columnWidths,
  columnOrder,
  isSelected,
  onSelectToggle,
  onRowDoubleClick,
  onUpdateField
}: BacklogRowProps) {
  const [showStatusMenu, setShowStatusMenu] = useState(false)
  const [showPriorityMenu, setShowPriorityMenu] = useState(false)

  const handleStatusSelect = (statusId: string) => {
    onUpdateField(item.id, { status: statusId })
    setShowStatusMenu(false)
  }

  const handlePrioritySelect = (priorityNum: number) => {
    onUpdateField(item.id, { priority: priorityNum as Item['priority'] })
    setShowPriorityMenu(false)
  }

  const isOverdue = item.due_at && item.due_at < Date.now() && item.status !== 'done'
  const dueDateStr = item.due_at ? new Date(item.due_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '-'
  const createdDateStr = new Date(item.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

  // Read relations count from item metadata or pre-populated field
  const relationsCount = (item as Item & { relations_count?: number }).relations_count ?? 0

  const renderCell = (colKey: string) => {
    switch (colKey) {
      case 'status':
        const currentColumn = columns.find(c => c.id === item.status)
        const statusLabel = currentColumn ? currentColumn.name : item.status

        return (
          <div
            key={colKey}
            style={{
              width: columnWidths.status,
              padding: '0 var(--space-3)',
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              flexShrink: 0
            }}
          >
            <button
              aria-expanded={showStatusMenu}
              aria-haspopup="menu"
              onClick={() => setShowStatusMenu(!showStatusMenu)}
              style={{
                background: 'var(--color-surface-offset)',
                border: '1px solid var(--color-balance)',
                color: 'var(--color-text-base)',
                borderRadius: '4px',
                padding: '2px 8px',
                fontSize: '10px',
                fontWeight: 'var(--weight-semibold)',
                cursor: 'pointer',
                textAlign: 'left',
                textTransform: 'uppercase',
                maxWidth: '100%',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap'
              }}
            >
              {statusLabel}
            </button>

            {showStatusMenu && (
              <div style={{
                position: 'absolute',
                top: '100%',
                left: 'var(--space-3)',
                marginTop: '4px',
                background: 'var(--color-surface-elevated)',
                border: '1px solid var(--color-surface-offset)',
                borderRadius: 'var(--radius-md)',
                boxShadow: '0 4px 6px -1px rgba(0,0,0,0.3)',
                zIndex: 100,
                minWidth: '120px',
                display: 'flex',
                flexDirection: 'column',
                padding: '4px 0'
              }}>
                {columns.map(col => (
                  <button
                    key={col.id}
                    onClick={() => handleStatusSelect(col.id)}
                    style={{
                      background: item.status === col.id ? 'var(--color-surface-offset)' : 'transparent',
                      border: 'none',
                      color: 'var(--color-text-base)',
                      padding: 'var(--space-1.5) var(--space-3)',
                      fontSize: '11px',
                      textAlign: 'left',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between'
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-surface-offset)')}
                    onMouseLeave={e => (e.currentTarget.style.background = item.status === col.id ? 'var(--color-surface-offset)' : 'transparent')}
                  >
                    <span>{col.name}</span>
                    {item.status === col.id && <Check size={10} style={{ color: 'var(--color-secondary)' }} />}
                  </button>
                ))}
              </div>
            )}
          </div>
        )

      case 'priority':
        return (
          <div
            key={colKey}
            style={{
              width: columnWidths.priority,
              padding: '0 var(--space-3)',
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0
            }}
          >
            <button
              aria-expanded={showPriorityMenu}
              aria-haspopup="menu"
              onClick={() => setShowPriorityMenu(!showPriorityMenu)}
              title={`Priority: ${PRIORITY_LABELS[item.priority]}`}
              style={{
                background: 'transparent',
                border: '1px solid var(--color-surface-offset)',
                borderRadius: '4px',
                width: '24px',
                height: '24px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                padding: 0
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-surface-offset)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              {PRIORITY_ICONS[item.priority]}
            </button>

            {showPriorityMenu && (
              <div style={{
                position: 'absolute',
                top: '100%',
                left: '50%',
                transform: 'translateX(-50%)',
                marginTop: '4px',
                background: 'var(--color-surface-elevated)',
                border: '1px solid var(--color-surface-offset)',
                borderRadius: 'var(--radius-md)',
                boxShadow: '0 4px 6px -1px rgba(0,0,0,0.3)',
                zIndex: 100,
                minWidth: '100px',
                display: 'flex',
                flexDirection: 'column',
                padding: '4px 0'
              }}>
                {[3, 2, 1, 0].map(p => (
                  <button
                    key={p}
                    onClick={() => handlePrioritySelect(p)}
                    style={{
                      background: item.priority === p ? 'var(--color-surface-offset)' : 'transparent',
                      border: 'none',
                      color: 'var(--color-text-base)',
                      padding: 'var(--space-1.5) var(--space-3)',
                      fontSize: '11px',
                      textAlign: 'left',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 'var(--space-2)'
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-surface-offset)')}
                    onMouseLeave={e => (e.currentTarget.style.background = item.priority === p ? 'var(--color-surface-offset)' : 'transparent')}
                  >
                    {PRIORITY_ICONS[p]}
                    <span>{PRIORITY_LABELS[p]}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )

      case 'title':
        return (
          <div
            key={colKey}
            style={{
              width: columnWidths.title,
              padding: '0 var(--space-3)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 'var(--space-2)',
              overflow: 'hidden',
              flexShrink: 0
            }}
            className="backlog-title-cell"
          >
            <span
              onClick={() => onRowDoubleClick(item.id)}
              style={{
                color: 'var(--color-text-base)',
                fontWeight: 'var(--weight-semibold)',
                cursor: 'pointer',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                flex: 1
              }}
            >
              {item.title || 'Untitled Task'}
            </span>
            <button
              title="Start Pomodoro Focus Session"
              onClick={(e) => {
                e.stopPropagation()
                useAppStore.getState().setPreselectedTaskId(item.id)
                useAppStore.getState().setView('focus')
              }}
              className="backlog-play-btn"
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--color-secondary)',
                cursor: 'pointer',
                display: 'none',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '2px',
                borderRadius: '4px',
                transition: 'background var(--duration-fast)',
                flexShrink: 0
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-surface-offset)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="5 3 19 12 5 21 5 3"/>
              </svg>
            </button>
          </div>
        )

      case 'tags':
        return (
          <div
            key={colKey}
            style={{
              width: columnWidths.tags,
              padding: '0 var(--space-3)',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              overflow: 'hidden',
              whiteSpace: 'nowrap',
              flexWrap: 'nowrap',
              flexShrink: 0
            }}
          >
            {item.tags?.map(t => (
              <span
                key={t.id}
                style={{
                  fontSize: '9px',
                  fontWeight: 'var(--weight-semibold)',
                  color: t.color,
                  background: `${t.color}15`,
                  border: `1px solid ${t.color}25`,
                  padding: '1px 5px',
                  borderRadius: '4px',
                  whiteSpace: 'nowrap'
                }}
              >
                {t.name}
              </span>
            ))}
            {(!item.tags || item.tags.length === 0) && <span style={{ color: 'var(--color-text-faint)' }}>-</span>}
          </div>
        )

      case 'due_date':
        return (
          <div
            key={colKey}
            style={{
              width: columnWidths.due_date,
              padding: '0 var(--space-3)',
              color: isOverdue ? 'var(--color-error)' : 'var(--color-text-muted)',
              fontSize: 'var(--text-xs)',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              fontWeight: isOverdue ? 'var(--weight-semibold)' : 'var(--weight-normal)',
              flexShrink: 0
            }}
          >
            {item.due_at && <Calendar size={11} />}
            <span>{dueDateStr}</span>
          </div>
        )

      case 'created_at':
        return (
          <div
            key={colKey}
            style={{
              width: columnWidths.created_at,
              padding: '0 var(--space-3)',
              color: 'var(--color-text-faint)',
              fontSize: 'var(--text-xs)',
              flexShrink: 0
            }}
          >
            {createdDateStr}
          </div>
        )

      case 'relations':
        return (
          <div
            key={colKey}
            style={{
              width: columnWidths.relations,
              padding: '0 var(--space-3)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0
            }}
          >
            {relationsCount > 0 ? (
              <span style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '2px',
                background: 'var(--color-surface-offset)',
                color: 'var(--color-text-muted)',
                borderRadius: '4px',
                padding: '2px 6px',
                fontSize: '10px',
                fontWeight: 'var(--weight-semibold)'
              }}>
                <Link2 size={10} /> {relationsCount}
              </span>
            ) : (
              <span style={{ color: 'var(--color-text-faint)' }}>-</span>
            )}
          </div>
        )

      default:
        return null
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.target !== e.currentTarget) return
    if (e.key === 'Enter') {
      e.preventDefault()
      onRowDoubleClick(item.id)
    } else if (e.key === ' ') {
      e.preventDefault()
      onSelectToggle(item.id, e as unknown as React.MouseEvent)
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onDoubleClick={() => onRowDoubleClick(item.id)}
      onKeyDown={handleKeyDown}
      style={{
        display: 'flex',
        alignItems: 'center',
        height: '40px',
        borderBottom: '1px solid var(--color-surface-offset)',
        background: isSelected ? 'var(--color-primary-muted)' : 'transparent',
        fontSize: 'var(--text-xs)',
        transition: 'background var(--duration-fast)',
        overflow: 'hidden',
        outline: 'none'
      }}
      className="backlog-row-container"
    >
      {/* Checkbox Cell */}
      <div
        style={{
          width: '40px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0
        }}
      >
        <input
          type="checkbox"
          checked={isSelected}
          onClick={e => e.stopPropagation()} // Prevent double click trigger
          onChange={e => onSelectToggle(item.id, e as unknown as React.MouseEvent)}
          style={{ cursor: 'pointer' }}
        />
      </div>

      {/* Render columns based on order and visibility */}
      {columnOrder.map(colKey => {
        if (!visibleColumns[colKey]) return null
        return renderCell(colKey)
      })}
      
      {/* Hover and focus row style */}
      <style>{`
        .backlog-row-container:hover {
          background-color: var(--color-surface-2) !important;
        }
        .backlog-row-container:hover .backlog-play-btn {
          display: inline-flex !important;
        }
        .backlog-row-container:focus-visible {
          outline: 1.5px solid var(--color-secondary) !important;
          outline-offset: -1.5px;
          background-color: var(--color-surface-2) !important;
        }
      `}</style>
    </div>
  )
}
