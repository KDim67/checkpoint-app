/**
 * The Wall: a freeform canvas per workspace. The work here is mostly about not
 * being clever.
 *
 * - The dot grid scales with the camera. Without it, panning an infinite
 *   canvas looks like nothing happened.
 * - "Fit" is always reachable. Panning into empty space is the one mistake you
 *   cannot undo by looking harder.
 * - Cards are references. Moving one here means nothing to its column, which is
 *   what stops the Wall becoming a second, lying board.
 * - Left-drag selects, right-drag pans (Unity/Unreal, not Figma), and pans from
 *   anywhere. Hunting for empty space first makes a canvas feel cramped.
 *   So right-click does two jobs split by distance: barely moved opens a menu,
 *   further was a pan.
 */

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  StickyNote, Type, Square, Layers, Image as ImageIcon, Maximize2,
  Trash2, ArrowUp, ArrowDown, Copy, Lock, Unlock, Undo2, Redo2,
  Grid3x3, ExternalLink, FileText, Wand2, Expand, Palette, Download,
  PanelRight, PenLine, Spline, MousePointer2
} from 'lucide-react'
import { useAppStore } from '../../store/appStore'
import { useToast } from '../ui/Toast'
import {
  bringToFront, boundsOf, createWallItem, duplicateItems, fitCamera, inPaintOrder,
  itemsInRect, moveItems, normalizeWallDoc, patchItems, rectFromPoints, sendToBack,
  cameraCentredOn, itemAtPoint, searchItems,
  gridSpacing, toWallPoint, WALL_COLORS, zoomAt,
  createWall, removeWall, wallDocKey, withFrameContents,
  arrowGeometry, arrowAnchors, arrowDash, arrowHeadPoints, arrowHeadInset,
  distanceToPolyline, inkFromPath, pruneArrows,
  STROKE_WIDTHS, SMOOTHING_STRENGTH, ARROW_SHAPES, ARROW_LINES, ARROW_HEAD_MODES,
  type ArrowShape, type ArrowLine, type ArrowHeads,
  type WallCamera, type WallDoc, type WallIndex, type WallItem, type WallItemKind, type WallRef
} from '../../../../shared/wallModel'
import {
  arrowDropTarget, arrowEndTarget, arrowRelease, isStrokeJitter, pressSelection, recordsHistory,
  resizedSize, rotationAngle, rotationStart, snapMoving, type WallDrag
} from '../../../../shared/wallPointer'
import {
  canRedo, canUndo, initHistory, pushHistory, redo, replacePresent, undo,
  type History
} from '../../../../shared/history'
import {
  deleteWallDoc, flushWallDoc, loadWallDoc, loadWallIndex, saveWallDoc, saveWallIndex
} from '../../lib/wallDoc'
import { derivePalette, derivePbrMaps, deriveUpscale } from '../../lib/wallImageOps'
import { exportWallToPng } from '../../lib/wallExport'
import { errorMessage } from '../../../../shared/errors'
import type { Item, NoteMetadata } from '../../../../shared/types'
import WallItemLayer from './WallItemLayer'
import WallContextMenu, { type MenuEntry } from './WallContextMenu'
import ConfirmDialog from '../ui/ConfirmDialog'
import WallBoardRail, { type RailTab } from './WallBoardRail'
import WallSwitcher from './WallSwitcher'
import WallMinimap from './WallMinimap'
import {
  decodeWallDrag, filterGroups, groupCardsByColumn, planHandoff, WALL_DRAG_MIME
} from '../../../../shared/wallBoard'
import { loadBoardConfig } from '../../lib/boardConfig'
import { getBoolSetting, getNumberSetting, getEnumSetting, setBoolSetting } from '../../lib/settings'
import { useViewShortcuts } from '../../lib/useViewShortcuts'
import {
  PAN_BUTTONS_KEY, MENU_BUTTON_KEY, PAN_BUTTON_MODES, MENU_BUTTON_MODES,
  panHintLabel, type PanButtons, type MenuButton
} from '../../lib/wallInput'
import { getTextColorForBackground } from '../../lib/contrast'
import { DEFAULT_COLUMNS, type ColumnConfig } from '../../../../shared/boardModel'
import { updateItem, itemPage } from '../../data/items'
import { toolButton } from './wallButtons'
import { RAIL_OPEN_KEY, RAIL_WIDTH_KEY, SMOOTHING_KEY, ARROW_SHAPE_KEY, ARROW_LINE_KEY, ARROW_HEADS_KEY, clampRail } from './wallPreferences'
import { NUDGE } from './wallShortcutSheet'
import WallBackgroundMenu from './WallBackgroundMenu'
import WallSearch from './WallSearch'
import WallShortcutsMenu from './WallShortcutsMenu'
import WallPlacePicker from './WallPlacePicker'
import WallSelectionBar from './WallSelectionBar'
import WallPenSettings from './WallPenSettings'
import WallRailHandle from './WallRailHandle'
import * as notesApi from '../../data/notes'
import * as mediaApi from '../../data/media'
import * as appApi from '../../data/app'

/** How far a press may travel and still count as a click rather than a drag. */
const CLICK_SLOP = 4

interface Menu { x: number; y: number; itemId: string | null; at: { x: number; y: number } }

/** How long the wheel has to be still before the zoom it drew becomes state. */
const ZOOM_SETTLE_MS = 150

