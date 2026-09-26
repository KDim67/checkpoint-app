import React, { useState, useEffect, useCallback, useRef } from 'react'
import type { Tag } from '../../../../shared/types'
import { useSensor, useSensors, PointerSensor, KeyboardSensor } from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { useAppStore } from '../../store/appStore'
import type { Item } from '../../../../shared/types'
import { useConfirm } from '../ui/ConfirmDialog'
import { useToast } from '../ui/Toast'
import { errorMessage } from '../../../../shared/errors'
import { loadBoardConfig, patchBoardConfig, DEFAULT_CARD_DISPLAY, type BoardConfig, type CardDisplay, type ColumnConfig, type ColumnSort } from '../../lib/boardConfig'
import type { DropTarget } from '../../../../shared/cardDrop'
import { listTags } from '../../data/tags'
import { readItems } from '../../data/items'
import { useCollab } from '../../context/CollabContext'
import { useBoardTheme } from './useBoardTheme'

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

  // latest columns, so two quick edits can't resurrect a removed column
  const columnsRef = useRef<ColumnConfig[]>([])
  useEffect(() => { columnsRef.current = columns }, [columns])

  /** a ref, written during render so it's never a frame behind the permission */
  const readOnlyRef = useRef(false)

  /** true once saved; a failure says so and puts the columns back, so the screen never shows what isn't on disk */
  const persistColumns = useCallback(async (next: ColumnConfig[]): Promise<boolean> => {
    // the board doc travels between peers, a read-only guest can't change it
    if (readOnlyRef.current) return false
    const before = columnsRef.current
    columnsRef.current = next
    setColumns(next)
    try {
      await patchBoardConfig(activeWorkspace, { columns: next })
      return true
    } catch (err) {
      console.error('Failed to persist columns:', err)
      columnsRef.current = before
      setColumns(before)
      toast(`Could not save the columns: ${errorMessage(err)}`, { type: 'error' })
      return false
    }
  }, [activeWorkspace, toast])

  /** state is set by the caller, which puts it back when this answers false; the failure is said here */
  const persistConfig = useCallback(async (patch: Partial<BoardConfig>): Promise<boolean> => {
    if (readOnlyRef.current) return false
    try {
      await patchBoardConfig(activeWorkspace, patch)
      return true
    } catch (err) {
      console.error('Failed to persist board config:', err)
      toast(`Could not save the board: ${errorMessage(err)}`, { type: 'error' })
      return false
    }
  }, [activeWorkspace, toast])

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

  // card drawer and AI panel are mutually exclusive
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
  /** state on the board: the drag context changes every move and re-rendered every column */
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null)
  const [dragHeight, setDragHeight] = useState(0)
  const [pendingDeleteColId, setPendingDeleteColId] = useState<string | null>(null)

  const theme = useBoardTheme()
  const { boardBg, setBoardBg } = theme
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [filterPriority, setFilterPriority] = useState<number>(-1)
  const [filterTagId, setFilterTagId] = useState<string>('all')
  const [allTags, setAllTags] = useState<Tag[]>([])

  const [archivedColumns, setArchivedColumns] = useState<ColumnConfig[]>([])
  /** columns keep stale archive handlers, so read the live list via ref */
  const archivedColumnsRef = useRef<ColumnConfig[]>([])
  useEffect(() => { archivedColumnsRef.current = archivedColumns }, [archivedColumns])
  const [showArchiveBin, setShowArchiveBin] = useState(false)
  const closeArchiveBin = useCallback(() => setShowArchiveBin(false), [])
  const [selectedArchived, setSelectedArchived] = useState<Set<string>>(new Set())
  const [showTemplateSelector, setShowTemplateSelector] = useState(false)

  const collab = useCollab()
  const isReadOnlyMode = collab.isReadOnly
  readOnlyRef.current = isReadOnlyMode

  // distance threshold tells click from drag
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (cardDisplayRef.current && !cardDisplayRef.current.contains(e.target as Node)) {
        setShowCardDisplayMenu(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const loadColumns = useCallback(async () => {
    try {
      // one doc covers columns, background, swimlanes and archive; the shared lock stops two default column sets
      const config = await loadBoardConfig(activeWorkspace)
      setColumns(config.columns)
      setSwimlanesEnabled(config.swimlanes)
      setBoardBg(config.background)
      setArchivedColumns(config.archivedColumns)
      setCardDisplay(config.cardDisplay)
    } catch (err) {
      console.error('Failed to load Kanban column settings:', err)
      toast(`Could not load the board's columns: ${errorMessage(err)}`, { type: 'error' })
    }
  }, [activeWorkspace, setBoardBg, toast])

  const loadCards = useCallback(async () => {
    try {
      setCards(await readItems(activeWorkspace, 'card'))
    } catch (err) {
      console.error('Failed to load Kanban cards:', err)
      toast(`Could not load the cards: ${errorMessage(err)}`, { type: 'error' })
    }
  }, [activeWorkspace, toast])

  const loadTags = useCallback(async () => {
    try {
      const tags = await listTags()
      setAllTags(tags)
    } catch (err) {
      console.error('Failed to load tags:', err)
      toast(`Could not load the tags: ${errorMessage(err)}`, { type: 'error' })
    }
  }, [toast])

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
