import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { Search, Plus, SlidersHorizontal, ArrowLeft, ArrowRight, RotateCcw, X } from 'lucide-react'
import { useAppStore } from '../store/appStore'
import type { Item, Tag as TagType } from '../../../shared/types'
import BacklogFilters from './backlog/BacklogFilters'
import BacklogTable from './backlog/BacklogTable'
import BulkActionsBar from './backlog/BulkActionsBar'
import TaskDetailDrawer from './backlog/TaskDetailDrawer'

interface WorkflowColumn {
  id: string
  name: string
}

export default function BacklogView() {
  const activeContext = useAppStore(s => s.activeContext)

  // Items and Schema configurations
  const [tasks, setTasks] = useState<Item[]>([])
  const [totalTasks, setTotalTasks] = useState(0)
  const [workflowColumns, setWorkflowColumns] = useState<WorkflowColumn[]>([])
  const [allTags, setAllTags] = useState<TagType[]>([])

  // Query & pagination state
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [page, setPage] = useState(1)
  const pageSize = 50

  // Collapsible Filters Panel
  const [showFilters, setShowFilters] = useState(false)

  // Filter conditions
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>([])
  const [selectedPriorities, setSelectedPriorities] = useState<number[]>([])
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([])
  const [dueStart, setDueStart] = useState('')
  const [dueEnd, setDueEnd] = useState('')
  const [hasRelations, setHasRelations] = useState('all') // 'all' | 'yes' | 'no'
  const [grouping, setGrouping] = useState<'none' | 'status' | 'priority' | 'tag'>('none')

  // Sorting
  const [sortBy, setSortBy] = useState('created_at')
  const [sortDesc, setSortDesc] = useState(true)

  // Selection
  const [selectedIds, setSelectedIds] = useState<string[]>([])

  // Column settings
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({
    title: 250,
    status: 120,
    priority: 80,
    tags: 150,
    due_date: 110,
    created_at: 100,
    relations: 85
  })
  const [columnOrder, setColumnOrder] = useState<string[]>([
    'title',
    'status',
    'priority',
    'tags',
    'due_date',
    'relations',
    'created_at'
  ])
  const [visibleColumns, setVisibleColumns] = useState<Record<string, boolean>>({
    title: true,
    status: true,
    priority: true,
    tags: true,
    due_date: true,
    relations: true,
    created_at: true
  })

  // Selected item detail drawer
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null)

  // Soft-delete undo state
  const [showUndo, setShowUndo] = useState(false)
  const [undoData, setUndoData] = useState<{
    items: Item[]
    originalStatuses: Array<{ id: string; status: string }>
  } | null>(null)

  // 1. Debounce Search Input
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedQuery(searchQuery)
      setPage(1) // Reset page when query changes
    }, 200)
    return () => clearTimeout(handler)
  }, [searchQuery])

  // 2. Load Columns Configuration (Workflow Stages)
  const loadWorkflowColumns = useCallback(async () => {
    try {
      const key = `kanban_columns_${activeContext}`
      const val = await window.electronAPI.db.getSetting(key)
      if (val) {
        setWorkflowColumns(JSON.parse(val as string))
      } else {
        const defaultCols = [
          { id: 'open', name: 'Backlog', wipLimit: null },
          { id: 'in_progress', name: 'In Progress', wipLimit: null },
          { id: 'in_review', name: 'In Review', wipLimit: null },
          { id: 'done', name: 'Done', wipLimit: null }
        ]
        setWorkflowColumns(defaultCols)
      }
    } catch (err) {
      console.error('Failed to load columns:', err)
    }
  }, [activeContext])

  // 3. Load Column Layout settings (Widths, Order, Visibility)
  const loadColumnLayout = useCallback(async () => {
    try {
      const key = `backlog_columns_layout_${activeContext}`
      const val = await window.electronAPI.db.getSetting(key)
      if (val) {
        const config = JSON.parse(val as string)
        if (config.widths) setColumnWidths(config.widths)
        if (config.order) setColumnOrder(config.order)
        if (config.visibility) setVisibleColumns(config.visibility)
      }
    } catch (err) {
      console.error('Failed to load column layout:', err)
    }
  }, [activeContext])

  // Save layout configurations
  const saveColumnLayout = async (
    widths: typeof columnWidths,
    order: typeof columnOrder,
    visibility: typeof visibleColumns
  ) => {
    try {
      const key = `backlog_columns_layout_${activeContext}`
      await window.electronAPI.db.setSetting(
        key,
        JSON.stringify({ widths, order, visibility })
      )
    } catch (err) {
      console.error('Failed to save column layout:', err)
    }
  }

  // 4. Load Tags
  const loadTags = useCallback(async () => {
    try {
      const tags = await window.electronAPI.db.getTags()
      setAllTags(tags)
    } catch (err) {
      console.error('Failed to load tags:', err)
    }
  }, [])

  // 5. Load Tasks
  const loadTasks = useCallback(async () => {
    try {
      const params = {
        query: debouncedQuery,
        status: selectedStatuses,
        priority: selectedPriorities,
        tagIds: selectedTagIds,
        dueStart: dueStart ? new Date(dueStart).getTime() : null,
        dueEnd: dueEnd ? new Date(dueEnd).getTime() : null,
        hasRelations:
          hasRelations === 'all' ? null : hasRelations === 'yes',
        sortBy,
        sortDesc,
        page,
        pageSize
      }
      const res = await window.electronAPI.db.queryTasks(activeContext, params)
      setTasks(res.items)
      setTotalTasks(res.total)
    } catch (err) {
      console.error('Failed to load tasks:', err)
    }
  }, [
    activeContext,
    debouncedQuery,
    selectedStatuses,
    selectedPriorities,
    selectedTagIds,
    dueStart,
    dueEnd,
    hasRelations,
    sortBy,
    sortDesc,
    page
  ])

  // Initial trigger & context reload
  useEffect(() => {
    setSelectedIds([])
    setPage(1)
    loadWorkflowColumns()
    loadColumnLayout()
    loadTags()
  }, [activeContext, loadWorkflowColumns, loadColumnLayout, loadTags])

  // Reload tasks when filter dependencies alter
  useEffect(() => {
    loadTasks()
  }, [loadTasks])

  // Reset filters handler
  const handleResetFilters = () => {
    setSelectedStatuses([])
    setSelectedPriorities([])
    setSelectedTagIds([])
    setDueStart('')
    setDueEnd('')
    setHasRelations('all')
    setGrouping('none')
    setSearchQuery('')
    setPage(1)
  }

  // Update specific field on cell/popup double-click updates
  const handleUpdateField = async (id: string, patch: Partial<Item>, tagIds?: string[]) => {
    try {
      await window.electronAPI.db.updateItem(id, patch, tagIds)
      await loadTasks()
    } catch (err) {
      console.error('Failed to update task field:', err)
    }
  }

  // Row selection aggregation
  const selectedItems = useMemo(() => {
    return tasks.filter(t => selectedIds.includes(t.id))
  }, [tasks, selectedIds])

  // Bulk Actions
  const handleBulkUpdateStatus = async (status: string) => {
    try {
      await window.electronAPI.db.bulkUpdateItems({
        ids: selectedIds,
        patch: { status }
      })
      setSelectedIds([])
      await loadTasks()
    } catch (err) {
      console.error('Failed to bulk update status:', err)
    }
  }

  const handleBulkUpdatePriority = async (priority: number) => {
    try {
      await Promise.all(
        selectedIds.map(id =>
          window.electronAPI.db.updateItem(id, {
            priority: priority as Item['priority']
          })
        )
      )
      setSelectedIds([])
      await loadTasks()
    } catch (err) {
      console.error('Failed to bulk update priority:', err)
    }
  }

  const handleBulkAddTag = async (tagId: string) => {
    try {
      await Promise.all(
        selectedItems.map(item => {
          const existingTags = item.tags?.map(t => t.id) || []
          if (existingTags.includes(tagId)) return Promise.resolve()
          return window.electronAPI.db.updateItem(item.id, {}, [
            ...existingTags,
            tagId
          ])
        })
      )
      setSelectedIds([])
      await loadTasks()
    } catch (err) {
      console.error('Failed to bulk add tag:', err)
    }
  }

  const handleBulkDelete = async () => {
    try {
      const originalStatuses = selectedItems.map(item => ({
        id: item.id,
        status: item.status
      }))

      // Soft delete by updating status to 'archived'
      await window.electronAPI.db.bulkUpdateItems({
        ids: selectedIds,
        patch: { status: 'archived' }
      })

      setUndoData({ items: selectedItems, originalStatuses })
      setShowUndo(true)
      setSelectedIds([])
      await loadTasks()
    } catch (err) {
      console.error('Failed to bulk delete tasks:', err)
    }
  }

  const handleUndoDelete = async () => {
    if (!undoData) return
    try {
      await Promise.all(
        undoData.originalStatuses.map(os =>
          window.electronAPI.db.updateItem(os.id, { status: os.status })
        )
      )
      setShowUndo(false)
      setUndoData(null)
      await loadTasks()
    } catch (err) {
      console.error('Failed to undo deletion:', err)
    }
  }

  const handleExportMarkdown = async () => {
    let content = `# Checkpoint Backlog Export - ${new Date().toLocaleDateString()}\n\n`
    selectedItems.forEach(item => {
      const isDone = item.status.toLowerCase() === 'done'
      const statusLabel =
        workflowColumns.find(c => c.id === item.status)?.name || item.status
      
      const priorityLabel =
        item.priority === 3
          ? 'High'
          : item.priority === 2
          ? 'Medium'
          : item.priority === 1
          ? 'Low'
          : 'None'
      
      let est = ''
      try {
        const meta = JSON.parse(item.metadata || '{}')
        if (meta.estimate !== undefined) {
          est = ` (Estimate: ${meta.estimate}h)`
        }
      } catch {}

      content += `- [${isDone ? 'x' : ' '}] ${item.title}${est}\n`
      content += `  - Status: ${statusLabel}\n`
      content += `  - Priority: ${priorityLabel}\n`
      if (item.due_at) {
        content += `  - Due Date: ${new Date(item.due_at).toLocaleDateString()}\n`
      }
      if (item.tags && item.tags.length > 0) {
        content += `  - Tags: ${item.tags.map(t => t.name).join(', ')}\n`
      }
      if (item.body.trim()) {
        const indentedBody = item.body
          .split('\n')
          .map(line => '    ' + line)
          .join('\n')
        content += `\n${indentedBody}\n\n`
      } else {
        content += `\n`
      }
    })

    const success = await window.electronAPI.app.saveFile('backlog-export.md', content)
    if (success) {
      setSelectedIds([])
    }
  }

  // Create New Task Shortcut
  const handleCreateTask = async () => {
    try {
      const newTask = await window.electronAPI.db.createItem({
        type: 'task',
        context: activeContext,
        title: 'New Task',
        body: '',
        status: workflowColumns[0]?.id || 'open',
        priority: 0,
        position: Date.now(),
        due_at: null,
        metadata: '{}'
      })
      await loadTasks()
      setActiveTaskId(newTask.id)
    } catch (err) {
      console.error('Failed to create new backlog task:', err)
    }
  }

  // Layout updates persistence
  const handleColumnWidthChange = (colKey: string, width: number) => {
    const nextWidths = { ...columnWidths, [colKey]: width }
    setColumnWidths(nextWidths)
    saveColumnLayout(nextWidths, columnOrder, visibleColumns)
  }

  const handleColumnOrderChange = (nextOrder: string[]) => {
    setColumnOrder(nextOrder)
    saveColumnLayout(columnWidths, nextOrder, visibleColumns)
  }

  const handleColumnVisibilityToggle = (colKey: string) => {
    const nextVisibility = { ...visibleColumns, [colKey]: !visibleColumns[colKey] }
    setVisibleColumns(nextVisibility)
    saveColumnLayout(columnWidths, columnOrder, nextVisibility)
  }

  const handleSortChange = (field: string) => {
    if (sortBy === field) {
      setSortDesc(!sortDesc)
    } else {
      setSortBy(field)
      setSortDesc(true)
    }
    setPage(1)
  }

  // Total page calculation
  const totalPages = Math.max(1, Math.ceil(totalTasks / pageSize))

  return (
    <div
      style={{
        padding: 'var(--space-5) var(--space-6) var(--space-4)',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        boxSizing: 'border-box',
        gap: 0
      }}
    >
      {/* Top Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          marginBottom: 'var(--space-5)',
          flexShrink: 0
        }}
      >
        <div>
          <h1
            style={{
              fontSize: 'var(--text-xl)',
              fontWeight: 'var(--weight-semibold)',
              letterSpacing: 'var(--tracking-tight)',
              margin: '0 0 var(--space-1) 0',
              color: 'var(--color-text-base)'
            }}
          >
            Backlog Registry
          </h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              background: 'var(--color-surface-2)',
              border: '1px solid var(--color-surface-offset)',
              borderRadius: 'var(--radius-full)',
              padding: '2px 10px',
              fontSize: 'var(--text-2xs)',
              fontWeight: 'var(--weight-semibold)',
              color: 'var(--color-text-muted)',
              letterSpacing: '0.04em'
            }}>
              {totalTasks} task{totalTasks !== 1 ? 's' : ''}
            </div>
          </div>
        </div>

        <button
          onClick={handleCreateTask}
          style={{
            background: 'var(--color-secondary)',
            border: 'none',
            color: 'var(--color-text-inverted)',
            borderRadius: 'var(--radius-md)',
            padding: 'var(--space-2) var(--space-4)',
            fontSize: 'var(--text-xs)',
            fontWeight: 'var(--weight-bold)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-1-5)',
            height: '32px',
            letterSpacing: '0.01em',
            transition: 'filter 120ms ease, transform 120ms ease'
          }}
          onMouseEnter={e => {
            e.currentTarget.style.filter = 'brightness(1.15)'
            e.currentTarget.style.transform = 'translateY(-1px)'
          }}
          onMouseLeave={e => {
            e.currentTarget.style.filter = 'none'
            e.currentTarget.style.transform = 'translateY(0)'
          }}
        >
          <Plus size={13} />
          New Task
        </button>
      </div>

      {/* Control bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-2)',
          marginBottom: showFilters ? 'var(--space-3)' : 'var(--space-4)',
          flexShrink: 0,
          background: 'var(--color-surface-1)',
          border: '1px solid var(--color-surface-offset)',
          borderRadius: 'var(--radius-lg)',
          padding: 'var(--space-2) var(--space-3)'
        }}
      >
        {/* Search Input */}
        <div
          style={{
            position: 'relative',
            flex: 1
          }}
        >
          <Search
            size={13}
            style={{
              position: 'absolute',
              left: 'var(--space-2)',
              top: '50%',
              transform: 'translateY(-50%)',
              color: 'var(--color-text-faint)'
            }}
          />
          <input
            type="text"
            placeholder="Search tasks…"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            style={{
              width: '100%',
              background: 'transparent',
              border: 'none',
              color: 'var(--color-text-base)',
              padding: 'var(--space-1) var(--space-2) var(--space-1) 28px',
              fontSize: 'var(--text-sm)',
              outline: 'none',
              boxSizing: 'border-box'
            }}
          />
        </div>

        {/* Divider */}
        <div style={{ width: '1px', height: '18px', background: 'var(--color-surface-offset)', flexShrink: 0 }} />

        {/* Group By selector */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexShrink: 0 }}>
          <span style={{ fontSize: '10px', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text-faint)', textTransform: 'uppercase', letterSpacing: '0.08em', whiteSpace: 'nowrap' }}>
            Group
          </span>
          <select
            value={grouping}
            onChange={e => setGrouping(e.target.value as 'none' | 'status' | 'priority' | 'tag')}
            style={{
              background: 'var(--color-surface-2)',
              border: '1px solid var(--color-surface-offset)',
              color: 'var(--color-text-base)',
              borderRadius: 'var(--radius-sm)',
              padding: '3px var(--space-2)',
              fontSize: 'var(--text-xs)',
              outline: 'none',
              cursor: 'pointer'
            }}
          >
            <option value="none">None</option>
            <option value="status">Status</option>
            <option value="priority">Priority</option>
            <option value="tag">Tag</option>
          </select>
        </div>

        {/* Divider */}
        <div style={{ width: '1px', height: '18px', background: 'var(--color-surface-offset)', flexShrink: 0 }} />

        {/* Filters Panel Toggle */}
        <button
          onClick={() => setShowFilters(!showFilters)}
          style={{
            background: showFilters ? 'var(--color-secondary-muted, rgba(205,241,43,0.12))' : 'transparent',
            border: showFilters ? '1px solid var(--color-secondary)' : '1px solid transparent',
            color: showFilters ? 'var(--color-secondary)' : 'var(--color-text-muted)',
            borderRadius: 'var(--radius-sm)',
            padding: 'var(--space-1) var(--space-2)',
            fontSize: 'var(--text-xs)',
            fontWeight: 'var(--weight-semibold)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            flexShrink: 0,
            transition: 'all 120ms ease'
          }}
          onMouseEnter={e => {
            if (!showFilters) e.currentTarget.style.color = 'var(--color-text-base)'
          }}
          onMouseLeave={e => {
            if (!showFilters) e.currentTarget.style.color = 'var(--color-text-muted)'
          }}
        >
          <SlidersHorizontal size={12} />
          <span>Filters</span>
        </button>
      </div>

      {/* Filter panel (collapsible) */}
      {showFilters && (
        <div style={{ flexShrink: 0 }}>
          <BacklogFilters
            columns={workflowColumns}
            allTags={allTags}
            selectedStatuses={selectedStatuses}
            setSelectedStatuses={setSelectedStatuses}
            selectedPriorities={selectedPriorities}
            setSelectedPriorities={setSelectedPriorities}
            selectedTagIds={selectedTagIds}
            setSelectedTagIds={setSelectedTagIds}
            dueStart={dueStart}
            setDueStart={setDueStart}
            dueEnd={dueEnd}
            setDueEnd={setDueEnd}
            hasRelations={hasRelations}
            setHasRelations={setHasRelations}
            onReset={handleResetFilters}
          />
        </div>
      )}

      {/* Main registry Table area */}
      <div style={{ flex: 1, overflow: 'hidden', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <BacklogTable
          items={tasks}
          columns={workflowColumns}
          allTags={allTags}
          selectedIds={selectedIds}
          setSelectedIds={setSelectedIds}
          visibleColumns={visibleColumns}
          columnWidths={columnWidths}
          columnOrder={columnOrder}
          grouping={grouping}
          sortBy={sortBy}
          sortDesc={sortDesc}
          onSortChange={handleSortChange}
          onColumnWidthChange={handleColumnWidthChange}
          onColumnOrderChange={handleColumnOrderChange}
          onColumnVisibilityToggle={handleColumnVisibilityToggle}
          onRowDoubleClick={id => setActiveTaskId(id)}
          onUpdateField={handleUpdateField}
        />
      </div>

      {/* Pagination control footer bar */}
      {totalPages > 1 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 'var(--space-4)',
            marginTop: 'var(--space-4)',
            flexShrink: 0
          }}
        >
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
            style={{
              background: 'var(--color-surface-2)',
              border: '1px solid var(--color-surface-offset)',
              color: page === 1 ? 'var(--color-text-faint)' : 'var(--color-text-base)',
              borderRadius: 'var(--radius-md)',
              padding: 'var(--space-1.5) var(--space-3)',
              fontSize: 'var(--text-xs)',
              cursor: page === 1 ? 'default' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px'
            }}
          >
            <ArrowLeft size={12} /> Previous
          </button>

          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
            Page {page} of {totalPages}
          </span>

          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            style={{
              background: 'var(--color-surface-2)',
              border: '1px solid var(--color-surface-offset)',
              color: page === totalPages ? 'var(--color-text-faint)' : 'var(--color-text-base)',
              borderRadius: 'var(--radius-md)',
              padding: 'var(--space-1.5) var(--space-3)',
              fontSize: 'var(--text-xs)',
              cursor: page === totalPages ? 'default' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px'
            }}
          >
            Next <ArrowRight size={12} />
          </button>
        </div>
      )}

      {/* Task details drawer */}
      {activeTaskId && (
        <TaskDetailDrawer
          taskId={activeTaskId}
          columns={workflowColumns}
          onClose={() => {
            setActiveTaskId(null)
            loadTasks()
          }}
          onUpdate={handleUpdateField}
        />
      )}

      {/* Bulk operations bar */}
      <BulkActionsBar
        selectedItems={selectedItems}
        columns={workflowColumns}
        allTags={allTags}
        onClearSelection={() => setSelectedIds([])}
        onBulkUpdateStatus={handleBulkUpdateStatus}
        onBulkUpdatePriority={handleBulkUpdatePriority}
        onBulkAddTag={handleBulkAddTag}
        onBulkDelete={handleBulkDelete}
        onExportMarkdown={handleExportMarkdown}
      />

      {/* Undo Toast SnackBar */}
      {showUndo && undoData && (
        <div
          style={{
            position: 'fixed',
            bottom: '24px',
            right: '24px',
            background: 'var(--color-surface-elevated)',
            border: '1px solid var(--color-surface-offset)',
            borderRadius: 'var(--radius-md)',
            padding: 'var(--space-3) var(--space-4)',
            boxShadow: '0 10px 15px -3px rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-3)',
            zIndex: 1000,
            animation: 'slide-in 0.2s cubic-bezier(0.32, 0.72, 0, 1)'
          }}
        >
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-base)' }}>
            Deleted {undoData.items.length} tasks
          </span>
          <button
            onClick={handleUndoDelete}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--color-secondary)',
              fontWeight: 'var(--weight-bold)',
              cursor: 'pointer',
              fontSize: 'var(--text-xs)',
              padding: '2px 4px',
              display: 'flex',
              alignItems: 'center',
              gap: '4px'
            }}
          >
            <RotateCcw size={12} />
            <span>Undo</span>
          </button>
          <button
            onClick={() => {
              setShowUndo(false)
              setUndoData(null)
            }}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--color-text-muted)',
              cursor: 'pointer',
              fontSize: 'var(--text-xs)',
              display: 'flex'
            }}
          >
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  )
}
