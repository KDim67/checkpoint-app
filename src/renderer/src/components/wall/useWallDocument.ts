import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '../../store/appStore'
import { useToast } from '../ui/Toast'
import { createWallItem, duplicateItems, normalizeWallDoc, patchItems, toWallPoint, WALL_COLORS, createWall, removeWall, wallDocKey, pruneArrows, STROKE_WIDTHS, SMOOTHING_STRENGTH, ARROW_SHAPES, ARROW_LINES, ARROW_HEAD_MODES, type ArrowShape, type ArrowLine, type ArrowHeads, type WallCamera, type WallDoc, type WallIndex, type WallItem, type WallItemKind, type WallRef } from '../../../../shared/wallModel'
import type { WallDrag } from '../../../../shared/wallPointer'
import { initHistory, pushHistory, replacePresent, type History } from '../../../../shared/history'
import { deleteWallDoc, flushWallDoc, loadWallDoc, loadWallIndex, saveWallDoc, saveWallIndex } from '../../lib/wallDoc'
import { errorMessage } from '../../../../shared/errors'
import type { Item, NoteMetadata } from '../../../../shared/types'
import type { RailTab } from './WallBoardRail'
import { planHandoff } from '../../../../shared/wallBoard'
import { loadBoardConfig } from '../../lib/boardConfig'
import { getBoolSetting, getNumberSetting, getEnumSetting, setBoolSetting } from '../../lib/settings'
import { useViewShortcuts } from '../../lib/useViewShortcuts'
import { PAN_BUTTONS_KEY, MENU_BUTTON_KEY, PAN_BUTTON_MODES, MENU_BUTTON_MODES, type PanButtons, type MenuButton } from '../../lib/wallInput'
import { DEFAULT_COLUMNS, type ColumnConfig } from '../../../../shared/boardModel'
import { updateItem, itemPage } from '../../data/items'
import { RAIL_OPEN_KEY, RAIL_WIDTH_KEY, SMOOTHING_KEY, ARROW_SHAPE_KEY, ARROW_LINE_KEY, ARROW_HEADS_KEY, clampRail } from './wallPreferences'
import * as notesApi from '../../data/notes'
import * as mediaApi from '../../data/media'

export interface Menu { x: number; y: number; itemId: string | null; at: { x: number; y: number } }

/**
 * The wall document and what changes it: loading and saving, the wall index,
 * undo history, and adding, placing, duplicating and removing items.
 */
