import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { Search, Plus, SlidersHorizontal, ArrowLeft, ArrowRight, Archive, X, RotateCcw, Trash2, Repeat } from 'lucide-react'
import { useAppStore } from '../store/appStore'
import { useAiEnabled } from '../lib/useAiEnabled'
import type { Item, Tag as TagType } from '../../../shared/types'
import BacklogFilters from './backlog/BacklogFilters'
import BacklogTable from './backlog/BacklogTable'
import BulkActionsBar from './backlog/BulkActionsBar'
import TaskDetailDrawer from './backlog/TaskDetailDrawer'
import Skeleton from './ui/Skeleton'
import EmptyState from './ui/EmptyState'
import { useToast } from './ui/Toast'
import { loadBoardConfig } from '../lib/boardConfig'
import StandupTranslatorView from './StandupTranslatorView'
import ConfirmDialog from './ui/ConfirmDialog'
import RecurringPanel from './backlog/RecurringPanel'
import {
  BUILT_IN_VIEWS,
  normalizeSavedViews,
  toQueryParams,
  describeView,
  type SavedView
} from '../../../shared/savedViews'
import { getJsonSetting, getStringSetting, setJsonSetting } from '../lib/settings'

interface WorkflowColumn {
  id: string
  name: string
}

export default function BacklogView() {
  const activeWorkspace = useAppStore(s => s.activeWorkspace)
  const [showRecurring, setShowRecurring] = useState(false)
  const [activeView, setActiveView] = useState<SavedView | null>(null)
  const pendingViewId = useAppStore(s => s.pendingViewId)

  // Subscribed rather than read once: the palette can apply a view while this
  // screen is already open, in which case no mount effect would fire.
  useEffect(() => {
    if (!pendingViewId) return
    useAppStore.getState().setPendingViewId(null)
    let cancelled = false
    ;(async () => {
      const stored = await getStringSetting('saved_views', '').catch(() => '')
      const all = [...BUILT_IN_VIEWS, ...normalizeSavedViews(stored)]
      const found = all.find(v => v.id === pendingViewId) ?? null
      if (!cancelled) {
        setActiveView(found)
        setPage(1)
      }
    })()
    return () => { cancelled = true }
  }, [pendingViewId])
  const { toast } = useToast()

  // Items and Schema configurations
  const [tasks, setTasks] = useState<Item[]>([])
  const [totalTasks, setTotalTasks] = useState(0)
  const [workflowColumns, setWorkflowColumns] = useState<WorkflowColumn[]>([])
  const [showStandupModal, setShowStandupModal] = useState(false)
  const aiEnabled = useAiEnabled()
  const [allTags, setAllTags] = useState<TagType[]>([])
  const [loading, setLoading] = useState(true)

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

  // Computed filter count
  const activeFilterCount = useMemo(() => {
    return (
      selectedStatuses.length +
      selectedPriorities.length +
      selectedTagIds.length +
      (dueStart ? 1 : 0) +
      (dueEnd ? 1 : 0) +
      (hasRelations !== 'all' ? 1 : 0)
    )
  }, [
    selectedStatuses,
    selectedPriorities,
    selectedTagIds,
    dueStart,
    dueEnd,
    hasRelations
  ])

  // Selected item detail drawer
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null)

  const rightPanelOpen = useAppStore(s => s.rightPanelOpen)

  // Mutual exclusivity between Task details drawer and AI assistant panel
  useEffect(() => {
    if (activeTaskId) {
      const store = useAppStore.getState()
      if (store.rightPanelOpen) {
        store.setRightPanelContent(null)
      }
    }
  }, [activeTaskId])

  useEffect(() => {
    if (rightPanelOpen && activeTaskId) {
      setActiveTaskId(null)
    }
  }, [rightPanelOpen])

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
      // Reads the unified board document. This used to read the legacy
      // kanban_columns_* key directly, which stopped being written once board
      // configuration was unified, so every column added, renamed or removed
      // after that migration was invisible here.
      const config = await loadBoardConfig(activeWorkspace)
      setWorkflowColumns(config.columns)
    } catch (err) {
      console.error('Failed to load columns:', err)
    }
  }, [activeWorkspace])

  // 3. Load Column Layout settings (Widths, Order, Visibility)
  const loadColumnLayout = useCallback(async () => {
    try {
      const key = `backlog_columns_layout_${activeWorkspace}`
      const config = await getJsonSetting<{
        widths?: Record<string, number>
        order?: string[]
        visibility?: Record<string, boolean>
      } | null>(key, null)
      if (config) {
        if (config.widths) setColumnWidths(config.widths)
        if (config.order) setColumnOrder(config.order)
        if (config.visibility) setVisibleColumns(config.visibility)
      }
    } catch (err) {
      console.error('Failed to load column layout:', err)
    }
  }, [activeWorkspace])

  // Save layout configurations
  const saveColumnLayout = async (
    widths: typeof columnWidths,
    order: typeof columnOrder,
    visibility: typeof visibleColumns
  ) => {
    try {
      const key = `backlog_columns_layout_${activeWorkspace}`
      await setJsonSetting(
        key,
        ({ widths, order, visibility })
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
    setLoading(true)
    try {
      const params = activeView
        ? {
            ...toQueryParams(activeView, Date.now()),
            // The search box stays live on top of a view. Narrowing a view is
            // a normal thing to want, and it does not change what the view is.
            ...(debouncedQuery ? { query: debouncedQuery } : {}),
            sortBy,
            sortDesc,
            page,
            pageSize
          }
        : {
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
      const res = await window.electronAPI.db.queryTasks(activeWorkspace, params)
      setTasks(res.items)
      setTotalTasks(res.total)
    } catch (err) {
      console.error('Failed to load tasks:', err)
    } finally {
      setLoading(false)
    }
  }, [
    activeView,
    activeWorkspace,
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
  }, [activeWorkspace, loadWorkflowColumns, loadColumnLayout, loadTags])

  // Reload tasks when filter dependencies alter
  useEffect(() => {
    loadTasks()
  }, [loadTasks])

  useEffect(() => {
    const handleItemUpdated = () => {
      loadTasks()
    }
    window.addEventListener('item-updated', handleItemUpdated)
    return () => window.removeEventListener('item-updated', handleItemUpdated)
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
      toast(`Updated status of ${selectedIds.length} tasks`)
      setSelectedIds([])
      await loadTasks()
    } catch (err) {
      console.error('Failed to bulk update status:', err)
    }
  }

  const handleBulkUpdatePriority = async (priority: number) => {
    try {
      await window.electronAPI.db.bulkUpdateItems({
        ids: selectedIds,
        patch: { priority: priority as Item['priority'] }
      })
      toast(`Updated priority of ${selectedIds.length} tasks`)
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
      toast(`Added tag to ${selectedItems.length} tasks`)
      setSelectedIds([])
      await loadTasks()
    } catch (err) {
      console.error('Failed to bulk add tag:', err)
    }
  }

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  // Archived task browser. Lets people find and restore (or permanently delete) tasks
  // that were removed via bulk delete, since the toast "Undo" only lasts a few seconds.
  const [showArchive, setShowArchive] = useState(false)
  const [archivedTasks, setArchivedTasks] = useState<Item[]>([])
  const [archiveLoading, setArchiveLoading] = useState(false)
  const [deleteArchivedId, setDeleteArchivedId] = useState<string | null>(null)

  const loadArchivedTasks = useCallback(async () => {
    setArchiveLoading(true)
    try {
      const res = await window.electronAPI.db.queryTasks(activeWorkspace, {
        archivedOnly: true,
        sortBy: 'created_at',
        sortDesc: true,
        page: 1,
        pageSize: 200
      })
      setArchivedTasks(res.items)
    } catch (err) {
      console.error('Failed to load archived tasks:', err)
    } finally {
      setArchiveLoading(false)
    }
  }, [activeWorkspace])

  useEffect(() => {
    if (showArchive) loadArchivedTasks()
  }, [showArchive, loadArchivedTasks])

  const handleRestoreArchivedTask = async (id: string) => {
    try {
      const restoredStatus = workflowColumns[0]?.id || 'open'
      await window.electronAPI.db.updateItem(id, { status: restoredStatus })
      setArchivedTasks(prev => prev.filter(t => t.id !== id))
      toast('Task restored to ' + (workflowColumns[0]?.name || 'Backlog'))
      await loadTasks()
    } catch (err) {
      console.error('Failed to restore archived task:', err)
    }
  }

  const handlePermanentlyDeleteArchivedTask = async (id: string) => {
    try {
      await window.electronAPI.db.bulkDeleteItems([id])
      setArchivedTasks(prev => prev.filter(t => t.id !== id))
      setDeleteArchivedId(null)
      toast('Task permanently deleted')
    } catch (err) {
      console.error('Failed to permanently delete archived task:', err)
    }
  }

  const performBulkDelete = async () => {
    setShowDeleteConfirm(false)
    try {
      const originalStatuses = selectedItems.map(item => ({
        id: item.id,
        status: item.status
      }))
      const deletedIds = [...selectedIds]
      const deletedItems = [...selectedItems]

      // Soft delete by updating status to 'archived'
      await window.electronAPI.db.bulkUpdateItems({
        ids: deletedIds,
        patch: { status: 'archived' }
      })

      setSelectedIds([])
      await loadTasks()

      toast(`Deleted ${deletedItems.length} tasks.`, {
        action: {
          label: 'Undo',
          onClick: async () => {
            try {
              await Promise.all(
                originalStatuses.map(os =>
                  window.electronAPI.db.updateItem(os.id, { status: os.status })
                )
              )
              await loadTasks()
              toast('Tasks restored')
            } catch (err) {
              console.error('Failed to undo deletion:', err)
            }
          }
        }
      })
    } catch (err) {
      console.error('Failed to bulk delete tasks:', err)
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
      toast(`Exported ${selectedItems.length} tasks to markdown file`)
      setSelectedIds([])
    } else {
      toast('Export failed: file could not be saved', { type: 'error' })
    }
  }

  // Create New Task Shortcut
  const handleCreateTask = async () => {
    try {
      const newTask = await window.electronAPI.db.createItem({
        type: 'task',
        context: activeWorkspace,
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
      toast('Task created')
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
          <div className="row">
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

        <div className="row">
          {aiEnabled && <button
            onClick={() => setShowStandupModal(true)}
            style={{
              background: 'var(--color-surface-2)',
              border: '1px solid var(--color-surface-offset)',
              color: 'var(--color-text-base)',
              borderRadius: 'var(--radius-md)',
              padding: 'var(--space-2) var(--space-4)',
              fontSize: 'var(--text-xs)',
              fontWeight: 'var(--weight-semibold)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-1.5)',
              height: '32px',
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
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--color-secondary)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/>
            </svg>
            AI Standup
          </button>}

          <button
            onClick={() => setShowArchive(true)}
            title="View archived tasks"
            style={{
              background: 'var(--color-surface-2)',
              border: '1px solid var(--color-surface-offset)',
              color: 'var(--color-text-base)',
              borderRadius: 'var(--radius-md)',
              padding: 'var(--space-2) var(--space-4)',
              fontSize: 'var(--text-xs)',
              fontWeight: 'var(--weight-semibold)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-1.5)',
              height: '32px',
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
            <Archive size={13} />
            Archive
          </button>

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
            background: showFilters ? 'var(--color-surface-offset)' : 'transparent',
            border: '1px solid var(--color-surface-offset)',
            borderRadius: 'var(--radius-md)',
            color: showFilters ? 'var(--color-text-base)' : 'var(--color-text-muted)',
            padding: '6px 12px',
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
          {activeFilterCount > 0 && (
            <span
              style={{
                background: 'var(--color-secondary)',
                color: 'var(--color-text-inverted)',
                borderRadius: 'var(--radius-full)',
                fontSize: '9px',
                fontWeight: 'bold',
                minWidth: '16px',
                height: '16px',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '0 4px',
                boxSizing: 'border-box'
              }}
            >
              {activeFilterCount}
            </span>
          )}
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

      {activeView && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
          padding: 'var(--space-2) var(--space-3)', marginBottom: 'var(--space-3)',
          background: 'var(--color-secondary-muted)',
          border: '1px solid var(--color-secondary)',
          borderRadius: 'var(--radius-md)', flexShrink: 0
        }}>
          <span style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-secondary)' }}>
            {activeView.name}
          </span>
          <span style={{ flex: 1, fontSize: '11px', color: 'var(--color-text-muted)' }}>
            {describeView(activeView)}
          </span>
          <button
            className="btn-secondary"
            onClick={() => { setActiveView(null); setPage(1) }}
            aria-label="Clear the active view"
            title="Clear view"
          >
            <X size={12} />
          </button>
        </div>
      )}

      <div style={{ flexShrink: 0, marginBottom: showRecurring ? 'var(--space-3)' : 0 }}>
        <button
          onClick={() => setShowRecurring(v => !v)}
          aria-expanded={showRecurring}
          style={{
            display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
            background: 'none', border: 'none', cursor: 'pointer',
            padding: 'var(--space-1) 0', marginBottom: 'var(--space-1)',
            fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)'
          }}
        >
          <Repeat size={13} />
          Repeating tasks
        </button>
        {showRecurring && (
          <RecurringPanel context={activeWorkspace} onChanged={loadTasks} />
        )}
      </div>

      {/* Main registry Table area */}
      <div style={{ flex: 1, overflow: 'hidden', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {loading ? (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            background: 'var(--color-surface-1)',
            border: '1px solid var(--color-surface-offset)',
            borderRadius: 'var(--radius-lg)',
            height: '100%',
            overflow: 'hidden',
            boxSizing: 'border-box'
          }}>
            {/* Mock Table Header */}
            <div style={{
              display: 'flex',
              height: '36px',
              alignItems: 'center',
              background: 'var(--color-surface-2)',
              borderBottom: '1px solid var(--color-surface-offset)',
              paddingLeft: 'var(--space-4)',
              fontWeight: 'var(--weight-semibold)',
              fontSize: 'var(--text-xs)',
              color: 'var(--color-text-muted)',
              flexShrink: 0
            }}>
              <div style={{ width: '30px', display: 'flex', justifyContent: 'center', flexShrink: 0 }}>
                <Skeleton width={16} height={16} borderRadius="3px" />
              </div>
              {columnOrder.filter(k => visibleColumns[k]).map(colKey => {
                const width = columnWidths[colKey] ?? 100
                const label = colKey.charAt(0).toUpperCase() + colKey.slice(1).replace('_', ' ')
                return (
                  <div key={colKey} style={{ width, padding: '0 var(--space-3)', flexShrink: 0, boxSizing: 'border-box' }}>
                    {label}
                  </div>
                )
              })}
            </div>

            {/* Mock Table Rows */}
            <div style={{ flex: 1, overflow: 'hidden', padding: '0 var(--space-4)' }}>
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(i => (
                <div key={i} style={{
                  display: 'flex',
                  height: '40px',
                  alignItems: 'center',
                  borderBottom: '1px solid var(--color-surface-offset)'
                }}>
                  {/* Checkbox */}
                  <div style={{ width: '30px', display: 'flex', justifyContent: 'center', flexShrink: 0 }}>
                    <Skeleton width={16} height={16} borderRadius="3px" />
                  </div>
                  {/* Cells */}
                  {columnOrder.filter(k => visibleColumns[k]).map(colKey => {
                    const width = columnWidths[colKey] ?? 100
                    const skeletonW = colKey === 'title' ? `${Math.max(40, 80 - (i % 3) * 15)}%` : '60%'
                    return (
                      <div key={colKey} style={{ width, padding: '0 var(--space-3)', flexShrink: 0, boxSizing: 'border-box' }}>
                        <Skeleton width={skeletonW} height={14} />
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          </div>
        ) : tasks.length === 0 ? (
          <EmptyState
            icon={<Search size={48} />}
            title="No Tasks Found"
            description="Your backlog is clear. Add structured tasks or adjust filters to see existing items."
            actionLabel="Create Task"
            onActionClick={handleCreateTask}
          />
        ) : (
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
        )}
      </div>

      {/* Pagination control footer bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginTop: 'var(--space-4)',
          flexShrink: 0,
          borderTop: '1px solid var(--color-surface-offset)',
          paddingTop: 'var(--space-3)'
        }}
      >
        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
          {totalTasks > 0 ? (
            `Showing ${Math.min(totalTasks, (page - 1) * pageSize + 1)}–${Math.min(totalTasks, page * pageSize)} of ${totalTasks} tasks`
          ) : (
            'No tasks found'
          )}
        </span>

        {totalPages > 1 && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-4)'
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
      </div>

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
        onBulkDelete={() => setShowDeleteConfirm(true)}
        onExportMarkdown={handleExportMarkdown}
      />

      <StandupTranslatorView
        isOpen={showStandupModal}
        onClose={() => setShowStandupModal(false)}
      />
      {/* Confirm Bulk Delete Dialog */}
      <ConfirmDialog
        isOpen={showDeleteConfirm}
        title="Confirm Bulk Deletion"
        message={`Are you sure you want to delete ${selectedItems.length} selected tasks?`}
        confirmText="Delete Tasks"
        isDestructive
        onConfirm={performBulkDelete}
        onCancel={() => setShowDeleteConfirm(false)}
      />

      {/* Archived Tasks Panel */}
      {showArchive && (
        <div
          style={{
            position: 'fixed',
            top: '32px',
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.5)',
            zIndex: 1100,
            display: 'flex',
            justifyContent: 'flex-end',
            backdropFilter: 'blur(2px)'
          }}
          onClick={() => setShowArchive(false)}
        >
          <div
            style={{
              width: '420px',
              maxWidth: '100vw',
              height: '100%',
              background: 'var(--color-surface-1)',
              borderLeft: '1px solid var(--color-surface-offset)',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '-10px 0 30px rgba(0,0,0,0.5)',
              animation: 'slide-in 0.25s cubic-bezier(0.32, 0.72, 0, 1)'
            }}
            onClick={e => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="archive-panel-title"
          >
            {/* Header */}
            <div style={{
              height: '56px',
              padding: '0 var(--space-5)',
              borderBottom: '1px solid var(--color-surface-offset)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexShrink: 0
            }}>
              <span
                id="archive-panel-title"
                style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-base)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}
              >
                <Archive size={15} /> Archived Tasks
              </span>
              <button
                onClick={() => setShowArchive(false)}
                style={{ background: 'transparent', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', display: 'flex', padding: '4px' }}
                onMouseEnter={e => (e.currentTarget.style.color = 'var(--color-text-base)')}
                onMouseLeave={e => (e.currentTarget.style.color = 'var(--color-text-muted)')}
              >
                <X size={18} />
              </button>
            </div>

            {/* Content */}
            <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              {archiveLoading ? (
                <div className="col">
                  {[1, 2, 3].map(i => (
                    <Skeleton key={i} width="100%" height={52} borderRadius="var(--radius-md)" />
                  ))}
                </div>
              ) : archivedTasks.length === 0 ? (
                <div style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 'var(--space-2)',
                  padding: 'var(--space-8) var(--space-4)',
                  textAlign: 'center'
                }}>
                  <Archive size={28} style={{ color: 'var(--color-text-faint)' }} />
                  <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-faint)' }}>
                    No archived tasks. Deleted tasks show up here so you can restore them later.
                  </span>
                </div>
              ) : (
                archivedTasks.map(task => (
                  <div
                    key={task.id}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '6px',
                      background: 'var(--color-surface-2)',
                      border: '1px solid var(--color-surface-offset)',
                      borderRadius: 'var(--radius-md)',
                      padding: 'var(--space-3)'
                    }}
                  >
                    <span style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text-base)' }}>
                      {task.title || 'Untitled Task'}
                    </span>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-3)' }}>
                      <button
                        onClick={() => handleRestoreArchivedTask(task.id)}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: 'var(--color-secondary)',
                          fontSize: '11px',
                          fontWeight: 'var(--weight-semibold)',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px'
                        }}
                      >
                        <RotateCcw size={11} /> Restore
                      </button>
                      <button
                        onClick={() => setDeleteArchivedId(task.id)}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: 'var(--color-error)',
                          fontSize: '11px',
                          fontWeight: 'var(--weight-semibold)',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px'
                        }}
                      >
                        <Trash2 size={11} /> Delete
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Confirm Permanent Deletion of a single archived task */}
      <ConfirmDialog
        isOpen={!!deleteArchivedId}
        title="Delete Permanently"
        message="This task will be permanently deleted and cannot be restored. Are you sure?"
        confirmText="Delete Permanently"
        isDestructive
        onConfirm={() => deleteArchivedId && handlePermanentlyDeleteArchivedTask(deleteArchivedId)}
        onCancel={() => setDeleteArchivedId(null)}
      />
    </div>
  )
}
