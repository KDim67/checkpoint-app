import React, { useState, useEffect, useCallback, useRef } from 'react'
import {
  DndContext,
  DragEndEvent,
  useSensor,
  useSensors,
  PointerSensor,
  KeyboardSensor,
  closestCorners
} from '@dnd-kit/core'
import {
  SortableContext,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
  arrayMove
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import KanbanColumn from './kanban/KanbanColumn'
import CardDetailModal from './kanban/CardDetailModal'
import AddColumnModal from './kanban/AddColumnModal'
import { useAppStore } from '../store/appStore'
import type { Item } from '../../../shared/types'
import { Plus, Layers, LayoutGrid, RotateCcw } from 'lucide-react'

interface ColumnConfig {
  id: string
  name: string
  wipLimit: number | null
}

// Sortable column wrapper so columns themselves can be reordered via drag
function SortableColumn({
  col,
  cards,
  onRename,
  onDelete,
  onCardClick,
  onCardDelete,
  onCardConvertToTask,
  onAddCard
}: {
  col: ColumnConfig
  cards: Item[]
  onRename: (id: string, name: string) => void
  onDelete: (id: string) => void
  onCardClick: (id: string) => void
  onCardDelete: (id: string) => void
  onCardConvertToTask: (id: string) => void
  onAddCard: (colId: string) => void
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id: `col::${col.id}` })

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
        height: '100%',
        flexShrink: 0
      }}
    >
      <KanbanColumn
        id={col.id}
        name={col.name}
        wipLimit={col.wipLimit}
        cards={cards}
        onRename={onRename}
        onDelete={onDelete}
        onCardClick={onCardClick}
        onCardDelete={onCardDelete}
        onCardConvertToTask={onCardConvertToTask}
        onAddCard={onAddCard}
        dragHandleProps={{ ...attributes, ...listeners }}
      />
    </div>
  )
}

