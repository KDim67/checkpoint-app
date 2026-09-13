import React from 'react'
import {
  DndContext,
  DragOverlay,
  MeasuringStrategy
} from '@dnd-kit/core'
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import KanbanColumn from './kanban/KanbanColumn'
import KanbanCard from './kanban/KanbanCard'
import CardDetailModal from './kanban/CardDetailModal'
import AddColumnModal from './kanban/AddColumnModal'
import type { Item } from '../../../shared/types'
import { Plus, KanbanSquare } from 'lucide-react'
import ConfirmDialog from './ui/ConfirmDialog'
import EmptyState from './ui/EmptyState'
import {
  sameCardDisplay,
  sameColumnConfig,
  type CardDisplay,
  type ColumnConfig,
  type ColumnSort
} from '../lib/boardConfig'
import ArchiveBin from './kanban/ArchiveBin'
import { getBoardBackgroundStyle } from './kanban/boardBackground'
import { useKanbanBoard } from './kanban/useKanbanBoard'
import KanbanSkeleton from './kanban/KanbanSkeleton'
import KanbanHeader from './kanban/KanbanHeader'
import KanbanFilterBar from './kanban/KanbanFilterBar'
import { canAimAtSlot } from './kanban/dropSlots'


// Re-exported rather than declared: the shape now belongs to lib/boardConfig,
// which owns the whole board document. Kept as an export so existing importers
// of ColumnConfig from this module keep working.
export type { ColumnConfig }

interface SortableColumnProps {
  col: ColumnConfig
  cards: Item[]
  onRename: (id: string, name: string, wipLimit: number | null, color?: string, colorMode?: 'header' | 'full') => void
  onDelete: (id: string) => void
  onCardClick: (id: string) => void
  onCardDelete: (id: string) => void
  onCardConvertToTask: (id: string) => void
  onAddCard: (colId: string) => void
  onCardUpdate?: (id: string, patch: Partial<Item>) => Promise<void>
  onClearColumn?: (columnId: string) => void
  onArchiveColumn?: (columnId: string) => void
  isReadOnly?: boolean
  onToggleCollapse?: (columnId: string) => void
  onSetSort?: (columnId: string, sort: ColumnSort) => void
  cardDisplay?: CardDisplay
  /** Where the drop preview sits, as an index into `cards`. null for nowhere. */
  dropSlot?: number | null
  /** The height the dragged card had, so the gap is the footprint it will take. */
  dropHeight?: number
}

function areSortableColumnPropsEqual(prev: SortableColumnProps, next: SortableColumnProps) {
  if (prev.isReadOnly !== next.isReadOnly) return false
  // The board hands these down only while a card is in the air, and only the
  // column under the pointer gets a slot, so this is what keeps a drag to one
  // re-rendering column instead of all of them.
  if (prev.dropSlot !== next.dropSlot || prev.dropHeight !== next.dropHeight) return false
  // Whole-object compares. The five fields this used to name by hand left
  // collapsed, sort, description and cardDisplay out, so those changes were
  // dropped here and never reached a card.
  if (!sameColumnConfig(prev.col, next.col)) return false
  if (!sameCardDisplay(prev.cardDisplay, next.cardDisplay)) return false
  if (prev.cards.length !== next.cards.length) return false
  for (let i = 0; i < prev.cards.length; i++) {
    if (prev.cards[i] !== next.cards[i]) return false
  }
  return true
}

// Sortable column wrapper so columns themselves can be reordered via drag
const SortableColumn = React.memo(function SortableColumn({
  col,
  cards,
  onRename,
  onDelete,
  onCardClick,
  onCardDelete,
  onCardConvertToTask,
  onAddCard,
  onCardUpdate,
  onClearColumn,
  onArchiveColumn,
  isReadOnly = false,
  onToggleCollapse,
  onSetSort,
  cardDisplay,
  dropSlot = null,
  dropHeight
}: SortableColumnProps) {
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
        minHeight: 0,
        flexShrink: 0
      }}
    >
      <KanbanColumn
        id={col.id}
        name={col.name}
        wipLimit={col.wipLimit}
        color={col.color}
        colorMode={col.colorMode}
        cards={cards}
        onRename={onRename}
        onDelete={onDelete}
        onCardClick={onCardClick}
        onCardDelete={onCardDelete}
        onCardConvertToTask={onCardConvertToTask}
        onAddCard={onAddCard}
        onCardUpdate={onCardUpdate}
        onClearColumn={onClearColumn}
        onArchiveColumn={onArchiveColumn}
        dragHandleProps={{ ...attributes, ...listeners }}
        isReadOnly={isReadOnly}
        collapsed={col.collapsed}
        onToggleCollapse={onToggleCollapse}
        sort={col.sort}
        onSetSort={onSetSort}
        description={col.description}
        cardDisplay={cardDisplay}
        dropSlot={dropSlot}
        dropHeight={dropHeight}
      />
    </div>
  )
}, areSortableColumnPropsEqual)

