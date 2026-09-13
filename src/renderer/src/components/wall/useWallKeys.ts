import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { boundsOf, moveItems, searchItems, withFrameContents, type WallItem } from '../../../../shared/wallModel'
import { canRedo, canUndo, redo, undo } from '../../../../shared/history'
import type { MenuEntry } from './WallContextMenu'
import { getTextColorForBackground } from '../../lib/contrast'
import { NUDGE } from './wallShortcutSheet'
import { wallMenuEntries } from './wallMenuEntries'
import { isLinkable, pastedLink } from '../../../../shared/wallLink'
import type { WallDocument } from './useWallDocument'
import type { WallPointer } from './useWallPointer'

export function useWallKeys(wallDocument: WallDocument, wallPointer: WallPointer) {
  const {
    toast, doc, cards, notes, selectedIds, setSelectedIds, editingId, setEditingId, picker,
    setPicker, menu, setMenu, setTool, setArrowFrom, setArrowDrag, query, historyTick,
    setWallMenuOpen, setRenaming, setBgOpen, setShortcutsOpen, setSpaceHeld, setSwatchOpen, matchKey,
    viewportRef, panCameraRef, labelRef, docRef, selectedRef, historyRef, cardsById, selectedItems,
    single, arrowsSelected, setItems, applyHistory, addItem, removeSelected, duplicateSelected,
    toggleLock, placeDerived, runImageOp, openCard, placeImageFiles, setLinkPickFor, setLinkOpen,
    setItemLink, addBookmark, refreshPreview, followLink, copyItemLink
  } = wallDocument
  const {
    fitToContent
  } = wallPointer
  useEffect(() => {
    const down = (e: KeyboardEvent): void => {
      if (e.code !== 'Space' || e.repeat) return
      // space belongs to focus; only a press with nothing focused pans
      const el = document.activeElement
      if (el instanceof HTMLElement && el !== document.body &&
        el.closest('button, a, input, textarea, select, [role="button"], [contenteditable="true"]')) return
      // otherwise the page scrolls
      e.preventDefault()
      setSpaceHeld(true)
    }
    const up = (e: KeyboardEvent): void => { if (e.code === 'Space') setSpaceHeld(false) }
    // a key held through blur never comes up, clear it
    const clear = (): void => setSpaceHeld(false)

    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', clear)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', clear)
    }
  }, [setSpaceHeld])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const el = document.activeElement
      // bare letters arm tools, typing "a" mustn't switch to arrow
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return
      if (el instanceof HTMLElement && el.isContentEditable) return

      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        applyHistory(e.shiftKey ? redo(historyRef.current) : undo(historyRef.current))
        return
      }
      // from the bindings; V, P, A are only defaults
      const command = matchKey(e)
      if (command === 'wall_tool_select') { setTool('select'); setArrowFrom(null); return }
      if (command === 'wall_tool_draw') { setTool('pen'); setArrowFrom(null); return }
      if (command === 'wall_tool_connect') { setTool('arrow'); setArrowFrom(null); return }
      if (command === 'wall_duplicate') { e.preventDefault(); duplicateSelected(); return }
      if (command === 'wall_delete') { e.preventDefault(); removeSelected(); return }
      if (command === 'wall_link') {
        const chosen = docRef.current.items.filter(i => selectedRef.current.has(i.id))
        if (chosen.length === 1 && isLinkable(chosen[0].kind) && !chosen[0].locked) {
          e.preventDefault()
          setLinkOpen(true)
        }
        return
      }

      if (mod && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        setSelectedIds(new Set(docRef.current.items.filter(i => !i.locked).map(i => i.id)))
        return
      }
      if (e.key === 'Escape') {
        // every panel: keyboard-open, mouse-close is a trap
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
        setLinkPickFor(null)
        setLinkOpen(false)
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
        // nudging matches dragging, frames take their contents
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
  }, [applyHistory, docRef, duplicateSelected, historyRef, matchKey, removeSelected, selectedRef, setArrowDrag, setArrowFrom, setBgOpen, setEditingId, setItems, setLinkOpen, setLinkPickFor, setMenu, setPicker, setRenaming, setSelectedIds, setShortcutsOpen, setTool, setWallMenuOpen])

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const el = document.activeElement
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return
      const files = e.clipboardData?.files ? Array.from(e.clipboardData.files) : []
      if (files.some(f => f.type.startsWith('image/'))) {
        e.preventDefault()
        void placeImageFiles(files)
        return
      }

      const link = pastedLink(e.clipboardData?.getData('text/plain') ?? '')
      if (!link) return
      e.preventDefault()

      const chosen = docRef.current.items.filter(i => selectedRef.current.has(i.id))
      const target = chosen.length === 1 && isLinkable(chosen[0].kind) && !chosen[0].locked ? chosen[0] : null
      if (target) {
        setItemLink(target.id, link)
        toast('Link added. Ctrl+click the item or click its chip to follow it.')
        return
      }
      // an item link has nothing to show on its own
      if (link.startsWith('wall:')) {
        toast('Select an item first, then paste to link it there.')
        return
      }
      addBookmark(link)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [placeImageFiles, docRef, selectedRef, setItemLink, addBookmark, toast])

  const menuEntries = (): MenuEntry[] => wallMenuEntries({
    menu, doc, docRef, selectedIds, setSelectedIds, setItems, addItem, openCard,
    duplicateSelected, toggleLock, removeSelected, fitToContent, runImageOp, placeDerived, toast,
    followLink, copyItemLink, setItemLink, refreshPreview, openLinkEditor: () => setLinkOpen(true)
  })

  // live camera from the ref mid-pan, so a stray render agrees with what's painted
  const camera = panCameraRef.current ?? doc.camera
  // 'default' follows the theme
  const custom = doc.background && doc.background !== 'default' ? doc.background : null
  const canvasBackground = custom ?? 'var(--color-background)'
  // derived, a fixed dot colour vanishes on half the palette
  const dotColor = custom
    ? (getTextColorForBackground(custom) === '#ffffff' ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.18)')
    : 'var(--color-surface-offset)'
  // skip what's already placed
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

  /** wherever the name actually lives */
  const labelOf = (i: WallItem): string | undefined => {
    if (i.kind === 'card') return cardsById.get(i.ref ?? '')?.title
    if (i.kind === 'doc') return i.ref
    if (i.kind === 'image') return i.text
    return i.text
  }
  labelRef.current = labelOf
  const matches = query.trim() ? searchItems(doc.items, query, labelOf) : []

  // read after historyTick so buttons see the ref stack
  void historyTick
  const undoable = canUndo(historyRef.current)
  const redoable = canRedo(historyRef.current)

  /** above the selection, below if no room; clamped both ways since the canvas clips */
  const selectionBounds = boundsOf(selectedItems)
  /** its width changes with the selection */
  const floatingRef = useRef<HTMLDivElement>(null)
  const [floatingWidth, setFloatingWidth] = useState(220)
  const floatingPos = ((): { left: number; top: number } | null => {
    if (!selectionBounds || editingId) return null

    const centreX = (selectionBounds.minX + (selectionBounds.maxX - selectionBounds.minX) / 2) * camera.zoom + camera.x
    const above = selectionBounds.minY * camera.zoom + camera.y - 44
    const below = selectionBounds.maxY * camera.zoom + camera.y + 12

    const rect = viewportRef.current?.getBoundingClientRect()
    // measured, a flat 110 let wide toolbars hang off the edge
    const halfWidth = floatingWidth / 2
    return {
      left: rect ? Math.min(Math.max(centreX, halfWidth), rect.width - halfWidth) : centreX,
      top: above < 4 ? below : above
    }
  })()

  /** measured after layout, counting buttons would drift */
  useLayoutEffect(() => {
    const width = floatingRef.current?.offsetWidth
    if (width && width !== floatingWidth) setFloatingWidth(width)
  }, [floatingWidth, selectedIds, arrowsSelected, single?.locked, single?.text])

  /** belongs to the selection that opened it */
  useEffect(() => { setSwatchOpen(false); setLinkOpen(false) }, [selectedIds, setSwatchOpen, setLinkOpen])

  return {
    menuEntries,
    camera,
    custom,
    canvasBackground,
    dotColor,
    placed,
    pickerRows,
    labelOf,
    matches,
    undoable,
    redoable,
    floatingRef,
    floatingPos
  }
}

export type WallKeys = ReturnType<typeof useWallKeys>