export default function KanbanView() {
  const activeContext = useAppStore(s => s.activeContext)

  const [cards, setCards] = useState<Item[]>([])
  const [columns, setColumns] = useState<ColumnConfig[]>([])
  const [swimlanesEnabled, setSwimlanesEnabled] = useState(false)
  const [loading, setLoading] = useState(true)

  const [showAddColModal, setShowAddColModal] = useState(false)
  const [activeCardId, setActiveCardId] = useState<string | null>(null)

  // Undo deletion
  const [undoCard, setUndoCard] = useState<Item | null>(null)
  const [showUndo, setShowUndo] = useState(false)
  const undoTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Sensors: use a distance threshold to distinguish click vs drag
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  // Data Loading

  const loadColumns = useCallback(async () => {
    try {
      const key = `kanban_columns_${activeContext}`
      const val = await window.electronAPI.db.getSetting(key)
      if (val) {
        setColumns(JSON.parse(val as string))
      } else {
        const defaultCols: ColumnConfig[] = [
          { id: 'open',        name: 'Backlog',     wipLimit: null },
          { id: 'in_progress', name: 'In Progress', wipLimit: null },
          { id: 'in_review',   name: 'In Review',   wipLimit: null },
          { id: 'done',        name: 'Done',         wipLimit: null }
        ]
        await window.electronAPI.db.setSetting(key, JSON.stringify(defaultCols))
        setColumns(defaultCols)
      }
    } catch (err) {
      console.error('Failed to load Kanban column settings:', err)
    }
  }, [activeContext])

  const loadCards = useCallback(async () => {
    try {
      const res = await window.electronAPI.db.getItems(activeContext, 'card', 1, 1000)
      setCards(res.items)
    } catch (err) {
      console.error('Failed to load Kanban cards:', err)
    }
  }, [activeContext])

  const initializeBoard = useCallback(async () => {
    setLoading(true)
    await Promise.all([loadColumns(), loadCards()])
    setLoading(false)
  }, [loadColumns, loadCards])

  useEffect(() => {
    initializeBoard()
  }, [initializeBoard])

  // Drag & Drop

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const activeId = active.id as string
    const overId = over.id as string

    // Column reorder: ids are prefixed with "col::"
    if (activeId.startsWith('col::')) {
      const fromIdx = columns.findIndex(c => `col::${c.id}` === activeId)
      const toIdx   = columns.findIndex(c => `col::${c.id}` === overId)
      if (fromIdx === -1 || toIdx === -1) return
      const reordered = arrayMove(columns, fromIdx, toIdx)
      setColumns(reordered)
      try {
        const key = `kanban_columns_${activeContext}`
        await window.electronAPI.db.setSetting(key, JSON.stringify(reordered))
      } catch (err) {
        console.error('Failed to persist column order:', err)
      }
      return
    }

    // Card move / reorder
    const cardId = activeId
    let newStatus = overId
    const isColumnTarget = columns.some(c => c.id === overId)

    const draggedCard = cards.find(c => c.id === cardId)
    if (!draggedCard) return

    if (!isColumnTarget) {
      const targetCard = cards.find(c => c.id === overId)
      if (!targetCard) return
      newStatus = targetCard.status
    }

    const destColumnCards = cards
      .filter(c => c.status === newStatus && c.id !== cardId)
      .sort((a, b) => a.position - b.position)

    let newPosition = 0

    if (isColumnTarget) {
      newPosition = destColumnCards.length === 0
        ? 1000.0
        : destColumnCards[destColumnCards.length - 1].position + 1000.0
    } else {
      const overIndex = destColumnCards.findIndex(c => c.id === overId)
      if (overIndex === 0) {
        newPosition = destColumnCards[0].position / 2.0
      } else if (overIndex === -1 || overIndex === destColumnCards.length) {
        newPosition = destColumnCards[destColumnCards.length - 1].position + 1000.0
      } else {
        const a = destColumnCards[overIndex - 1].position
        const b = destColumnCards[overIndex].position
        newPosition = (a + b) / 2.0
        if (Math.abs(a - b) < 0.00001) {
          setCards(prev => prev.map(c => c.id === cardId ? { ...c, status: newStatus, position: newPosition } : c))
          await window.electronAPI.db.updateItem(cardId, { status: newStatus, position: newPosition })
          await window.electronAPI.db.rebalancePositions(activeContext, newStatus)
          loadCards()
          return
        }
      }
    }

    setCards(prev => prev.map(c => c.id === cardId ? { ...c, status: newStatus, position: newPosition } : c))
    try {
      await window.electronAPI.db.updateItem(cardId, { status: newStatus, position: newPosition })
    } catch (err) {
      console.error('Failed to update card position:', err)
      loadCards()
    }
  }

  // Column Management

  const handleCreateColumnSubmit = async (name: string, wipLimit: number | null) => {
    const id = `col-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now()}`
    const updatedCols = [...columns, { id, name, wipLimit }]
    try {
      const key = `kanban_columns_${activeContext}`
      await window.electronAPI.db.setSetting(key, JSON.stringify(updatedCols))
      setColumns(updatedCols)
      setShowAddColModal(false)
    } catch (err) {
      console.error('Failed to create column:', err)
    }
  }

  const handleRenameColumn = async (colId: string, newName: string) => {
    const updatedCols = columns.map(c => c.id === colId ? { ...c, name: newName } : c)
    try {
      const key = `kanban_columns_${activeContext}`
      await window.electronAPI.db.setSetting(key, JSON.stringify(updatedCols))
      setColumns(updatedCols)
    } catch (err) {
      console.error('Failed to rename column:', err)
    }
  }

  const handleDeleteColumn = async (colId: string) => {
    const updatedCols = columns.filter(c => c.id !== colId)
    try {
      const cardsToMove = cards.filter(c => c.status === colId)
      if (cardsToMove.length > 0) {
        await window.electronAPI.db.bulkUpdateItems({
          ids: cardsToMove.map(c => c.id),
          patch: { status: 'open' }
        })
      }
      const key = `kanban_columns_${activeContext}`
      await window.electronAPI.db.setSetting(key, JSON.stringify(updatedCols))
      setColumns(updatedCols)
      loadCards()
    } catch (err) {
      console.error('Failed to delete column:', err)
    }
  }

  // Card Management

  const handleUpdateCardDetails = async (id: string, patch: Partial<Item>, tagIds?: string[]) => {
    try {
      await window.electronAPI.db.updateItem(id, patch, tagIds)
      loadCards()
    } catch (err) {
      console.error('Failed to update card details:', err)
    }
  }

  const handleCardDelete = async (id: string) => {
    try {
      const targetCard = cards.find(c => c.id === id)
      if (!targetCard) return
      if (undoTimeoutRef.current) clearTimeout(undoTimeoutRef.current)
      await window.electronAPI.db.updateItem(id, { status: 'archived' })
      setCards(prev => prev.filter(c => c.id !== id))
      setUndoCard(targetCard)
      setShowUndo(true)
      undoTimeoutRef.current = setTimeout(() => {
        setShowUndo(false)
        setUndoCard(null)
      }, 4000)
    } catch (err) {
      console.error('Failed to delete card:', err)
    }
  }

  const handleUndoDelete = async () => {
    if (!undoCard) return
    if (undoTimeoutRef.current) { clearTimeout(undoTimeoutRef.current); undoTimeoutRef.current = null }
    try {
      await window.electronAPI.db.updateItem(undoCard.id, { status: undoCard.status })
      setCards(prev => [...prev, undoCard])
      setShowUndo(false)
      setUndoCard(null)
    } catch (err) {
      console.error('Failed to undo card deletion:', err)
    }
  }

  const handleCardConvertToTask = async (id: string) => {
    try {
      await window.electronAPI.db.updateItem(id, { type: 'task' })
      setCards(prev => prev.filter(c => c.id !== id))
    } catch (err) {
      console.error('Failed to promote card to task:', err)
    }
  }

  // Add card to a specific column
  const handleAddCardToColumn = async (columnId: string) => {
    try {
      const colCards = cards.filter(c => c.status === columnId)
      const defaultPos = colCards.length > 0
        ? Math.max(...colCards.map(c => c.position)) + 1000.0
        : 1000.0
      const created = await window.electronAPI.db.createItem({
        type: 'card',
        context: activeContext,
        title: 'New card',
        body: '',
        status: columnId,
        priority: 0,
        position: defaultPos,
        due_at: null,
        metadata: '{}'
      })
      setCards(prev => [...prev, created])
      // Auto-open editor for the new card
      setActiveCardId(created.id)
    } catch (err) {
      console.error('Failed to create card:', err)
    }
  }

  // Quick add card to Backlog from header
  const handleAddCardToBacklog = () => handleAddCardToColumn('open')

  // Cards for a column, sorted appropriately
  const getCardsForColumn = (columnId: string) => {
    const colCards = cards.filter(c => c.status === columnId)
    if (swimlanesEnabled) {
      return [...colCards].sort((a, b) => {
        if (b.priority !== a.priority) return b.priority - a.priority
        return a.position - b.position
      })
    }
    return [...colCards].sort((a, b) => a.position - b.position)
  }

  if (loading) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        color: 'var(--color-text-muted)',
        background: 'var(--color-background)',
        fontSize: 'var(--text-sm)',
        gap: 'var(--space-3)'
      }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: 'spin 1s linear infinite' }}>
          <path d="M21 12a9 9 0 1 1-6.219-8.56" />
        </svg>
        Loading board...
      </div>
    )
  }

  const columnSortableIds = columns.map(c => `col::${c.id}`)

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      background: 'var(--color-background)',
      position: 'relative'
    }}>
      {/* Header Bar */}
      <header style={{
        height: '52px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 var(--space-6)',
        borderBottom: '1px solid var(--color-surface-offset)',
        background: 'var(--color-surface-1)',
        flexShrink: 0
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <h1 style={{
            fontSize: 'var(--text-base)',
            fontWeight: 'var(--weight-semibold)',
            color: 'var(--color-text-base)',
            margin: 0,
            letterSpacing: 'var(--tracking-tight)'
          }}>
            Kanban Board
          </h1>
          <span style={{
            fontSize: 'var(--text-xs)',
            color: 'var(--color-text-faint)',
            background: 'var(--color-surface-2)',
            padding: '2px 10px',
            borderRadius: 'var(--radius-full)',
            border: '1px solid var(--color-surface-offset)',
            fontWeight: 'var(--weight-medium)'
          }}>
            #{activeContext}
          </span>
          <span style={{
            fontSize: 'var(--text-xs)',
            color: 'var(--color-text-faint)'
          }}>
            {cards.length} card{cards.length !== 1 ? 's' : ''}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          {/* Swimlanes toggle */}
          <HeaderBtn
            active={swimlanesEnabled}
            onClick={() => setSwimlanesEnabled(!swimlanesEnabled)}
            title="Toggle priority swimlanes"
            icon={swimlanesEnabled ? <Layers size={13} /> : <LayoutGrid size={13} />}
          >
            {swimlanesEnabled ? 'Priority View' : 'Flat Board'}
          </HeaderBtn>

          {/* Add Column */}
          <HeaderBtn
            onClick={() => setShowAddColModal(true)}
            title="Add a new column"
            icon={<Plus size={13} />}
          >
            Add Column
          </HeaderBtn>

          {/* Add Card (primary CTA) */}
          <button
            id="kanban-add-card"
            onClick={handleAddCardToBacklog}
            style={{
              background: 'var(--color-secondary)',
              border: 'none',
              color: 'var(--color-text-inverted)',
              borderRadius: 'var(--radius-md)',
              padding: '0 var(--space-4)',
              height: '32px',
              fontSize: 'var(--text-xs)',
              fontWeight: 'var(--weight-bold)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-1-5)',
              letterSpacing: '0.01em',
              transition: 'filter 100ms ease, transform 100ms ease'
            }}
            onMouseEnter={e => { e.currentTarget.style.filter = 'brightness(1.12)'; e.currentTarget.style.transform = 'translateY(-1px)' }}
            onMouseLeave={e => { e.currentTarget.style.filter = 'none'; e.currentTarget.style.transform = 'none' }}
          >
            <Plus size={13} strokeWidth={2.5} />
            New Card
          </button>
        </div>
      </header>

      {/* Board Area */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragEnd={handleDragEnd}
      >
        {/* Column-level sortable context (for column reordering) */}
        <SortableContext items={columnSortableIds} strategy={horizontalListSortingStrategy}>
          <div style={{
            flex: 1,
            padding: 'var(--space-5) var(--space-6)',
            display: 'flex',
            gap: 'var(--space-4)',
            overflowX: 'auto',
            overflowY: 'hidden',
            alignItems: 'stretch',
            height: 'calc(100% - 52px)'
          }}>
            {columns.map(col => (
              <SortableColumn
                key={col.id}
                col={col}
                cards={getCardsForColumn(col.id)}
                onRename={handleRenameColumn}
                onDelete={handleDeleteColumn}
                onCardClick={setActiveCardId}
                onCardDelete={handleCardDelete}
                onCardConvertToTask={handleCardConvertToTask}
                onAddCard={handleAddCardToColumn}
              />
            ))}

            {/* Ghost "Add Column" tile at end */}
            <button
              onClick={() => setShowAddColModal(true)}
              style={{
                width: '280px',
                minWidth: '260px',
                flexShrink: 0,
                height: '100%',
                background: 'transparent',
                border: '2px dashed var(--color-surface-offset)',
                borderRadius: 'var(--radius-lg)',
                color: 'var(--color-text-faint)',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 'var(--space-2)',
                fontSize: 'var(--text-sm)',
                fontWeight: 'var(--weight-medium)',
                transition: 'border-color 150ms ease, color 150ms ease, background 150ms ease'
              }}
              onMouseEnter={e => {
                e.currentTarget.style.borderColor = 'var(--color-balance)'
                e.currentTarget.style.color = 'var(--color-text-muted)'
                e.currentTarget.style.background = 'var(--color-surface-1)'
              }}
              onMouseLeave={e => {
                e.currentTarget.style.borderColor = 'var(--color-surface-offset)'
                e.currentTarget.style.color = 'var(--color-text-faint)'
                e.currentTarget.style.background = 'transparent'
              }}
            >
              <Plus size={20} strokeWidth={1.5} />
              Add Column
            </button>
          </div>
        </SortableContext>
      </DndContext>

      {/* Card Detail Modal */}
      {activeCardId && (
        <CardDetailModal
          cardId={activeCardId}
          columns={columns}
          onClose={() => setActiveCardId(null)}
          onUpdate={handleUpdateCardDetails}
        />
      )}

      {/* Add Column Modal */}
      {showAddColModal && (
        <AddColumnModal
          onClose={() => setShowAddColModal(false)}
          onSubmit={handleCreateColumnSubmit}
        />
      )}

      {/* Undo Snackbar */}
      {showUndo && (
        <div style={{
          position: 'absolute',
          bottom: '24px',
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'var(--color-surface-elevated)',
          border: '1px solid var(--color-surface-offset)',
          boxShadow: 'var(--shadow-lg)',
          borderRadius: 'var(--radius-lg)',
          padding: 'var(--space-3) var(--space-5)',
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-4)',
          zIndex: 200,
          color: 'var(--color-text-base)',
          fontSize: 'var(--text-sm)',
          animation: 'toast-in 200ms var(--ease-spring)'
        }}>
          <span>Card deleted</span>
          <button
            onClick={handleUndoDelete}
            style={{
              background: 'var(--color-secondary-muted)',
              border: '1px solid var(--color-secondary)',
              color: 'var(--color-secondary)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
              fontWeight: 'var(--weight-semibold)',
              padding: '3px 10px',
              borderRadius: 'var(--radius-sm)',
              fontSize: 'var(--text-xs)',
              transition: 'background 100ms ease'
            }}
          >
            <RotateCcw size={12} />
            Undo
          </button>
        </div>
      )}
    </div>
  )
}

// Header Button component
function HeaderBtn({
  children,
  onClick,
  title,
  icon,
  active = false
}: {
  children: React.ReactNode
  onClick: () => void
  title: string
  icon: React.ReactNode
  active?: boolean
}) {
  const [hover, setHover] = useState(false)
  return (
    <button
      onClick={onClick}
      title={title}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: active
          ? 'var(--color-secondary-muted)'
          : hover ? 'var(--color-surface-2)' : 'transparent',
        border: active
          ? '1px solid var(--color-secondary)'
          : '1px solid var(--color-surface-offset)',
        color: active
          ? 'var(--color-secondary)'
          : hover ? 'var(--color-text-base)' : 'var(--color-text-muted)',
        borderRadius: 'var(--radius-md)',
        padding: '0 var(--space-3)',
        height: '32px',
        fontSize: 'var(--text-xs)',
        fontWeight: 'var(--weight-medium)',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-1-5)',
        transition: 'background 100ms ease, border-color 100ms ease, color 100ms ease',
        whiteSpace: 'nowrap'
      }}
    >
      {icon}
      {children}
    </button>
  )
}
