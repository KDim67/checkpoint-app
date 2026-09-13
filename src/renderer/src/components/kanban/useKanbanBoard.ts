import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import type { Tag } from '../../../../shared/types'
import { DragEndEvent, DragOverEvent, DragStartEvent, useSensor, useSensors, PointerSensor, KeyboardSensor, rectIntersection, CollisionDetection } from '@dnd-kit/core'
import { sortableKeyboardCoordinates, arrayMove } from '@dnd-kit/sortable'
import { useAppStore } from '../../store/appStore'
import type { Item } from '../../../../shared/types'
import { useConfirm } from '../ui/ConfirmDialog'
import { useToast } from '../ui/Toast'
import { loadBoardConfig, patchBoardConfig, DEFAULT_CARD_DISPLAY, type BoardConfig, type CardDisplay, type ColumnConfig, type ColumnSort } from '../../lib/boardConfig'
import { dropIndex, dropTargetAt, lastCardIn, positionForIndex, type CardBox, type ColumnBox, type DropTarget } from '../../../../shared/cardDrop'
import { listTags } from '../../data/tags'
import { bulkUpdateItems, createItem, deleteItem, readItems, rebalancePositions, updateItem } from '../../data/items'
import { useCollabSession } from './useCollabSession'
import { useBoardTheme } from './useBoardTheme'
import { cardFromTemplate, isTemplateCard } from '../../../../shared/cardTemplates'
import { canAimAtSlot } from './dropSlots'

/**
 * What the collision detector needs to know that the rectangles do not say:
 * which droppables are columns, which are cards and whose column each card is
 * in.
 *
 * Worked out from the board's own state rather than from the ids, because the
 * ids do not carry it. Columns register under their own id and cards under
 * theirs, but so does each column's sortable, under a `col::` id, and reading
 * "not a column id" as "a card" is what silently sent every drop to the end of
 * the first column.
 */
interface DropGeometry {
  /** Column id to whether a drop can pick a slot in it rather than just land in it. */
  columns: Map<string, boolean>
  cardColumn: Map<string, string>
}

// Shared stable reference for empty columns, so the memoized column never
// re-renders just because it received a freshly-allocated [] each render.
const EMPTY_ITEMS: Item[] = []

/**
 * The board and everything done to it: loading, drag and drop, columns, cards
 * and the archive. KanbanView draws the columns from it, and its header and
 * filter bar take it as one prop.
 */