export default function WallView() {
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

  // Camera
  const screenPoint = (e: { clientX: number; clientY: number }): { x: number; y: number } => {
    const rect = viewportRef.current?.getBoundingClientRect()
    return rect ? { x: e.clientX - rect.left, y: e.clientY - rect.top } : { x: 0, y: 0 }
  }

  const onWheel = (e: React.WheelEvent) => {
    const rect = viewportRef.current?.getBoundingClientRect()
    if (!rect) return
    // Drawn by hand like a pan, for the same reason. A wheel sends a notch
    // every few milliseconds, and each one used to write the whole document
    // and re-render every item on the wall. Zoomed from the live camera, not
    // the one in state, or every notch in a burst would start from the same
    // place and only the last would count.
    const zoomed = zoomAt(
      panCameraRef.current ?? docRef.current.camera,
      { x: e.clientX - rect.left, y: e.clientY - rect.top },
      e.deltaY < 0 ? 1.1 : 1 / 1.1
    )
    panCameraRef.current = zoomed
    paintCamera(zoomed)
    if (zoomCommitRef.current !== null) window.clearTimeout(zoomCommitRef.current)
    zoomCommitRef.current = window.setTimeout(() => {
      zoomCommitRef.current = null
      // A drag that ended in the meantime has committed it already.
      if (panCameraRef.current) setCamera(panCameraRef.current)
    }, ZOOM_SETTLE_MS)
  }

  /** Centres one item without changing zoom, and selects it so it stands out. */
  const jumpTo = useCallback((item: WallItem) => {
    const rect = viewportRef.current?.getBoundingClientRect()
    if (!rect) return
    setCamera(cameraCentredOn(item, { width: rect.width, height: rect.height }, docRef.current.camera.zoom))
    setSelectedIds(new Set([item.id]))
  }, [setCamera])

  /** Redraws the wall to a canvas and offers it as a PNG. */
  const exportPng = useCallback(async () => {
    const items = docRef.current.items
    if (items.length === 0) { toast('Nothing on this wall to export yet.'); return }
    const wallBackground = docRef.current.background
    setBusy('Rendering')
    try {
      // Colours are read from the live theme rather than hardcoded, so an
      // export matches the wall the user is looking at.
      const style = getComputedStyle(document.documentElement)
      const png = await exportWallToPng(items, {
        titleOf: labelRef.current,
        background: wallBackground !== 'default'
          ? wallBackground
          : style.getPropertyValue('--color-background').trim() || '#0b0c10',
        textColor: style.getPropertyValue('--color-text-base').trim() || '#ffffff',
        surfaceColor: style.getPropertyValue('--color-surface-1').trim() || '#131622',
        borderColor: style.getPropertyValue('--color-surface-offset').trim() || '#24293f'
      })
      if (!png) { toast('Could not render the wall.', { type: 'error' }); return }
      const saved = await appApi.saveBinaryFile(`${activeWorkspace}-${activeWall?.name ?? 'wall'}.png`.replace(/[^\w.-]+/g, '-'), await png.arrayBuffer(), 'png')
      if (saved) toast('Wall exported.')
    } catch (err) {
      toast(`Export failed: ${errorMessage(err)}`, { type: 'error' })
    } finally {
      setBusy(null)
    }
  }, [activeWorkspace, activeWall, toast])

  const fitToContent = useCallback(() => {
    const rect = viewportRef.current?.getBoundingClientRect()
    if (!rect) return
    setCamera(fitCamera(docRef.current.items, { width: rect.width, height: rect.height }))
  }, [setCamera])

  // Pointer
  /** The arrow under a wall point, if the click landed near enough to one. */
  const arrowAt = (at: { x: number; y: number }): WallItem | null => {
    const slack = 8 / docRef.current.camera.zoom
    for (const arrow of docRef.current.items.filter(i => i.kind === 'arrow')) {
      const ends = arrowAnchors(arrow, itemsById)
      if (!ends) continue
      const { from, to } = ends
      if (!from || !to) continue
      // Against the same points the renderer draws, so a curve is clicked
      // where it looks rather than along the straight line under it.
      const { polyline } = arrowGeometry(from, to, arrow.arrowShape ?? ARROW_SHAPES[0])
      if (distanceToPolyline(at, polyline) <= slack + (arrow.strokeWidth ?? 2)) return arrow
    }
    return null
  }

  const onPointerDown = (e: React.PointerEvent) => {
    setMenu(null)
    const target = e.target as HTMLElement

    // A press in a text field belongs to it. Capture has to be skipped too.
    // A captured pointer never reaches the textarea at all.
    if (target.closest('input, textarea, [contenteditable="true"]')) return

    // Same for the panels floating over the canvas. They are children of it, so
    // without this the canvas takes the pointer first: in pen mode that starts
    // a stroke, and either way capture retargets the click away from the button
    // that was pressed, which is why the ink palette could not be clicked.
    if (target.closest('[data-wall-ui]')) return

    const handle = target.closest<HTMLElement>('[data-wall-handle]')
    const itemEl = target.closest<HTMLElement>('[data-wall-item]')
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)

    // The middle and right buttons, whose jobs are a setting.
    //
    // Out of the box both pan and the right one also opens the menu, which is
    // why a right press cannot know what it was until the release tells it how
    // far it travelled. Anyone who finds that overloading confusing can move
    // panning to the middle button and leave the right one to the menu.
    const pressed = e.button === 1 ? 'middle' : e.button === 2 ? 'right' : null
    if (pressed) {
      const pans = panButtons === 'both' || panButtons === pressed
      const menus = menuButton === pressed
      if (!pans && !menus) return

      const cam = panCameraRef.current ?? docRef.current.camera
      if (menus) {
        rightPressRef.current = {
          clientX: e.clientX,
          clientY: e.clientY,
          itemId: itemEl?.dataset.wallItem ?? null,
          at: toWallPoint(screenPoint(e), cam),
          moved: false
        }
      }
      if (pressed === 'middle') {
        // Chromium answers a middle press with autoscroll: a drift anchor that
        // scrolls the page under the pointer and swallows the drag. Preventing
        // the default here stops the mousedown that starts it.
        e.preventDefault()
      }
      if (pans) {
        dragRef.current = { mode: 'pan', startX: e.clientX, startY: e.clientY, camX: cam.x, camY: cam.y }
      }
      return
    }

    // Space held turns the left button into a pan as well, checked before
    // anything that would otherwise claim the press: the point of it is to
    // move the view without putting the tool down.
    if (spaceHeld && e.button === 0) {
      const cam = panCameraRef.current ?? docRef.current.camera
      dragRef.current = { mode: 'pan', startX: e.clientX, startY: e.clientY, camX: cam.x, camY: cam.y }
      return
    }

    // A connection handle, which sits on an item and so has to be checked
    // before the item does. Same drag as the arrow tool runs, so everything
    // downstream, the preview, the snapping, the styles, is already there.
    const connectHandle = target.closest<HTMLElement>('[data-wall-connect]')
    if (connectHandle && e.button === 0) {
      const fromId = connectHandle.dataset.wallConnect
      if (fromId) {
        dragRef.current = {
          mode: 'arrow', fromId,
          startX: e.clientX, startY: e.clientY, moved: false, overId: null, viaHandle: true
        }
        setArrowDrag({ fromId, at: toWallPoint(screenPoint(e), docRef.current.camera), overId: null })
        return
      }
    }

    // An end handle is grabbed before anything else on the canvas: it sits over
    // the item it is attached to, and the item would otherwise win.
    const endHandle = target.closest<HTMLElement>('[data-arrow-handle]')
    if (endHandle && single?.kind === 'arrow' && e.button === 0) {
      dragRef.current = {
        mode: 'arrowEnd',
        id: single.id,
        end: endHandle.dataset.arrowHandle === 'start' ? 'start' : 'end'
      }
      return
    }

    if (handle && single && !single.locked) {
      if (handle.dataset.wallHandle === 'rotate') {
        const rect = viewportRef.current?.getBoundingClientRect()
        const cam = docRef.current.camera
        const cx = (single.x + single.width / 2) * cam.zoom + cam.x + (rect?.left ?? 0)
        const cy = (single.y + single.height / 2) * cam.zoom + cam.y + (rect?.top ?? 0)
        dragRef.current = {
          mode: 'rotate', id: single.id, cx, cy,
          start: rotationStart({ x: e.clientX, y: e.clientY }, { x: cx, y: cy }, single.rotation ?? 0)
        }
      } else {
        dragRef.current = { mode: 'resize', id: single.id, startX: e.clientX, startY: e.clientY, w: single.width, h: single.height }
      }
      return
    }

    const id = itemEl?.dataset.wallItem
    const item = id ? docRef.current.items.find(i => i.id === id) : undefined

    // Drag from one item to another, with the line following the pointer. A
    // press that never moves still works the old way, picking two items in
    // turn, which is easier between two items that nearly touch.
    if (tool === 'arrow' && e.button === 0) {
      if (!item || item.kind === 'arrow') { setArrowFrom(null); return }
      dragRef.current = {
        mode: 'arrow', fromId: item.id,
        startX: e.clientX, startY: e.clientY, moved: false, overId: null
      }
      setArrowDrag({ fromId: item.id, at: toWallPoint(screenPoint(e), docRef.current.camera), overId: null })
      return
    }

    // The pen takes the whole gesture, over items as well as empty canvas:
    // drawing over a card is the ordinary thing to want. Checked before the
    // move branch, which previously won and dragged the card instead.
    if (tool === 'pen' && e.button === 0) {
      dragRef.current = { mode: 'draw' }
      setDrawing([toWallPoint(screenPoint(e), docRef.current.camera)])
      return
    }

    if (id && item && e.button === 0) {
      if (item.locked) { setSelectedIds(new Set()); return }
      const next = pressSelection(selectedRef.current, id, e.shiftKey)
      setSelectedIds(next)
      if (!e.shiftKey) setItems(bringToFront(docRef.current.items, id), { record: false })
      movingRef.current = withFrameContents(docRef.current.items, next)
      dragRef.current = { mode: 'move', startX: e.clientX, startY: e.clientY, origin: docRef.current.items, moved: false }
      return
    }

    // Before the marquee starts, since a click near a line reads as a click on
    // empty canvas otherwise.
    const arrow = arrowAt(toWallPoint(screenPoint(e), docRef.current.camera))
    if (arrow && e.button === 0) {
      setSelectedIds(new Set([arrow.id]))
      return
    }

    // Shift keeps whatever was selected, so a marquee can add to it.
    if (!e.shiftKey) setSelectedIds(new Set())
    setEditingId(null)

    const p = screenPoint(e)
    // The selection as it was at drag start. Unioning against the live one
    // means an item, once caught, can never be released.
    const base = e.shiftKey ? new Set(selectedRef.current) : new Set<string>()
    dragRef.current = { mode: 'marquee', startX: p.x, startY: p.y, base }
    // What is on screen once the clear above has rendered, so the first frame
    // of the sweep knows what it is starting from.
    setMarquee({ x: p.x, y: p.y, width: 0, height: 0 })
  }

  /** Moves the view by hand, without going through React. */
  const paintCamera = (cam: WallCamera): void => {
    const viewport = viewportRef.current
    if (!viewport) return

    const transform = `translate(${cam.x}px, ${cam.y}px) scale(${cam.zoom})`
    viewport.querySelectorAll<HTMLElement>('[data-wall-camera-layer]').forEach(layer => {
      layer.style.transform = transform
    })
    viewport.style.backgroundPosition = `${cam.x}px ${cam.y}px`
    const dots = gridSpacing(cam.zoom)
    viewport.style.backgroundSize = `${dots}px ${dots}px`

    // The minimap's window onto the wall, kept in step so it does not sit still
    // through the pan and then jump at the end. Its scale and offsets cannot
    // change while a pan runs, so they ride along on the element itself.
    const view = viewport.querySelector<HTMLElement>('[data-wall-minimap-view]')
    const geom = view?.dataset.geom?.split(',').map(Number)
    if (view && geom && geom.length === 5 && geom.every(Number.isFinite)) {
      const [k, ox, oy, vw, vh] = geom
      view.style.left = `${(-cam.x / cam.zoom) * k + ox}px`
      view.style.top = `${(-cam.y / cam.zoom) * k + oy}px`
      view.style.width = `${(vw / cam.zoom) * k}px`
      view.style.height = `${(vh / cam.zoom) * k}px`
    }
  }

  /**
   * Marks what is selected on the elements themselves.
   *
   * Selection is not passed down to the items. It used to be, and releasing a
   * marquee over fifty of them re-rendered fifty subtrees on that one frame.
   * Here only the elements whose state actually changed are touched, and
   * index.css draws the rest.
   */
  const paintSelection = (next: Set<string>, all = false): void => {
    const viewport = viewportRef.current
    if (!viewport) return
    const painted = paintedSelRef.current
    const touched = all || !painted
      ? docRef.current.items.map(i => i.id)
      : [...new Set([...painted, ...next])].filter(id => painted.has(id) !== next.has(id))

    touched.forEach(id => {
      const el = viewport.querySelector<HTMLElement>(`[data-wall-item="${id}"]`)
      if (!el) return
      if (next.has(id)) el.setAttribute('data-wall-selected', '')
      else el.removeAttribute('data-wall-selected')
    })
    paintedSelRef.current = new Set(next)
  }

  /** Moves items, and the arrows on them, by hand without going through React. */
  const paintItems = (items: WallItem[], ids: Set<string>): void => {
    const viewport = viewportRef.current
    if (!viewport) return
    const byId = new Map(items.map(i => [i.id, i]))

    ids.forEach(id => {
      const item = byId.get(id)
      const el = viewport.querySelector<HTMLElement>(`[data-wall-item="${id}"]`)
      if (!item || !el) return
      el.style.transform = `translate(${item.x}px, ${item.y}px)${item.rotation ? ` rotate(${item.rotation}deg)` : ''}`
    })

    // An arrow has no position of its own. One on a moving item is redrawn
    // from wherever both its ends now are, the same way the render draws it.
    items.forEach(arrow => {
      if (arrow.kind !== 'arrow') return
      if (![arrow.from, arrow.to].some(end => end !== undefined && ids.has(end))) return
      const g = viewport.querySelector<SVGGElement>(`[data-wall-arrow="${arrow.id}"]`)
      const ends = arrowAnchors(arrow, byId)
      if (!g || !ends) return

      const width = arrow.strokeWidth ?? 2
      const heads = arrow.arrowHeads ?? ARROW_HEAD_MODES[0]
      const inset = arrowHeadInset(width)
      const geo = arrowGeometry(ends.from, ends.to, arrow.arrowShape ?? ARROW_SHAPES[0], {
        end: heads !== 'none' ? inset : 0,
        start: heads === 'both' ? inset : 0
      })
      g.querySelector('path')?.setAttribute('d', geo.d)
      // In the order the render puts them: the end head first, then the start.
      const [endHead, startHead] = Array.from(g.querySelectorAll('polygon'))
      endHead?.setAttribute('points', arrowHeadPoints(geo.end, geo.endAngle, width))
      startHead?.setAttribute('points', arrowHeadPoints(geo.start, geo.startAngle, width))
    })
  }

  // A render in the middle of a move, from the rail lighting up under the
  // pointer say, writes the positions in state back over the ones drawn by
  // hand. Drawn again before that frame is shown.
  useLayoutEffect(() => {
    if (liveItemsRef.current) paintItems(liveItemsRef.current, movingRef.current)
    // A sweep in flight is ahead of the selection in state, so it wins. Items
    // added or removed by the render itself are covered either way, because
    // this diffs against what is actually on the elements.
    paintSelection(marqueeSelRef.current ?? selectedIds)
  })

  /**
   * One drag frame's worth of work. Takes bare numbers rather than the event so
   * the handler below can hold on to a position and replay it later.
   */
  const applyPointerMove = (e: { clientX: number; clientY: number; shiftKey: boolean }) => {
    const drag = dragRef.current
    if (!drag) return
    // The live camera: a zoom drawn moments ago may not be state yet.
    const cam = panCameraRef.current ?? docRef.current.camera

    if (drag.mode === 'pan') {
      // Painted here and committed once on release. Zoom cannot change while a
      // pan is running, so the one in hand is still current.
      const panned = { ...cam, x: drag.camX + (e.clientX - drag.startX), y: drag.camY + (e.clientY - drag.startY) }
      panCameraRef.current = panned
      paintCamera(panned)
      return
    }

    if (drag.mode === 'arrowEnd') {
      const at = toWallPoint(screenPoint(e), cam)
      const arrow = docRef.current.items.find(i => i.id === drag.id)
      if (!arrow) return

      const { targetId, patch } = arrowEndTarget(docRef.current.items, at, arrow, drag.end)
      setArrowEndHover(targetId)
      // Recorded once when the drag ends, not per frame.
      setItems(patchItems(docRef.current.items, new Set([drag.id]), patch), { record: false })
      return
    }

    if (drag.mode === 'arrow') {
      if (!drag.moved && Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > CLICK_SLOP) {
        drag.moved = true
      }
      const at = toWallPoint(screenPoint(e), cam)
      drag.overId = arrowDropTarget(docRef.current.items, at, drag.fromId)
      setArrowDrag({ fromId: drag.fromId, at, overId: drag.overId })
      return
    }

    if (drag.mode === 'draw') {
      const at = toWallPoint(screenPoint(e), cam)
      // Dropped when the pointer has barely moved: raw pointer events are far
      // denser than the drawing needs, and every point is persisted.
      setDrawing(path => {
        if (!path) return path
        const last = path[path.length - 1]
        return isStrokeJitter(last, at, cam.zoom) ? path : [...path, at]
      })
      return
    }

    if (drag.mode === 'marquee') {
      const p = screenPoint(e)
      // Drawn by hand: through state the box re-rendered the wall on every
      // frame of the sweep. The state set at the press only makes it exist.
      const box = rectFromPoints({ x: drag.startX, y: drag.startY }, p)
      marqueeRectRef.current = box
      const el = viewportRef.current?.querySelector<HTMLElement>('[data-wall-marquee]')
      if (el) {
        el.style.left = `${box.x}px`
        el.style.top = `${box.y}px`
        el.style.width = `${box.width}px`
        el.style.height = `${box.height}px`
      }
      const a = toWallPoint({ x: drag.startX, y: drag.startY }, cam)
      const b = toWallPoint(p, cam)
      const hit = itemsInRect(docRef.current.items, rectFromPoints(a, b))
      // Painted by hand and committed on release. Through state, every frame
      // re-rendered the outline and the handles of every item the box crossed,
      // which on a wide sweep was the last thing still costing a stutter.
      const next = new Set([...drag.base, ...hit])
      paintSelection(next)
      marqueeSelRef.current = next
      return
    }

    if (drag.mode === 'rotate') {
      const rotation = rotationAngle({ x: e.clientX, y: e.clientY }, { x: drag.cx, y: drag.cy }, drag.start, e.shiftKey)
      setItems(
        docRef.current.items.map(i =>
          i.id === drag.id ? { ...i, rotation } : i
        ),
        { record: false }
      )
      return
    }

    const dx = (e.clientX - drag.startX) / cam.zoom
    const dy = (e.clientY - drag.startY) / cam.zoom

    if (drag.mode === 'move') {
      // A press that has not travelled yet is still a click. Without this a
      // hand that shifts a pixel while clicking nudges the item and spends an
      // undo step on it.
      if (!drag.moved && Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < CLICK_SLOP) return
      drag.moved = true

      // Hit-tested against the document: capture keeps sending us events even
      // once the cursor has left the canvas for the rail.
      const under = railOpen ? document.elementFromPoint(e.clientX, e.clientY) : null
      const columnId = under?.closest<HTMLElement>('[data-wall-column]')?.dataset.wallColumn ?? null
      const overRail = !!under?.closest('[data-wall-rail]')
      railHoverRef.current = { overRail, columnId }
      // Unconditional. React drops same-value writes, and comparing risks a miss.
      setDropColumnId(columnId)

      const moving = movingRef.current
      const moved = moveItems(drag.origin, moving, dx, dy)
      const live = snapMoving(moved, moving, snapping)
      // Drawn by hand and committed on release, like a pan. Through state,
      // every frame re-rendered the wall to move a few items across it.
      liveItemsRef.current = live
      paintItems(live, moving)
    } else {
      const size = resizedSize(drag.w, drag.h, dx, dy, snapping)
      setItems(
        docRef.current.items.map(i =>
          i.id === drag.id ? { ...i, ...size } : i
        ),
        { record: false }
      )
    }
  }

  /**
   * Keeps only the newest position and lets the frame apply it. Everything the
   * pointer reports in between lands on a screen that has not repainted yet.
   */
  const onPointerMove = (e: React.PointerEvent) => {
    // How far a press that might still become a menu has travelled. Tracked
    // here rather than inside the pan branch, because a button set to open the
    // menu and nothing else starts no drag at all, and would otherwise answer
    // a long sweep with a context menu.
    const press = rightPressRef.current
    if (press && !press.moved &&
      Math.hypot(e.clientX - press.clientX, e.clientY - press.clientY) > CLICK_SLOP) {
      press.moved = true
    }
    if (!dragRef.current) return
    pendingMoveRef.current = { clientX: e.clientX, clientY: e.clientY, shiftKey: e.shiftKey }
    if (moveFrameRef.current !== null) return
    moveFrameRef.current = requestAnimationFrame(() => {
      moveFrameRef.current = null
      const next = pendingMoveRef.current
      // The drag can end between the event and the frame it asked for.
      if (next && dragRef.current) applyPointerMove(next)
    })
  }

  const endDrag = (e: React.PointerEvent) => {
    // Run the frame that has not fired yet, or the drop lands wherever the
    // pointer was up to sixteen milliseconds ago instead of where it let go.
    if (moveFrameRef.current !== null) {
      cancelAnimationFrame(moveFrameRef.current)
      moveFrameRef.current = null
      const pending = pendingMoveRef.current
      if (pending && dragRef.current) applyPointerMove(pending)
    }
    pendingMoveRef.current = null

    // A pan was drawn by hand while it ran. This is where it becomes state, and
    // the render that follows writes back the values already on screen.
    if (panCameraRef.current) {
      const settled = panCameraRef.current
      panCameraRef.current = null
      setCamera(settled)
    }
    // Same for a move. Through setItems, so the history sees what it used to
    // see from the frames, a replaced present, before the push below.
    const movedItems = liveItemsRef.current
    liveItemsRef.current = null
    if (movedItems) setItems(movedItems, { record: false })

    setArrowEndHover(null)
    const drag = dragRef.current
    dragRef.current = null
    // A sweep that never moved committed nothing: the press already set the
    // selection it wanted.
    const swept = marqueeSelRef.current
    marqueeSelRef.current = null
    if (swept) setSelectedIds(swept)

    marqueeRectRef.current = null
    setMarquee(null)
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId) } catch { /* already released */ }

    // A right press that went nowhere was a click, so it opens a menu.
    const press = rightPressRef.current
    rightPressRef.current = null
    if (press && !press.moved) {
      if (press.itemId && !selectedRef.current.has(press.itemId)) {
        setSelectedIds(new Set([press.itemId]))
      }
      setMenu({ x: press.clientX, y: press.clientY, itemId: press.itemId, at: press.at })
      return
    }

    if (drag?.mode === 'arrow') {
      setArrowDrag(null)
      const style = {
        color: penColor,
        strokeWidth: penWidth,
        ...(arrowShape !== ARROW_SHAPES[0] ? { arrowShape } : {}),
        ...(arrowLine !== ARROW_LINES[0] ? { arrowLine } : {}),
        ...(arrowHeads !== ARROW_HEAD_MODES[0] ? { arrowHeads } : {})
      }

      const release = arrowRelease({
        fromId: drag.fromId,
        moved: drag.moved,
        overId: drag.overId,
        viaHandle: drag.viaHandle,
        travelled: Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY),
        armed: arrowFrom
      })
      if (release.draw) {
        addItem('arrow', release.draw.to !== null
          ? { from: release.draw.from, to: release.draw.to, ...style }
          : { from: release.draw.from, toPoint: toWallPoint(screenPoint(e), docRef.current.camera), ...style })
      }
      if (release.armed !== undefined) setArrowFrom(release.armed)
      if (release.handBack) setTool('select')
      return
    }

    if (drag?.mode === 'draw') {
      const ink = drawing && inkFromPath(drawing, docRef.current.items, {
        color: penColor, strokeWidth: penWidth, ...(smoothing ? { smooth: SMOOTHING_STRENGTH } : {})
      })
      setDrawing(null)
      if (ink) {
        setItems([...docRef.current.items, ink])
        setSelectedIds(new Set())
      }
      return
    }

    const hover = railHoverRef.current
    railHoverRef.current = { overRail: false, columnId: null }
    setDropColumnId(null)

    // The rail is beside the canvas, not part of it. Items released over it go
    // back, or they end up parked off-screen behind the panel.
    if (drag?.mode === 'move' && hover.overRail) {
      setItems(drag.origin, { record: false })
      if (hover.columnId) void handOffToColumn(hover.columnId)
      return
    }

    // One undo step for the whole gesture, recorded now that it is finished.
    // A move that never passed the threshold changed nothing worth recording.
    if (recordsHistory(drag)) {
      historyRef.current = pushHistory(historyRef.current, movedItems ?? docRef.current.items)
      setHistoryTick(t => t + 1)
    }
  }

  // Keyboard
  useEffect(() => {
    const down = (e: KeyboardEvent): void => {
      if (e.code !== 'Space' || e.repeat) return
      // Space belongs to whatever has focus: it types, and it presses a button
      // that has been tabbed to. Only a press with nothing focused is a pan.
      const el = document.activeElement
      if (el instanceof HTMLElement && el !== document.body &&
        el.closest('button, a, input, textarea, select, [role="button"], [contenteditable="true"]')) return
      // Otherwise the page scrolls under the wall.
      e.preventDefault()
      setSpaceHeld(true)
    }
    const up = (e: KeyboardEvent): void => { if (e.code === 'Space') setSpaceHeld(false) }
    // A key held while the window loses focus is never seen to come up, and the
    // wall would be stuck panning when you came back to it.
    const clear = (): void => setSpaceHeld(false)

    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', clear)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', clear)
    }
  }, [])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const el = document.activeElement
      // contenteditable included now that bare letters arm a tool: typing "a"
      // into text must not switch to the arrow.
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return
      if (el instanceof HTMLElement && el.isContentEditable) return

      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        applyHistory(e.shiftKey ? redo(historyRef.current) : undo(historyRef.current))
        return
      }
      // The tools and duplicate come from the bindings, so Settings can move
      // them. V, P and A are only the defaults now, not the definition.
      const command = matchKey(e)
      if (command === 'wall_tool_select') { setTool('select'); setArrowFrom(null); return }
      if (command === 'wall_tool_draw') { setTool('pen'); setArrowFrom(null); return }
      if (command === 'wall_tool_connect') { setTool('arrow'); setArrowFrom(null); return }
      if (command === 'wall_duplicate') { e.preventDefault(); duplicateSelected(); return }
      if (command === 'wall_delete') { e.preventDefault(); removeSelected(); return }

      if (mod && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        setSelectedIds(new Set(docRef.current.items.filter(i => !i.locked).map(i => i.id)))
        return
      }
      if (e.key === 'Escape') {
        // Every open panel, not just the canvas state. A popover you can open
        // with the keyboard and only close with the mouse is a trap.
        setWallMenuOpen(false)
        setRenaming(null)
        setBgOpen(false)
        setShortcutsOpen(false)
        setPicker(null)
        setTool('select')
        setArrowFrom(null)
        setArrowDrag(null)
        setSelectedIds(new Set())
        setEditingId(null)
        setMenu(null)
        return
      }
      if (selectedRef.current.size === 0) return

      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeSelected(); return }

      const step = e.shiftKey ? NUDGE * 5 : NUDGE
      const deltas: Record<string, [number, number]> = {
        ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step]
      }
      const delta = deltas[e.key]
      if (delta) {
        e.preventDefault()
        // Nudging matches dragging: a frame takes its contents either way.
        setItems(moveItems(
          docRef.current.items,
          withFrameContents(docRef.current.items, selectedRef.current),
          delta[0],
          delta[1]
        ))
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [applyHistory, duplicateSelected, matchKey, removeSelected, setItems])

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const el = document.activeElement
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return
      const files = e.clipboardData?.files ? Array.from(e.clipboardData.files) : []
      if (files.some(f => f.type.startsWith('image/'))) {
        e.preventDefault()
        void placeImageFiles(files)
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [placeImageFiles])

  // Context menus
  const menuEntries = (): MenuEntry[] => {
    if (!menu) return []

    if (menu.itemId) {
      const item = doc.items.find(i => i.id === menu.itemId)
      if (!item) return []
      const many = selectedIds.size > 1

      // Only for a single image: these read the source pixels, and there is no
      // sensible meaning for "generate maps" from a mixed selection.
      const imageOps: MenuEntry[] = item.kind === 'image' && item.ref && !many
        ? [
            {
              label: 'Generate PBR maps',
              icon: <Wand2 size={13} />,
              onClick: () => void runImageOp('Generating maps', async () => {
                placeDerived(item, await derivePbrMaps(item.ref as string))
              })
            },
            {
              label: 'Upscale 2×',
              icon: <Expand size={13} />,
              onClick: () => void runImageOp('Upscaling', async () => {
                placeDerived(item, [await deriveUpscale(item.ref as string, 2)])
              })
            },
            {
              label: 'Upscale 3×',
              icon: <Expand size={13} />,
              onClick: () => void runImageOp('Upscaling', async () => {
                placeDerived(item, [await deriveUpscale(item.ref as string, 3)])
              })
            },
            {
              label: 'Extract palette',
              icon: <Palette size={13} />,
              onClick: () => void runImageOp('Reading colours', async () => {
                const colors = await derivePalette(item.ref as string)
                if (colors.length === 0) { toast('No colours found in that image.'); return }
                // Swatches: small squares in a row under the image, each one a
                // colour you can then paint other items with.
                const base = docRef.current.items
                const swatches = colors.map((c, i) =>
                  createWallItem('note', {
                    x: item.x + i * 56 + 24,
                    y: item.y + item.height + 24
                  }, base, { color: c, text: c, width: 48, height: 48 })
                )
                setItems([...base, ...swatches])
                setSelectedIds(new Set(swatches.map(sw => sw.id)))
              })
            }
          ]
        : []

      return [
        ...imageOps,
        ...(item.kind === 'card' && !many
          ? [{ label: 'Open card', icon: <ExternalLink size={13} />, onClick: () => openCard(item) }]
          : []),
        { label: many ? `Duplicate ${selectedIds.size} items` : 'Duplicate', icon: <Copy size={13} />, hint: 'Ctrl D', onClick: duplicateSelected },
        { label: 'Bring to front', icon: <ArrowUp size={13} />, onClick: () => setItems(bringToFront(doc.items, item.id)) },
        { label: 'Send to back', icon: <ArrowDown size={13} />, onClick: () => setItems(sendToBack(doc.items, item.id)) },
        {
          label: item.locked ? 'Unlock' : 'Lock in place',
          icon: item.locked ? <Unlock size={13} /> : <Lock size={13} />,
          onClick: toggleLock
        },
        { label: many ? `Delete ${selectedIds.size} items` : 'Delete', icon: <Trash2 size={13} />, hint: 'Del', destructive: true, onClick: removeSelected }
      ]
    }

    return [
      { label: 'Sticky note here', icon: <StickyNote size={13} />, onClick: () => addItem('note', {}, menu.at) },
      { label: 'Text here', icon: <Type size={13} />, onClick: () => addItem('text', {}, menu.at) },
      { label: 'Frame here', icon: <Square size={13} />, onClick: () => addItem('frame', {}, menu.at) },
      { label: 'Select all', icon: <Layers size={13} />, hint: 'Ctrl A', onClick: () => setSelectedIds(new Set(doc.items.filter(i => !i.locked).map(i => i.id))) },
      { label: 'Fit to content', icon: <Maximize2 size={13} />, onClick: fitToContent, disabled: doc.items.length === 0 }
    ]
  }

  // Not doc.camera directly: while a pan is in flight the live one is in the
  // ref, and a render triggered by something else entirely still has to agree
  // with what has already been painted.
  const camera = panCameraRef.current ?? doc.camera
  // 'default' follows the theme, until someone picks a colour.
  const custom = doc.background && doc.background !== 'default' ? doc.background : null
  const canvasBackground = custom ?? 'var(--color-background)'
  // Derived from the background: a fixed dot colour vanishes on half the palette.
  const dotColor = custom
    ? (getTextColorForBackground(custom) === '#ffffff' ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.18)')
    : 'var(--color-surface-offset)'
  // Anything already on the wall is left out: placing a second copy of the same
  // card is possible but never what the picker is for.
  const placed = new Set(
    doc.items
      .filter(i => (i.kind === 'card' || i.kind === 'doc') && i.ref)
      .map(i => i.ref as string)
  )
  const pickerRows = picker === 'card'
    ? cards.filter(c => !placed.has(c.id)).map(c => ({ ref: c.id, label: c.title }))
    : picker === 'doc'
      ? notes.filter(n => !placed.has(n.title)).map(n => ({ ref: n.title, label: n.title }))
      : []

  /** What an item is called, wherever its name actually lives. */
  const labelOf = (i: WallItem): string | undefined => {
    if (i.kind === 'card') return cardsById.get(i.ref ?? '')?.title
    if (i.kind === 'doc') return i.ref
    if (i.kind === 'image') return i.text
    return i.text
  }
  labelRef.current = labelOf
  const matches = query.trim() ? searchItems(doc.items, query, labelOf) : []

  // Read after historyTick so the buttons reflect the ref-held stack.
  void historyTick
  const undoable = canUndo(historyRef.current)
  const redoable = canRedo(historyRef.current)

  /**
   * Where the selection's toolbar goes, in screen space.
   *
   * Above the selection normally, below it when there is no room. The canvas
   * clips its overflow, so an unclamped toolbar simply vanished whenever the
   * selected item was near the top edge. Horizontal is clamped too, since the
   * toolbar is centre-anchored and would otherwise hang off either side.
   */
  const selectionBounds = boundsOf(selectedItems)
  /**
   * The selection toolbar's own width, so the clamp below knows what it is
   * keeping on screen. It changes with the selection: an arrow adds four more
   * buttons than a sticky note does.
   */
  const floatingRef = useRef<HTMLDivElement>(null)
  const [floatingWidth, setFloatingWidth] = useState(220)
  const floatingPos = ((): { left: number; top: number } | null => {
    if (!selectionBounds || editingId) return null

    const centreX = (selectionBounds.minX + (selectionBounds.maxX - selectionBounds.minX) / 2) * camera.zoom + camera.x
    const above = selectionBounds.minY * camera.zoom + camera.y - 44
    const below = selectionBounds.maxY * camera.zoom + camera.y + 12

    const rect = viewportRef.current?.getBoundingClientRect()
    // Measured rather than assumed. This was a flat 110, which was already
    // wrong for the arrow toolbar and stayed wrong: the clamp let a toolbar
    // wider than 220 hang off the edge it was there to keep it away from.
    const halfWidth = floatingWidth / 2
    return {
      left: rect ? Math.min(Math.max(centreX, halfWidth), rect.width - halfWidth) : centreX,
      top: above < 4 ? below : above
    }
  })()

  /**
   * The toolbar's width, read back after it has been laid out.
   *
   * Measured rather than counted from the buttons: the arrow controls, the
   * label button and the colour swatch come and go with what is selected, and
   * a number kept in step by hand would drift the first time one of them
   * changed.
   */
  useLayoutEffect(() => {
    const width = floatingRef.current?.offsetWidth
    if (width && width !== floatingWidth) setFloatingWidth(width)
  }, [floatingWidth, selectedIds, arrowsSelected, single?.locked, single?.text])

  /** A popover belongs to the selection that opened it. */
  useEffect(() => { setSwatchOpen(false) }, [selectedIds])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>

      <ConfirmDialog
        isOpen={pendingDelete !== null}
        title="Delete wall"
        message={`Delete "${pendingDelete?.name ?? ''}" and everything on it?`}
        warning="Cards and notes placed on it are only removed from the wall. The originals are untouched."
        confirmText="Delete wall"
        isDestructive
        onConfirm={() => void confirmDeleteWall()}
        onCancel={() => setPendingDelete(null)}
      />

      {/* Toolbar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
        padding: 'var(--space-2) var(--space-3)',
        borderBottom: '1px solid var(--color-surface-offset)',
        flexShrink: 0, position: 'relative'
      }}>
        <WallBackgroundMenu bgOpen={bgOpen} setBgOpen={setBgOpen} custom={custom} setBackground={setBackground} />

        <div style={{ width: '1px', height: '18px', background: 'var(--color-surface-offset)' }} />

        {/* Which wall */}
        <WallSwitcher
          wallIndex={wallIndex}
          activeWall={activeWall}
          wallMenuOpen={wallMenuOpen}
          setWallMenuOpen={setWallMenuOpen}
          renaming={renaming}
          setRenaming={setRenaming}
          commitIndex={commitIndex}
          addWall={addWall}
          setPendingDelete={setPendingDelete}
        />

        <div style={{ width: '1px', height: '18px', background: 'var(--color-surface-offset)' }} />

        {toolButton('Select', <MousePointer2 size={14} />, () => setTool('select'), { active: tool === 'select', shortcut: keys.wall_tool_select })}
        {toolButton('Draw', <PenLine size={14} />, () => setTool(t => (t === 'pen' ? 'select' : 'pen')), { active: tool === 'pen', shortcut: keys.wall_tool_draw })}
        {toolButton('Connect two items', <Spline size={14} />, () => { setArrowFrom(null); setTool(t => (t === 'arrow' ? 'select' : 'arrow')) }, { active: tool === 'arrow', shortcut: keys.wall_tool_connect })}

        {toolButton('Sticky note', <StickyNote size={14} />, () => addItem('note'))}
        {toolButton('Text', <Type size={14} />, () => addItem('text'))}
        {toolButton('Frame', <Square size={14} />, () => addItem('frame'))}
        {toolButton('Place a card', <Layers size={14} />, () => setPicker(p => (p === 'card' ? null : 'card')))}
        {toolButton('Place a note', <FileText size={14} />, () => setPicker(p => (p === 'doc' ? null : 'doc')))}
        {toolButton('Image', <ImageIcon size={14} />, () => fileInputRef.current?.click())}

        <div style={{ width: '1px', height: '18px', background: 'var(--color-surface-offset)' }} />

        {toolButton('Undo', <Undo2 size={14} />, () => applyHistory(undo(historyRef.current)), { disabled: !undoable })}
        {toolButton('Redo', <Redo2 size={14} />, () => applyHistory(redo(historyRef.current)), { disabled: !redoable })}
        {toolButton('Snap to grid', <Grid3x3 size={14} />, () => setSnapping(v => !v), { active: snapping })}
        {toolButton('Fit to content', <Maximize2 size={14} />, fitToContent, { disabled: doc.items.length === 0 })}
        {toolButton('Export as PNG', <Download size={14} />, () => void exportPng(), { disabled: doc.items.length === 0 })}

        {/* A number you cannot act on is a label pretending to be a control.
            Clicking it is the fastest way back from a zoom you regret. */}
        <button
          onClick={() => setCamera({ ...docRef.current.camera, zoom: 1 })}
          title="Reset zoom to 100%"
          aria-label="Reset zoom to 100 percent"
          disabled={Math.round(camera.zoom * 100) === 100}
          style={{
            fontSize: '11px', color: 'var(--color-text-faint)', fontFamily: 'var(--font-mono)',
            minWidth: '46px', height: '24px', padding: '0 var(--space-1)',
            background: 'none', border: 'none', borderRadius: 'var(--radius-sm)',
            cursor: Math.round(camera.zoom * 100) === 100 ? 'default' : 'pointer'
          }}
        >
          {Math.round(camera.zoom * 100)}%
        </button>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 'var(--space-3)', position: 'relative' }}>
          {/* Says what the armed tool does rather than everything at once. The
              old line wrapped to two rows and was ignored either way. */}
          <span style={{ fontSize: '10px', color: 'var(--color-text-faint)', whiteSpace: 'nowrap' }}>
            {tool === 'pen'
              ? 'Drag to draw · Esc to stop'
              : tool === 'arrow'
                ? (arrowFrom ? 'Now click the item to point at' : 'Drag from one item to another, or to anywhere')
                : `Drag to select · Space or ${panHintLabel(panButtons)} to pan`}
          </span>

          <WallSearch query={query} setQuery={setQuery} matches={matches} jumpTo={jumpTo} labelOf={labelOf} />

          <WallShortcutsMenu
            shortcutsOpen={shortcutsOpen}
            setShortcutsOpen={setShortcutsOpen}
            keys={keys}
            panButtons={panButtons}
            menuButton={menuButton}
          />

          {/* At this end because the panel it opens is on this side. It used
              to sit on the far left, pointing across the whole toolbar. */}
          {toolButton(
            railOpen ? 'Hide the board' : 'Show the board beside the wall',
            <PanelRight size={14} />,
            toggleRail,
            { active: railOpen }
          )}
        </div>

        {picker && (
          <WallPlacePicker picker={picker} pickerRows={pickerRows} notes={notes} addItem={addItem} setPicker={setPicker} />
        )}

        <input
          ref={fileInputRef} type="file" accept="image/*" multiple style={{ display: 'none' }}
          onChange={e => { void placeImageFiles(Array.from(e.target.files ?? [])); e.target.value = '' }}
        />
      </div>

      {/* Beside the canvas, not over it. The drag should be a straight line. */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* Canvas */}
        <div
          ref={viewportRef}
          onWheel={onWheel}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          // Suppressed entirely: the menu is opened from the pointer release,
          // which is the only place a click can be told apart from a pan.
          onContextMenu={e => e.preventDefault()}
          // Hit-tested by coordinate, not by event.target: the pointer capture
          // taken during a drag retargets the following dblclick to this element,
          // so the target reports the viewport whatever was actually clicked.
          onDoubleClick={e => {
            // Double-clicking a word inside a note being edited selects the word.
            if ((e.target as HTMLElement).closest('input, textarea, [contenteditable="true"]')) return

            // The floating panels are children of the canvas, and this handler
            // works from coordinates rather than the target, so without the
            // guard a double-click on the ink palette made a note behind it.
            if ((e.target as HTMLElement).closest('[data-wall-ui]')) return
            const at = toWallPoint(screenPoint(e), docRef.current.camera)
            const hit = itemAtPoint(docRef.current.items, at)
            if (!hit) {
              // A connector has no box to hit, so it is asked for by hand
              // before the empty canvas gets to make a note.
              const arrow = arrowAt(at)
              if (arrow) { setSelectedIds(new Set([arrow.id])); setEditingId(arrow.id); return }
              addItem('note', {}, at)
              return
            }
            if (hit.locked) return
            if (hit.kind === 'card') openCard(hit)
            else if (hit.kind === 'doc') {
              // Hands the title to the Notes view, which opens it on arrival.
              if (hit.ref) {
                setPendingNoteTitle(hit.ref)
                setView('notes')
              }
            }
            else if (hit.kind !== 'image') setEditingId(hit.id)
          }}
          onDragOver={e => {
            e.preventDefault()
          // Copy, not move. The card stays on the board.
            if (e.dataTransfer.types.includes(WALL_DRAG_MIME)) e.dataTransfer.dropEffect = 'copy'
          }}
          onDrop={e => {
            e.preventDefault()
            const at = toWallPoint(screenPoint(e), docRef.current.camera)
            const dragged = decodeWallDrag(e.dataTransfer.getData(WALL_DRAG_MIME))
          // Where the cursor was. The whole point of dragging rather than picking.
            if (dragged) { addItem(dragged.kind, { ref: dragged.ref }, at); return }
            void placeImageFiles(Array.from(e.dataTransfer.files ?? []), at)
          }}
          style={{
            flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden',
            cursor: spaceHeld ? 'grab' : tool === 'pen' ? 'crosshair' : tool === 'arrow' ? 'copy' : undefined,
            background: canvasBackground,
            backgroundImage: `radial-gradient(circle, ${dotColor} 1px, transparent 1px)`,
            backgroundSize: `${gridSpacing(camera.zoom)}px ${gridSpacing(camera.zoom)}px`,
            backgroundPosition: `${camera.x}px ${camera.y}px`
          }}
        >
          {loading && (
            <div style={{
              position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 'var(--text-sm)', color: 'var(--color-text-faint)'
            }}>
              Opening the wall…
            </div>
          )}

          {!loading && doc.items.length === 0 && (
            <div style={{
              position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', gap: 'var(--space-2)',
              pointerEvents: 'none', textAlign: 'center', padding: 'var(--space-6)'
            }}>
              <span style={{ fontSize: 'var(--text-base)', color: 'var(--color-text-muted)' }}>An empty wall</span>
              <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-faint)', maxWidth: '440px', lineHeight: 1.6 }}>
                Double-click anywhere for a sticky note, drop images straight on, or place cards
                from the board. Nothing snaps and nothing sorts. Put things where you want them.
              </span>
            </div>
          )}

          <div data-wall-camera-layer style={{
            position: 'absolute', top: 0, left: 0,
            transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`,
            transformOrigin: '0 0',
            // Promoted up front. A plain 2D transform is not given its own
            // compositor layer, so the first frame of a pan repainted the whole
            // board on the main thread; only then did Chromium notice the
            // transform was moving and promote it, which is why a pan used to
            // stall once at the start and run smoothly ever after.
            willChange: 'transform',
          }}>
            {/* One layer for every arrow. They have no box of their own: each
                is redrawn from wherever its two items currently are. */}
            <svg
              style={{
                position: 'absolute', left: 0, top: 0, width: '1px', height: '1px',
                overflow: 'visible', pointerEvents: 'none', zIndex: 1
              }}
            >
              {doc.items.filter(i => i.kind === 'arrow').map(arrow => {
                const ends = arrowAnchors(arrow, itemsById)
                if (!ends) return null

                const width = arrow.strokeWidth ?? 2
                const stroke = arrow.color || 'var(--color-text-muted)'
                const selected = selectedIds.has(arrow.id)
                const heads = arrow.arrowHeads ?? ARROW_HEAD_MODES[0]
                // Stopped behind whichever ends carry a head, so a thick stroke
                // does not fill in the notch it is supposed to meet.
                const inset = arrowHeadInset(width)
                const g = arrowGeometry(ends.from, ends.to, arrow.arrowShape ?? ARROW_SHAPES[0], {
                  end: heads !== 'none' ? inset : 0,
                  start: heads === 'both' ? inset : 0
                })

                return (
                  <g key={arrow.id} data-wall-arrow={arrow.id} opacity={selected ? 1 : 0.85}>
                    <path
                      d={g.d}
                      fill="none"
                      stroke={stroke}
                      strokeWidth={width + (selected ? 2 : 0)}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeDasharray={arrowDash(arrow.arrowLine ?? ARROW_LINES[0], width)}
                    />
                    {heads !== 'none' && (
                      <polygon points={arrowHeadPoints(g.end, g.endAngle, width)} fill={stroke} />
                    )}
                    {heads === 'both' && (
                      <polygon points={arrowHeadPoints(g.start, g.startAngle, width)} fill={stroke} />
                    )}
                  </g>
                )
              })}

              {/* The connector being dragged out. Drawn in the style it will
                  have, so what is on screen is what gets made. */}
              {arrowDrag && (() => {
                const from = itemsById.get(arrowDrag.fromId)
                if (!from) return null

                // Snaps to the item under the pointer when there is one, and
                // otherwise follows the pointer itself as a point with no size.
                const target = arrowDrag.overId ? itemsById.get(arrowDrag.overId) : undefined
                const landing: WallItem = target ?? {
                  id: '', kind: 'note', z: 0,
                  x: arrowDrag.at.x, y: arrowDrag.at.y, width: 1, height: 1
                }
                const inset = arrowHeadInset(penWidth)
                const g = arrowGeometry(from, landing, arrowShape, {
                  end: arrowHeads !== 'none' ? inset : 0,
                  start: arrowHeads === 'both' ? inset : 0
                })

                return (
                  <g opacity={target ? 0.9 : 0.55}>
                    <path
                      d={g.d}
                      fill="none"
                      stroke={penColor}
                      strokeWidth={penWidth}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeDasharray={arrowDash(arrowLine, penWidth)}
                    />
                    {arrowHeads !== 'none' && (
                      <polygon points={arrowHeadPoints(g.end, g.endAngle, penWidth)} fill={penColor} />
                    )}
                    {arrowHeads === 'both' && (
                      <polygon points={arrowHeadPoints(g.start, g.startAngle, penWidth)} fill={penColor} />
                    )}
                  </g>
                )
              })()}
            </svg>

            {/* The stroke in progress. Drawn separately because it is not an
                item yet: it becomes one when the pointer comes up. */}
            {drawing && drawing.length > 1 && (
              <svg style={{ position: 'absolute', left: 0, top: 0, width: '1px', height: '1px', overflow: 'visible', pointerEvents: 'none', zIndex: 2 }}>
                <polyline
                  points={drawing.map(pt => `${pt.x},${pt.y}`).join(' ')}
                  fill="none"
                  stroke={penColor}
                  strokeWidth={penWidth}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            )}

            {inPaintOrder(doc.items).filter(i => i.kind !== 'arrow').map(item => {
              const isSelected = selectedIds.has(item.id)
              return (
                <WallItemLayer
                  key={item.id}
                  item={item}
                  card={item.kind === 'card' ? cardsById.get(item.ref ?? '') : undefined}
                  note={item.kind === 'doc' ? notesByTitle.get(item.ref ?? '') : undefined}
                  editing={editingId === item.id}
                  connectable={tool === 'select' && !item.locked && item.kind !== 'frame'}
                  showHandles={isSelected && single?.id === item.id && !item.locked}
                  arrowTarget={arrowDrag?.overId === item.id || arrowEndHover === item.id}
                  arrowFrom={arrowFrom === item.id}
                  onTextChange={onItemTextChange}
                  onFinishEditing={onItemFinishEditing}
                />
              )
            })}
          </div>

          {/* Labels, above the lines and the items so they stay readable.
              An arrow's label lives in `text`, the same field a frame's does. */}
          <div data-wall-camera-layer style={{
            position: 'absolute', left: 0, top: 0, width: '1px', height: '1px',
            transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`,
            transformOrigin: '0 0', zIndex: 5, pointerEvents: 'none',
            willChange: 'transform'
          }}>
            {doc.items.filter(i => i.kind === 'arrow').map(arrow => {
              const editing = editingId === arrow.id
              if (!arrow.text && !editing) return null

              const ends = arrowAnchors(arrow, itemsById)
              if (!ends) return null
              const { mid } = arrowGeometry(ends.from, ends.to, arrow.arrowShape ?? ARROW_SHAPES[0])

              return (
                <div
                  key={arrow.id}
                  data-arrow-label={arrow.id}
                  onPointerDown={e => { e.stopPropagation(); setSelectedIds(new Set([arrow.id])) }}
                  onDoubleClick={e => { e.stopPropagation(); setEditingId(arrow.id) }}
                  style={{
                    position: 'absolute', left: 0, top: 0,
                    transform: `translate(${mid.x}px, ${mid.y}px) translate(-50%, -50%)`,
                    maxWidth: '220px',
                    padding: '2px 6px',
                    background: 'var(--color-surface-1)',
                    border: `1px solid ${selectedIds.has(arrow.id) ? 'var(--color-secondary)' : 'var(--color-surface-offset)'}`,
                    borderRadius: 'var(--radius-sm)',
                    color: 'var(--color-text-base)',
                    fontSize: '12px', lineHeight: 1.3,
                    pointerEvents: 'auto', cursor: 'text'
                  }}
                >
                  {editing ? (
                    <input
                      autoFocus
                      defaultValue={arrow.text ?? ''}
                      placeholder="Label"
                      onBlur={e => {
                        setEditingId(null)
                        const text = e.target.value.trim()
                        // An emptied label is removed rather than kept as a
                        // blank chip sitting on the line.
                        setItems(patchItems(docRef.current.items, new Set([arrow.id]), {
                          text: text || undefined
                        }))
                      }}
                      onKeyDown={e => {
                        if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLInputElement).blur()
                      }}
                      style={{
                        width: '120px', background: 'none', border: 'none', outline: 'none',
                        color: 'var(--color-text-base)', font: 'inherit', padding: 0
                      }}
                    />
                  ) : (
                    <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{arrow.text}</span>
                  )}
                </div>
              )
            })}
          </div>

          {/* Both ends of the selected connector, as something to grab. Drawn
              in the canvas layer so they sit exactly on the line, but sized
              against the zoom so they stay the same size to grab. */}
          {single?.kind === 'arrow' && (() => {
            const ends = arrowAnchors(single, itemsById)
            if (!ends) return null

            const heads = single.arrowHeads ?? ARROW_HEAD_MODES[0]
            const g = arrowGeometry(ends.from, ends.to, single.arrowShape ?? ARROW_SHAPES[0])
            const size = 12 / camera.zoom
            const ring = 2 / camera.zoom

            return (
              <div data-wall-camera-layer style={{
                position: 'absolute', left: 0, top: 0, width: '1px', height: '1px',
                transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`,
                transformOrigin: '0 0', zIndex: 6,
                willChange: 'transform'
              }}>
                {([['start', g.start], ['end', g.end]] as const).map(([which, at]) => (
                  <div
                    key={which}
                    data-arrow-handle={which}
                    title={which === 'end' ? 'Drag to point somewhere else' : 'Drag to start somewhere else'}
                    style={{
                      position: 'absolute', left: 0, top: 0,
                      width: `${size}px`, height: `${size}px`, boxSizing: 'border-box',
                      transform: `translate3d(${at.x - size / 2}px, ${at.y - size / 2}px, 0)`,
                      borderRadius: '50%',
                      background: 'var(--color-surface-elevated)',
                      border: `${ring}px solid var(--color-secondary)`,
                      // Square at the tail, round at the head, so which end is
                      // which is readable without hovering either of them.
                      ...(which === 'start' && heads !== 'both' ? { borderRadius: '20%' } : {}),
                      cursor: 'grab'
                    }}
                  />
                ))}
              </div>
            )
          })()}

          {/* Marquee, drawn in screen space so it does not scale with the camera. */}
          {marquee && (() => {
            // The box drawn by hand is ahead of the one in state, and a render
            // mid-sweep must not shrink it back to where the press was.
            const box = marqueeRectRef.current ?? marquee
            return (
              <div data-wall-marquee style={{
                position: 'absolute',
                left: `${box.x}px`, top: `${box.y}px`,
                width: `${box.width}px`, height: `${box.height}px`,
                border: '1px solid var(--color-secondary)',
                background: 'var(--color-secondary-muted)',
                pointerEvents: 'none'
              }} />
            )
          })()}

          {/* Controls for the current selection, floated above it. */}
          {floatingPos && selectedItems.length > 0 && (
            <WallSelectionBar
              floatingPos={floatingPos}
              floatingRef={floatingRef}
              swatchOpen={swatchOpen}
              setSwatchOpen={setSwatchOpen}
              single={single}
              arrowsSelected={arrowsSelected}
              items={doc.items}
              selectedIds={selectedIds}
              setItems={setItems}
              setEditingId={setEditingId}
              duplicateSelected={duplicateSelected}
              toggleLock={toggleLock}
              removeSelected={removeSelected}
            />
          )}

          {picker && (
            <div onPointerDown={() => setPicker(null)} style={{ position: 'absolute', inset: 0, zIndex: 10 }} />
          )}

          {/* A minimap only earns its space once there is something to lose track
              of, so it appears with the fourth item rather than sitting empty. */}
          {doc.items.length > 3 && (
            <WallMinimap
              items={doc.items}
              selectedIds={selectedIds}
              camera={camera}
              viewportRef={viewportRef}
              docRef={docRef}
              setCamera={setCamera}
            />
          )}

          {tool !== 'select' && (
            <WallPenSettings
              tool={tool}
              penColor={penColor}
              setPenColor={setPenColor}
              penWidth={penWidth}
              setPenWidth={setPenWidth}
              arrowShape={arrowShape}
              setArrowShape={setArrowShape}
              arrowLine={arrowLine}
              setArrowLine={setArrowLine}
              arrowHeads={arrowHeads}
              setArrowHeads={setArrowHeads}
              smoothing={smoothing}
              setSmoothing={setSmoothing}
            />
          )}

        {busy && (
            <div
              aria-live="polite"
              style={{
                position: 'absolute', bottom: 'var(--space-4)', left: '50%', transform: 'translateX(-50%)',
                padding: 'var(--space-2) var(--space-4)',
                background: 'var(--color-surface-elevated)',
                border: '1px solid var(--color-surface-offset)',
                borderRadius: 'var(--radius-full, 999px)',
                boxShadow: 'var(--shadow-lg)',
                fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)',
                zIndex: 30
              }}
            >
              {busy}…
            </div>
          )}
        </div>

        {railOpen && (
          <>
            <WallRailHandle railWidth={railWidth} setRailWidth={setRailWidth} />

            <WallBoardRail
              width={railWidth}
              tab={railTab}
              onTabChange={setRailTab}
              groups={filterGroups(groupCardsByColumn(cards, columns), railQuery)}
              notes={notes}
              placed={placed}
              query={railQuery}
              onQueryChange={setRailQuery}
              dropColumnId={dropColumnId}
              onClose={toggleRail}
            />
          </>
        )}
      </div>

      {menu && (
        <WallContextMenu x={menu.x} y={menu.y} entries={menuEntries()} onClose={() => setMenu(null)} />
      )}
    </div>
  )
}
