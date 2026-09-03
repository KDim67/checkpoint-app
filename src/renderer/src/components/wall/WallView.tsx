/**
 * The Wall: a freeform canvas per workspace.
 *
 * Every other view imposes a shape. This one imposes none, nothing snaps
 * (unless asked), nothing sorts, nothing has a status, and an item stays where
 * it was put. The design work is mostly about *not* being clever.
 *
 * Decisions worth stating:
 *
 * - **The dot grid scales with the camera.** On an infinite canvas with no
 *   scrollbars, a flat background gives no sense of movement; panning feels
 *   like nothing happened. The grid is the only cue that the camera moved.
 * - **"Fit" is always reachable.** Panning into empty space is the one mistake
 *   the user cannot undo by looking harder.
 * - **Cards are references.** Placing a card does not copy it, and moving it
 *   here means nothing to its column. That is what stops the Wall becoming a
 *   second, lying board.
 * - **Left-drag selects; right-drag pans.** The convention from Unity and
 *   Unreal rather than from Figma, and right-drag pans from *anywhere*, on a
 *   busy wall, having to find empty space before you can move the view is the
 *   thing that makes a canvas feel cramped.
 *
 *   That leaves right-click doing two jobs, separated by distance: a press that
 *   travels less than a few pixels was a click and opens a menu; anything
 *   further was a pan and does not.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  StickyNote, Type, Square, Layers, Image as ImageIcon, Maximize2,
  Trash2, ArrowUp, ArrowDown, Plus, Copy, Lock, Unlock, Undo2, Redo2,
  Grid3x3, RotateCw, ExternalLink, FileText, Wand2, Expand, Palette, Search
} from 'lucide-react'
import { useAppStore } from '../../store/appStore'
import { useToast } from '../ui/Toast'
import {
  bringToFront, boundsOf, createWallItem, duplicateItems, fitCamera, inPaintOrder,
  itemsInRect, moveItems, normalizeWallDoc, patchItems, rectFromPoints, sendToBack,
  boundsOf as wallBounds, cameraCentredOn, itemAtPoint, searchItems,
  snap, SNAP_GRID, toWallPoint, WALL_COLORS, zoomAt,
  type WallCamera, type WallDoc, type WallItem, type WallItemKind
} from '../../../../shared/wallModel'
import {
  canRedo, canUndo, initHistory, pushHistory, redo, replacePresent, undo,
  type History
} from '../../../../shared/history'
import { flushWallDoc, loadWallDoc, saveWallDoc } from '../../lib/wallDoc'
import { derivePalette, derivePbrMaps, deriveUpscale } from '../../lib/wallImageOps'
import { errorMessage } from '../../../../shared/errors'
import type { Item, NoteMetadata } from '../../../../shared/types'
import WallItemView from './WallItemView'
import WallContextMenu, { type MenuEntry } from './WallContextMenu'

const NUDGE = 4
/** How far a press may travel and still count as a click rather than a drag. */
const CLICK_SLOP = 4

