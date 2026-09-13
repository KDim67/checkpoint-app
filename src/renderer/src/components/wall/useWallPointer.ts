import React, { useCallback, useLayoutEffect } from 'react'
import { bringToFront, fitCamera, itemsInRect, moveItems, patchItems, rectFromPoints, cameraCentredOn, toWallPoint, zoomAt, withFrameContents, arrowGeometry, arrowAnchors, distanceToPolyline, inkFromPath, SMOOTHING_STRENGTH, ARROW_SHAPES, ARROW_LINES, ARROW_HEAD_MODES, type WallCamera, type WallItem } from '../../../../shared/wallModel'
import { arrowDropTarget, arrowEndTarget, arrowRelease, isStrokeJitter, pressSelection, recordsHistory, resizedSize, rotationAngle, rotationStart, snapMoving } from '../../../../shared/wallPointer'
import { pushHistory } from '../../../../shared/history'
import { exportWallToPng } from '../../lib/wallExport'
import { errorMessage } from '../../../../shared/errors'
import * as appApi from '../../data/app'
import { paintWallCamera, paintWallItems, paintWallSelection } from './wallPaint'
import type { WallDocument } from './useWallDocument'

/** How far a press may travel and still count as a click rather than a drag. */
const CLICK_SLOP = 4

/** How long the wheel has to be still before the zoom it drew becomes state. */
const ZOOM_SETTLE_MS = 150

/**
 * The camera and every pointer gesture: panning, zooming, selecting, moving,
 * resizing, rotating, drawing and connecting. Drags paint the DOM directly
 * between renders, which is why so much of this is refs.
 */
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
  }, [docRef, setCamera, setSelectedIds, viewportRef])

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
  }, [docRef, setBusy, toast, labelRef, activeWorkspace, activeWall?.name])

  const fitToContent = useCallback(() => {
    const rect = viewportRef.current?.getBoundingClientRect()
    if (!rect) return
    setCamera(fitCamera(docRef.current.items, { width: rect.width, height: rect.height }))
  }, [docRef, setCamera, viewportRef])

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
