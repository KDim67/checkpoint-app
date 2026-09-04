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

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  StickyNote, Type, Square, Layers, Image as ImageIcon, Maximize2,
  Trash2, ArrowUp, ArrowDown, Plus, Copy, Lock, Unlock, Undo2, Redo2,
  Grid3x3, RotateCw, ExternalLink, FileText, Wand2, Expand, Palette, Search, Download,
  ChevronDown, Pencil, PanelRight, Paintbrush, Check, PenLine, Spline, MousePointer2
} from 'lucide-react'
import { useAppStore } from '../../store/appStore'
import { useToast } from '../ui/Toast'
import {
  bringToFront, boundsOf, createWallItem, duplicateItems, fitCamera, inPaintOrder,
  itemsInRect, moveItems, normalizeWallDoc, patchItems, rectFromPoints, sendToBack,
  boundsOf as wallBounds, cameraCentredOn, itemAtPoint, searchItems,
  snap, SNAP_GRID, toWallPoint, WALL_COLORS, zoomAt,
  createWall, removeWall, renameWall, setActiveWall, wallDocKey, withFrameContents,
  arrowEnds, distanceToSegment, inkFromPath, pruneArrows, STROKE_WIDTHS,
  type WallCamera, type WallDoc, type WallIndex, type WallItem, type WallItemKind, type WallRef
} from '../../../../shared/wallModel'
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
import WallItemView from './WallItemView'
import WallContextMenu, { type MenuEntry } from './WallContextMenu'
import ConfirmDialog from '../ui/ConfirmDialog'
import WallBoardRail, { type RailTab } from './WallBoardRail'
import {
  decodeWallDrag, filterGroups, groupCardsByColumn, planHandoff, WALL_DRAG_MIME
} from '../../../../shared/wallBoard'
import { loadBoardConfig } from '../../lib/boardConfig'
import { getBoolSetting, getNumberSetting, setBoolSetting, setNumberSetting } from '../../lib/settings'
import { getTextColorForBackground } from '../../lib/contrast'
import { DEFAULT_COLUMNS, type ColumnConfig } from '../../../../shared/boardModel'

const NUDGE = 4
/** Narrow enough not to crowd the wall, wide enough for a real card title. */
const RAIL_MIN = 190
const RAIL_MAX = 460
// Deliberately not under the `wall_` prefix: those keys name a workspace,
// and a workspace called "rail_open" would own this one. These are preferences.
const RAIL_OPEN_KEY = 'wallview_rail_open'
const RAIL_WIDTH_KEY = 'wallview_rail_width'

const clampRail = (width: number): number => Math.min(RAIL_MAX, Math.max(RAIL_MIN, Math.round(width)))
/** How far a press may travel and still count as a click rather than a drag. */
const CLICK_SLOP = 4

type Drag =
  | { mode: 'pan'; startX: number; startY: number; camX: number; camY: number }
  | { mode: 'move'; startX: number; startY: number; origin: WallItem[] }
  | { mode: 'resize'; id: string; startX: number; startY: number; w: number; h: number }
  | { mode: 'rotate'; id: string; cx: number; cy: number; start: number }
  | { mode: 'marquee'; startX: number; startY: number; base: Set<string> }
  | { mode: 'draw' }
  | null

interface Menu { x: number; y: number; itemId: string | null; at: { x: number; y: number } }

