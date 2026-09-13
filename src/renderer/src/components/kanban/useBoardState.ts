import React, { useState, useEffect, useCallback, useRef } from 'react'
import type { Tag } from '../../../../shared/types'
import { useSensor, useSensors, PointerSensor, KeyboardSensor } from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { useAppStore } from '../../store/appStore'
import type { Item } from '../../../../shared/types'
import { useConfirm } from '../ui/ConfirmDialog'
import { useToast } from '../ui/Toast'
import { loadBoardConfig, patchBoardConfig, DEFAULT_CARD_DISPLAY, type BoardConfig, type CardDisplay, type ColumnConfig, type ColumnSort } from '../../lib/boardConfig'
import type { DropTarget } from '../../../../shared/cardDrop'
import { listTags } from '../../data/tags'
import { readItems } from '../../data/items'
import { useCollabSession } from './useCollabSession'
import { useBoardTheme } from './useBoardTheme'

/**
 * The board and how it loads: columns, cards, tags, the archive, the card face
 * and filter settings, and the writes every other part of the board goes
 * through.
 */
export function useBoardState() {
  const activeWorkspace = useAppStore(s => s.activeWorkspace)
  const availableWorkspaces = useAppStore(s => s.availableWorkspaces)
  const workspaceList = useAppStore(s => s.workspaceList)
  const setWorkspace = useAppStore(s => s.setWorkspace)
  const setView = useAppStore(s => s.setView)
  const setSettingsTab = useAppStore(s => s.setSettingsTab)

  const [dropdownOpen, setDropdownOpen] = useState(false)
  const dropdownRef = React.useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!dropdownOpen) return
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [dropdownOpen])

  const { toast } = useToast()
  const confirm = useConfirm()

  const [cards, setCards] = useState<Item[]>([])
  const [columns, setColumns] = useState<ColumnConfig[]>([])
  const [swimlanesEnabled, setSwimlanesEnabled] = useState(false)
  const [cardDisplay, setCardDisplay] = useState<CardDisplay>(DEFAULT_CARD_DISPLAY)
  const [showCardDisplayMenu, setShowCardDisplayMenu] = useState(false)
  const cardDisplayRef = useRef<HTMLDivElement>(null)
  const [loading, setLoading] = useState(true)

  // Always-latest columns snapshot. Column mutations read/write through this so
  // two quick edits (e.g. deleting two columns in a row) can never operate on a
  // stale closure and resurrect a just-removed column.
  const columnsRef = useRef<ColumnConfig[]>([])
  useEffect(() => { columnsRef.current = columns }, [columns])

  // Single source of truth for writing the column list: updates the ref
  // synchronously, the state, and the persisted setting the AI also reads.
  /**
   * Whether this side may write the board document.
   *
   * A ref because the persistence layer is defined above the collaboration
   * state it depends on, and written during render rather than in an effect so
   * it is never a frame behind the permission it stands for.
   */
  const readOnlyRef = useRef(false)

  const persistColumns = useCallback(async (next: ColumnConfig[]): Promise<void> => {
    // The board document travels between peers now, so a guest with no right to
    // change the board has no right to change this either.
    if (readOnlyRef.current) return
    columnsRef.current = next
    setColumns(next)
    try {
      await patchBoardConfig(activeWorkspace, { columns: next })
    } catch (err) {
      console.error('Failed to persist columns:', err)
    }
  }, [activeWorkspace])

  /** Writes any other slice of the board document; state is set by the caller. */
  const persistConfig = useCallback(async (patch: Partial<BoardConfig>): Promise<void> => {
    if (readOnlyRef.current) return
    try {
      await patchBoardConfig(activeWorkspace, patch)
    } catch (err) {
      console.error('Failed to persist board config:', err)
    }
  }, [activeWorkspace])

  /** Applies a change to one column and persists the whole list. */
  const updateColumn = useCallback((colId: string, patch: Partial<ColumnConfig>): void => {
    const next = columnsRef.current.map(c => (c.id === colId ? { ...c, ...patch } : c))
    persistColumns(next)
  }, [persistColumns])

  const handleToggleCollapse = useCallback((colId: string): void => {
    const col = columnsRef.current.find(c => c.id === colId)
    updateColumn(colId, { collapsed: !col?.collapsed })
  }, [updateColumn])

  const handleSetColumnSort = useCallback((colId: string, sort: ColumnSort): void => {
    updateColumn(colId, { sort })
  }, [updateColumn])

  const [showAddColModal, setShowAddColModal] = useState(false)
  const [activeCardId, setActiveCardId] = useState<string | null>(null)

  const rightPanelOpen = useAppStore(s => s.rightPanelOpen)

  // Mutual exclusivity between Card details drawer and AI assistant panel
  useEffect(() => {
    if (activeCardId) {
      const store = useAppStore.getState()
      if (store.rightPanelOpen) {
        store.setRightPanelContent(null)
      }
    }
  }, [activeCardId])

  useEffect(() => {
    if (rightPanelOpen) setActiveCardId(null)
  }, [rightPanelOpen])

  const [activeDragCard, setActiveDragCard] = useState<Item | null>(null)
  /**
   * Where the card in the air would land.
   *
   * State on the board rather than each column reading the drag context for
   * itself. The context's value changes on every pointer move, so every column
   * on the board re-rendered on every frame of every drag just to work out that
   * nothing about it had changed. This changes when the target changes, which
   * during a whole drag is a handful of times.
   */
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null)
  /** The height the dragged card had before it was picked up. */
  const [dragHeight, setDragHeight] = useState(0)
  const [pendingDeleteColId, setPendingDeleteColId] = useState<string | null>(null)

  // Advanced Kanban States
  const theme = useBoardTheme()
  const { boardBg, setBoardBg } = theme
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [filterPriority, setFilterPriority] = useState<number>(-1)
  const [filterTagId, setFilterTagId] = useState<string>('all')
  const [allTags, setAllTags] = useState<Tag[]>([])

  const [archivedColumns, setArchivedColumns] = useState<ColumnConfig[]>([])
  /**
   * The archive list as it stands. The columns keep whichever archive handler
   * they last rendered with, so a handler reading state would see the list as
   * it was when the board loaded and write that back over the real one.
   */
  const archivedColumnsRef = useRef<ColumnConfig[]>([])
  useEffect(() => { archivedColumnsRef.current = archivedColumns }, [archivedColumns])
  const [showArchiveBin, setShowArchiveBin] = useState(false)
  const closeArchiveBin = useCallback(() => setShowArchiveBin(false), [])
  const [selectedArchived, setSelectedArchived] = useState<Set<string>>(new Set())
  const [showTemplateSelector, setShowTemplateSelector] = useState(false)

  const collab = useCollabSession()
  const isReadOnlyMode = collab.isReadOnly
  readOnlyRef.current = isReadOnlyMode

  // Sensors: use a distance threshold to distinguish click vs drag
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  // Click Outside Closures
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (cardDisplayRef.current && !cardDisplayRef.current.contains(e.target as Node)) {
        setShowCardDisplayMenu(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Data Loading

  const loadColumns = useCallback(async () => {
    try {
      // One document now covers columns, background, swimlanes and the archive
      // bin, so this is a single read where it used to be four. loadBoardConfig
      // holds the same `kanban-cols:` lock the AI action blocks take, which is
      // what stops the board bootstrap and a concurrent AI write from both
      // seeing "empty" and each installing its own default column set.
      const config = await loadBoardConfig(activeWorkspace)
      setColumns(config.columns)
      setSwimlanesEnabled(config.swimlanes)
      setBoardBg(config.background)
      setArchivedColumns(config.archivedColumns)
      setCardDisplay(config.cardDisplay)
    } catch (err) {
      console.error('Failed to load Kanban column settings:', err)
    }
  }, [activeWorkspace, setBoardBg])

  const loadCards = useCallback(async () => {
    try {
      setCards(await readItems(activeWorkspace, 'card'))
    } catch (err) {
      console.error('Failed to load Kanban cards:', err)
    }
  }, [activeWorkspace])

  const loadTags = useCallback(async () => {
    try {
      const tags = await listTags()
      setAllTags(tags)
    } catch (err) {
      console.error('Failed to load tags:', err)
    }
  }, [])

  const initializeBoard = useCallback(async () => {
    setLoading(true)
    await Promise.all([loadColumns(), loadCards(), loadTags()])
    setLoading(false)
  }, [loadColumns, loadCards, loadTags])

  useEffect(() => {
    initializeBoard()
  }, [initializeBoard])

  useEffect(() => {
    const handleBoardUpdate = () => {
      loadCards()
      loadColumns()
    }
    window.addEventListener('item-updated', handleBoardUpdate)
    window.addEventListener('kanban-refresh', handleBoardUpdate)
    return () => {
      window.removeEventListener('item-updated', handleBoardUpdate)
      window.removeEventListener('kanban-refresh', handleBoardUpdate)
    }
  }, [loadCards, loadColumns])


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
    toast,
    confirm,
    cards,
    setCards,
    columns,
    setColumns,
    swimlanesEnabled,
    setSwimlanesEnabled,
    cardDisplay,
    setCardDisplay,
    showCardDisplayMenu,
    setShowCardDisplayMenu,
    cardDisplayRef,
    loading,
    columnsRef,
    persistColumns,
    persistConfig,
    handleToggleCollapse,
    handleSetColumnSort,
    showAddColModal,
    setShowAddColModal,
    activeCardId,
    setActiveCardId,
    activeDragCard,
    setActiveDragCard,
    dropTarget,
    setDropTarget,
    dragHeight,
    setDragHeight,
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
    setArchivedColumns,
    archivedColumnsRef,
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
    loadCards
  }
}

export type BoardState = ReturnType<typeof useBoardState>