export function useKanbanBoard() {
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

  // Cards for a column, filtered and sorted appropriately
  // Group + filter + sort all cards into their columns in a SINGLE pass, memoized
  // on the inputs. Previously each column re-filtered the whole card list on every
  // render, and a drag renders the board repeatedly, so that was O(columns × cards)
  // per frame. The main source of drag lag. Now it's one pass, and card object refs
  // are preserved so the memoized columns only re-render when their own cards
  // actually change.
  //
  // It sits above the drag handlers because it is the order the user is looking
  // at, and that is the order a drop has to be worked out against.
  const cardsByColumn = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    const map = new Map<string, Item[]>()
    for (const c of cards) {
      if (c.status === 'archived') continue
      if (q && !(
        c.title.toLowerCase().includes(q) ||
        c.body.toLowerCase().includes(q) ||
        (c.tags && c.tags.some(t => t.name.toLowerCase().includes(q)))
      )) continue
      if (filterPriority !== -1 && c.priority !== filterPriority) continue
      if (filterTagId !== 'all' && !(c.tags && c.tags.some(t => t.id === filterTagId))) continue
      let arr = map.get(c.status)
      if (!arr) { arr = []; map.set(c.status, arr) }
      arr.push(c)
    }
    // Sorting stays inside this single pass. Applying a per-column order as a
    // second pass over the map would reintroduce the per-frame work this memo
    // exists to avoid during a drag.
    const byPosition = (a: Item, b: Item): number => a.position - b.position
    const byPriority = (a: Item, b: Item): number =>
      b.priority !== a.priority ? b.priority - a.priority : a.position - b.position
    // Cards with no due date sort last rather than reading as "due first".
    const byDue = (a: Item, b: Item): number => {
      if (!a.due_at && !b.due_at) return a.position - b.position
      if (!a.due_at) return 1
      if (!b.due_at) return -1
      return a.due_at - b.due_at || a.position - b.position
    }

    const sortModes = new Map(columns.map(c => [c.id, c.sort ?? 'manual']))
    for (const [colId, arr] of map) {
      // Swimlanes are a board-wide priority grouping and outrank a column's own
      // order; without that the two settings would visibly contradict.
      if (swimlanesEnabled) { arr.sort(byPriority); continue }
      const mode = sortModes.get(colId) ?? 'manual'
      arr.sort(mode === 'priority' ? byPriority : mode === 'due' ? byDue : byPosition)
    }
    return map
  }, [cards, searchQuery, filterPriority, filterTagId, swimlanesEnabled, columns])

  const getCardsForColumn = useCallback(
    (columnId: string): Item[] => cardsByColumn.get(columnId) || EMPTY_ITEMS,
    [cardsByColumn]
  )

  // Drag & Drop

  /**
   * Kept in a ref because the collision detector runs on every pointer move and
   * must not be rebuilt under the drag each time a card changes.
   */
  const dropGeometryRef = useRef<DropGeometry>({ columns: new Map(), cardColumn: new Map() })
  useEffect(() => {
    const columnOrder = new Map<string, boolean>()
    for (const col of columns) columnOrder.set(col.id, canAimAtSlot(col, swimlanesEnabled))
    const cardColumn = new Map<string, string>()
    for (const card of cards) cardColumn.set(card.id, card.status)
    dropGeometryRef.current = { columns: columnOrder, cardColumn }
  }, [columns, cards, swimlanesEnabled])

  /**
   * Which droppable the card in the air is aimed at.
   *
   * dnd-kit's own detectors answer "which rectangle is the pointer inside", and
   * the gaps between cards are inside no card at all, so a pointer resting in
   * one fell through to the column, and the column means the end of the list.
   * That is the jump to the bottom. This asks the question the user is actually
   * asking, which card would I end up above, and cardDrop answers it against
   * the midpoints, so a gap belongs to the card either side of it.
   */
  const collisionDetection = useCallback<CollisionDetection>(args => {
    // Dragging a column is a different gesture with different targets: the
    // other columns, hit by the dragged column's own rectangle.
    if (String(args.active.id).startsWith('col::')) return rectIntersection(args)

    // The keyboard sensor moves a rectangle rather than a pointer, so its
    // centre stands in for one and the same rules apply.
    const point = args.pointerCoordinates ?? {
      x: args.collisionRect.left + args.collisionRect.width / 2,
      y: args.collisionRect.top + args.collisionRect.height / 2
    }

    const { columns: columnOrder, cardColumn } = dropGeometryRef.current
    const columnBoxes: ColumnBox[] = []
    const cardBoxes: CardBox[] = []
    for (const container of args.droppableContainers) {
      const rect = container.rect.current
      if (!rect) continue
      const id = String(container.id)
      if (columnOrder.has(id)) {
        columnBoxes.push({ id, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom })
        continue
      }
      // Anything that is neither a known column nor a known card is left alone
      // rather than guessed at. Each column registers a sortable of its own
      // under a `col::` id, and reading those as cards is what once sent every
      // drop to the end of the first column.
      const column = cardColumn.get(id)
      if (column) cardBoxes.push({ id, column, top: rect.top, height: rect.height })
    }

    const target = dropTargetAt(columnBoxes, cardBoxes, point)
    if (!target) return []
    if (columnOrder.get(target.column) !== true) return [{ id: target.column }]

    // Past the last card of the card's own column. dnd-kit can only preview a
    // move onto another card, so naming the column here parts nothing and the
    // drag looks dead. Aiming at the bottom card says the same thing: with this
    // card lifted out of the list, taking the bottom card's slot is the end of
    // it. A column holding nothing but the dragged card names the card itself,
    // which is the drag that changes nothing.
    const before = target.before ?? (
      cardColumn.get(String(args.active.id)) === target.column
        ? lastCardIn(cardBoxes, target.column)
        : null
    )
    return [{ id: before ?? target.column }]
  }, [])

  const handleDragStart = useCallback((event: DragStartEvent) => {
    if (isReadOnlyMode) return
    const { active } = event
    const id = active.id as string
    if (id.startsWith('col::')) return
    setCards(currentCards => {
      const found = currentCards.find(c => c.id === id)
      if (found) setActiveDragCard(found)
      return currentCards
    })
    // Read here because the card is about to be lifted out of the layout, and
    // the gap held open for it should be the footprint it will really take.
    setDragHeight(active.rect.current.initial?.height ?? 0)
  }, [isReadOnlyMode])

  /**
   * Where the card would land, not a move of it.
   *
   * Actually moving the card into the hovered column here is what the board
   * used to do, and it unmounted and remounted the card in a different
   * SortableContext every time, which is what made a cross-column drag crawl.
   * dnd-kit calls this only when the target changes, so noting the target costs
   * one render per target rather than one per frame, and the column draws the
   * gap for itself. Reordering inside a column still previews through dnd-kit's
   * own sortable transforms.
   */
  const handleDragOver = useCallback((event: DragOverEvent) => {
    if (isReadOnlyMode) return
    const { active, over } = event
    if (String(active.id).startsWith('col::')) return
    if (!over) {
      setDropTarget(null)
      return
    }
    const overId = String(over.id)
    const { columns: columnOrder, cardColumn } = dropGeometryRef.current
    if (columnOrder.has(overId)) {
      setDropTarget({ column: overId, before: null })
      return
    }
    const column = cardColumn.get(overId)
    setDropTarget(column ? { column, before: overId } : null)
  }, [isReadOnlyMode])

  const endDrag = useCallback(() => {
    setActiveDragCard(null)
    setDropTarget(null)
  }, [])

  const handleDragCancel = useCallback(() => {
    endDrag()
    loadCards()
  }, [endDrag, loadCards])

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    // Before the read-only check, because the overlay and the gap have to be
    // put away whether or not the drop is allowed to land.
    endDrag()
    if (isReadOnlyMode) return
    const { active, over } = event

    if (!over || active.id === over.id) return

    const activeId = String(active.id)
    const overId = String(over.id)

    // Column reorder: ids are prefixed with "col::"
    if (activeId.startsWith('col::')) {
      const current = columnsRef.current
      const fromIdx = current.findIndex(c => `col::${c.id}` === activeId)
      const toIdx   = current.findIndex(c => `col::${c.id}` === overId)
      if (fromIdx === -1 || toIdx === -1) return
      await persistColumns(arrayMove(current, fromIdx, toIdx))
      return
    }

    // Card move / reorder
    const cardId = activeId
    const draggedCard = cards.find(c => c.id === cardId)
    if (!draggedCard) return

    const isColumnTarget = columns.some(c => c.id === overId)
    const newStatus = isColumnTarget ? overId : cards.find(c => c.id === overId)?.status
    if (!newStatus) return

    // The destination column in the order the user is looking at. The gap was
    // drawn into this same list, so working the position out from any other
    // order is how a card ends up somewhere other than where the gap was.
    const order = cardsByColumn.get(newStatus) ?? EMPTY_ITEMS
    const rest = order.filter(c => c.id !== cardId)
    const index = dropIndex(order.map(c => c.id), cardId, isColumnTarget ? null : overId)
    const newPosition = positionForIndex(rest.map(c => c.position), index)

    // Swimlanes group the whole board by priority, so which lane a card is
    // dropped into is a choice of priority as much as a choice of place.
    const neighbour = rest[index] ?? rest[index - 1]
    const newPriority = swimlanesEnabled ? (neighbour?.priority ?? draggedCard.priority) : undefined

    // A null position means the cards either side of the gap already hold
    // numbers with nothing between them. Take the lower one and renumber the
    // column, which is the only thing that makes room.
    const needsRebalance = newPosition === null
    const patch: Partial<Item> = {
      status: newStatus,
      position: newPosition ?? rest[index].position
    }
    if (newPriority !== undefined) patch.priority = newPriority

    setCards(prev => prev.map(c => c.id === cardId ? { ...c, ...patch } : c))
    try {
      await updateItem(cardId, patch)
      if (needsRebalance) {
        await rebalancePositions(activeWorkspace, newStatus)
        loadCards()
      }
    } catch (err) {
      console.error('Failed to update card position:', err)
      loadCards()
    }
  }, [cards, cardsByColumn, columns, swimlanesEnabled, activeWorkspace, loadCards, persistColumns, endDrag, isReadOnlyMode])

  // Column Management

  const handleCreateColumnSubmit = async (name: string, wipLimit: number | null, color?: string, colorMode?: 'header' | 'full', description?: string) => {
    const id = `col-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now()}`
    const updatedCols = [...columnsRef.current, { id, name, wipLimit, color, colorMode, description }]
    try {
      await persistColumns(updatedCols)
      setShowAddColModal(false)
      toast(`Column "${name}" created`)
    } catch (err) {
      console.error('Failed to create column:', err)
    }
  }

  const handleRenameColumn = useCallback(async (colId: string, newName: string, newWipLimit: number | null, color?: string, colorMode?: 'header' | 'full') => {
    const updatedCols = columnsRef.current.map(c => c.id === colId ? { ...c, name: newName, wipLimit: newWipLimit, color, colorMode } : c)
    await persistColumns(updatedCols)
    toast(`Column "${newName}" updated`)
  }, [persistColumns, toast])

  const performDeleteColumn = useCallback(async (colId: string) => {
    // Read the LATEST columns (via ref) so deleting two in a row can't operate on
    // a stale list and write back a column that was just removed.
    const current = columnsRef.current
    const colName = current.find(c => c.id === colId)?.name || 'Column'
    const updatedCols = current.filter(c => c.id !== colId)
    try {
      const cardsToMove = cards.filter(c => c.status === colId)
      if (cardsToMove.length > 0) {
        const fallbackColId = updatedCols[0]?.id ?? 'open'
        await bulkUpdateItems({
          ids: cardsToMove.map(c => c.id),
          patch: { status: fallbackColId }
        })
      }
      await persistColumns(updatedCols)
      setPendingDeleteColId(null)
      loadCards()
      toast(`Column "${colName}" deleted. Remaining cards moved.`)
    } catch (err) {
      console.error('Failed to delete column:', err)
    }
  }, [cards, persistColumns, loadCards, toast])

  const handleDeleteColumn = useCallback(async (colId: string) => {
    const cardsToMove = cards.filter(c => c.status === colId)
    if (cardsToMove.length > 0) {
      setPendingDeleteColId(colId)
    } else {
      await performDeleteColumn(colId)
    }
  }, [cards, performDeleteColumn])

  // Column sorting & bulk actions

  const handleClearColumnCards = useCallback(async (columnId: string) => {
    const colCards = cards.filter(c => c.status === columnId)
    if (colCards.length === 0) return

    try {
      await bulkUpdateItems({
        ids: colCards.map(c => c.id),
        patch: { status: 'archived' }
      })
      loadCards()
      toast(`Archived all cards in column`)
    } catch (err) {
      console.error(err)
    }
  }, [cards, loadCards, toast])

  const handleArchiveColumn = useCallback(async (colId: string) => {
    const current = columnsRef.current
    const colToArchive = current.find(c => c.id === colId)
    if (!colToArchive) return

    try {
      // Both halves in one patch: archiving moves a column between two lists,
      // and writing them separately left a window where the column existed in
      // neither if the second write failed.
      const updatedArchived = [...archivedColumnsRef.current, colToArchive]
      const updatedCols = current.filter(c => c.id !== colId)
      columnsRef.current = updatedCols
      archivedColumnsRef.current = updatedArchived
      setColumns(updatedCols)
      setArchivedColumns(updatedArchived)
      await persistConfig({ columns: updatedCols, archivedColumns: updatedArchived })
      loadCards()
      toast(`Column "${colToArchive.name}" archived`)
    } catch (err) {
      console.error(err)
    }
  }, [persistConfig, loadCards, toast])

  // Card Management

  const handleUpdateCardDetails = useCallback(async (id: string, patch: Partial<Item>, tagIds?: string[]) => {
    try {
      setCards(prev => prev.map(c => {
        if (c.id === id) {
          const updated = { ...c, ...patch }
          if (tagIds !== undefined) {
            updated.tags = allTags.filter(t => tagIds.includes(t.id))
          }
          return updated
        }
        return c
      }))
      await updateItem(id, patch, tagIds)
      loadCards()
    } catch (err) {
      console.error('Failed to update card details:', err)
    }
  }, [loadCards, allTags])

  const handleCardDelete = useCallback(async (id: string) => {
    try {
      const originalIndex = cards.findIndex(c => c.id === id)
      if (originalIndex === -1) return
      const targetCard = cards[originalIndex]
      await updateItem(id, { status: 'archived' })
      setCards(prev => prev.filter(c => c.id !== id))
      
      toast('Card archived.', {
        action: {
          label: 'Undo',
          onClick: async () => {
            try {
              await updateItem(id, { status: targetCard.status })
              setCards(prev => {
                const updated = [...prev]
                updated.splice(originalIndex, 0, targetCard)
                return updated
              })
              toast('Card restored')
            } catch (err) {
              console.error('Failed to restore card:', err)
            }
          }
        }
      })
    } catch (err) {
      console.error('Failed to delete card:', err)
    }
  }, [cards, toast])

  const handleCardConvertToTask = useCallback(async (id: string) => {
    try {
      const targetCard = cards.find(c => c.id === id)
      await updateItem(id, { type: 'task', status: 'open' })
      setCards(prev => prev.filter(c => c.id !== id))
      toast(`Card "${targetCard?.title}" converted to Backlog Task`)
    } catch (err) {
      console.error('Failed to promote card to task:', err)
    }
  }, [cards, toast])

  const handleAddCardToColumn = useCallback(async (columnId: string) => {
    try {
      const colCards = cards.filter(c => c.status === columnId)
      const defaultPos = colCards.length > 0
        ? Math.max(...colCards.map(c => c.position)) + 1000.0
        : 1000.0
      const created = await createItem({
        type: 'card',
        context: activeWorkspace,
        title: 'New card',
        body: '',
        status: columnId,
        priority: 0,
        position: defaultPos,
        due_at: null,
        metadata: '{}'
      })
      setCards(prev => [...prev, created])
      setActiveCardId(created.id)
    } catch (err) {
      console.error('Failed to create card:', err)
    }
  }, [cards, activeWorkspace])

  // Template Instantiation
  const handleCreateCardFromTemplate = async (templateCard: Item) => {
    setShowTemplateSelector(false)
    try {
      const made = cardFromTemplate(templateCard, columns, cards, activeWorkspace, Date.now())
      if (!made) {
        toast('Add a column first.', { type: 'info' })
        return
      }

      const created = await createItem(made.payload, made.tagIds)

      setCards(prev => [...prev, created])
      setActiveCardId(created.id)
      toast(`Created card from template "${templateCard.title}"`)
    } catch (err) {
      console.error('Failed to create card from template:', err)
    }
  }

  // Archive Bin Restores
  const handleRestoreColumn = async (colId: string) => {
    const colToRestore = archivedColumns.find(c => c.id === colId)
    if (!colToRestore) return

    try {
      // One patch, for the same reason archiving is: a restore that half-failed
      // used to leave the column in both lists at once.
      const updatedCols = [...columns, colToRestore]
      const updatedArchived = archivedColumns.filter(c => c.id !== colId)
      columnsRef.current = updatedCols
      setColumns(updatedCols)
      setArchivedColumns(updatedArchived)
      await persistConfig({ columns: updatedCols, archivedColumns: updatedArchived })

      toast(`Column "${colToRestore.name}" restored`)
    } catch (err) {
      console.error(err)
    }
  }

  const handleDeleteColumnPermanently = async (colId: string) => {
    const colName = archivedColumns.find(c => c.id === colId)?.name || 'Column'
    const confirmed = await confirm({
      title: 'Delete list permanently',
      message: `Permanently delete list "${colName}"? Any cards that belong to this list will remain archived.`,
      confirmText: 'Delete List',
      isDestructive: true
    })
    if (confirmed) {
      try {
        const updatedArchived = archivedColumns.filter(c => c.id !== colId)
        setArchivedColumns(updatedArchived)
        await persistConfig({ archivedColumns: updatedArchived })
        toast(`List "${colName}" deleted permanently`)
      } catch (err) {
        console.error(err)
      }
    }
  }

  const handleRestoreCard = async (cardId: string) => {
    const targetCard = cards.find(c => c.id === cardId)
    if (!targetCard) return

    const fallbackCol = columns[0]
    if (!fallbackCol) {
      toast('Add a column first to restore the card.', { type: 'info' })
      return
    }

    const destColId = columns.some(c => c.id === targetCard.status)
      ? targetCard.status
      : fallbackCol.id

    try {
      await updateItem(cardId, { status: destColId })
      loadCards()
      toast(`Card "${targetCard.title}" restored`)
    } catch (err) {
      console.error(err)
    }
  }

  // Archive Bin multi-select (bulk restore / delete)
  const handleBulkDeleteArchived = async (): Promise<void> => {
    const ids = Array.from(selectedArchived)
    if (ids.length === 0) return
    const confirmed = await confirm({
      title: 'Delete archived cards',
      message: `Permanently delete ${ids.length} archived card${ids.length > 1 ? 's' : ''}? This cannot be undone.`,
      confirmText: 'Delete',
      isDestructive: true
    })
    if (!confirmed) return
    try {
      await Promise.all(ids.map(id => deleteItem(id)))
      setCards(prev => prev.filter(c => !selectedArchived.has(c.id)))
      setSelectedArchived(new Set())
      toast(`${ids.length} card${ids.length > 1 ? 's' : ''} deleted permanently`)
    } catch (err) {
      console.error(err)
      toast('Failed to delete some cards', { type: 'error' })
    }
  }

  const handleBulkRestoreArchived = async (): Promise<void> => {
    const ids = Array.from(selectedArchived)
    if (ids.length === 0) return
    const fallbackCol = columns[0]
    if (!fallbackCol) {
      toast('Add a column first to restore cards.', { type: 'info' })
      return
    }
    try {
      await Promise.all(ids.map(id => {
        const card = cards.find(c => c.id === id)
        const dest = card && columns.some(c => c.id === card.status) ? card.status : fallbackCol.id
        return updateItem(id, { status: dest })
      }))
      setSelectedArchived(new Set())
      loadCards()
      toast(`${ids.length} card${ids.length > 1 ? 's' : ''} restored`)
    } catch (err) {
      console.error(err)
      toast('Failed to restore some cards', { type: 'error' })
    }
  }

  const handleDeleteArchivedCard = async (card: Item): Promise<void> => {
    const confirmed = await confirm({
      title: 'Delete card permanently',
      message: `Permanently delete card "${card.title}"? This cannot be undone.`,
      confirmText: 'Delete',
      isDestructive: true
    })
    if (confirmed) {
      try {
        await deleteItem(card.id)
        setCards(prev => prev.filter(c => c.id !== card.id))
        setSelectedArchived(prev => { const n = new Set(prev); n.delete(card.id); return n })
        toast('Card deleted permanently')
      } catch (err) {
        console.error(err)
      }
    }
  }

  // Clear any archive-bin selection whenever the drawer closes.
  useEffect(() => {
    if (!showArchiveBin) setSelectedArchived(new Set())
  }, [showArchiveBin])

  const templateCards = cards.filter(isTemplateCard)

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
