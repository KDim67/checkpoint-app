import { useEffect, useCallback, useRef, useMemo } from 'react'
import { DragEndEvent, DragOverEvent, DragStartEvent, rectIntersection, CollisionDetection } from '@dnd-kit/core'
import { arrayMove } from '@dnd-kit/sortable'
import type { Item } from '../../../../shared/types'
import { dropIndex, dropTargetAt, lastCardIn, positionForIndex, type CardBox, type ColumnBox } from '../../../../shared/cardDrop'
import { rebalancePositions, updateItem } from '../../data/items'
import { canAimAtSlot } from './dropSlots'
import type { BoardState } from './useBoardState'

/** columns, cards and each card's column, from board state: a col:: sortable read as a card sent drops to the end */
interface DropGeometry {
  /** whether a drop can pick a slot, or only land */
  columns: Map<string, boolean>
  cardColumn: Map<string, string>
}

// shared empty array so memoized columns don't re-render on a fresh []
const EMPTY_ITEMS: Item[] = []

export function useBoardDrag(boardState: BoardState) {
  const {
    activeWorkspace, cards, setCards, columns, swimlanesEnabled, columnsRef, persistColumns,
    setActiveDragCard, setDropTarget, setDragHeight, searchQuery, filterPriority, filterTagId,
    isReadOnlyMode, loadCards
  } = boardState
  // one memoized pass groups, filters and sorts; per-column refiltering was O(columns x cards) per drag frame
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
    // sorting stays in this pass, a second pass brings the per-frame work back
    const byPosition = (a: Item, b: Item): number => a.position - b.position
    const byPriority = (a: Item, b: Item): number =>
      b.priority !== a.priority ? b.priority - a.priority : a.position - b.position
    // no due date sorts last, not "due first"
    const byDue = (a: Item, b: Item): number => {
      if (!a.due_at && !b.due_at) return a.position - b.position
      if (!a.due_at) return 1
      if (!b.due_at) return -1
      return a.due_at - b.due_at || a.position - b.position
    }

    const sortModes = new Map(columns.map(c => [c.id, c.sort ?? 'manual']))
    for (const [colId, arr] of map) {
      // swimlanes' priority grouping outranks the column's own order
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

  /** a ref: the detector runs every pointer move and mustn't rebuild when a card changes */
  const dropGeometryRef = useRef<DropGeometry>({ columns: new Map(), cardColumn: new Map() })
  useEffect(() => {
    const columnOrder = new Map<string, boolean>()
    for (const col of columns) columnOrder.set(col.id, canAimAtSlot(col, swimlanesEnabled))
    const cardColumn = new Map<string, string>()
    for (const card of cards) cardColumn.set(card.id, card.status)
    dropGeometryRef.current = { columns: columnOrder, cardColumn }
  }, [columns, cards, swimlanesEnabled])

  /** aims at the card you'd land above by midpoints, so gaps between cards don't fall through to the column end */
  const collisionDetection = useCallback<CollisionDetection>(args => {
    // column drags hit the other columns by rectangle
    if (String(args.active.id).startsWith('col::')) return rectIntersection(args)

    // the keyboard sensor moves a rect, its centre stands in for the pointer
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
      // neither known column nor card: leave it, col:: ids read as cards once broke every drop
      const column = cardColumn.get(id)
      if (column) cardBoxes.push({ id, column, top: rect.top, height: rect.height })
    }

    const target = dropTargetAt(columnBoxes, cardBoxes, point)
    if (!target) return []
    if (columnOrder.get(target.column) !== true) return [{ id: target.column }]

    // past the last card, aim at the bottom card: dnd-kit only previews moves onto cards
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
    // read before the card lifts out, so the gap matches its footprint
    setDragHeight(active.rect.current.initial?.height ?? 0)
  }, [isReadOnlyMode, setActiveDragCard, setCards, setDragHeight])

  /** notes the target instead of moving the card; moving remounted it across SortableContexts and crawled */
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
  }, [isReadOnlyMode, setDropTarget])

  const endDrag = useCallback(() => {
    setActiveDragCard(null)
    setDropTarget(null)
  }, [setActiveDragCard, setDropTarget])

  const handleDragCancel = useCallback(() => {
    endDrag()
    loadCards()
  }, [endDrag, loadCards])

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    // before the read-only check, the overlay and gap go away either way
    endDrag()
    if (isReadOnlyMode) return
    const { active, over } = event

    if (!over || active.id === over.id) return

    const activeId = String(active.id)
    const overId = String(over.id)

    // column ids are prefixed col::
    if (activeId.startsWith('col::')) {
      const current = columnsRef.current
      const fromIdx = current.findIndex(c => `col::${c.id}` === activeId)
      const toIdx   = current.findIndex(c => `col::${c.id}` === overId)
      if (fromIdx === -1 || toIdx === -1) return
      await persistColumns(arrayMove(current, fromIdx, toIdx))
      return
    }

    const cardId = activeId
    const draggedCard = cards.find(c => c.id === cardId)
    if (!draggedCard) return

    const isColumnTarget = columns.some(c => c.id === overId)
    const newStatus = isColumnTarget ? overId : cards.find(c => c.id === overId)?.status
    if (!newStatus) return

    // position from the order on screen, the same list the gap was drawn into
    const order = cardsByColumn.get(newStatus) ?? EMPTY_ITEMS
    const rest = order.filter(c => c.id !== cardId)
    const index = dropIndex(order.map(c => c.id), cardId, isColumnTarget ? null : overId)
    const newPosition = positionForIndex(rest.map(c => c.position), index)

    // in swimlanes the lane dropped into sets priority
    const neighbour = rest[index] ?? rest[index - 1]
    const newPriority = swimlanesEnabled ? (neighbour?.priority ?? draggedCard.priority) : undefined

    // null means no room between neighbours: take the lower and renumber the column
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
  }, [endDrag, isReadOnlyMode, cards, columns, cardsByColumn, swimlanesEnabled, setCards, columnsRef, persistColumns, activeWorkspace, loadCards])


  return {
    getCardsForColumn,
    collisionDetection,
    handleDragStart,
    handleDragOver,
    handleDragCancel,
    handleDragEnd
  }
}

export type BoardDrag = ReturnType<typeof useBoardDrag>
