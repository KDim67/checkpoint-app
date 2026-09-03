/**
 * The Wall: a freeform canvas per workspace.
 *
 * Every other view imposes a shape. This one imposes none, nothing snaps,
 * nothing sorts, nothing has a status, and an item stays exactly where it was
 * put. The design work here is almost entirely about *not* being clever.
 *
 * Three things are deliberate:
 *
 * - **The dot grid scales with the camera.** On an infinite canvas with no
 *   scrollbars, a plain background gives no sense of movement or scale, and
 *   panning feels like nothing is happening. The grid is the only cue that the
 *   camera moved rather than the content changing.
 * - **"Fit" is always reachable.** Panning into empty space is the one mistake
 *   a user cannot undo by looking harder, so there is a permanent way back.
 * - **Cards are references.** Placing a card here does not copy it; the board
 *   remains the source of truth, and moving a card on the Wall means nothing to
 *   its status. That is what stops this becoming a second, lying board.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  StickyNote, Type, Square, Layers, Image as ImageIcon, Maximize2,
  Trash2, ArrowUp, ArrowDown, Plus
} from 'lucide-react'
import { useAppStore } from '../../store/appStore'
import { useToast } from '../ui/Toast'
import {
  bringToFront, createWallItem, fitCamera, inPaintOrder,
  normalizeWallDoc, sendToBack, toWallPoint, WALL_COLORS, zoomAt,
  type WallCamera, type WallDoc, type WallItem, type WallItemKind
} from '../../../../shared/wallModel'
import { flushWallDoc, loadWallDoc, saveWallDoc } from '../../lib/wallDoc'
import { errorMessage } from '../../../../shared/errors'
import type { Item } from '../../../../shared/types'
import WallItemView from './WallItemView'

/** Nudge distance for arrow keys; Shift multiplies it. */
const NUDGE = 4

type Drag =
  | { mode: 'pan'; startX: number; startY: number; camX: number; camY: number }
  | { mode: 'move'; id: string; startX: number; startY: number; itemX: number; itemY: number }
  | { mode: 'resize'; id: string; startX: number; startY: number; w: number; h: number }
  | null