export default function KanbanView() {
  const kanbanBoard = useKanbanBoard()
  const {
    cards, columns, swimlanesEnabled, cardDisplay, loading, handleToggleCollapse,
    handleSetColumnSort, showAddColModal, setShowAddColModal, activeCardId, setActiveCardId,
    activeDragCard, dropTarget, dragHeight, pendingDeleteColId, setPendingDeleteColId, boardBg,
    archivedColumns, showArchiveBin, closeArchiveBin, selectedArchived, setSelectedArchived,
    isReadOnlyMode, sensors, getCardsForColumn, collisionDetection, handleDragStart, handleDragOver,
    handleDragCancel, handleDragEnd, handleCreateColumnSubmit, handleRenameColumn,
    performDeleteColumn, handleDeleteColumn, handleClearColumnCards, handleArchiveColumn,
    handleUpdateCardDetails, handleCardDelete, handleCardConvertToTask, handleAddCardToColumn,
    handleRestoreColumn, handleDeleteColumnPermanently, handleRestoreCard, handleBulkDeleteArchived,
    handleBulkRestoreArchived, handleDeleteArchivedCard
  } = kanbanBoard

  // Loading skeleton view
  if (loading) {
    return (
      <KanbanSkeleton />
    )
  }

  const columnSortableIds = columns.map(c => `col::${c.id}`)

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      background: getBoardBackgroundStyle(boardBg),
      position: 'relative',
      overflow: 'hidden'
    }}>
      {/* Header Bar */}
      <KanbanHeader kanbanBoard={kanbanBoard} />

      {/* Real-Time Filter Toolbar */}
      <KanbanFilterBar kanbanBoard={kanbanBoard} />

      {/* Board Area */}
      {columns.length === 0 ? (
        <div className="flex-1">
          <EmptyState
            icon={<KanbanSquare size={48} />}
            title="No Columns Defined"
            description="Your Kanban board needs columns to structure your workflow tasks."
            actionLabel="Add Columns"
            onActionClick={() => setShowAddColModal(true)}
          />
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={collisionDetection}
          measuring={{
            droppable: {
              strategy: MeasuringStrategy.WhileDragging
            }
          }}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
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
              height: 'calc(100% - 98px)', // Adjusted for header (52px) + filter toolbar (46px)
              minHeight: 0
            }}>
              {columns.map(col => {
                const colCards = getCardsForColumn(col.id)
                // The gap is only drawn for a card arriving from elsewhere.
                // Reordering inside a column already parts the list through
                // dnd-kit's sortable transforms, and both at once would be the
                // same thing said twice.
                const foreign = activeDragCard !== null && activeDragCard.status !== col.id
                // A column that sorts itself would move the card out of the gap
                // the moment it landed in it, so it gets the highlight and no
                // promise about where.
                const aimable = canAimAtSlot(col, swimlanesEnabled)
                const slot = foreign && aimable && dropTarget?.column === col.id
                  ? (dropTarget.before === null
                      ? colCards.length
                      : colCards.findIndex(c => c.id === dropTarget.before))
                  : -1
                return (
                <SortableColumn
                  key={col.id}
                  col={col}
                  cards={colCards}
                  dropSlot={slot === -1 ? null : slot}
                  dropHeight={dragHeight}
                  onRename={handleRenameColumn}
                  onDelete={handleDeleteColumn}
                  onCardClick={setActiveCardId}
                  onCardDelete={handleCardDelete}
                  onCardConvertToTask={handleCardConvertToTask}
                  onAddCard={handleAddCardToColumn}
                  onCardUpdate={handleUpdateCardDetails}
                  onClearColumn={handleClearColumnCards}
                  onArchiveColumn={handleArchiveColumn}
                  isReadOnly={isReadOnlyMode}
                  onToggleCollapse={handleToggleCollapse}
                  onSetSort={handleSetColumnSort}
                  cardDisplay={cardDisplay}
                />
                )
              })}

              {/* Ghost "Add Column" tile at end */}
              {!isReadOnlyMode && (
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
              )}
            </div>
          </SortableContext>

          <DragOverlay dropAnimation={null}>
            {activeDragCard ? (
              <div style={{ width: '280px', pointerEvents: 'none' }}>
                <KanbanCard
                  card={activeDragCard}
                  onClick={() => {}}
                  onDelete={() => {}}
                  onConvertToTask={() => {}}
                  isOverlay
                />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}

      {/* Archive Bin Drawer */}
      {showArchiveBin && (
        <ArchiveBin
          archivedColumns={archivedColumns}
          cards={cards}
          selectedIds={selectedArchived}
          setSelected={setSelectedArchived}
          onClose={closeArchiveBin}
          onRestoreColumn={handleRestoreColumn}
          onDeleteColumn={handleDeleteColumnPermanently}
          onRestoreCard={handleRestoreCard}
          onDeleteCard={handleDeleteArchivedCard}
          onBulkRestore={handleBulkRestoreArchived}
          onBulkDelete={handleBulkDeleteArchived}
        />
      )}


      {/* Card Detail Modal */}
      {activeCardId && (
        <CardDetailModal
          cardId={activeCardId}
          initialCard={cards.find(c => c.id === activeCardId)}
          columns={columns}
          onClose={() => setActiveCardId(null)}
          onUpdate={handleUpdateCardDetails}
          cardDisplay={cardDisplay}
          isReadOnly={isReadOnlyMode}
        />
      )}

      {/* Add Column Modal */}
      {showAddColModal && (
        <AddColumnModal
          onClose={() => setShowAddColModal(false)}
          onSubmit={handleCreateColumnSubmit}
          existingNames={columns.map(c => c.name)}
        />
      )}

      {/* Column Delete Confirmation Dialog */}
      <ConfirmDialog
        isOpen={pendingDeleteColId !== null}
        title="Confirm Column Deletion"
        message="Are you sure you want to delete this column? Any cards inside this column will be moved to the open backlog."
        confirmText="Delete Column"
        cancelText="Cancel"
        isDestructive={true}
        onConfirm={() => pendingDeleteColId && performDeleteColumn(pendingDeleteColId)}
        onCancel={() => setPendingDeleteColId(null)}
      />
    </div>
  )
}
