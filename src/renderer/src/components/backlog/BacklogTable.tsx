import React, { useState, useRef, useEffect, useMemo } from 'react'
import { ChevronLeft, ChevronRight, ChevronDown, ChevronUp, Eye } from 'lucide-react'
import type { Item, Tag as TagType } from '../../../../shared/types'
import BacklogRow from './BacklogRow'

interface BacklogTableProps {
  items: Item[]
  columns: Array<{ id: string; name: string }>
  allTags: TagType[]
  selectedIds: string[]
  setSelectedIds: React.Dispatch<React.SetStateAction<string[]>>
  visibleColumns: Record<string, boolean>
  columnWidths: Record<string, number>
  columnOrder: string[]
  grouping: 'none' | 'status' | 'priority' | 'tag'
  sortBy: string
  sortDesc: boolean
  onSortChange: (field: string) => void
  onColumnWidthChange: (colKey: string, width: number) => void
  onColumnOrderChange: (newOrder: string[]) => void
  onColumnVisibilityToggle: (colKey: string) => void
  onRowDoubleClick: (id: string) => void
  onUpdateField: (id: string, patch: Partial<Item>) => Promise<void>
}

type DisplayRow =
  | { type: 'header'; key: string; label: string; count: number }
  | { type: 'row'; key: string; item: Item }

const PRIORITY_LABELS: Record<number, string> = {
  3: 'High Priority',
  2: 'Medium Priority',
  1: 'Low Priority',
  0: 'No Priority'
}

