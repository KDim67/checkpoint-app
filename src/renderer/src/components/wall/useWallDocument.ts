import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '../../store/appStore'
import { useToast } from '../ui/Toast'
import { createWallItem, duplicateItems, normalizeWallDoc, patchItems, toWallPoint, WALL_COLORS, createWall, removeWall, setActiveWall, cameraCentredOn, wallDocKey, pruneArrows, STROKE_WIDTHS, SMOOTHING_STRENGTH, ARROW_SHAPES, ARROW_LINES, ARROW_HEAD_MODES, type ArrowShape, type ArrowLine, type ArrowHeads, type WallCamera, type WallDoc, type WallIndex, type WallItem, type WallItemKind, type WallRef } from '../../../../shared/wallModel'
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
import * as appApi from '../../data/app'
import { itemLink, parseWallLink } from '../../../../shared/wallLink'

export interface Menu { x: number; y: number; itemId: string | null; at: { x: number; y: number } }

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
  /** one at a time, same corner */
  const [picker, setPicker] = useState<'card' | 'doc' | null>(null)
  const [menu, setMenu] = useState<Menu | null>(null)
  const [snapping, setSnapping] = useState(false)
  /** the arrow is one-shot, the pen stays armed; Escape leaves either */
  const [tool, setTool] = useState<'select' | 'pen' | 'arrow'>('select')
  const [penColor, setPenColor] = useState(WALL_COLORS[0])
  const [penWidth, setPenWidth] = useState(STROKE_WIDTHS[1])
  /** hand-drawn lines are shaky */
  const [smoothing, setSmoothing] = useState(true)
  /** wall coordinates, null when idle */
  const [drawing, setDrawing] = useState<{ x: number; y: number }[] | null>(null)
  /** first pick, waiting for the second */
  const [arrowFrom, setArrowFrom] = useState<string | null>(null)
  /** overId lets the preview snap and the item light up */
  const [arrowDrag, setArrowDrag] = useState<{ fromId: string; at: { x: number; y: number }; overId: string | null } | null>(null)
  /** so it can light up */
  const [arrowEndHover, setArrowEndHover] = useState<string | null>(null)
  const [arrowShape, setArrowShape] = useState<ArrowShape>(ARROW_SHAPES[0])
  const [arrowLine, setArrowLine] = useState<ArrowLine>(ARROW_LINES[0])
  const [arrowHeads, setArrowHeads] = useState<ArrowHeads>(ARROW_HEAD_MODES[0])
  const [marquee, setMarquee] = useState<{ x: number; y: number; width: number; height: number } | null>(null)
  /** so a slow job doesn't look frozen */
  const [busy, setBusy] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  /** re-renders the buttons for the ref-held history */
  const [historyTick, setHistoryTick] = useState(0)

  /** tagged by workspace, or a switch briefly opens the old wall */
  const [index, setIndex] = useState<{ context: string; value: WallIndex } | null>(null)
  const [wallMenuOpen, setWallMenuOpen] = useState(false)
  const [renaming, setRenaming] = useState<{ id: string; draft: string } | null>(null)
  const [pendingDelete, setPendingDelete] = useState<WallRef | null>(null)

  /** board beside the wall for dragging cards on */
  const [railOpen, setRailOpen] = useState(false)
  const [railWidth, setRailWidth] = useState(260)
  const [railTab, setRailTab] = useState<RailTab>('board')
  const [railQuery, setRailQuery] = useState('')
  const [columns, setColumns] = useState<ColumnConfig[]>([])
  /** mirrored in a ref, read every pointer move */
  const [dropColumnId, setDropColumnId] = useState<string | null>(null)
  const [bgOpen, setBgOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  /** space pans without putting the tool down */
  const [spaceHeld, setSpaceHeld] = useState(false)
  const [swatchOpen, setSwatchOpen] = useState(false)
  /** the selection bar's link field */
  const [linkOpen, setLinkOpen] = useState(false)
  /** the item waiting for a click on what it should link to */
  const [linkPickFor, setLinkPickFor] = useState<string | null>(null)
  /** an item on another wall, centred once that wall has loaded */
  const pendingJumpRef = useRef<string | null>(null)
  /** bookmarks whose page main is still reading; a view state, never saved */
  const [previewing, setPreviewing] = useState<Set<string>>(new Set())
  const { bindings: keys, match: matchKey } = useViewShortcuts('wall')
  const [panButtons, setPanButtons] = useState<PanButtons>(PAN_BUTTON_MODES[0])
  const [menuButton, setMenuButton] = useState<MenuButton>(MENU_BUTTON_MODES[0])

  const viewportRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<WallDrag>(null)
  /** newest pointer position; a 1000Hz mouse fires ~16 moves a frame */
  const pendingMoveRef = useRef<{ clientX: number; clientY: number; shiftKey: boolean } | null>(null)
  const moveFrameRef = useRef<number | null>(null)
  /** pan camera ahead of state; through state every item re-rendered for a moved view */
  const panCameraRef = useRef<WallCamera | null>(null)
  const zoomCommitRef = useRef<number | null>(null)
  /** ahead of state during a move */
  const liveItemsRef = useRef<WallItem[] | null>(null)
  /** ahead of state */
  const marqueeRectRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null)
  /** caught so far, ahead of state */
  const marqueeSelRef = useRef<Set<string> | null>(null)
  /** so a frame only writes the difference */
  const paintedSelRef = useRef<Set<string> | null>(null)
  useEffect(() => () => {
    if (zoomCommitRef.current !== null) window.clearTimeout(zoomCommitRef.current)
  }, [])
  /** decided at drag start: frames bring contents, items mustn't join mid-sweep */
  const movingRef = useRef<Set<string>>(new Set())
  /** barely moved becomes a menu on release */
  const rightPressRef = useRef<{ clientX: number; clientY: number; itemId: string | null; at: { x: number; y: number }; moved: boolean } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  /** or the exit flush restores them */
  const discardedRef = useRef<Set<string>>(new Set())
  const railHoverRef = useRef<{ overRail: boolean; columnId: string | null }>({ overRail: false, columnId: null })
  /** a ref, the export callback predates the lookup maps */
  const labelRef = useRef<(item: WallItem) => string | undefined>(() => undefined)
  const docRef = useRef(doc)
  docRef.current = doc
  const selectedRef = useRef(selectedIds)
  selectedRef.current = selectedIds

  /** items only, the camera is a view */
  const historyRef = useRef<History<WallItem[]>>(initHistory([]))

  const cardsById = useMemo(() => new Map(cards.map(c => [c.id, c])), [cards])
  const itemsById = useMemo(() => new Map(doc.items.map(i => [i.id, i])), [doc.items])
  const notesByTitle = useMemo(() => new Map(notes.map(n => [n.title, n])), [notes])
  const selectedItems = doc.items.filter(i => selectedIds.has(i.id))
  const single = selectedItems.length === 1 ? selectedItems[0] : null
  /** restyling needs every selected item to be a connector */
  const arrowsSelected = selectedItems.length > 0 && selectedItems.every(i => i.kind === 'arrow')

  const wallIndex = index?.context === activeWorkspace ? index.value : null
  const activeWall = wallIndex?.walls.find(w => w.id === wallIndex.activeId) ?? null
  /** null until the index is read */
  const docKey = activeWall ? wallDocKey(activeWorkspace, activeWall.id) : null

  /** workspace-wide, survives wall switches */
  useEffect(() => {
    let cancelled = false

    const readCards = (): Promise<void> =>
      itemPage(activeWorkspace, 'card', 1, 500)
        .catch(() => ({ items: [] as Item[] }))
        .then(res => { if (!cancelled) setCards((res.items ?? []).filter(c => c.status !== 'archived')) })

    void readCards()
    Promise.all([
      // notes aren't per-workspace
      notesApi.listNotes().catch(() => [] as NoteMetadata[]),
      // the board's columns, not statuses in use
      loadBoardConfig(activeWorkspace).catch(() => null)
    ]).then(([noteList, config]) => {
      if (cancelled) return
      setNotes(noteList ?? [])
      // defaults, with no columns every card is an orphan
      setColumns(config?.columns ?? DEFAULT_COLUMNS)
    })

    // rail, board and peer moves all arrive here
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

  /** matching the popover's subtree lets the dismissing click through; a backdrop ate it */
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

  /** a preference, not part of any wall */
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
      // stored as a strength from the dial build, above zero is on
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
        const jump = pendingJumpRef.current
        pendingJumpRef.current = null
        const target = jump ? loaded.items.find(i => i.id === jump) : undefined
        const rect = viewportRef.current?.getBoundingClientRect()
        if (target && rect) {
          // same zoom as you left it, a link shouldn't change how close you are
          setDoc({ ...loaded, camera: cameraCentredOn(target, { width: rect.width, height: rect.height }, loaded.camera.zoom) })
          setSelectedIds(new Set([target.id]))
        } else {
          setDoc(loaded)
          if (jump) toast('The linked item was deleted. Edit the link to point somewhere else.')
        }
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
    // on the way out of this wall, while docRef still holds it
    return () => {
      if (discarded.delete(docKey)) return
      void flushWallDoc(docKey, docRef.current)
    }
  }, [docKey])

  /** MCP writes from main, so re-read; skipped mid-gesture */
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

  const write = useCallback((next: WallDoc) => {
    setDoc(next)
    if (docKey) saveWallDoc(docKey, next)
  }, [docKey])

  const commitIndex = useCallback((next: WallIndex) => {
    setIndex({ context: activeWorkspace, value: next })
    void saveWallIndex(activeWorkspace, next)
  }, [activeWorkspace])

  const addWall = useCallback(() => {
    // from the loaded index, so a slow load can't start a competing list
    if (!wallIndex) return
    commitIndex(createWall(wallIndex).index)
    setWallMenuOpen(false)
  }, [wallIndex, commitIndex])

  /** a drop onto a column is an instruction, so it really moves the card */
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
      // one at a time, each fires the mutation event
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
    // before the switch, or the exit flush lands after the delete
    await deleteWallDoc(key)
    commitIndex(next)
  }, [pendingDelete, wallIndex, activeWorkspace, commitIndex])

  /** record: false for drag frames, one undo step per gesture */
  const setItems = useCallback((items: WallItem[], { record = true } = {}) => {
    historyRef.current = record
      ? pushHistory(historyRef.current, items)
      : replacePresent(historyRef.current, items)
    if (record) setHistoryTick(t => t + 1)
    write({ ...docRef.current, items })
  }, [write])

  const setCamera = useCallback((camera: WallCamera) => {
    // the hand-drawn camera is now behind the commit
    panCameraRef.current = null
    write({ ...docRef.current, camera })
  }, [write])

  // stable so WallItemView's memo holds
  const onItemTextChange = useCallback((id: string, text: string) => {
    setItems(patchItems(docRef.current.items, new Set([id]), { text }), { record: false })
  }, [setItems])
  const onItemFinishEditing = useCallback(() => {
    setEditingId(null)
    setItems(docRef.current.items)
  }, [setItems])

  /** a text box follows its words; part of the edit or resize that changed them, not an undo step of its own */
  const onItemAutoSize = useCallback((id: string, height: number) => {
    // the item floor, a one-line box would otherwise go below it
    const next = Math.max(32, Math.ceil(height))
    const items = docRef.current.items
    const target = items.find(i => i.id === id)
    if (!target || target.kind !== 'text' || Math.abs(target.height - next) < 1) return
    setItems(items.map(i => (i.id === id ? { ...i, height: next } : i)), { record: false })
  }, [setItems])

  const applyHistory = useCallback((next: History<WallItem[]>) => {
    historyRef.current = next
    setHistoryTick(t => t + 1)
    write({ ...docRef.current, items: next.present })
    // the step may have removed selected items
    setSelectedIds(prev => new Set([...prev].filter(id => next.present.some(i => i.id === id))))
  }, [write])

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
    // prune arrows too, or a dangling one stays invisible and unselectable
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
    // a mixed selection locks everything
    const lock = chosen.some(i => !i.locked)
    setItems(items.map(i => (ids.has(i.id) ? { ...i, locked: lock ? true : undefined } : i)))
  }, [setItems])

  /** a row below the source, maps as a strip */
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

  /** waiting toast and one error path */
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

  /** web links leave through main, which checks the scheme again; item links pan at the current zoom */
  const followLink = useCallback((link: string) => {
    const parsed = parseWallLink(link)
    if (!parsed) { toast('That link can\'t be opened. Edit it to fix the address.', { type: 'error' }); return }

    if (parsed.type === 'url') {
      appApi.openExternal(parsed.url).catch(err => toast(`Could not open the link: ${errorMessage(err)}`, { type: 'error' }))
      return
    }

    if (!wallIndex) return
    if (parsed.wallId !== wallIndex.activeId) {
      if (!wallIndex.walls.some(w => w.id === parsed.wallId)) {
        toast('The linked wall was deleted. Edit the link to point somewhere else.')
        return
      }
      // the doc load centres it once that wall is open
      pendingJumpRef.current = parsed.itemId
      commitIndex(setActiveWall(wallIndex, parsed.wallId))
      return
    }

    const target = docRef.current.items.find(i => i.id === parsed.itemId)
    if (!target) { toast('The linked item was deleted. Edit the link to point somewhere else.'); return }
    const rect = viewportRef.current?.getBoundingClientRect()
    if (!rect) return
    setCamera(cameraCentredOn(target, { width: rect.width, height: rect.height }, docRef.current.camera.zoom))
    setSelectedIds(new Set([target.id]))
  }, [wallIndex, commitIndex, setCamera, toast])

  /** one undo step; undefined removes it; a locked item keeps its link like its text */
  const setItemLink = useCallback((id: string, link: string | undefined) => {
    setItems(docRef.current.items.map(i => {
      if (i.id !== id || i.locked) return i
      const next = { ...i, link }
      if (!link) delete next.link
      return next
    }))
  }, [setItems])

  const copyItemLink = useCallback((item: WallItem) => {
    if (!activeWall) return
    navigator.clipboard.writeText(itemLink(activeWall.id, item.id))
      .then(() => toast('Link copied. Paste it into another item\'s link, on any wall.'))
      .catch(err => toast(`Could not copy the link: ${errorMessage(err)}`, { type: 'error' }))
  }, [activeWall, toast])

  /** the next click on an item becomes the link target */
  const startLinkPick = useCallback((id: string) => {
    setLinkOpen(false)
    setTool('select')
    setLinkPickFor(id)
  }, [])

  /** main reads the page; the card is already placed, so a slow or failed read only leaves it plain */
  const refreshPreview = useCallback(async (id: string) => {
    const link = parseWallLink(docRef.current.items.find(i => i.id === id)?.link)
    // mailto has no page to read, the address is the card
    if (link?.type !== 'url' || !/^https?:/.test(link.url)) return

    setPreviewing(prev => new Set(prev).add(id))
    try {
      const preview = await mediaApi.linkPreview(link.url)
      const current = docRef.current.items.find(i => i.id === id)
      // gone, or another wall is open by now
      if (!current || current.link !== link.url) return
      if (!preview) {
        toast(`Could not read ${link.host}. The card still opens it, and Refresh preview tries again.`)
        return
      }
      // folded into the paste's undo step, not one of its own
      setItems(docRef.current.items.map(i => i.id === id
        ? { ...i, text: preview.title ?? i.text, summary: preview.description ?? i.summary, ref: preview.icon ?? i.ref }
        : i
      ), { record: false })
    } catch (err) {
      toast(`Could not read ${link.host}: ${errorMessage(err)}`, { type: 'error' })
    } finally {
      setPreviewing(prev => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }
  }, [setItems, toast])

  /** a pasted or dropped address becomes a card that fills in once main has read the page */
  const addBookmark = useCallback((link: string, at?: { x: number; y: number }) => {
    const parsed = parseWallLink(link)
    if (parsed?.type !== 'url') return
    const items = docRef.current.items
    const created = createWallItem('bookmark', at ?? centreOfView(), items, { link: parsed.url, text: parsed.host })
    setItems([...items, created])
    setSelectedIds(new Set([created.id]))
    void refreshPreview(created.id)
  }, [centreOfView, setItems, refreshPreview])

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
    onItemAutoSize,
    applyHistory,
    addItem,
    removeSelected,
    duplicateSelected,
    toggleLock,
    placeDerived,
    runImageOp,
    openCard,
    placeImageFiles,
    linkOpen,
    setLinkOpen,
    linkPickFor,
    setLinkPickFor,
    followLink,
    setItemLink,
    copyItemLink,
    startLinkPick,
    previewing,
    refreshPreview,
    addBookmark
  }
}

export type WallDocument = ReturnType<typeof useWallDocument>