export function useWallDocument() {
  const activeWorkspace = useAppStore(s => s.activeWorkspace)
  const selectItem = useAppStore(s => s.selectItem)
  const setView = useAppStore(s => s.setView)
  const setPendingNoteTitle = useAppStore(s => s.setPendingNoteTitle)
  const { toast } = useToast()

  const [doc, setDoc] = useState<WallDoc>(() => normalizeWallDoc(null))
  const [cards, setCards] = useState<Item[]>([])
  const [notes, setNotes] = useState<NoteMetadata[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [editingId, setEditingId] = useState<string | null>(null)
  /** Which picker is open, if any. One at a time: they occupy the same corner. */
  const [picker, setPicker] = useState<'card' | 'doc' | null>(null)
  const [menu, setMenu] = useState<Menu | null>(null)
  const [snapping, setSnapping] = useState(false)
  /**
   * What a left-drag on empty canvas does. Select is the resting state, and the
   * two others differ in how they leave it.
   *
   * The arrow is one-shot: drawing one hands the pointer straight back. A
   * connector is a single deliberate act, and staying armed afterwards meant
   * the next click on a card started another arrow instead of selecting it,
   * with nothing on screen saying so. The pen stays armed, because a sketch is
   * several strokes and re-arming between each of them is the annoying half of
   * the same trade. Escape still leaves either one.
   */
  const [tool, setTool] = useState<'select' | 'pen' | 'arrow'>('select')
  const [penColor, setPenColor] = useState(WALL_COLORS[0])
  const [penWidth, setPenWidth] = useState(STROKE_WIDTHS[1])
  /** On by default: a hand-drawn line is shaky and almost nobody wants that. */
  const [smoothing, setSmoothing] = useState(true)
  /** The stroke being drawn, in wall coordinates. Null when not drawing. */
  const [drawing, setDrawing] = useState<{ x: number; y: number }[] | null>(null)
  /** The first item picked for an arrow, waiting for its second. */
  const [arrowFrom, setArrowFrom] = useState<string | null>(null)
  /**
   * The connector being dragged out, in wall coordinates. `overId` is the item
   * under the pointer, so the preview can snap to it and the item can light up
   * before the pointer is let go.
   */
  const [arrowDrag, setArrowDrag] = useState<{ fromId: string; at: { x: number; y: number }; overId: string | null } | null>(null)
  /** The item a dragged end is currently over, so it can light up. */
  const [arrowEndHover, setArrowEndHover] = useState<string | null>(null)
  const [arrowShape, setArrowShape] = useState<ArrowShape>(ARROW_SHAPES[0])
  const [arrowLine, setArrowLine] = useState<ArrowLine>(ARROW_LINES[0])
  const [arrowHeads, setArrowHeads] = useState<ArrowHeads>(ARROW_HEAD_MODES[0])
  const [marquee, setMarquee] = useState<{ x: number; y: number; width: number; height: number } | null>(null)
  /** Name of an image job in flight, shown so a slow one does not look frozen. */
  const [busy, setBusy] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  /** Bumped whenever the ref-held history changes, so the buttons re-render. */
  const [historyTick, setHistoryTick] = useState(0)

  /**
   * Tagged with the workspace it was read for: otherwise the moment after a
   * switch still holds the old active wall id and opens the wrong wall.
   */
  const [index, setIndex] = useState<{ context: string; value: WallIndex } | null>(null)
  const [wallMenuOpen, setWallMenuOpen] = useState(false)
  const [renaming, setRenaming] = useState<{ id: string; draft: string } | null>(null)
  const [pendingDelete, setPendingDelete] = useState<WallRef | null>(null)

  /** The board, shown beside the wall so a card can be dragged straight onto it. */
  const [railOpen, setRailOpen] = useState(false)
  const [railWidth, setRailWidth] = useState(260)
  const [railTab, setRailTab] = useState<RailTab>('board')
  const [railQuery, setRailQuery] = useState('')
  const [columns, setColumns] = useState<ColumnConfig[]>([])
  /** The rail column a wall drag is over, if any. Mirrored in a ref: this is
   *  read on every pointer move, and re-rendering on each one would stutter. */
  const [dropColumnId, setDropColumnId] = useState<string | null>(null)
  const [bgOpen, setBgOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  /**
   * Space is down, so the left button pans.
   *
   * This is the one pan that does not cost you the tool in your hand: the pen
   * stays armed while you move the view and carry on drawing. It is also the
   * first thing anyone who has used a canvas tool tries, which is why it is
   * worth having on top of the two mouse buttons.
   */
  const [spaceHeld, setSpaceHeld] = useState(false)
  /** The selection toolbar's colour popover. */
  const [swatchOpen, setSwatchOpen] = useState(false)
  const { bindings: keys, match: matchKey } = useViewShortcuts('wall')
  const [panButtons, setPanButtons] = useState<PanButtons>(PAN_BUTTON_MODES[0])
  const [menuButton, setMenuButton] = useState<MenuButton>(MENU_BUTTON_MODES[0])

  const viewportRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<WallDrag>(null)
  /**
   * The newest pointer position, and the frame that will apply it.
   *
   * A pointer reports far faster than the screen paints. A 1000 Hz mouse fires
   * roughly sixteen moves per frame, and each one re-rendered every item on the
   * wall; fifteen of those renders were painted over before anyone saw them.
   */
  const pendingMoveRef = useRef<{ clientX: number; clientY: number; shiftKey: boolean } | null>(null)
  const moveFrameRef = useRef<number | null>(null)
  /**
   * The camera while a pan is in flight, ahead of the one in state.
   *
   * A pan moves no item. It only changes where the whole board is drawn, and
   * every layer that has to move is one element with one transform. Putting it
   * through state re-rendered every card, note, image and arrow on the wall for
   * a change that moved none of them, which is what a full board felt like.
   */
  const panCameraRef = useRef<WallCamera | null>(null)
  const zoomCommitRef = useRef<number | null>(null)
  /** The items while a move is in flight, ahead of the ones in state. */
  const liveItemsRef = useRef<WallItem[] | null>(null)
  /** The marquee as drawn, ahead of the one in state. */
  const marqueeRectRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null)
  /** What the sweep has caught so far, ahead of the selection in state. */
  const marqueeSelRef = useRef<Set<string> | null>(null)
  /** What the sweep has actually drawn, so a frame only writes the difference. */
  const paintedSelRef = useRef<Set<string> | null>(null)
  useEffect(() => () => {
    if (zoomCommitRef.current !== null) window.clearTimeout(zoomCommitRef.current)
  }, [])
  /**
   * What a drag moves, not the selection, since a frame brings its contents.
   * Decided once at drag start, or items would join as the frame swept over them.
   */
  const movingRef = useRef<Set<string>>(new Set())
  /** A right-press in flight: becomes a menu on release if it barely moved. */
  const rightPressRef = useRef<{ clientX: number; clientY: number; itemId: string | null; at: { x: number; y: number }; moved: boolean } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  /** Just-deleted docs. The flush on the way out would otherwise restore them. */
  const discardedRef = useRef<Set<string>>(new Set())
  const railHoverRef = useRef<{ overRail: boolean; columnId: string | null }>({ overRail: false, columnId: null })
  /** In a ref because the export callback is created before the lookup maps. */
  const labelRef = useRef<(item: WallItem) => string | undefined>(() => undefined)
  const docRef = useRef(doc)
  docRef.current = doc
  const selectedRef = useRef(selectedIds)
  selectedRef.current = selectedIds

  /** Undo covers the items only: the camera is a view, not an edit. */
  const historyRef = useRef<History<WallItem[]>>(initHistory([]))

  const cardsById = useMemo(() => new Map(cards.map(c => [c.id, c])), [cards])
  const itemsById = useMemo(() => new Map(doc.items.map(i => [i.id, i])), [doc.items])
  const notesByTitle = useMemo(() => new Map(notes.map(n => [n.title, n])), [notes])
  const selectedItems = doc.items.filter(i => selectedIds.has(i.id))
  const single = selectedItems.length === 1 ? selectedItems[0] : null
  /** Restyling only makes sense when everything selected is a connector. */
  const arrowsSelected = selectedItems.length > 0 && selectedItems.every(i => i.kind === 'arrow')

  const wallIndex = index?.context === activeWorkspace ? index.value : null
  const activeWall = wallIndex?.walls.find(w => w.id === wallIndex.activeId) ?? null
  /** Null until the index has been read: there is no wall to open before then. */
  const docKey = activeWall ? wallDocKey(activeWorkspace, activeWall.id) : null

  // Load
  /** What the walls can point at. Workspace-wide, so switching wall leaves it. */
  useEffect(() => {
    let cancelled = false

    const readCards = (): Promise<void> =>
      itemPage(activeWorkspace, 'card', 1, 500)
        .catch(() => ({ items: [] as Item[] }))
        .then(res => { if (!cancelled) setCards((res.items ?? []).filter(c => c.status !== 'archived')) })

    void readCards()
    Promise.all([
      // Notes are not per-workspace, so they are offered whole.
      notesApi.listNotes().catch(() => [] as NoteMetadata[]),
      // The board's own columns, not whatever statuses happen to be in use.
      loadBoardConfig(activeWorkspace).catch(() => null)
    ]).then(([noteList, config]) => {
      if (cancelled) return
      setNotes(noteList ?? [])
      // Not none: with no columns every card is an orphan and the board looks broken.
      setColumns(config?.columns ?? DEFAULT_COLUMNS)
    })

    // Rail, board and peer moves all arrive this way; without it the rail goes stale.
    const onMutation = (e: Event): void => {
      const type = (e as CustomEvent<{ type?: string }>).detail?.type ?? ''
      if (type === 'createItem' || type === 'updateItem' || type === 'deleteItem') void readCards()
    }
    window.addEventListener('db-mutation', onMutation)

    return () => {
      cancelled = true
      window.removeEventListener('db-mutation', onMutation)
    }
  }, [activeWorkspace])

  /**
   * Closes a toolbar popover when the click lands elsewhere.
   *
   * These used to sit under a full-screen backdrop, which swallowed the click
   * that dismissed them: reaching the other popover took two clicks, one to
   * close and one to open. Matching on the popover's own subtree lets the click
   * through to whatever it was aimed at, the way WallContextMenu already does.
   */
  useEffect(() => {
    if (!wallMenuOpen && !bgOpen && !shortcutsOpen) return

    const onDown = (e: PointerEvent): void => {
      const inside = (e.target as HTMLElement).closest('[data-wall-popover]')?.getAttribute('data-wall-popover')
      if (inside !== 'wall') { setWallMenuOpen(false); setRenaming(null) }
      if (inside !== 'bg') setBgOpen(false)
      if (inside !== 'keys') setShortcutsOpen(false)
    }

    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [wallMenuOpen, bgOpen, shortcutsOpen])

  /** The rail's own state is a preference, not part of any wall. */
  useEffect(() => {
    let cancelled = false
    Promise.all([
      getBoolSetting(RAIL_OPEN_KEY, false),
      getNumberSetting(RAIL_WIDTH_KEY, 260),
      getNumberSetting(SMOOTHING_KEY, SMOOTHING_STRENGTH),
      getEnumSetting(ARROW_SHAPE_KEY, ARROW_SHAPES, ARROW_SHAPES[0]),
      getEnumSetting(ARROW_LINE_KEY, ARROW_LINES, ARROW_LINES[0]),
      getEnumSetting(ARROW_HEADS_KEY, ARROW_HEAD_MODES, ARROW_HEAD_MODES[0]),
      getEnumSetting(PAN_BUTTONS_KEY, PAN_BUTTON_MODES, PAN_BUTTON_MODES[0]),
      getEnumSetting(MENU_BUTTON_KEY, MENU_BUTTON_MODES, MENU_BUTTON_MODES[0])
    ]).then(([open, width, smooth, shape, line, heads, pan, menuOn]) => {
      if (cancelled) return
      setRailOpen(open)
      setRailWidth(clampRail(width))
      setArrowShape(shape)
      setArrowLine(line)
      setArrowHeads(heads)
      setPanButtons(pan)
      setMenuButton(menuOn)
      // Still kept as a strength so the preference carries over from the build
      // that had a dial. Anything above zero means on.
      setSmoothing(smooth > 0)
    })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    let cancelled = false
    setIndex(null)
    setWallMenuOpen(false)
    loadWallIndex(activeWorkspace).then(loaded => {
      if (!cancelled) setIndex({ context: activeWorkspace, value: loaded })
    })
    return () => { cancelled = true }
  }, [activeWorkspace])

  useEffect(() => {
    if (!docKey) return
    let cancelled = false
    setLoading(true)
    setSelectedIds(new Set())
    setEditingId(null)

    loadWallDoc(docKey)
      .then(loaded => {
        if (cancelled) return
        setDoc(loaded)
        historyRef.current = initHistory(loaded.items)
        setHistoryTick(t => t + 1)
      })
      .catch(err => !cancelled && toast(`Could not open the wall: ${errorMessage(err)}`, { type: 'error' }))
      .finally(() => !cancelled && setLoading(false))

    return () => { cancelled = true }
  }, [docKey, toast])

  useEffect(() => {
    if (!docKey) return
    const discarded = discardedRef.current
    // Runs on the way out of *this* wall, while docRef still holds it.
    return () => {
      if (discarded.delete(docKey)) return
      void flushWallDoc(docKey, docRef.current)
    }
  }, [docKey])

  /**
   * MCP writes the doc from the main process, so the open view has to re-read.
   * Skipped mid-gesture. Being briefly stale beats losing a drag in progress.
   */
  useEffect(() => {
    if (!docKey) return
    const refresh = (): void => {
      if (dragRef.current || editingId) return
      void loadWallDoc(docKey).then(loaded => {
        setDoc(loaded)
        historyRef.current = initHistory(loaded.items)
        setHistoryTick(t => t + 1)
      })
    }
    window.addEventListener('wall-refresh', refresh)
    return () => window.removeEventListener('wall-refresh', refresh)
  }, [docKey, editingId])

  // Mutation
  const write = useCallback((next: WallDoc) => {
    setDoc(next)
    if (docKey) saveWallDoc(docKey, next)
  }, [docKey])

  const commitIndex = useCallback((next: WallIndex) => {
    setIndex({ context: activeWorkspace, value: next })
    void saveWallIndex(activeWorkspace, next)
  }, [activeWorkspace])

  const addWall = useCallback(() => {
    // From the loaded index, so a slow load cannot start a competing list.
    if (!wallIndex) return
    commitIndex(createWall(wallIndex).index)
    setWallMenuOpen(false)
  }, [wallIndex, commitIndex])

  /**
   * The reverse direction. Position on the wall means nothing, but a drop onto
   * a named column is an instruction, so it moves the card for real.
   */
  const handOffToColumn = async (columnId: string): Promise<void> => {
    const refs = docRef.current.items
      .filter(i => selectedRef.current.has(i.id) && i.kind === 'card' && i.ref)
      .map(i => i.ref as string)

    if (refs.length === 0) {
      toast('Only cards can be moved to a column.')
      return
    }

    const plan = planHandoff(refs, columnId, cards)
    if (plan.length === 0) {
      toast('Already in that column.')
      return
    }

    try {
      // One at a time. Each write fires the mutation event the app listens on.
      for (const move of plan) {
        await updateItem(move.id, { status: move.status, position: move.position })
      }
      const name = columns.find(c => c.id === columnId)?.name ?? columnId
      toast(`Moved ${plan.length} card${plan.length === 1 ? '' : 's'} to ${name}.`)
    } catch (err) {
      toast(`Could not move the card: ${errorMessage(err)}`, { type: 'error' })
    }
  }

  const setBackground = useCallback((background: string) => {
    write({ ...docRef.current, background })
  }, [write])

  const toggleRail = useCallback(() => {
    setRailOpen(open => {
      void setBoolSetting(RAIL_OPEN_KEY, !open)
      return !open
    })
  }, [])

  const confirmDeleteWall = useCallback(async () => {
    if (!pendingDelete || !wallIndex) return
    const next = removeWall(wallIndex, pendingDelete.id)
    setPendingDelete(null)
    if (next === wallIndex) return

    const key = wallDocKey(activeWorkspace, pendingDelete.id)
    discardedRef.current.add(key)
    // Before the switch: the flush on the way out would land after the delete.
    await deleteWallDoc(key)
    commitIndex(next)
  }, [pendingDelete, wallIndex, activeWorkspace, commitIndex])

  /** `record: false` for drag frames. The whole gesture is one undo step. */
  const setItems = useCallback((items: WallItem[], { record = true } = {}) => {
    historyRef.current = record
      ? pushHistory(historyRef.current, items)
      : replacePresent(historyRef.current, items)
    if (record) setHistoryTick(t => t + 1)
    write({ ...docRef.current, items })
  }, [write])

  const setCamera = useCallback((camera: WallCamera) => {
    // Whatever was drawn by hand is now behind what is being committed.
    panCameraRef.current = null
    write({ ...docRef.current, camera })
  }, [write])

  // Stable, so the memo on WallItemView holds. Made inline in the item loop
  // these were new functions every render, which changed every item's props
  // every frame and re-rendered the whole wall to move one card.
  const onItemTextChange = useCallback((id: string, text: string) => {
    setItems(patchItems(docRef.current.items, new Set([id]), { text }), { record: false })
  }, [setItems])
  const onItemFinishEditing = useCallback(() => {
    setEditingId(null)
    setItems(docRef.current.items)
  }, [setItems])

  const applyHistory = useCallback((next: History<WallItem[]>) => {
    historyRef.current = next
    setHistoryTick(t => t + 1)
    write({ ...docRef.current, items: next.present })
    // A selection can point at items the step removed.
    setSelectedIds(prev => new Set([...prev].filter(id => next.present.some(i => i.id === id))))
  }, [write])

  // Placing
  const centreOfView = useCallback((): { x: number; y: number } => {
    const rect = viewportRef.current?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    return toWallPoint({ x: rect.width / 2, y: rect.height / 2 }, docRef.current.camera)
  }, [])

  const addItem = useCallback((kind: WallItemKind, extra: Partial<WallItem> = {}, at?: { x: number; y: number }) => {
    const items = docRef.current.items
    const created = createWallItem(kind, at ?? centreOfView(), items, {
      ...(kind === 'note' ? { color: WALL_COLORS[items.length % WALL_COLORS.length] } : {}),
      ...extra
    })
    setItems([...items, created])
    setSelectedIds(new Set([created.id]))
    if (kind === 'note' || kind === 'text' || kind === 'frame') setEditingId(created.id)
  }, [centreOfView, setItems])

  const removeSelected = useCallback(() => {
    const ids = selectedRef.current
    if (ids.size === 0) return
    const items = docRef.current.items
    const gone = items.filter(i => ids.has(i.id))
    // Pruned as well as filtered: an arrow whose end just went would otherwise
    // stay in the document, invisible and impossible to select.
    setItems(pruneArrows(items.filter(i => !ids.has(i.id))))
    setSelectedIds(new Set())
    toast(`Removed ${gone.length} item${gone.length === 1 ? '' : 's'}.`, {
      action: { label: 'Undo', onClick: () => setItems([...docRef.current.items, ...gone]) }
    })
  }, [setItems, toast])

  const duplicateSelected = useCallback(() => {
    const ids = selectedRef.current
    if (ids.size === 0) return
    const copies = duplicateItems(docRef.current.items, ids)
    setItems([...docRef.current.items, ...copies])
    setSelectedIds(new Set(copies.map(c => c.id)))
  }, [setItems])

  const toggleLock = useCallback(() => {
    const ids = selectedRef.current
    const items = docRef.current.items
    const chosen = items.filter(i => ids.has(i.id))
    if (chosen.length === 0) return
    // A mixed selection locks everything, which is the less surprising direction.
    const lock = chosen.some(i => !i.locked)
    setItems(items.map(i => (ids.has(i.id) ? { ...i, locked: lock ? true : undefined } : i)))
  }, [setItems])

  /** In a row below the source, so four PBR maps are a strip, not a stack. */
  const placeDerived = useCallback((source: WallItem, made: { filename: string; label: string; width: number; height: number }[]) => {
    const items = [...docRef.current.items]
    const created: WallItem[] = []
    made.forEach((m, i) => {
      created.push(createWallItem('image', {
        x: source.x + i * (source.width + 16) + source.width / 2,
        y: source.y + source.height + 16 + source.height / 2
      }, [...items, ...created], {
        ref: m.filename,
        text: `${source.text ?? 'image'}, ${m.label}`,
        width: source.width,
        height: source.height
      }))
    })
    setItems([...items, ...created])
    setSelectedIds(new Set(created.map(c => c.id)))
  }, [setItems])

  /** Wraps a slow image job with a waiting toast and one error path. */
  const runImageOp = useCallback(async (label: string, job: () => Promise<void>) => {
    setBusy(label)
    try {
      await job()
    } catch (err) {
      toast(`${label} failed: ${errorMessage(err)}`, { type: 'error' })
    } finally {
      setBusy(null)
    }
  }, [toast])

  const openCard = useCallback((item: WallItem) => {
    if (item.kind === 'card' && item.ref) selectItem(item.ref)
  }, [selectItem])

  // Images
  const placeImageFiles = useCallback(async (files: File[], at?: { x: number; y: number }) => {
    const images = files.filter(f => f.type.startsWith('image/'))
    if (images.length === 0) return
    for (const file of images) {
      try {
        const buffer = await file.arrayBuffer()
        const ext = (file.type.split('/')[1] || 'png').replace('+xml', '')
        const filename = await mediaApi.saveFromBuffer(buffer, ext)
        addItem('image', { ref: filename, text: file.name }, at)
      } catch (err) {
        toast(`Could not add image: ${errorMessage(err)}`, { type: 'error' })
      }
    }
  }, [addItem, toast])


  return {
    activeWorkspace,
    setView,
    setPendingNoteTitle,
    toast,
    doc,
    cards,
    notes,
    loading,
    selectedIds,
    setSelectedIds,
    editingId,
    setEditingId,
    picker,
    setPicker,
    menu,
    setMenu,
    snapping,
    setSnapping,
    tool,
    setTool,
    penColor,
    setPenColor,
    penWidth,
    setPenWidth,
    smoothing,
    setSmoothing,
    drawing,
    setDrawing,
    arrowFrom,
    setArrowFrom,
    arrowDrag,
    setArrowDrag,
    arrowEndHover,
    setArrowEndHover,
    arrowShape,
    setArrowShape,
    arrowLine,
    setArrowLine,
    arrowHeads,
    setArrowHeads,
    marquee,
    setMarquee,
    busy,
    setBusy,
    query,
    setQuery,
    historyTick,
    setHistoryTick,
    wallMenuOpen,
    setWallMenuOpen,
    renaming,
    setRenaming,
    pendingDelete,
    setPendingDelete,
    railOpen,
    railWidth,
    setRailWidth,
    railTab,
    setRailTab,
    railQuery,
    setRailQuery,
    columns,
    dropColumnId,
    setDropColumnId,
    bgOpen,
    setBgOpen,
    shortcutsOpen,
    setShortcutsOpen,
    spaceHeld,
    setSpaceHeld,
    swatchOpen,
    setSwatchOpen,
    keys,
    matchKey,
    panButtons,
    menuButton,
    viewportRef,
    dragRef,
    pendingMoveRef,
    moveFrameRef,
    panCameraRef,
    zoomCommitRef,
    liveItemsRef,
    marqueeRectRef,
    marqueeSelRef,
    paintedSelRef,
    movingRef,
    rightPressRef,
    fileInputRef,
    railHoverRef,
    labelRef,
    docRef,
    selectedRef,
    historyRef,
    cardsById,
    itemsById,
    notesByTitle,
    selectedItems,
    single,
    arrowsSelected,
    wallIndex,
    activeWall,
    commitIndex,
    addWall,
    handOffToColumn,
    setBackground,
    toggleRail,
    confirmDeleteWall,
    setItems,
    setCamera,
    onItemTextChange,
    onItemFinishEditing,
    applyHistory,
    addItem,
    removeSelected,
    duplicateSelected,
    toggleLock,
    placeDerived,
    runImageOp,
    openCard,
    placeImageFiles
  }
}

export type WallDocument = ReturnType<typeof useWallDocument>
