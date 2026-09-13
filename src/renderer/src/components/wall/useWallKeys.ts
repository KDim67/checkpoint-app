import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { boundsOf, moveItems, searchItems, withFrameContents, type WallItem } from '../../../../shared/wallModel'
import { canRedo, canUndo, redo, undo } from '../../../../shared/history'
import type { MenuEntry } from './WallContextMenu'
import { getTextColorForBackground } from '../../lib/contrast'
import { NUDGE } from './wallShortcutSheet'
import { wallMenuEntries } from './wallMenuEntries'
import type { WallDocument } from './useWallDocument'
import type { WallPointer } from './useWallPointer'

/** The keyboard, pasted images, the context menu, and what the toolbar and canvas derive from the document. */
export function useWallKeys(wallDocument: WallDocument, wallPointer: WallPointer) {
  const {
    toast, doc, cards, notes, selectedIds, setSelectedIds, editingId, setEditingId, picker,
    setPicker, menu, setMenu, setTool, setArrowFrom, setArrowDrag, query, historyTick,
    setWallMenuOpen, setRenaming, setBgOpen, setShortcutsOpen, setSpaceHeld, setSwatchOpen, matchKey,
    viewportRef, panCameraRef, labelRef, docRef, selectedRef, historyRef, cardsById, selectedItems,
    single, arrowsSelected, setItems, applyHistory, addItem, removeSelected, duplicateSelected,
    toggleLock, placeDerived, runImageOp, openCard, placeImageFiles
  } = wallDocument
  const {
    fitToContent
  } = wallPointer
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
  }, [setSpaceHeld])

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
  }, [applyHistory, docRef, duplicateSelected, historyRef, matchKey, removeSelected, selectedRef, setArrowDrag, setArrowFrom, setBgOpen, setEditingId, setItems, setMenu, setPicker, setRenaming, setSelectedIds, setShortcutsOpen, setTool, setWallMenuOpen])

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
  const menuEntries = (): MenuEntry[] => wallMenuEntries({
    menu, doc, docRef, selectedIds, setSelectedIds, setItems, addItem, openCard,
    duplicateSelected, toggleLock, removeSelected, fitToContent, runImageOp, placeDerived, toast
  })

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
  useEffect(() => { setSwatchOpen(false) }, [selectedIds, setSwatchOpen])

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