export default function WallView() {
  const activeContext = useAppStore(s => s.activeContext)
  const { toast } = useToast()

  const [doc, setDoc] = useState<WallDoc>(() => normalizeWallDoc(null))
  const [cards, setCards] = useState<Item[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showCardPicker, setShowCardPicker] = useState(false)

  const viewportRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<Drag>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  // Kept in a ref as well so the unmount flush writes the latest, not the
  // document captured when the effect was created.
  const docRef = useRef(doc)
  docRef.current = doc

  const cardsById = useMemo(() => new Map(cards.map(c => [c.id, c])), [cards])
  const selected = doc.items.find(i => i.id === selectedId) ?? null

  // Load
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setSelectedId(null)
    setEditingId(null)

    Promise.all([
      loadWallDoc(activeContext),
      window.electronAPI.db.getItems(activeContext, 'card', 1, 500).catch(() => ({ items: [] as Item[] }))
    ])
      .then(([loaded, res]) => {
        if (cancelled) return
        setDoc(loaded)
        setCards((res.items ?? []).filter(c => c.status !== 'archived'))
      })
      .catch(err => !cancelled && toast(`Could not open the wall: ${errorMessage(err)}`, { type: 'error' }))
      .finally(() => !cancelled && setLoading(false))

    return () => { cancelled = true }
  }, [activeContext, toast])

  // Leaving the view must not lose the last few hundred milliseconds of work.
  useEffect(() => {
    const context = activeContext
    return () => { void flushWallDoc(context, docRef.current) }
  }, [activeContext])

  /** Every mutation goes through here, so nothing can change without saving. */
  const commit = useCallback((next: WallDoc) => {
    setDoc(next)
    saveWallDoc(activeContext, next)
  }, [activeContext])

  const setItems = useCallback((items: WallItem[]) => {
    commit({ ...docRef.current, items })
  }, [commit])

  const patchItem = useCallback((id: string, patch: Partial<WallItem>) => {
    setItems(docRef.current.items.map(i => (i.id === id ? { ...i, ...patch } : i)))
  }, [setItems])

  const setCamera = useCallback((camera: WallCamera) => {
    commit({ ...docRef.current, camera })
  }, [commit])

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
    setSelectedId(created.id)
    // Text-bearing kinds open straight into editing: placing one and then
    // having to find it again to type is a step with no purpose.
    if (kind === 'note' || kind === 'text' || kind === 'frame') setEditingId(created.id)
  }, [centreOfView, setItems])

  const removeItem = useCallback((id: string) => {
    const items = docRef.current.items
    const gone = items.find(i => i.id === id)
    if (!gone) return
    setItems(items.filter(i => i.id !== id))
    setSelectedId(null)
    toast('Removed from the wall.', {
      action: { label: 'Undo', onClick: () => setItems([...docRef.current.items, gone]) }
    })
  }, [setItems, toast])

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
  const onWheel = useCallback((e: React.WheelEvent) => {
    const rect = viewportRef.current?.getBoundingClientRect()
    if (!rect) return
    const at = { x: e.clientX - rect.left, y: e.clientY - rect.top }
    setCamera(zoomAt(docRef.current.camera, at, e.deltaY < 0 ? 1.1 : 1 / 1.1))
  }, [setCamera])

  const fitToContent = useCallback(() => {
    const rect = viewportRef.current?.getBoundingClientRect()
    if (!rect) return
    setCamera(fitCamera(docRef.current.items, { width: rect.width, height: rect.height }))
  }, [setCamera])

  // Pointer
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.button !== 1) return
    const target = e.target as HTMLElement
    const itemEl = target.closest<HTMLElement>('[data-wall-item]')
    const handle = target.closest<HTMLElement>('[data-wall-handle]')

    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)

    if (handle && selectedId) {
      const item = docRef.current.items.find(i => i.id === selectedId)
      if (item) {
        dragRef.current = { mode: 'resize', id: item.id, startX: e.clientX, startY: e.clientY, w: item.width, h: item.height }
        return
      }
    }

    if (itemEl && e.button === 0) {
      const id = itemEl.dataset.wallItem
      const item = id ? docRef.current.items.find(i => i.id === id) : undefined
      if (id && item) {
        setSelectedId(id)
        // Raised on grab: what you are moving should be what you can see.
        if (item.z < Math.max(...docRef.current.items.map(i => i.z))) {
          setItems(bringToFront(docRef.current.items, id))
        }
        dragRef.current = { mode: 'move', id, startX: e.clientX, startY: e.clientY, itemX: item.x, itemY: item.y }
        return
      }
    }

    setSelectedId(null)
    setEditingId(null)
    const cam = docRef.current.camera
    dragRef.current = { mode: 'pan', startX: e.clientX, startY: e.clientY, camX: cam.x, camY: cam.y }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current
    if (!drag) return
    const zoom = docRef.current.camera.zoom
    const dx = e.clientX - drag.startX
    const dy = e.clientY - drag.startY

    if (drag.mode === 'pan') {
      setCamera({ ...docRef.current.camera, x: drag.camX + dx, y: drag.camY + dy })
    } else if (drag.mode === 'move') {
      patchItem(drag.id, { x: drag.itemX + dx / zoom, y: drag.itemY + dy / zoom })
    } else {
      patchItem(drag.id, {
        width: Math.max(40, drag.w + dx / zoom),
        height: Math.max(32, drag.h + dy / zoom)
      })
    }
  }

  const endDrag = (e: React.PointerEvent) => {
    dragRef.current = null
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId) } catch { /* already gone */ }
  }

  // Keyboard
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const el = document.activeElement
      const typing = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
      if (typing) return

      if (e.key === 'Escape') { setSelectedId(null); setEditingId(null); return }
      if (!selectedId) return

      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        removeItem(selectedId)
        return
      }

      // Arrow keys, so an item can be placed exactly without a steady hand.
      const step = e.shiftKey ? NUDGE * 5 : NUDGE
      const move: Record<string, [number, number]> = {
        ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step]
      }
      const delta = move[e.key]
      if (delta) {
        e.preventDefault()
        const item = docRef.current.items.find(i => i.id === selectedId)
        if (item) patchItem(selectedId, { x: item.x + delta[0], y: item.y + delta[1] })
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selectedId, removeItem, patchItem])

  // Paste an image straight onto the wall.
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

  const { camera } = doc
  const placedCardIds = new Set(doc.items.filter(i => i.kind === 'card').map(i => i.ref))
  const availableCards = cards.filter(c => !placedCardIds.has(c.id))

  const toolButton = (label: string, icon: React.ReactNode, onClick: () => void): React.JSX.Element => (
    <button
      key={label}
      onClick={onClick}
      title={label}
      aria-label={label}
      className="btn-icon"
      style={{ width: '30px', height: '30px' }}
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
        {toolButton('Sticky note', <StickyNote size={14} />, () => addItem('note'))}
        {toolButton('Text', <Type size={14} />, () => addItem('text'))}
        {toolButton('Frame', <Square size={14} />, () => addItem('frame'))}
        {toolButton('Place a card', <Layers size={14} />, () => setShowCardPicker(v => !v))}
        {toolButton('Image', <ImageIcon size={14} />, () => fileInputRef.current?.click())}

        <div style={{ width: '1px', height: '18px', background: 'var(--color-surface-offset)' }} />

        {toolButton('Fit to content', <Maximize2 size={14} />, fitToContent)}
        <span style={{
          fontSize: '11px', color: 'var(--color-text-faint)',
          fontFamily: 'var(--font-mono)', minWidth: '42px'
        }}>
          {Math.round(camera.zoom * 100)}%
        </span>

        {selected && (
          <>
            <div style={{ width: '1px', height: '18px', background: 'var(--color-surface-offset)' }} />
            <div style={{ display: 'flex', gap: '3px' }}>
              {WALL_COLORS.map(c => (
                <button
                  key={c}
                  onClick={() => patchItem(selected.id, { color: c })}
                  aria-label={`Colour ${c}`}
                  style={{
                    width: '16px', height: '16px', borderRadius: '3px', background: c,
                    border: selected.color === c ? '2px solid var(--color-text-base)' : '1px solid rgba(0,0,0,0.25)',
                    cursor: 'pointer', padding: 0
                  }}
                />
              ))}
            </div>
            {toolButton('Bring to front', <ArrowUp size={14} />, () => setItems(bringToFront(doc.items, selected.id)))}
            {toolButton('Send to back', <ArrowDown size={14} />, () => setItems(sendToBack(doc.items, selected.id)))}
            {toolButton('Remove', <Trash2 size={14} />, () => removeItem(selected.id))}
          </>
        )}

        {/* Card picker */}
        {showCardPicker && (
          <div style={{
            position: 'absolute', top: '100%', left: 'var(--space-3)', zIndex: 20,
            marginTop: '4px', width: '280px', maxHeight: '320px', overflowY: 'auto',
            background: 'var(--color-surface-elevated)',
            border: '1px solid var(--color-surface-offset)',
            borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg)', padding: '4px'
          }}>
            {availableCards.length === 0 ? (
              <div style={{ padding: 'var(--space-3)', fontSize: 'var(--text-xs)', color: 'var(--color-text-faint)' }}>
                Every card is already on the wall.
              </div>
            ) : availableCards.map(c => (
              <button
                key={c.id}
                onClick={() => { addItem('card', { ref: c.id }); setShowCardPicker(false) }}
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
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.title}</span>
              </button>
            ))}
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          style={{ display: 'none' }}
          onChange={e => {
            void placeImageFiles(Array.from(e.target.files ?? []))
            e.target.value = ''
          }}
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
        onDoubleClick={e => {
          if ((e.target as HTMLElement).closest('[data-wall-item]')) return
          const rect = viewportRef.current?.getBoundingClientRect()
          if (!rect) return
          addItem('note', {}, toWallPoint({ x: e.clientX - rect.left, y: e.clientY - rect.top }, docRef.current.camera))
        }}
        onDragOver={e => e.preventDefault()}
        onDrop={e => {
          e.preventDefault()
          const rect = viewportRef.current?.getBoundingClientRect()
          const at = rect
            ? toWallPoint({ x: e.clientX - rect.left, y: e.clientY - rect.top }, docRef.current.camera)
            : undefined
          void placeImageFiles(Array.from(e.dataTransfer.files ?? []), at)
        }}
        style={{
          flex: 1,
          minHeight: 0,
          position: 'relative',
          overflow: 'hidden',
          cursor: dragRef.current?.mode === 'pan' ? 'grabbing' : 'default',
          background: 'var(--color-background)',
          // The only cue that the camera moved rather than the content changing.
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
            <span style={{ fontSize: 'var(--text-base)', color: 'var(--color-text-muted)' }}>
              An empty wall
            </span>
            <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-faint)', maxWidth: '420px', lineHeight: 1.6 }}>
              Double-click anywhere for a sticky note, drop images straight on, or place cards
              from the board. Nothing snaps and nothing sorts, put things where you want them.
            </span>
          </div>
        )}

        {/* One transformed layer: items are stored in wall coordinates and the
            camera is applied once, so nothing has to know about zoom. */}
        <div style={{
          position: 'absolute', top: 0, left: 0,
          transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`,
          transformOrigin: '0 0'
        }}>
          {inPaintOrder(doc.items).map(item => {
            const isSelected = item.id === selectedId
            return (
              <div
                key={item.id}
                data-wall-item={item.id}
                onDoubleClick={e => {
                  e.stopPropagation()
                  if (item.kind === 'note' || item.kind === 'text' || item.kind === 'frame') setEditingId(item.id)
                }}
                style={{
                  position: 'absolute',
                  left: `${item.x}px`,
                  top: `${item.y}px`,
                  width: `${item.width}px`,
                  height: `${item.height}px`,
                  transform: item.rotation ? `rotate(${item.rotation}deg)` : undefined,
                  cursor: 'grab',
                  outline: isSelected ? '2px solid var(--color-secondary)' : 'none',
                  outlineOffset: '2px'
                }}
              >
                <WallItemView
                  item={item}
                  card={item.kind === 'card' ? cardsById.get(item.ref ?? '') : undefined}
                  selected={isSelected}
                  editing={editingId === item.id}
                  onTextChange={text => patchItem(item.id, { text })}
                  onFinishEditing={() => setEditingId(null)}
                />

                {isSelected && (
                  <div
                    data-wall-handle="se"
                    style={{
                      position: 'absolute', right: '-6px', bottom: '-6px',
                      width: '12px', height: '12px',
                      background: 'var(--color-secondary)',
                      border: '2px solid var(--color-surface-1)',
                      borderRadius: '2px', cursor: 'nwse-resize'
                    }}
                  />
                )}
              </div>
            )
          })}
        </div>

        {/* Closes the picker without stealing a click from the canvas. */}
        {showCardPicker && (
          <div
            onPointerDown={() => setShowCardPicker(false)}
            style={{ position: 'absolute', inset: 0, zIndex: 10 }}
          />
        )}
      </div>
    </div>
  )
}
