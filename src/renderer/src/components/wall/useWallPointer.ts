import React, { useCallback, useLayoutEffect } from 'react'
import { bringToFront, fitCamera, itemsInRect, moveItems, patchItems, rectFromPoints, cameraCentredOn, toWallPoint, zoomAt, withFrameContents, arrowGeometry, arrowAnchors, distanceToPolyline, inkFromPath, SMOOTHING_STRENGTH, ARROW_SHAPES, ARROW_LINES, ARROW_HEAD_MODES, type WallCamera, type WallItem } from '../../../../shared/wallModel'
import { arrowDropTarget, arrowEndTarget, arrowRelease, isStrokeJitter, pressSelection, recordsHistory, resizedSize, rotationAngle, rotationStart, snapMoving } from '../../../../shared/wallPointer'
import { pushHistory } from '../../../../shared/history'
import { exportWallToPng } from '../../lib/wallExport'
import { errorMessage } from '../../../../shared/errors'
import * as appApi from '../../data/app'
import { paintWallCamera, paintWallItems, paintWallSelection } from './wallPaint'
import type { WallDocument } from './useWallDocument'

/** travel still counted as a click */
const CLICK_SLOP = 4

/** wheel idle time before zoom becomes state */
const ZOOM_SETTLE_MS = 150