export default function WallView() {
  const activeContext = useAppStore(s => s.activeContext)
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
   * What a left-drag on empty canvas does. Select is the resting state: the pen
   * and the arrow are modes you enter deliberately and leave with Escape.
   */
  const [tool, setTool] = useState<'select' | 'pen' | 'arrow'>('select')
  const [penColor, setPenColor] = useState(WALL_COLORS[0])
  const [penWidth, setPenWidth] = useState(STROKE_WIDTHS[1])
  /** The stroke being drawn, in wall coordinates. Null when not drawing. */
  const [drawing, setDrawing] = useState<{ x: number; y: number }[] | null>(null)
  /** The first item picked for an arrow, waiting for its second. */
  const [arrowFrom, setArrowFrom] = useState<string | null>(null)
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

  const viewportRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<Drag>(null)
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
  const railResizeRef = useRef<{ startX: number; startWidth: number } | null>(null)
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

  const wallIndex = index?.context === activeContext ? index.value : null
  const activeWall = wallIndex?.walls.find(w => w.id === wallIndex.activeId) ?? null
  /** Null until the index has been read: there is no wall to open before then. */
  const docKey = activeWall ? wallDocKey(activeContext, activeWall.id) : null

  // Load
  /** What the walls can point at. Workspace-wide, so switching wall leaves it. */
  useEffect(() => {
    let cancelled = false

    const readCards = (): Promise<void> =>
      window.electronAPI.db
        .getItems(activeContext, 'card', 1, 500)
        .catch(() => ({ items: [] as Item[] }))
        .then(res => { if (!cancelled) setCards((res.items ?? []).filter(c => c.status !== 'archived')) })

    void readCards()
    Promise.all([
      // Notes are not per-workspace, so they are offered whole.
      window.electronAPI.notes.listNotes().catch(() => [] as NoteMetadata[]),
      // The board's own columns, not whatever statuses happen to be in use.
      loadBoardConfig(activeContext).catch(() => null)
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
  }, [activeContext])

  /**
   * Closes a toolbar popover when the click lands elsewhere.
   *
   * These used to sit under a full-screen backdrop, which swallowed the click
   * that dismissed them: reaching the other popover took two clicks, one to
   * close and one to open. Matching on the popover's own subtree lets the click
   * through to whatever it was aimed at, the way WallContextMenu already does.
   */
  useEffect(() => {
    if (!wallMenuOpen && !bgOpen) return

    const onDown = (e: PointerEvent): void => {
      const inside = (e.target as HTMLElement).closest('[data-wall-popover]')?.getAttribute('data-wall-popover')
      if (inside !== 'wall') { setWallMenuOpen(false); setRenaming(null) }
      if (inside !== 'bg') setBgOpen(false)
    }

    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [wallMenuOpen, bgOpen])

  /** The rail's own state is a preference, not part of any wall. */
  useEffect(() => {
    let cancelled = false
    Promise.all([
      getBoolSetting(RAIL_OPEN_KEY, false),
      getNumberSetting(RAIL_WIDTH_KEY, 260)
    ]).then(([open, width]) => {
      if (cancelled) return
      setRailOpen(open)
      setRailWidth(clampRail(width))
    })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    let cancelled = false
    setIndex(null)
    setWallMenuOpen(false)
    loadWallIndex(activeContext).then(loaded => {
      if (!cancelled) setIndex({ context: activeContext, value: loaded })
    })
    return () => { cancelled = true }
  }, [activeContext])

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
    // Runs on the way out of *this* wall, while docRef still holds it.
    return () => {
      if (discardedRef.current.delete(docKey)) return
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
    setIndex({ context: activeContext, value: next })
    void saveWallIndex(activeContext, next)
  }, [activeContext])

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
        await window.electronAPI.db.updateItem(move.id, { status: move.status, position: move.position })
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

    const key = wallDocKey(activeContext, pendingDelete.id)
    discardedRef.current.add(key)
    // Before the switch: the flush on the way out would land after the delete.
    await deleteWallDoc(key)
    commitIndex(next)
  }, [pendingDelete, wallIndex, activeContext, commitIndex])

  /** `record: false` for drag frames. The whole gesture is one undo step. */
  const setItems = useCallback((items: WallItem[], { record = true } = {}) => {
    historyRef.current = record
      ? pushHistory(historyRef.current, items)
      : replacePresent(historyRef.current, items)
    if (record) setHistoryTick(t => t + 1)
    write({ ...docRef.current, items })
  }, [write])

  const setCamera = useCallback((camera: WallCamera) => {
    write({ ...docRef.current, camera })
  }, [write])

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
        const filename = await window.electronAPI.media.saveFromBuffer(buffer, ext)
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

  const onWheel = useCallback((e: React.WheelEvent) => {
    const rect = viewportRef.current?.getBoundingClientRect()
    if (!rect) return
    setCamera(zoomAt(
      docRef.current.camera,
      { x: e.clientX - rect.left, y: e.clientY - rect.top },
      e.deltaY < 0 ? 1.1 : 1 / 1.1
    ))
  }, [setCamera])

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
      const saved = await window.electronAPI.app.saveBinaryFile(`${activeContext}-${activeWall?.name ?? 'wall'}.png`.replace(/[^\w.-]+/g, '-'), await png.arrayBuffer(), 'png')
      if (saved) toast('Wall exported.')
    } catch (err) {
      toast(`Export failed: ${errorMessage(err)}`, { type: 'error' })
    } finally {
      setBusy(null)
    }
  }, [activeContext, activeWall, toast])

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
      const from = itemsById.get(arrow.from ?? '')
      const to = itemsById.get(arrow.to ?? '')
      if (!from || !to) continue
      const { start, end } = arrowEnds(from, to)
      if (distanceToSegment(at, start, end) <= slack + (arrow.strokeWidth ?? 2)) return arrow
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

    // Right button: pan from anywhere. Whether this turns out to be a menu
    // instead is decided on release, by how far it travelled.
    if (e.button === 2) {
      const cam = docRef.current.camera
      rightPressRef.current = {
        clientX: e.clientX,
        clientY: e.clientY,
        itemId: itemEl?.dataset.wallItem ?? null,
        at: toWallPoint(screenPoint(e), cam),
        moved: false
      }
      dragRef.current = { mode: 'pan', startX: e.clientX, startY: e.clientY, camX: cam.x, camY: cam.y }
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
          start: Math.atan2(e.clientY - cy, e.clientX - cx) * (180 / Math.PI) - (single.rotation ?? 0)
        }
      } else {
        dragRef.current = { mode: 'resize', id: single.id, startX: e.clientX, startY: e.clientY, w: single.width, h: single.height }
      }
      return
    }

    const id = itemEl?.dataset.wallItem
    const item = id ? docRef.current.items.find(i => i.id === id) : undefined

    // Two clicks make an arrow: pick a source, then a target. Picking the same
    // item twice cancels rather than drawing a loop nobody asked for.
    if (tool === 'arrow' && e.button === 0) {
      if (!item || item.kind === 'arrow') { setArrowFrom(null); return }
      if (!arrowFrom) { setArrowFrom(item.id); return }
      if (arrowFrom !== item.id) {
        addItem('arrow', { from: arrowFrom, to: item.id, color: penColor, strokeWidth: penWidth })
      }
      setArrowFrom(null)
      return
    }

    if (id && item && e.button === 0) {
      if (item.locked) { setSelectedIds(new Set()); return }
      const already = selectedRef.current.has(id)
      const next = e.shiftKey
        ? new Set(already ? [...selectedRef.current].filter(x => x !== id) : [...selectedRef.current, id])
        : (already ? selectedRef.current : new Set([id]))
      setSelectedIds(next)
      if (!e.shiftKey) setItems(bringToFront(docRef.current.items, id), { record: false })
      movingRef.current = withFrameContents(docRef.current.items, next)
      dragRef.current = { mode: 'move', startX: e.clientX, startY: e.clientY, origin: docRef.current.items }
      return
    }

    // The pen takes the whole gesture: on empty canvas and over items alike,
    // because drawing over a card is the ordinary thing to want.
    if (tool === 'pen' && e.button === 0) {
      dragRef.current = { mode: 'draw' }
      setDrawing([toWallPoint(screenPoint(e), docRef.current.camera)])
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
    dragRef.current = { mode: 'marquee', startX: p.x, startY: p.y, base: e.shiftKey ? new Set(selectedRef.current) : new Set() }
    setMarquee({ x: p.x, y: p.y, width: 0, height: 0 })
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current
    if (!drag) return
    const cam = docRef.current.camera

    if (drag.mode === 'pan') {
      const press = rightPressRef.current
      if (press && !press.moved) {
        const travelled = Math.hypot(e.clientX - press.clientX, e.clientY - press.clientY)
        if (travelled > CLICK_SLOP) press.moved = true
      }
      setCamera({ ...cam, x: drag.camX + (e.clientX - drag.startX), y: drag.camY + (e.clientY - drag.startY) })
      return
    }

    if (drag.mode === 'draw') {
      const at = toWallPoint(screenPoint(e), cam)
      // Dropped when the pointer has barely moved: raw pointer events are far
      // denser than the drawing needs, and every point is persisted.
      setDrawing(path => {
        if (!path) return path
        const last = path[path.length - 1]
        return Math.hypot(at.x - last.x, at.y - last.y) < 2 / cam.zoom ? path : [...path, at]
      })
      return
    }

    if (drag.mode === 'marquee') {
      const p = screenPoint(e)
      setMarquee(rectFromPoints({ x: drag.startX, y: drag.startY }, p))
      const a = toWallPoint({ x: drag.startX, y: drag.startY }, cam)
      const b = toWallPoint(p, cam)
      const hit = itemsInRect(docRef.current.items, rectFromPoints(a, b))
      setSelectedIds(new Set([...drag.base, ...hit]))
      return
    }

    if (drag.mode === 'rotate') {
      const angle = Math.atan2(e.clientY - drag.cy, e.clientX - drag.cx) * (180 / Math.PI) - drag.start
      // Shift snaps to 15°, the way every rotation handle does.
      setItems(
        docRef.current.items.map(i =>
          i.id === drag.id ? { ...i, rotation: e.shiftKey ? Math.round(angle / 15) * 15 : Math.round(angle) } : i
        ),
        { record: false }
      )
      return
    }

    const dx = (e.clientX - drag.startX) / cam.zoom
    const dy = (e.clientY - drag.startY) / cam.zoom

    if (drag.mode === 'move') {
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
      setItems(
        snapping
          ? moved.map(i => (moving.has(i.id) ? { ...i, x: snap(i.x, SNAP_GRID), y: snap(i.y, SNAP_GRID) } : i))
          : moved,
        { record: false }
      )
    } else {
      setItems(
        docRef.current.items.map(i =>
          i.id === drag.id
            ? {
                ...i,
                width: Math.max(40, snapping ? snap(drag.w + dx, SNAP_GRID) : drag.w + dx),
                height: Math.max(32, snapping ? snap(drag.h + dy, SNAP_GRID) : drag.h + dy)
              }
            : i
        ),
        { record: false }
      )
    }
  }

  const endDrag = (e: React.PointerEvent) => {
    const drag = dragRef.current
    dragRef.current = null
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

    if (drag?.mode === 'draw') {
      const ink = drawing && inkFromPath(drawing, docRef.current.items, { color: penColor, strokeWidth: penWidth })
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
    if (drag && (drag.mode === 'move' || drag.mode === 'resize' || drag.mode === 'rotate')) {
      historyRef.current = pushHistory(historyRef.current, docRef.current.items)
      setHistoryTick(t => t + 1)
    }
  }

  // Keyboard
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
      // V, P and A, as every canvas tool binds them. Bare keys, so they stay
      // out of the way of the app's own Ctrl shortcuts.
      if (!mod && !e.altKey) {
        const key = e.key.toLowerCase()
        if (key === 'v') { setTool('select'); setArrowFrom(null); return }
        if (key === 'p') { setTool('pen'); setArrowFrom(null); return }
        if (key === 'a') { setTool('arrow'); setArrowFrom(null); return }
      }

      if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateSelected(); return }
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
        setPicker(null)
        setTool('select')
        setArrowFrom(null)
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
  }, [applyHistory, duplicateSelected, removeSelected, setItems])

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

  const { camera } = doc
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
  const floatingPos = ((): { left: number; top: number } | null => {
    if (!selectionBounds || editingId) return null

    const centreX = (selectionBounds.minX + (selectionBounds.maxX - selectionBounds.minX) / 2) * camera.zoom + camera.x
    const above = selectionBounds.minY * camera.zoom + camera.y - 44
    const below = selectionBounds.maxY * camera.zoom + camera.y + 12

    const rect = viewportRef.current?.getBoundingClientRect()
    const halfWidth = 110
    return {
      left: rect ? Math.min(Math.max(centreX, halfWidth), rect.width - halfWidth) : centreX,
      top: above < 4 ? below : above
    }
  })()

  /**
   * `.btn-icon:hover` already paints `--color-surface-offset`, so an active
   * state that only did the same was indistinguishable from hovering. Active is
   * now the accent colour plus an underline: legible without relying on colour,
   * which matters most for the pen and arrow, where being wrong about which
   * tool is armed changes what a click does.
   */
  const toolButton = (
    label: string,
    icon: React.ReactNode,
    onClick: () => void,
    opts: { active?: boolean; disabled?: boolean } = {}
  ): React.JSX.Element => (
    <button
      key={label}
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={opts.active}
      disabled={opts.disabled}
      className="btn-icon"
      style={{
        position: 'relative',
        width: '30px', height: '30px',
        background: opts.active ? 'var(--color-secondary-muted)' : undefined,
        color: opts.active ? 'var(--color-secondary)' : undefined,
        opacity: opts.disabled ? 0.4 : 1,
        cursor: opts.disabled ? 'not-allowed' : 'pointer'
      }}
    >
      {icon}
      {opts.active && (
        <span
          aria-hidden
          style={{
            position: 'absolute', left: '6px', right: '6px', bottom: '3px', height: '2px',
            borderRadius: '999px', background: 'var(--color-secondary)'
          }}
        />
      )}
    </button>
  )

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
        {toolButton(
          railOpen ? 'Hide the board' : 'Show the board beside the wall',
          <PanelRight size={14} />,
          toggleRail,
          { active: railOpen }
        )}

        <div data-wall-popover="bg" style={{ position: 'relative' }}>
          {toolButton('Wall background', <Paintbrush size={14} />, () => setBgOpen(v => !v), { active: bgOpen })}

          {bgOpen && (
            <>
              <div
                style={{
                  position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 41,
                  padding: 'var(--space-2)', width: '188px',
                  background: 'var(--color-surface-elevated)',
                  border: '1px solid var(--color-surface-offset)',
                  borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg)'
                }}
              >
                <button
                  onClick={() => { setBackground('default'); setBgOpen(false) }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 'var(--space-2)', width: '100%',
                    background: 'none', border: 'none', cursor: 'pointer', marginBottom: 'var(--space-2)',
                    padding: 'var(--space-2)', borderRadius: 'var(--radius-sm)',
                    color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)'
                  }}
                >
                  {!custom && <Check size={12} />}
                  Follow the theme
                </button>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px' }}>
                  {WALL_COLORS.map(color => (
                    <button
                      key={color}
                      onClick={() => { setBackground(color); setBgOpen(false) }}
                      title={color}
                      aria-label={`Background ${color}`}
                      style={{
                        height: '26px', background: color, cursor: 'pointer',
                        border: custom === color ? '2px solid var(--color-secondary)' : '1px solid var(--color-surface-offset)',
                        borderRadius: 'var(--radius-sm)'
                      }}
                    />
                  ))}
                </div>

                {/* Any colour. This view imposes nothing. */}
                <label style={{
                  display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
                  marginTop: 'var(--space-2)', fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)'
                }}>
                  <input
                    type="color"
                    value={custom ?? '#111318'}
                    onChange={e => setBackground(e.target.value)}
                    style={{ width: '26px', height: '26px', padding: 0, border: 'none', background: 'none', cursor: 'pointer' }}
                  />
                  Custom
                </label>
              </div>
            </>
          )}
        </div>

        <div style={{ width: '1px', height: '18px', background: 'var(--color-surface-offset)' }} />

        {/* Which wall */}
        <div data-wall-popover="wall" style={{ position: 'relative' }}>
          <button
            onClick={() => { setWallMenuOpen(v => !v); setRenaming(null) }}
            title="Switch wall"
            aria-haspopup="menu"
            aria-expanded={wallMenuOpen}
            disabled={!wallIndex}
            style={{
              display: 'flex', alignItems: 'center', gap: 'var(--space-1)',
              maxWidth: '170px', height: '30px', padding: '0 var(--space-2)',
              background: wallMenuOpen ? 'var(--color-surface-offset)' : 'transparent',
              border: '1px solid var(--color-surface-offset)',
              borderRadius: 'var(--radius-md)',
              color: 'var(--color-text-base)', fontSize: 'var(--text-xs)',
              fontWeight: 500, cursor: wallIndex ? 'pointer' : 'default'
            }}
          >
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {activeWall?.name ?? '…'}
            </span>
            {/* Just a hint that there is a choice. */}
            <ChevronDown size={12} style={{ flexShrink: 0, color: 'var(--color-text-faint)' }} />
          </button>

          {wallMenuOpen && wallIndex && (
            <>
              <div
                role="menu"
                style={{
                  position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 41,
                  width: '240px', padding: '4px',
                  background: 'var(--color-surface-elevated)',
                  border: '1px solid var(--color-surface-offset)',
                  borderRadius: 'var(--radius-md)',
                  boxShadow: 'var(--shadow-lg)'
                }}
              >
                {wallIndex.walls.map(w => {
                  const isActive = w.id === wallIndex.activeId
                  const isRenaming = renaming?.id === w.id

                  if (isRenaming) {
                    return (
                      <input
                        key={w.id}
                        autoFocus
                        value={renaming.draft}
                        onChange={e => setRenaming({ id: w.id, draft: e.target.value })}
                        // Commits rather than discards. Clicking away after
                        // typing a name is not a request to throw it away, and
                        // it happened silently.
                        onBlur={() => {
                          commitIndex(renameWall(wallIndex, w.id, renaming.draft))
                          setRenaming(null)
                        }}
                        onKeyDown={e => {
                          if (e.key === 'Enter') {
                            commitIndex(renameWall(wallIndex, w.id, renaming.draft))
                            setRenaming(null)
                          }
                          if (e.key === 'Escape') setRenaming(null)
                        }}
                        aria-label="Wall name"
                        style={{
                          display: 'block', width: '100%', boxSizing: 'border-box',
                          padding: 'var(--space-2)',
                          background: 'var(--color-surface-2)',
                          border: '1px solid var(--color-secondary)',
                          borderRadius: 'var(--radius-sm)',
                          color: 'var(--color-text-base)', fontSize: 'var(--text-xs)',
                          outline: 'none'
                        }}
                      />
                    )
                  }

                  return (
                    <div
                      key={w.id}
                      className="wall-switcher-row"
                      style={{
                        display: 'flex', alignItems: 'center', gap: 'var(--space-1)',
                        borderRadius: 'var(--radius-sm)',
                        background: isActive ? 'var(--color-surface-offset)' : 'transparent'
                      }}
                    >
                      <button
                        onClick={() => { commitIndex(setActiveWall(wallIndex, w.id)); setWallMenuOpen(false) }}
                        style={{
                          flex: 1, minWidth: 0, textAlign: 'left', background: 'none', border: 'none',
                          cursor: 'pointer', padding: 'var(--space-2)',
                          color: isActive ? 'var(--color-text-base)' : 'var(--color-text-muted)',
                          fontSize: 'var(--text-xs)', fontWeight: isActive ? 600 : 400,
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
                        }}
                      >
                        {w.name}
                      </button>

                      <button
                        onClick={() => setRenaming({ id: w.id, draft: w.name })}
                        title="Rename"
                        aria-label={`Rename ${w.name}`}
                        className="btn-icon"
                        style={{ width: '24px', height: '24px', flexShrink: 0 }}
                      >
                        <Pencil size={12} />
                      </button>

                      {/* Hidden, not disabled. An always-greyed button reads as broken. */}
                      {wallIndex.walls.length > 1 && (
                        <button
                          onClick={() => { setPendingDelete(w); setWallMenuOpen(false) }}
                          title="Delete wall"
                          aria-label={`Delete ${w.name}`}
                          className="btn-icon"
                          style={{ width: '24px', height: '24px', flexShrink: 0, marginRight: '2px' }}
                        >
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                  )
                })}

                <div style={{ height: '1px', background: 'var(--color-surface-offset)', margin: '4px 0' }} />

                <button
                  onClick={addWall}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 'var(--space-2)', width: '100%',
                    background: 'none', border: 'none', cursor: 'pointer',
                    padding: 'var(--space-2)', borderRadius: 'var(--radius-sm)',
                    color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)'
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-surface-offset)' }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'none' }}
                >
                  <Plus size={12} /> New wall
                </button>
              </div>
            </>
          )}
        </div>

        <div style={{ width: '1px', height: '18px', background: 'var(--color-surface-offset)' }} />

        {toolButton('Select', <MousePointer2 size={14} />, () => setTool('select'), { active: tool === 'select' })}
        {toolButton('Draw', <PenLine size={14} />, () => setTool(t => (t === 'pen' ? 'select' : 'pen')), { active: tool === 'pen' })}
        {toolButton('Connect two items', <Spline size={14} />, () => { setArrowFrom(null); setTool(t => (t === 'arrow' ? 'select' : 'arrow')) }, { active: tool === 'arrow' })}

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
                ? (arrowFrom ? 'Now click the item to point at' : 'Click an item to start from')
                : 'Drag to select · Right-drag to pan'}
          </span>

          <div style={{ position: 'relative' }}>
            <Search
              size={12}
              style={{ position: 'absolute', left: '8px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-faint)', pointerEvents: 'none' }}
            />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Escape') { setQuery(''); (e.target as HTMLInputElement).blur() }
                // Enter jumps to the best match, so finding something never
                // needs the mouse.
                if (e.key === 'Enter' && matches.length > 0) { jumpTo(matches[0]); setQuery('') }
              }}
              placeholder="Find on this wall"
              aria-label="Find on this wall"
              style={{
                width: '170px',
                background: 'var(--color-surface-2)',
                border: '1px solid var(--color-surface-offset)',
                borderRadius: 'var(--radius-md)',
                color: 'var(--color-text-base)',
                padding: '4px 8px 4px 24px',
                fontSize: 'var(--text-xs)',
                outline: 'none'
              }}
            />

            {query.trim() !== '' && matches.length === 0 && (
              <div style={{
                position: 'absolute', top: '100%', right: 0, marginTop: '4px', zIndex: 25,
                width: '260px', padding: 'var(--space-3)',
                background: 'var(--color-surface-elevated)',
                border: '1px solid var(--color-surface-offset)',
                borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg)',
                fontSize: 'var(--text-xs)', color: 'var(--color-text-faint)'
              }}>
                Nothing on this wall matches.
              </div>
            )}

            {matches.length > 0 && (
              <div style={{
                position: 'absolute', top: '100%', right: 0, marginTop: '4px', zIndex: 25,
                width: '260px', maxHeight: '260px', overflowY: 'auto',
                background: 'var(--color-surface-elevated)',
                border: '1px solid var(--color-surface-offset)',
                borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg)', padding: '4px'
              }}>
                {matches.slice(0, 12).map(m => (
                  <button
                    key={m.id}
                    onClick={() => { jumpTo(m); setQuery('') }}
                    style={{
                      display: 'block', width: '100%', textAlign: 'left', background: 'none',
                      border: 'none', cursor: 'pointer', padding: 'var(--space-2)',
                      borderRadius: 'var(--radius-sm)', color: 'var(--color-text-base)',
                      fontSize: 'var(--text-xs)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-surface-offset)' }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'none' }}
                  >
                    {labelOf(m) || '(untitled)'}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {picker && (
          <div data-wall-ui style={{
            position: 'absolute', top: '100%', left: 'var(--space-3)', zIndex: 20,
            marginTop: '4px', width: '300px', maxHeight: '340px', overflowY: 'auto',
            background: 'var(--color-surface-elevated)', border: '1px solid var(--color-surface-offset)',
            borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg)', padding: '4px'
          }}>
            {pickerRows.length === 0 ? (
              <div style={{ padding: 'var(--space-3)', fontSize: 'var(--text-xs)', color: 'var(--color-text-faint)' }}>
                {picker === 'card'
                  ? 'Every card is already on the wall.'
                  : notes.length === 0 ? 'No notes yet.' : 'Every note is already on the wall.'}
              </div>
            ) : pickerRows.map(row => (
              <button
                key={row.ref}
                onClick={() => { addItem(picker === 'card' ? 'card' : 'doc', { ref: row.ref }); setPicker(null) }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 'var(--space-2)', width: '100%',
                  textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer',
                  padding: 'var(--space-2)', borderRadius: 'var(--radius-sm)',
                  color: 'var(--color-text-base)', fontSize: 'var(--text-xs)'
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-surface-offset)' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'none' }}
              >
                <Plus size={12} style={{ flexShrink: 0, color: 'var(--color-text-faint)' }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.label}</span>
              </button>
            ))}
          </div>
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
            const at = toWallPoint(screenPoint(e), docRef.current.camera)
            const hit = itemAtPoint(docRef.current.items, at)
            if (!hit) { addItem('note', {}, at); return }
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
            cursor: tool === 'pen' ? 'crosshair' : tool === 'arrow' ? 'copy' : undefined,
            background: canvasBackground,
            backgroundImage: `radial-gradient(circle, ${dotColor} 1px, transparent 1px)`,
            backgroundSize: `${24 * camera.zoom}px ${24 * camera.zoom}px`,
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

          <div style={{
            position: 'absolute', top: 0, left: 0,
            transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`,
            transformOrigin: '0 0'
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
                const from = itemsById.get(arrow.from ?? '')
                const to = itemsById.get(arrow.to ?? '')
                if (!from || !to) return null

                const { start, end } = arrowEnds(from, to)
                const angle = Math.atan2(end.y - start.y, end.x - start.x)
                const head = 10 + (arrow.strokeWidth ?? 2) * 2
                const spread = 0.4
                const stroke = arrow.color || 'var(--color-text-muted)'
                const selected = selectedIds.has(arrow.id)

                return (
                  <g key={arrow.id} opacity={selected ? 1 : 0.85}>
                    <line
                      x1={start.x} y1={start.y} x2={end.x} y2={end.y}
                      stroke={stroke}
                      strokeWidth={(arrow.strokeWidth ?? 2) + (selected ? 2 : 0)}
                      strokeLinecap="round"
                    />
                    <polygon
                      points={[
                        `${end.x},${end.y}`,
                        `${end.x - head * Math.cos(angle - spread)},${end.y - head * Math.sin(angle - spread)}`,
                        `${end.x - head * Math.cos(angle + spread)},${end.y - head * Math.sin(angle + spread)}`
                      ].join(' ')}
                      fill={stroke}
                    />
                  </g>
                )
              })}
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
                <div
                  key={item.id}
                  data-wall-item={item.id}
                  style={{
                    position: 'absolute',
                    left: 0, top: 0,
                    width: `${item.width}px`, height: `${item.height}px`,
                    // translate, not left/top. Moving an item this way costs no
                    // layout, and a layout here repaints the whole canvas layer,
                    // which means resampling every image on the wall per frame.
                    transform: `translate3d(${item.x}px, ${item.y}px, 0)${item.rotation ? ` rotate(${item.rotation}deg)` : ''}`,
                    // Images get their own compositor layer so a repaint of the
                    // canvas does not re-rasterise them. They are the expensive
                    // ones: a photo can be tens of megapixels behind a 280px box.
                    willChange: item.kind === 'image' ? 'transform' : undefined,
                    cursor: item.locked ? 'default' : 'grab',
                    outline: arrowFrom === item.id
                      ? '2px dashed var(--color-secondary)'
                      : isSelected ? '2px solid var(--color-secondary)' : 'none',
                    outlineOffset: '2px'
                  }}
                >
                  <WallItemView
                    item={item}
                    card={item.kind === 'card' ? cardsById.get(item.ref ?? '') : undefined}
                    note={item.kind === 'doc' ? notesByTitle.get(item.ref ?? '') : undefined}
                    selected={isSelected}
                    editing={editingId === item.id}
                    onTextChange={text => setItems(patchItems(docRef.current.items, new Set([item.id]), { text }), { record: false })}
                    onFinishEditing={() => { setEditingId(null); setItems(docRef.current.items) }}
                  />

                  {item.locked && isSelected && (
                    <div style={{ position: 'absolute', top: '-8px', right: '-8px', color: 'var(--color-text-faint)' }}>
                      <Lock size={12} />
                    </div>
                  )}

                  {/* A locked item ignores every press. Without a marker that
                      reads as the app being broken rather than as a choice. */}
                  {item.locked && (
                    <span
                      title="Locked. Right-click to unlock."
                      style={{
                        position: 'absolute', right: '-6px', top: '-6px',
                        width: '18px', height: '18px', borderRadius: '50%',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: 'var(--color-surface-elevated)',
                        border: '1px solid var(--color-surface-offset)',
                        color: 'var(--color-text-faint)', pointerEvents: 'none'
                      }}
                    >
                      <Lock size={10} />
                    </span>
                  )}

                  {/* Handles only for a single unlocked selection: dragging one
                      corner of five items has no obvious meaning. */}
                  {isSelected && single?.id === item.id && !item.locked && (
                    <>
                      {/* A 22px grab area around a 12px dot. The handle used
                          to be exactly as big as it looked, which made resizing
                          a matter of hitting a 12px corner. */}
                      <div
                        data-wall-handle="se"
                        style={{
                          position: 'absolute', right: '-11px', bottom: '-11px', width: '22px', height: '22px',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          cursor: 'nwse-resize'
                        }}
                      >
                        <span style={{
                          width: '12px', height: '12px',
                          background: 'var(--color-secondary)', border: '2px solid var(--color-surface-1)',
                          borderRadius: '2px'
                        }} />
                      </div>
                      <div
                        data-wall-handle="rotate"
                        title="Drag to rotate, hold Shift for 15° steps"
                        style={{
                          position: 'absolute', left: '50%', top: '-30px', transform: 'translateX(-50%)',
                          width: '24px', height: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                          cursor: 'grab'
                        }}
                      >
                        <span style={{
                          width: '16px', height: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                          background: 'var(--color-surface-1)', border: '1px solid var(--color-secondary)',
                          borderRadius: '50%', color: 'var(--color-secondary)'
                        }}>
                          <RotateCw size={9} />
                        </span>
                      </div>
                    </>
                  )}
                </div>
              )
            })}
          </div>

          {/* Marquee, drawn in screen space so it does not scale with the camera. */}
          {marquee && (
            <div style={{
              position: 'absolute',
              left: `${marquee.x}px`, top: `${marquee.y}px`,
              width: `${marquee.width}px`, height: `${marquee.height}px`,
              border: '1px solid var(--color-secondary)',
              background: 'var(--color-secondary-muted)',
              pointerEvents: 'none'
            }} />
          )}

          {/* Controls for the current selection, floated above it. */}
          {floatingPos && selectedItems.length > 0 && (
            <div data-wall-ui style={{
              position: 'absolute',
              left: `${floatingPos.left}px`, top: `${floatingPos.top}px`,
              transform: 'translateX(-50%)',
              display: 'flex', alignItems: 'center', gap: '2px',
              padding: '3px',
              background: 'var(--color-surface-elevated)',
              border: '1px solid var(--color-surface-offset)',
              borderRadius: 'var(--radius-md)',
              boxShadow: 'var(--shadow-lg)',
              zIndex: 15
            }}>
              {WALL_COLORS.slice(0, 6).map(c => (
                <button
                  key={c}
                  onClick={() => setItems(patchItems(doc.items, selectedIds, { color: c }))}
                  aria-label={`Colour ${c}`}
                  style={{
                    width: '16px', height: '16px', borderRadius: '3px', background: c,
                    border: single?.color === c ? '2px solid var(--color-text-base)' : '1px solid rgba(0,0,0,0.25)',
                    cursor: 'pointer', padding: 0
                  }}
                />
              ))}
              <div style={{ width: '1px', height: '16px', background: 'var(--color-surface-offset)', margin: '0 2px' }} />
              {toolButton('Bring to front', <ArrowUp size={13} />, () => single && setItems(bringToFront(doc.items, single.id)), { disabled: !single })}
              {toolButton('Send to back', <ArrowDown size={13} />, () => single && setItems(sendToBack(doc.items, single.id)), { disabled: !single })}
              {toolButton('Duplicate', <Copy size={13} />, duplicateSelected)}
              {toolButton(single?.locked ? 'Unlock' : 'Lock', single?.locked ? <Unlock size={13} /> : <Lock size={13} />, toggleLock)}
              {toolButton('Delete', <Trash2 size={13} />, removeSelected)}
            </div>
          )}

          {picker && (
            <div onPointerDown={() => setPicker(null)} style={{ position: 'absolute', inset: 0, zIndex: 10 }} />
          )}

          {/* A minimap only earns its space once there is something to lose track
              of, so it appears with the fourth item rather than sitting empty. */}
          {doc.items.length > 3 && (() => {
            const b = wallBounds(doc.items)
            const rect = viewportRef.current?.getBoundingClientRect()
            if (!b || !rect) return null

            const W = 150
            const H = 110
            const pad = 8
            const contentW = Math.max(1, b.maxX - b.minX)
            const contentH = Math.max(1, b.maxY - b.minY)
            const k = Math.min((W - pad * 2) / contentW, (H - pad * 2) / contentH)
            const ox = pad - b.minX * k
            const oy = pad - b.minY * k

            // The camera's own window onto the wall, drawn in the same space.
            const viewX = (-camera.x / camera.zoom) * k + ox
            const viewY = (-camera.y / camera.zoom) * k + oy
            const viewW = (rect.width / camera.zoom) * k
            const viewH = (rect.height / camera.zoom) * k

            return (
              <div
                onPointerDown={e => {
                  e.stopPropagation()
                  // Click the map, go there: the wall point under the click
                  // becomes the centre of the view.
                  const box = (e.currentTarget as HTMLElement).getBoundingClientRect()
                  const wx = (e.clientX - box.left - ox) / k
                  const wy = (e.clientY - box.top - oy) / k
                  setCamera({
                    ...docRef.current.camera,
                    x: rect.width / 2 - wx * docRef.current.camera.zoom,
                    y: rect.height / 2 - wy * docRef.current.camera.zoom
                  })
                }}
                data-wall-ui
                title="Click to jump"
                style={{
                  position: 'absolute', right: 'var(--space-3)', bottom: 'var(--space-3)',
                  width: `${W}px`, height: `${H}px`, zIndex: 20, cursor: 'pointer',
                  background: 'var(--color-surface-1)',
                  border: '1px solid var(--color-surface-offset)',
                  borderRadius: 'var(--radius-md)',
                  boxShadow: 'var(--shadow-md)',
                  overflow: 'hidden'
                }}
              >
                {doc.items.filter(i => i.kind !== 'arrow').map(i => (
                  <div
                    key={i.id}
                    style={{
                      position: 'absolute',
                      left: `${i.x * k + ox}px`, top: `${i.y * k + oy}px`,
                      width: `${Math.max(2, i.width * k)}px`, height: `${Math.max(2, i.height * k)}px`,
                      background: i.color || 'var(--color-surface-offset)',
                      borderRadius: '1px',
                      opacity: selectedIds.has(i.id) ? 1 : 0.7
                    }}
                  />
                ))}
                <div style={{
                  position: 'absolute',
                  left: `${viewX}px`, top: `${viewY}px`,
                  width: `${viewW}px`, height: `${viewH}px`,
                  border: '1px solid var(--color-secondary)',
                  background: 'var(--color-secondary-muted)',
                  pointerEvents: 'none'
                }} />
              </div>
            )
          })()}

          {tool !== 'select' && (
          <div
            data-wall-ui
            role="group"
            aria-label="Ink colour and width"
            style={{
              position: 'absolute', left: 'var(--space-3)', top: '50%', transform: 'translateY(-50%)',
              zIndex: 20, display: 'flex', flexDirection: 'column', gap: '6px',
              padding: 'var(--space-2)',
              background: 'var(--color-surface-elevated)',
              border: '1px solid var(--color-surface-offset)',
              borderRadius: 'var(--radius-md)',
              boxShadow: 'var(--shadow-lg)'
            }}
          >
            {WALL_COLORS.map(color => (
              <button
                key={color}
                onClick={() => setPenColor(color)}
                title={color}
                aria-label={`Ink ${color}`}
                aria-pressed={penColor === color}
                style={{
                  // 24px of target around a 16px dot: the swatches were
                  // pixel-hunting at their old size.
                  width: '24px', height: '24px', padding: 0, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: 'none', border: 'none', borderRadius: 'var(--radius-sm)'
                }}
              >
                <span style={{
                  width: '16px', height: '16px', borderRadius: '50%', background: color,
                  boxShadow: penColor === color
                    ? '0 0 0 2px var(--color-surface-elevated), 0 0 0 4px var(--color-secondary)'
                    : 'inset 0 0 0 1px rgba(0,0,0,0.25)'
                }} />
              </button>
            ))}

            <div style={{ height: '1px', background: 'var(--color-surface-offset)', margin: '2px 0' }} />

            {STROKE_WIDTHS.map(width => (
              <button
                key={width}
                onClick={() => setPenWidth(width)}
                title={`${width}px`}
                aria-label={`Stroke width ${width}`}
                aria-pressed={penWidth === width}
                style={{
                  width: '24px', height: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: penWidth === width ? 'var(--color-secondary-muted)' : 'none',
                  border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer'
                }}
              >
                <span style={{
                  width: `${width + 6}px`, height: `${width}px`, borderRadius: '999px',
                  background: penWidth === width ? 'var(--color-secondary)' : 'var(--color-text-muted)'
                }} />
              </button>
            ))}
          </div>
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
            <div
              onPointerDown={e => {
                ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
                railResizeRef.current = { startX: e.clientX, startWidth: railWidth }
              }}
              onPointerMove={e => {
                const resize = railResizeRef.current
                // Inverted: the handle is on the rail's left edge now, so
                // dragging left has to widen it rather than shrink it.
                if (resize) setRailWidth(clampRail(resize.startWidth - (e.clientX - resize.startX)))
              }}
              onPointerUp={e => {
                if (!railResizeRef.current) return
                railResizeRef.current = null
                try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId) } catch { /* already released */ }
                void setNumberSetting(RAIL_WIDTH_KEY, railWidth)
              }}
              role="separator"
              aria-label="Resize the board panel"
              style={{
                width: '5px', flexShrink: 0, cursor: 'col-resize',
                background: 'var(--color-surface-offset)'
              }}
            />

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