export default function BacklogTable({
  items,
  columns,
  allTags,
  selectedIds,
  setSelectedIds,
  visibleColumns,
  columnWidths,
  columnOrder,
  grouping,
  sortBy,
  sortDesc,
  onSortChange,
  onColumnWidthChange,
  onColumnOrderChange,
  onColumnVisibilityToggle,
  onRowDoubleClick,
  onUpdateField
}: BacklogTableProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [containerHeight, setContainerHeight] = useState(500)
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({})
  const [showVisibilityMenu, setShowVisibilityMenu] = useState(false)

  // Listen for scroll & resize to update virtual viewport bounds
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const handleScroll = () => {
      setScrollTop(container.scrollTop)
    }

    container.addEventListener('scroll', handleScroll, { passive: true })

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerHeight(entry.contentRect.height)
      }
    })
    resizeObserver.observe(container)

    setContainerHeight(container.getBoundingClientRect().height || 500)

    return () => {
      container.removeEventListener('scroll', handleScroll)
      resizeObserver.disconnect()
    }
  }, [])

  // Shift column left in columnOrder
  const handleShiftLeft = (colKey: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const index = columnOrder.indexOf(colKey)
    if (index <= 0) return
    const newOrder = [...columnOrder]
    newOrder[index] = columnOrder[index - 1]
    newOrder[index - 1] = colKey
    onColumnOrderChange(newOrder)
  }

  // Shift column right in columnOrder
  const handleShiftRight = (colKey: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const index = columnOrder.indexOf(colKey)
    if (index < 0 || index >= columnOrder.length - 1) return
    const newOrder = [...columnOrder]
    newOrder[index] = columnOrder[index + 1]
    newOrder[index + 1] = colKey
    onColumnOrderChange(newOrder)
  }

  // Toggle resize handle drag listener
  const handleResizeStart = (colKey: string, e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = columnWidths[colKey] || 120

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX
      const newWidth = Math.max(60, startWidth + deltaX)
      onColumnWidthChange(colKey, newWidth)
    }

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }

  // Group and flatten items for virtualized registry rendering
  const flatRows = useMemo<DisplayRow[]>(() => {
    if (grouping === 'none') {
      return items.map((item) => ({ type: 'row' as const, key: item.id, item }))
    }

    const rowsList: DisplayRow[] = []

    if (grouping === 'status') {
      // Create buckets
      const buckets: Record<string, Item[]> = {}
      columns.forEach((col) => {
        buckets[col.id] = []
      })
      buckets['unassigned'] = []

      items.forEach((item) => {
        if (buckets[item.status] !== undefined) {
          buckets[item.status].push(item)
        } else {
          buckets['unassigned'].push(item)
        }
      })

      columns.forEach((col) => {
        const list = buckets[col.id]
        if (list.length === 0) return
        const isCollapsed = !!collapsedGroups[col.id]
        rowsList.push({
          type: 'header',
          key: col.id,
          label: col.name,
          count: list.length
        })
        if (!isCollapsed) {
          list.forEach((item) => {
            rowsList.push({ type: 'row', key: item.id, item })
          })
        }
      })

      const unassigned = buckets['unassigned']
      if (unassigned.length > 0) {
        const isCollapsed = !!collapsedGroups['unassigned']
        rowsList.push({
          type: 'header',
          key: 'unassigned',
          label: 'Unassigned',
          count: unassigned.length
        })
        if (!isCollapsed) {
          unassigned.forEach((item) => {
            rowsList.push({ type: 'row', key: item.id, item })
          })
        }
      }
    } else if (grouping === 'priority') {
      const priorityBuckets: Record<number, Item[]> = { 3: [], 2: [], 1: [], 0: [] }
      items.forEach((item) => {
        const p = item.priority ?? 0
        if (priorityBuckets[p] !== undefined) {
          priorityBuckets[p].push(item)
        } else {
          priorityBuckets[0].push(item)
        }
      })

      ;[3, 2, 1, 0].forEach((p) => {
        const list = priorityBuckets[p]
        if (list.length === 0) return
        const key = `priority-${p}`
        const isCollapsed = !!collapsedGroups[key]
        rowsList.push({
          type: 'header',
          key,
          label: PRIORITY_LABELS[p],
          count: list.length
        })
        if (!isCollapsed) {
          list.forEach((item) => {
            rowsList.push({ type: 'row', key: item.id, item })
          })
        }
      })
    } else if (grouping === 'tag') {
      const tagBuckets: Record<string, Item[]> = {}
      const noTagsList: Item[] = []

      allTags.forEach((t) => {
        tagBuckets[t.id] = []
      })

      items.forEach((item) => {
        if (item.tags && item.tags.length > 0) {
          item.tags.forEach((t) => {
            if (tagBuckets[t.id]) {
              tagBuckets[t.id].push(item)
            }
          })
        } else {
          noTagsList.push(item)
        }
      })

      allTags.forEach((t) => {
        const list = tagBuckets[t.id]
        if (list.length === 0) return
        const key = `tag-${t.id}`
        const isCollapsed = !!collapsedGroups[key]
        rowsList.push({
          type: 'header',
          key,
          label: t.name,
          count: list.length
        })
        if (!isCollapsed) {
          list.forEach((item) => {
            rowsList.push({ type: 'row', key: `${key}-${item.id}`, item })
          })
        }
      })

      if (noTagsList.length > 0) {
        const key = 'tag-none'
        const isCollapsed = !!collapsedGroups[key]
        rowsList.push({
          type: 'header',
          key,
          label: 'No Tags',
          count: noTagsList.length
        })
        if (!isCollapsed) {
          noTagsList.forEach((item) => {
            rowsList.push({ type: 'row', key: `${key}-${item.id}`, item })
          })
        }
      }
    }

    return rowsList
  }, [items, columns, allTags, grouping, collapsedGroups])

  // Select all logic
  const allSelected = useMemo(() => {
    if (items.length === 0) return false
    return items.every((item) => selectedIds.includes(item.id))
  }, [items, selectedIds])

  const handleSelectAllToggle = () => {
    if (allSelected) {
      setSelectedIds([])
    } else {
      setSelectedIds(items.map((i) => i.id))
    }
  }

  const handleRowSelectToggle = (id: string, e: React.MouseEvent) => {
    if (e.shiftKey && selectedIds.length > 0) {
      // Shift-click selection range
      const lastSelectedId = selectedIds[selectedIds.length - 1]
      const lastIndex = items.findIndex((i) => i.id === lastSelectedId)
      const currentIndex = items.findIndex((i) => i.id === id)

      if (lastIndex !== -1 && currentIndex !== -1) {
        const start = Math.min(lastIndex, currentIndex)
        const end = Math.max(lastIndex, currentIndex)
        const slicedIds = items.slice(start, end + 1).map((i) => i.id)

        setSelectedIds((prev) => {
          const union = new Set([...prev, ...slicedIds])
          return Array.from(union)
        })
        return
      }
    }

    setSelectedIds((prev) => {
      if (prev.includes(id)) {
        return prev.filter((x) => x !== id)
      } else {
        return [...prev, id]
      }
    })
  }

  const toggleGroupCollapse = (groupKey: string) => {
    setCollapsedGroups((prev) => ({
      ...prev,
      [groupKey]: !prev[groupKey]
    }))
  }

  // Row virtualization geometry
  const rowHeight = 40
  const totalHeight = flatRows.length * rowHeight
  const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - 6)
  const endIndex = Math.min(flatRows.length - 1, Math.ceil((scrollTop + containerHeight) / rowHeight) + 6)

  const visibleRows = flatRows.slice(startIndex, endIndex + 1)
  const paddingTop = startIndex * rowHeight

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        height: '100%',
        overflow: 'hidden',
        background: 'var(--color-surface-1)',
        border: '1px solid var(--color-surface-offset)',
        borderRadius: 'var(--radius-lg)'
      }}
    >
      {/* Table Header Wrapper */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          height: '40px',
          background: 'var(--color-surface-2)',
          borderBottom: '1px solid var(--color-surface-offset)',
          fontWeight: 'var(--weight-semibold)',
          fontSize: '10px',
          color: 'var(--color-text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          position: 'relative',
          userSelect: 'none',
          flexShrink: 0
        }}
      >
        {/* Master Selection Checkbox */}
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
            checked={allSelected}
            onChange={handleSelectAllToggle}
            style={{ cursor: 'pointer' }}
          />
        </div>

        {/* Dynamic Column Headers */}
        {columnOrder.map((colKey, index) => {
          if (!visibleColumns[colKey]) return null
          const width = columnWidths[colKey] || 120
          const COLUMN_LABELS: Record<string, string> = {
            title: 'Title',
            status: 'Status',
            priority: 'Priority',
            tags: 'Tags',
            due_date: 'Due Date',
            created_at: 'Created',
            relations: 'Relations'
          }
          const label = COLUMN_LABELS[colKey] ?? (colKey.charAt(0).toUpperCase() + colKey.slice(1))

          const isSortable = ['title', 'status', 'priority', 'due_date', 'created_at', 'relations'].includes(colKey)
          const isSorted = sortBy === colKey

          return (
            <div
              key={colKey}
              style={{
                width,
                padding: '0 var(--space-3)',
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                position: 'relative',
                flexShrink: 0,
                borderRight: '1px solid var(--color-surface-offset)'
              }}
              className="backlog-col-header"
            >
              <div
                onClick={() => isSortable && onSortChange(colKey)}
                onKeyDown={(e) => {
                  if (isSortable && (e.key === 'Enter' || e.key === ' ')) {
                    e.preventDefault()
                    onSortChange(colKey)
                  }
                }}
                role={isSortable ? 'button' : undefined}
                tabIndex={isSortable ? 0 : undefined}
                className={isSortable ? 'backlog-header-sortable' : undefined}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  cursor: isSortable ? 'pointer' : 'default',
                  flex: 1,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  outline: 'none'
                }}
              >
                <span>{label}</span>
                {isSorted && (
                  <span>
                    {sortDesc ? <ChevronDown size={10} /> : <ChevronUp size={10} />}
                  </span>
                )}
              </div>

              {/* Column Shifters (Reorder control) */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '1px',
                  marginLeft: '4px',
                  marginRight: '2px',
                  opacity: 0.35
                }}
                className="column-reorder-buttons"
              >
                <button
                  disabled={index === 0}
                  onClick={(e) => handleShiftLeft(colKey, e)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    padding: 0,
                    cursor: index === 0 ? 'default' : 'pointer',
                    color: 'var(--color-text-base)',
                    display: 'flex'
                  }}
                >
                  <ChevronLeft size={10} />
                </button>
                <button
                  disabled={index === columnOrder.length - 1}
                  onClick={(e) => handleShiftRight(colKey, e)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    padding: 0,
                    cursor: index === columnOrder.length - 1 ? 'default' : 'pointer',
                    color: 'var(--color-text-base)',
                    display: 'flex'
                  }}
                >
                  <ChevronRight size={10} />
                </button>
              </div>

              {/* Resize Handle */}
              <div
                onMouseDown={(e) => handleResizeStart(colKey, e)}
                style={{
                  position: 'absolute',
                  right: '-3px',
                  top: 0,
                  bottom: 0,
                  width: '6px',
                  cursor: 'col-resize',
                  zIndex: 10,
                  display: 'flex',
                  justifyContent: 'center'
                }}
                className="col-resize-handle"
                title="Drag to resize column"
              >
                <div
                  style={{
                    width: '1px',
                    height: '100%',
                    background: 'transparent',
                    transition: 'background var(--duration-fast), width var(--duration-fast)'
                  }}
                  className="col-resize-line"
                />
              </div>
            </div>
          )
        })}

        {/* Column Toggle / Visibility Button */}
        <div style={{ marginLeft: 'auto', marginRight: 'var(--space-3)', position: 'relative' }}>
          <button
            onClick={() => setShowVisibilityMenu(!showVisibilityMenu)}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--color-text-muted)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              padding: '4px'
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--color-text-base)')}
            onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--color-text-muted)')}
            title="Toggle Columns"
          >
            <Eye size={13} />
          </button>

          {showVisibilityMenu && (
            <>
              <div
                style={{
                  position: 'fixed',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  zIndex: 99
                }}
                onClick={() => setShowVisibilityMenu(false)}
              />
              <div
                style={{
                  position: 'absolute',
                  top: '100%',
                  right: 0,
                  marginTop: '4px',
                  background: 'var(--color-surface-elevated)',
                  border: '1px solid var(--color-surface-offset)',
                  borderRadius: 'var(--radius-md)',
                  boxShadow: '0 10px 15px -3px rgba(0,0,0,0.5)',
                  padding: '6px 0',
                  minWidth: '130px',
                  zIndex: 100,
                  display: 'flex',
                  flexDirection: 'column'
                }}
              >
                {columnOrder.map((colKey) => {
                  const label =
                    colKey === 'due_date'
                      ? 'Due Date'
                      : colKey === 'created_at'
                      ? 'Created'
                      : colKey.charAt(0).toUpperCase() + colKey.slice(1)
                  return (
                    <label
                      key={colKey}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        padding: 'var(--space-1.5) var(--space-3)',
                        fontSize: '11px',
                        color: 'var(--color-text-base)',
                        cursor: 'pointer'
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--color-surface-offset)')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                    >
                      <input
                        type="checkbox"
                        checked={!!visibleColumns[colKey]}
                        onChange={() => onColumnVisibilityToggle(colKey)}
                        style={{ cursor: 'pointer' }}
                      />
                      <span>{label}</span>
                    </label>
                  )
                })}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Table Body - Virtualized Registry List */}
      <div
        ref={containerRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          position: 'relative'
        }}
      >
        {flatRows.length === 0 ? (
          <div
            style={{
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 'var(--space-3)',
              padding: 'var(--space-6)'
            }}
          >
            {/* Illustration */}
            <div style={{
              width: '56px',
              height: '56px',
              borderRadius: '14px',
              background: 'var(--color-surface-2)',
              border: '1px solid var(--color-surface-offset)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 'var(--space-1)'
            }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-faint)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
                <rect x="9" y="3" width="6" height="4" rx="1" />
                <line x1="9" y1="12" x2="15" y2="12" />
                <line x1="9" y1="16" x2="13" y2="16" />
              </svg>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text-base)', marginBottom: '4px' }}>
                No tasks found
              </div>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-faint)', maxWidth: '220px', lineHeight: 1.6 }}>
                Create your first task or adjust your search and filter criteria.
              </div>
            </div>
          </div>
        ) : (
          <div
            style={{
              height: `${totalHeight}px`,
              position: 'relative',
              width: '100%'
            }}
          >
            <div
              style={{
                transform: `translateY(${paddingTop}px)`,
                width: '100%'
              }}
            >
              {visibleRows.map((row) => {
                if (row.type === 'header') {
                  const isCollapsed = !!collapsedGroups[row.key]
                  return (
                    <div
                      key={row.key}
                      role="button"
                      tabIndex={0}
                      onClick={() => toggleGroupCollapse(row.key)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          toggleGroupCollapse(row.key)
                        }
                      }}
                      className="backlog-group-header"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        height: '40px',
                        padding: '0 var(--space-4)',
                        background: 'var(--color-surface-2)',
                        borderBottom: '1px solid var(--color-surface-offset)',
                        cursor: 'pointer',
                        fontSize: 'var(--text-xs)',
                        fontWeight: 'var(--weight-bold)',
                        color: 'var(--color-text-base)',
                        gap: 'var(--space-2)',
                        userSelect: 'none',
                        outline: 'none'
                      }}
                    >
                      {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                      <span>{row.label}</span>
                      <span
                        style={{
                          fontSize: '10px',
                          color: 'var(--color-text-muted)',
                          background: 'var(--color-surface-offset)',
                          padding: '1px 6px',
                          borderRadius: '10px'
                        }}
                      >
                        {row.count}
                      </span>
                    </div>
                  )
                }

                return (
                  <BacklogRow
                    key={row.key}
                    item={row.item}
                    columns={columns}
                    visibleColumns={visibleColumns}
                    columnWidths={columnWidths}
                    columnOrder={columnOrder}
                    isSelected={selectedIds.includes(row.item.id)}
                    onSelectToggle={handleRowSelectToggle}
                    onRowDoubleClick={onRowDoubleClick}
                    onUpdateField={onUpdateField}
                  />
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* Styling for column reorder buttons and hover effects */}
      <style>{`
        .backlog-col-header .column-reorder-buttons {
          opacity: 0;
          transition: opacity var(--duration-fast);
        }
        .backlog-col-header:hover .column-reorder-buttons {
          opacity: 0.65;
        }
        .column-reorder-buttons {
          opacity: 0;
          transition: opacity var(--duration-fast);
        }
        .backlog-header-sortable:focus-visible {
          outline: 1.5px solid var(--color-secondary) !important;
          outline-offset: -2px;
          border-radius: var(--radius-sm);
        }
        .backlog-group-header:focus-visible {
          outline: 1.5px solid var(--color-secondary) !important;
          outline-offset: -1.5px;
          background-color: var(--color-surface-offset) !important;
        }
        .backlog-col-header:hover .col-resize-line,
        .col-resize-handle:hover .col-resize-line {
          background: var(--color-surface-offset) !important;
        }
        .col-resize-handle:active .col-resize-line {
          background: var(--color-secondary) !important;
          width: 2px !important;
        }
      `}</style>
    </div>
  )
}