/** drags paint the DOM between renders, hence the refs */
export function useWallPointer(wallDocument: WallDocument) {
  const {
    activeWorkspace, toast, selectedIds, setSelectedIds, setEditingId, setMenu, snapping, tool,
    setTool, penColor, penWidth, smoothing, drawing, setDrawing, arrowFrom, setArrowFrom,
    setArrowDrag, setArrowEndHover, arrowShape, arrowLine, arrowHeads, setMarquee, setBusy,
    setHistoryTick, railOpen, setDropColumnId, spaceHeld, panButtons, menuButton, viewportRef,
    dragRef, pendingMoveRef, moveFrameRef, panCameraRef, zoomCommitRef, liveItemsRef, marqueeRectRef,
    marqueeSelRef, paintedSelRef, movingRef, rightPressRef, railHoverRef, labelRef, docRef,
    selectedRef, historyRef, itemsById, single, activeWall, handOffToColumn, setItems, setCamera,
    addItem
  } = wallDocument
  const screenPoint = (e: { clientX: number; clientY: number }): { x: number; y: number } => {
    const rect = viewportRef.current?.getBoundingClientRect()
    return rect ? { x: e.clientX - rect.left, y: e.clientY - rect.top } : { x: 0, y: 0 }
  }

  const onWheel = (e: React.WheelEvent) => {
    const rect = viewportRef.current?.getBoundingClientRect()
    if (!rect) return
    // drawn by hand from the live camera; per-notch state writes re-rendered everything and dropped notches
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
      // an ended drag already committed it
      if (panCameraRef.current) setCamera(panCameraRef.current)
    }, ZOOM_SETTLE_MS)
  }

  /** centres without zooming, selects to highlight */
  const jumpTo = useCallback((item: WallItem) => {
    const rect = viewportRef.current?.getBoundingClientRect()
    if (!rect) return
    setCamera(cameraCentredOn(item, { width: rect.width, height: rect.height }, docRef.current.camera.zoom))
    setSelectedIds(new Set([item.id]))
  }, [docRef, setCamera, setSelectedIds, viewportRef])

  const exportPng = useCallback(async () => {
    const items = docRef.current.items
    if (items.length === 0) { toast('Nothing on this wall to export yet.'); return }
    const wallBackground = docRef.current.background
    setBusy('Rendering')
    try {
      // colours from the live theme so the export matches
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
  }, [docRef, setBusy, toast, labelRef, activeWorkspace, activeWall?.name])

  const fitToContent = useCallback(() => {
    const rect = viewportRef.current?.getBoundingClientRect()
    if (!rect) return
    setCamera(fitCamera(docRef.current.items, { width: rect.width, height: rect.height }))
  }, [docRef, setCamera, viewportRef])

  /** if the click was near enough */
  const arrowAt = (at: { x: number; y: number }): WallItem | null => {
    const slack = 8 / docRef.current.camera.zoom
    for (const arrow of docRef.current.items.filter(i => i.kind === 'arrow')) {
      const ends = arrowAnchors(arrow, itemsById)
      if (!ends) continue
      const { from, to } = ends
      if (!from || !to) continue
      // same points the renderer draws, so curves hit where they look
      const { polyline } = arrowGeometry(from, to, arrow.arrowShape ?? ARROW_SHAPES[0])
      if (distanceToPolyline(at, polyline) <= slack + (arrow.strokeWidth ?? 2)) return arrow
    }
    return null
  }

  const onPointerDown = (e: React.PointerEvent) => {
    setMenu(null)
    const target = e.target as HTMLElement

    // a text field owns its press; capture would starve the textarea
    if (target.closest('input, textarea, [contenteditable="true"]')) return

    // floating panels are children; capture used to steal their clicks
    if (target.closest('[data-wall-ui]')) return

    const handle = target.closest<HTMLElement>('[data-wall-handle]')
    const itemEl = target.closest<HTMLElement>('[data-wall-item]')
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)

    // a right press can't know menu vs pan until release; panning can move to middle
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
        // stop chromium's middle-click autoscroll
        e.preventDefault()
      }
      if (pans) {
        dragRef.current = { mode: 'pan', startX: e.clientX, startY: e.clientY, camX: cam.x, camY: cam.y }
      }
      return
    }

    // space turns left into pan before anything claims the press
    if (spaceHeld && e.button === 0) {
      const cam = panCameraRef.current ?? docRef.current.camera
      dragRef.current = { mode: 'pan', startX: e.clientX, startY: e.clientY, camX: cam.x, camY: cam.y }
      return
    }

    // connect handles sit on items, check first; same drag as the arrow tool
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

    // end handles sit over their item, grab them first
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

    // drag to connect; a still press picks two items, easier when they nearly touch
    if (tool === 'arrow' && e.button === 0) {
      if (!item || item.kind === 'arrow') { setArrowFrom(null); return }
      dragRef.current = {
        mode: 'arrow', fromId: item.id,
        startX: e.clientX, startY: e.clientY, moved: false, overId: null
      }
      setArrowDrag({ fromId: item.id, at: toWallPoint(screenPoint(e), docRef.current.camera), overId: null })
      return
    }

    // the pen owns the gesture over items too; the move branch used to win
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

    // before the marquee, or a click near a line reads as empty canvas
    const arrow = arrowAt(toWallPoint(screenPoint(e), docRef.current.camera))
    if (arrow && e.button === 0) {
      setSelectedIds(new Set([arrow.id]))
      return
    }

    // shift adds to the selection
    if (!e.shiftKey) setSelectedIds(new Set())
    setEditingId(null)

    const p = screenPoint(e)
    // union against the start selection, or caught items can't be released
    const base = e.shiftKey ? new Set(selectedRef.current) : new Set<string>()
    dragRef.current = { mode: 'marquee', startX: p.x, startY: p.y, base }
    // so the first sweep frame knows its start
    setMarquee({ x: p.x, y: p.y, width: 0, height: 0 })
  }

  const paintCamera = (cam: WallCamera): void => {
    if (viewportRef.current) paintWallCamera(viewportRef.current, cam)
  }

  const paintSelection = (next: Set<string>, all = false): void => {
    const viewport = viewportRef.current
    if (!viewport) return
    paintedSelRef.current = paintWallSelection(viewport, paintedSelRef.current, docRef.current.items, next, all)
  }

  const paintItems = (items: WallItem[], ids: Set<string>): void => {
    if (viewportRef.current) paintWallItems(viewportRef.current, items, ids)
  }

  // redraw after a mid-move render writes state positions back
  useLayoutEffect(() => {
    if (liveItemsRef.current) paintItems(liveItemsRef.current, movingRef.current)
    // a live sweep wins; diffing against the elements covers added or removed items
    paintSelection(marqueeSelRef.current ?? selectedIds)
  })

  /** bare numbers so a position can be replayed later */
  const applyPointerMove = (e: { clientX: number; clientY: number; shiftKey: boolean }) => {
    const drag = dragRef.current
    if (!drag) return
    // live camera, a recent zoom may not be state yet
    const cam = panCameraRef.current ?? docRef.current.camera

    if (drag.mode === 'pan') {
      // painted here, committed on release; zoom can't change mid-pan
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
      // recorded once at drag end
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
      // drop near-duplicate points, every point is persisted
      setDrawing(path => {
        if (!path) return path
        const last = path[path.length - 1]
        return isStrokeJitter(last, at, cam.zoom) ? path : [...path, at]
      })
      return
    }

    if (drag.mode === 'marquee') {
      const p = screenPoint(e)
      // drawn by hand, state re-rendered the wall per frame
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
      // committed on release; state re-rendered outlines of every crossed item
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
      // still a click until it travels, a 1px shift mustn't nudge and spend undo
      if (!drag.moved && Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < CLICK_SLOP) return
      drag.moved = true

      // against the document, capture keeps sending events over the rail
      const under = railOpen ? document.elementFromPoint(e.clientX, e.clientY) : null
      const columnId = under?.closest<HTMLElement>('[data-wall-column]')?.dataset.wallColumn ?? null
      const overRail = !!under?.closest('[data-wall-rail]')
      railHoverRef.current = { overRail, columnId }
      // unconditional, React drops same-value writes
      setDropColumnId(columnId)

      const moving = movingRef.current
      const moved = moveItems(drag.origin, moving, dx, dy)
      const live = snapMoving(moved, moving, snapping)
      // drawn by hand, committed on release like a pan
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

  /** keep only the newest position for the frame */
  const onPointerMove = (e: React.PointerEvent) => {
    // tracked here: a menu-only button starts no drag and would open on a long sweep
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
      // the drag can end before the frame
      if (next && dragRef.current) applyPointerMove(next)
    })
  }

  const endDrag = (e: React.PointerEvent) => {
    // flush the pending frame or the drop lands 16ms behind
    if (moveFrameRef.current !== null) {
      cancelAnimationFrame(moveFrameRef.current)
      moveFrameRef.current = null
      const pending = pendingMoveRef.current
      if (pending && dragRef.current) applyPointerMove(pending)
    }
    pendingMoveRef.current = null

    // the hand-drawn pan becomes state here
    if (panCameraRef.current) {
      const settled = panCameraRef.current
      panCameraRef.current = null
      setCamera(settled)
    }
    // through setItems so history sees a replaced present before the push
    const movedItems = liveItemsRef.current
    liveItemsRef.current = null
    if (movedItems) setItems(movedItems, { record: false })

    setArrowEndHover(null)
    const drag = dragRef.current
    dragRef.current = null
    // an unmoved sweep committed nothing
    const swept = marqueeSelRef.current
    marqueeSelRef.current = null
    if (swept) setSelectedIds(swept)

    marqueeRectRef.current = null
    setMarquee(null)
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId) } catch { /* already released */ }

    // a right press that went nowhere opens a menu
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

    // items released over the rail go back, or they park behind it
    if (drag?.mode === 'move' && hover.overRail) {
      setItems(drag.origin, { record: false })
      if (hover.columnId) void handOffToColumn(hover.columnId)
      return
    }

    // one undo step per gesture, unmoved moves skip it
    if (recordsHistory(drag)) {
      historyRef.current = pushHistory(historyRef.current, movedItems ?? docRef.current.items)
      setHistoryTick(t => t + 1)
    }
  }


  return {
    screenPoint,
    onWheel,
    jumpTo,
    exportPng,
    fitToContent,
    arrowAt,
    onPointerDown,
    onPointerMove,
    endDrag
  }
}

export type WallPointer = ReturnType<typeof useWallPointer>