type Drag =
  | { mode: 'pan'; startX: number; startY: number; camX: number; camY: number }
  | { mode: 'move'; startX: number; startY: number; origin: WallItem[] }
  | { mode: 'resize'; id: string; startX: number; startY: number; w: number; h: number }
  | { mode: 'rotate'; id: string; cx: number; cy: number; start: number }
  | { mode: 'marquee'; startX: number; startY: number; base: Set<string> }
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
  const [marquee, setMarquee] = useState<{ x: number; y: number; width: number; height: number } | null>(null)
  /** Name of an image job in flight, shown so a slow one does not look frozen. */
  const [busy, setBusy] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  /** Bumped whenever the ref-held history changes, so the buttons re-render. */
  const [historyTick, setHistoryTick] = useState(0)

  const viewportRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<Drag>(null)
  /** A right-press in flight: becomes a menu on release if it barely moved. */
  const rightPressRef = useRef<{ clientX: number; clientY: number; itemId: string | null; at: { x: number; y: number }; moved: boolean } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const docRef = useRef(doc)
  docRef.current = doc
  const selectedRef = useRef(selectedIds)
  selectedRef.current = selectedIds

  /** Undo covers the items only: the camera is a view, not an edit. */
  const historyRef = useRef<History<WallItem[]>>(initHistory([]))

  const cardsById = useMemo(() => new Map(cards.map(c => [c.id, c])), [cards])
  const notesByTitle = useMemo(() => new Map(notes.map(n => [n.title, n])), [notes])
  const selectedItems = doc.items.filter(i => selectedIds.has(i.id))
  const single = selectedItems.length === 1 ? selectedItems[0] : null

  // Load
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setSelectedIds(new Set())
    setEditingId(null)

    Promise.all([
      loadWallDoc(activeContext),
      window.electronAPI.db.getItems(activeContext, 'card', 1, 500).catch(() => ({ items: [] as Item[] })),
      // Notes are not per-workspace, so they are offered whole.
      window.electronAPI.notes.listNotes().catch(() => [] as NoteMetadata[])
    ])
      .then(([loaded, res, noteList]) => {
        if (cancelled) return
        setDoc(loaded)
        historyRef.current = initHistory(loaded.items)
        setHistoryTick(t => t + 1)
        setCards((res.items ?? []).filter(c => c.status !== 'archived'))
        setNotes(noteList ?? [])
      })
      .catch(err => !cancelled && toast(`Could not open the wall: ${errorMessage(err)}`, { type: 'error' }))
      .finally(() => !cancelled && setLoading(false))

    return () => { cancelled = true }
  }, [activeContext, toast])

  useEffect(() => {
    const context = activeContext
    return () => { void flushWallDoc(context, docRef.current) }
  }, [activeContext])

  // Mutation
  const write = useCallback((next: WallDoc) => {
    setDoc(next)
    saveWallDoc(activeContext, next)
  }, [activeContext])

  /**
   * `record: false` is for the frames of a drag. Recording each one would make
   * a single gesture take fifty presses of undo to reverse, so the whole drag
   * is recorded once when the pointer comes up.
   */
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
    setItems(items.filter(i => !ids.has(i.id)))
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

  /**
   * Results are placed in a row beneath the source rather than on top of it,
   * so four PBR maps arrive as a strip you can read instead of a stack you have
   * to pull apart.
   */
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

  const fitToContent = useCallback(() => {
    const rect = viewportRef.current?.getBoundingClientRect()
    if (!rect) return
    setCamera(fitCamera(docRef.current.items, { width: rect.width, height: rect.height }))
  }, [setCamera])

  // Pointer
  const onPointerDown = (e: React.PointerEvent) => {
    setMenu(null)
    const target = e.target as HTMLElement

    // A press inside a text field belongs to the text field. Capturing it here
    // would turn every attempt to select a word into a drag of the whole item,
    // and the capture has to be skipped as well as the drag, a captured
    // pointer never reaches the textarea at all.
    if (target.closest('input, textarea, [contenteditable="true"]')) return

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

    if (id && item && e.button === 0) {
      if (item.locked) { setSelectedIds(new Set()); return }
      const already = selectedRef.current.has(id)
      const next = e.shiftKey
        ? new Set(already ? [...selectedRef.current].filter(x => x !== id) : [...selectedRef.current, id])
        : (already ? selectedRef.current : new Set([id]))
      setSelectedIds(next)
      if (!e.shiftKey) setItems(bringToFront(docRef.current.items, id), { record: false })
      dragRef.current = { mode: 'move', startX: e.clientX, startY: e.clientY, origin: docRef.current.items }
      return
    }

    // Shift keeps whatever was selected, so a marquee can add to it.
    if (!e.shiftKey) setSelectedIds(new Set())
    setEditingId(null)

    const p = screenPoint(e)
    // The selection as it was when the drag began. Unioning against the live
    // selection instead would mean an item, once caught, could never be
    // released by moving the marquee back off it.
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
      const moved = moveItems(drag.origin, selectedRef.current, dx, dy)
      setItems(
        snapping
          ? moved.map(i => (selectedRef.current.has(i.id) ? { ...i, x: snap(i.x, SNAP_GRID), y: snap(i.y, SNAP_GRID) } : i))
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
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return

      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        applyHistory(e.shiftKey ? redo(historyRef.current) : undo(historyRef.current))
        return
      }
      if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateSelected(); return }
      if (mod && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        setSelectedIds(new Set(docRef.current.items.filter(i => !i.locked).map(i => i.id)))
        return
      }
      if (e.key === 'Escape') { setSelectedIds(new Set()); setEditingId(null); setMenu(null); return }
      if (selectedRef.current.size === 0) return

      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeSelected(); return }

      const step = e.shiftKey ? NUDGE * 5 : NUDGE
      const deltas: Record<string, [number, number]> = {
        ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step]
      }
      const delta = deltas[e.key]
      if (delta) {
        e.preventDefault()
        setItems(moveItems(docRef.current.items, selectedRef.current, delta[0], delta[1]))
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
  // Anything already on the wall is left out: placing a second copy of the same
  // card is possible but never what the picker is for.
  const placed = new Set(doc.items.filter(i => i.kind === 'card' || i.kind === 'doc').map(i => i.ref))
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
  const matches = query.trim() ? searchItems(doc.items, query, labelOf) : []

  // Read after historyTick so the buttons reflect the ref-held stack.
  void historyTick
  const undoable = canUndo(historyRef.current)
  const redoable = canRedo(historyRef.current)

  // Floating toolbar position, in screen space above the selection.
  const selectionBounds = boundsOf(selectedItems)
  const floatingPos = selectionBounds && !editingId
    ? {
        left: (selectionBounds.minX + (selectionBounds.maxX - selectionBounds.minX) / 2) * camera.zoom + camera.x,
        top: selectionBounds.minY * camera.zoom + camera.y - 44
      }
    : null

  const tool = (
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
        width: '30px', height: '30px',
        background: opts.active ? 'var(--color-surface-offset)' : undefined,
        opacity: opts.disabled ? 0.4 : 1
      }}
    >
      {icon}
    </button>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>

      {/* Toolbar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
        padding: 'var(--space-2) var(--space-3)',
        borderBottom: '1px solid var(--color-surface-offset)',
        flexShrink: 0, position: 'relative'
      }}>
        {tool('Sticky note', <StickyNote size={14} />, () => addItem('note'))}
        {tool('Text', <Type size={14} />, () => addItem('text'))}
        {tool('Frame', <Square size={14} />, () => addItem('frame'))}
        {tool('Place a card', <Layers size={14} />, () => setPicker(p => (p === 'card' ? null : 'card')))}
        {tool('Place a note', <FileText size={14} />, () => setPicker(p => (p === 'doc' ? null : 'doc')))}
        {tool('Image', <ImageIcon size={14} />, () => fileInputRef.current?.click())}

        <div style={{ width: '1px', height: '18px', background: 'var(--color-surface-offset)' }} />

        {tool('Undo', <Undo2 size={14} />, () => applyHistory(undo(historyRef.current)), { disabled: !undoable })}
        {tool('Redo', <Redo2 size={14} />, () => applyHistory(redo(historyRef.current)), { disabled: !redoable })}
        {tool('Snap to grid', <Grid3x3 size={14} />, () => setSnapping(v => !v), { active: snapping })}
        {tool('Fit to content', <Maximize2 size={14} />, fitToContent, { disabled: doc.items.length === 0 })}

        <span style={{ fontSize: '11px', color: 'var(--color-text-faint)', fontFamily: 'var(--font-mono)', minWidth: '42px' }}>
          {Math.round(camera.zoom * 100)}%
        </span>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 'var(--space-3)', position: 'relative' }}>
          {/* Stated rather than left to be discovered: neither is guessable. */}
          <span style={{ fontSize: '10px', color: 'var(--color-text-faint)' }}>
            Drag to select · Right-drag to pan · Right-click for more
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
          <div style={{
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
        onDragOver={e => e.preventDefault()}
        onDrop={e => {
          e.preventDefault()
          void placeImageFiles(Array.from(e.dataTransfer.files ?? []), toWallPoint(screenPoint(e), docRef.current.camera))
        }}
        style={{
          flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden',
          background: 'var(--color-background)',
          backgroundImage: 'radial-gradient(circle, var(--color-surface-offset) 1px, transparent 1px)',
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
              from the board. Nothing snaps and nothing sorts, put things where you want them.
            </span>
          </div>
        )}

        <div style={{
          position: 'absolute', top: 0, left: 0,
          transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`,
          transformOrigin: '0 0'
        }}>
          {inPaintOrder(doc.items).map(item => {
            const isSelected = selectedIds.has(item.id)
            return (
              <div
                key={item.id}
                data-wall-item={item.id}
                style={{
                  position: 'absolute',
                  left: `${item.x}px`, top: `${item.y}px`,
                  width: `${item.width}px`, height: `${item.height}px`,
                  transform: item.rotation ? `rotate(${item.rotation}deg)` : undefined,
                  cursor: item.locked ? 'default' : 'grab',
                  outline: isSelected ? '2px solid var(--color-secondary)' : 'none',
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

                {/* Handles only for a single unlocked selection: dragging one
                    corner of five items has no obvious meaning. */}
                {isSelected && single?.id === item.id && !item.locked && (
                  <>
                    <div
                      data-wall-handle="se"
                      style={{
                        position: 'absolute', right: '-6px', bottom: '-6px', width: '12px', height: '12px',
                        background: 'var(--color-secondary)', border: '2px solid var(--color-surface-1)',
                        borderRadius: '2px', cursor: 'nwse-resize'
                      }}
                    />
                    <div
                      data-wall-handle="rotate"
                      title="Drag to rotate, hold Shift for 15° steps"
                      style={{
                        position: 'absolute', left: '50%', top: '-26px', transform: 'translateX(-50%)',
                        width: '16px', height: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: 'var(--color-surface-1)', border: '1px solid var(--color-secondary)',
                        borderRadius: '50%', cursor: 'grab', color: 'var(--color-secondary)'
                      }}
                    >
                      <RotateCw size={9} />
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
          <div style={{
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
            {tool('Bring to front', <ArrowUp size={13} />, () => single && setItems(bringToFront(doc.items, single.id)), { disabled: !single })}
            {tool('Send to back', <ArrowDown size={13} />, () => single && setItems(sendToBack(doc.items, single.id)), { disabled: !single })}
            {tool('Duplicate', <Copy size={13} />, duplicateSelected)}
            {tool(single?.locked ? 'Unlock' : 'Lock', single?.locked ? <Unlock size={13} /> : <Lock size={13} />, toggleLock)}
            {tool('Delete', <Trash2 size={13} />, removeSelected)}
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
              {doc.items.map(i => (
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

      {menu && (
        <WallContextMenu x={menu.x} y={menu.y} entries={menuEntries()} onClose={() => setMenu(null)} />
      )}
    </div>
  )
}
