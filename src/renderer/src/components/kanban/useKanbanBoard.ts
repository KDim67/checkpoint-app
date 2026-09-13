import { useBoardState } from './useBoardState'
import { useBoardDrag } from './useBoardDrag'
import { useBoardActions } from './useBoardActions'

/**
 * The board and everything done to it: loading, drag and drop, columns, cards
 * and the archive. KanbanView draws the columns from it, and its header and
 * filter bar take it as one prop.
 */
export function useKanbanBoard() {
  const boardState = useBoardState()
  const boardDrag = useBoardDrag(boardState)
  const boardActions = useBoardActions(boardState)
  const {
    activeWorkspace, availableWorkspaces, workspaceList, setWorkspace, setView, setSettingsTab,
    dropdownOpen, setDropdownOpen, dropdownRef, cards, columns, swimlanesEnabled,
    setSwimlanesEnabled, cardDisplay, setCardDisplay, showCardDisplayMenu, setShowCardDisplayMenu,
    cardDisplayRef, loading, persistConfig, handleToggleCollapse, handleSetColumnSort,
    showAddColModal, setShowAddColModal, activeCardId, setActiveCardId, activeDragCard, dropTarget,
    dragHeight, pendingDeleteColId, setPendingDeleteColId, theme, boardBg, searchQuery,
    setSearchQuery, filterPriority, setFilterPriority, filterTagId, setFilterTagId, allTags,
    archivedColumns, showArchiveBin, setShowArchiveBin, closeArchiveBin, selectedArchived,
    setSelectedArchived, showTemplateSelector, setShowTemplateSelector, collab, isReadOnlyMode,
    sensors
  } = boardState
  const {
    getCardsForColumn, collisionDetection, handleDragStart, handleDragOver, handleDragCancel,
    handleDragEnd
  } = boardDrag
  const {
    handleCreateColumnSubmit, handleRenameColumn, performDeleteColumn, handleDeleteColumn,
    handleClearColumnCards, handleArchiveColumn, handleUpdateCardDetails, handleCardDelete,
    handleCardConvertToTask, handleAddCardToColumn, handleCreateCardFromTemplate,
    handleRestoreColumn, handleDeleteColumnPermanently, handleRestoreCard, handleBulkDeleteArchived,
    handleBulkRestoreArchived, handleDeleteArchivedCard, templateCards
  } = boardActions

  return {
    activeWorkspace,
    availableWorkspaces,
    workspaceList,
    setWorkspace,
    setView,
    setSettingsTab,
    dropdownOpen,
    setDropdownOpen,
    dropdownRef,
    cards,
    columns,
    swimlanesEnabled,
    setSwimlanesEnabled,
    cardDisplay,
    setCardDisplay,
    showCardDisplayMenu,
    setShowCardDisplayMenu,
    cardDisplayRef,
    loading,
    persistConfig,
    handleToggleCollapse,
    handleSetColumnSort,
    showAddColModal,
    setShowAddColModal,
    activeCardId,
    setActiveCardId,
    activeDragCard,
    dropTarget,
    dragHeight,
    pendingDeleteColId,
    setPendingDeleteColId,
    theme,
    boardBg,
    searchQuery,
    setSearchQuery,
    filterPriority,
    setFilterPriority,
    filterTagId,
    setFilterTagId,
    allTags,
    archivedColumns,
    showArchiveBin,
    setShowArchiveBin,
    closeArchiveBin,
    selectedArchived,
    setSelectedArchived,
    showTemplateSelector,
    setShowTemplateSelector,
    collab,
    isReadOnlyMode,
    sensors,
    getCardsForColumn,
    collisionDetection,
    handleDragStart,
    handleDragOver,
    handleDragCancel,
    handleDragEnd,
    handleCreateColumnSubmit,
    handleRenameColumn,
    performDeleteColumn,
    handleDeleteColumn,
    handleClearColumnCards,
    handleArchiveColumn,
    handleUpdateCardDetails,
    handleCardDelete,
    handleCardConvertToTask,
    handleAddCardToColumn,
    handleCreateCardFromTemplate,
    handleRestoreColumn,
    handleDeleteColumnPermanently,
    handleRestoreCard,
    handleBulkDeleteArchived,
    handleBulkRestoreArchived,
    handleDeleteArchivedCard,
    templateCards
  }
}

export type KanbanBoard = ReturnType<typeof useKanbanBoard>
