import { useEffect, useCallback, useRef, useMemo } from 'react'
import { DragEndEvent, DragOverEvent, DragStartEvent, rectIntersection, CollisionDetection } from '@dnd-kit/core'
import { arrayMove } from '@dnd-kit/sortable'
import type { Item } from '../../../../shared/types'
import { dropIndex, dropTargetAt, lastCardIn, positionForIndex, type CardBox, type ColumnBox } from '../../../../shared/cardDrop'
import { rebalancePositions, updateItem } from '../../data/items'
import { canAimAtSlot } from './dropSlots'
import type { BoardState } from './useBoardState'

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

/** Dragging cards and columns: the order each column shows, where a drop can land, and what it writes. */
export function useBoardDrag(boardState: BoardState) {
  const {
    activeWorkspace, cards, setCards, columns, swimlanesEnabled, columnsRef, persistColumns,
    setActiveDragCard, setDropTarget, setDragHeight, searchQuery, filterPriority, filterTagId,
    isReadOnlyMode, loadCards
  } = boardState
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
  }, [isReadOnlyMode, setActiveDragCard, setCards, setDragHeight])

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
