import React, { useCallback, useLayoutEffect } from 'react'
import { boundsOf, bringToFront, fitCamera, itemsInRect, moveItems, patchItems, rectFromPoints, cameraCentredOn, toWallPoint, zoomAt, withFrameContents, arrowGeometry, arrowAnchors, distanceToPolyline, inkFromPath, SMOOTHING_STRENGTH, ARROW_SHAPES, ARROW_LINES, ARROW_HEAD_MODES, type Point, type Rect, type WallCamera, type WallItem } from '../../../../shared/wallModel'
import { arrowDropTarget, arrowEndTarget, arrowRelease, isStrokeJitter, pressSelection, recordsHistory, resizedSize, rotationAngle, rotationStart, snapMoving, type WallDrag } from '../../../../shared/wallPointer'
import { pushHistory, replacePresent } from '../../../../shared/history'
import { clipSelection, placeClip } from '../../../../shared/wallClipboard'
import { canvasToJpeg, exportWallToPng, imageDataUris, renderWallCanvas, textMeasurer, type ExportContext } from '../../lib/wallExport'
import { wallToSvg } from '../../lib/wallSvg'
import { buildPdf, type PdfPage, type PdfText } from '../../lib/pdfImages'
import { itemLink } from '../../../../shared/wallLink'
import { SIDES } from '../../../../shared/wallGrow'
import { alignGuides, GUIDE_SNAP_PX, type GapMark, type Guide } from '../../../../shared/wallAlign'
import { groupOf, withGroups } from '../../../../shared/wallGroup'
import { eraseAlong, eraseParts, joinStrokes, lassoPick, HIGHLIGHT_SCALE } from '../../../../shared/wallInk'
import { wallToCsv } from '../../lib/wallCsv'
import { nextZoom, zoomToward } from '../../../../shared/wallZoom'
import { frameContents, framesInOrder } from '../../../../shared/wallFrames'
import { ERASER_RADIUS } from './wallTools'
import { errorMessage } from '../../../../shared/errors'
import * as appApi from '../../data/app'
import { paintWallCamera, paintWallGaps, paintWallGuides, paintWallItems, paintWallSelection } from './wallPaint'
import type { WallDocument } from './useWallDocument'

/** travel still counted as a click */
const CLICK_SLOP = 4

/** wheel idle time before zoom becomes state */
const ZOOM_SETTLE_MS = 150

export type WallExport = { kind: 'png' | 'selection' | 'svg' | 'pdf' | 'csv' } | { kind: 'frame'; frame: WallItem }

type EraseDrag = Extract<WallDrag, { mode: 'erase' }>

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
    addItem, linkPickFor, setLinkPickFor, followLink, setItemLink, pointerRef, growFrom, eraserMode, stepWith
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

  /** colours from the live theme, so the export looks like the wall on screen */
  const exportContext = useCallback((): ExportContext => {
    const style = getComputedStyle(document.documentElement)
    const wallBackground = docRef.current.background
    return {
      titleOf: labelRef.current,
      background: wallBackground !== 'default'
        ? wallBackground
        : style.getPropertyValue('--color-background').trim() || '#0b0c10',
      textColor: style.getPropertyValue('--color-text-base').trim() || '#ffffff',
      surfaceColor: style.getPropertyValue('--color-surface-1').trim() || '#131622',
      borderColor: style.getPropertyValue('--color-surface-offset').trim() || '#24293f'
    }
  }, [docRef, labelRef])

  const exportWall = useCallback(async (choice: WallExport) => {
    const all = docRef.current.items
    const items = choice.kind === 'frame'
      ? frameContents(all, choice.frame)
      : choice.kind === 'selection' ? clipSelection(all, selectedRef.current)?.items ?? [] : all
    if (items.length === 0) {
      toast(choice.kind === 'selection' ? 'Select something to export first.' : 'Nothing on this wall to export yet.')
      return
    }

    const base = `${activeWorkspace}-${activeWall?.name ?? 'wall'}`
    const save = async (name: string, data: ArrayBuffer, extension: string): Promise<void> => {
      if (await appApi.saveBinaryFile(`${name}.${extension}`.replace(/[^\w.-]+/g, '-'), data, extension)) toast('Exported.')
    }

    setBusy('Rendering')
    try {
      const context = exportContext()

      if (choice.kind === 'csv') {
        // the byte order mark tells a spreadsheet the file is UTF-8
        await save(base, new TextEncoder().encode(`﻿${wallToCsv(items, context.titleOf)}`).buffer as ArrayBuffer, 'csv')
        return
      }

      if (choice.kind === 'svg') {
        const images = await imageDataUris(items)
        const svg = wallToSvg(items, { ...context, measure: textMeasurer(), imageData: ref => images.get(ref) })
        if (svg) await save(base, new TextEncoder().encode(svg).buffer as ArrayBuffer, 'svg')
        return
      }

      if (choice.kind === 'pdf') {
        // a page a frame in reading order, or the whole wall on one
        const frames = framesInOrder(items, docRef.current.frameOrder)
        const pageSets = frames.length > 0 ? frames.map(frame => frameContents(items, frame)) : [items]
        const pages: PdfPage[] = []
        for (const set of pageSets) {
          const texts: PdfText[] = []
          const canvas = await renderWallCanvas(set, context, texts)
          const jpeg = canvas ? await canvasToJpeg(canvas) : null
          if (canvas && jpeg) pages.push({ jpeg, width: canvas.width, height: canvas.height, texts })
        }
        if (pages.length === 0) {
          toast('Could not render the wall.', { type: 'error' })
          return
        }
        const pdf = buildPdf(pages)
        await save(base, pdf.buffer.slice(pdf.byteOffset, pdf.byteOffset + pdf.byteLength) as ArrayBuffer, 'pdf')
        return
      }

      const png = await exportWallToPng(items, context)
      if (!png) {
        toast('Could not render the wall.', { type: 'error' })
        return
      }
      const suffix = choice.kind === 'selection' ? '-selection' : choice.kind === 'frame' ? `-${choice.frame.text?.trim() || 'frame'}` : ''
      await save(`${base}${suffix}`, await png.arrayBuffer(), 'png')
    } catch (err) {
      toast(`Export failed: ${errorMessage(err)}`, { type: 'error' })
    } finally {
      setBusy(null)
    }
  }, [docRef, selectedRef, toast, setBusy, exportContext, activeWorkspace, activeWall?.name])

  const viewportSize = useCallback((): { width: number; height: number } | null => {
    const rect = viewportRef.current?.getBoundingClientRect()
    return rect ? { width: rect.width, height: rect.height } : null
  }, [viewportRef])

  /** a level up or down, around the middle of the view */
  const zoomBy = useCallback((direction: 1 | -1) => {
    const size = viewportSize()
    if (!size) return
    const camera = panCameraRef.current ?? docRef.current.camera
    setCamera(zoomToward(camera, size, nextZoom(camera.zoom, direction)))
  }, [docRef, panCameraRef, setCamera, viewportSize])

  const zoomReset = useCallback(() => {
    const size = viewportSize()
    if (size) setCamera(zoomToward(panCameraRef.current ?? docRef.current.camera, size, 1))
  }, [docRef, panCameraRef, setCamera, viewportSize])

  const zoomToSelection = useCallback(() => {
    const size = viewportSize()
    const chosen = docRef.current.items.filter(i => selectedRef.current.has(i.id))
    if (size && chosen.length > 0) setCamera(fitCamera(chosen, size))
  }, [docRef, selectedRef, setCamera, viewportSize])

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

    // a link chip is a button, capture would swallow its click
    if (target.closest('[data-wall-link]')) return

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

    const pressedItem = itemEl ? docRef.current.items.find(i => i.id === itemEl.dataset.wallItem) : undefined

    // Pick an item: this press names the target, a press anywhere else calls it off
    if (linkPickFor && e.button === 0) {
      setLinkPickFor(null)
      if (pressedItem && pressedItem.id === linkPickFor) {
        toast('An item can\'t link to itself. Pick a different one.')
      } else if (pressedItem && activeWall) {
        setItemLink(linkPickFor, itemLink(activeWall.id, pressedItem.id))
        toast(`Linked to ${labelRef.current(pressedItem)?.trim() || 'that item'}.`)
      }
      return
    }

    // ctrl or cmd follows a link; an address in the text wins over the item's own
    if ((e.ctrlKey || e.metaKey) && e.button === 0 && tool === 'select') {
      const linked = target.closest<HTMLElement>('[data-wall-url]')?.dataset.wallUrl ?? pressedItem?.link
      if (linked) { followLink(linked); return }
    }

    // connect handles sit on items, check first; same drag as the arrow tool
    const connectHandle = target.closest<HTMLElement>('[data-wall-connect]')
    if (connectHandle && e.button === 0) {
      const fromId = connectHandle.dataset.wallConnect
      if (fromId) {
        const side = SIDES.find(s => s === connectHandle.dataset.wallSide)
        dragRef.current = {
          mode: 'arrow', fromId,
          startX: e.clientX, startY: e.clientY, moved: false, overId: null, viaHandle: true, side
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

    // the pen family owns the gesture over items too; the move branch used to win
    if ((tool === 'pen' || tool === 'highlighter' || tool === 'lasso') && e.button === 0) {
      dragRef.current = { mode: 'draw' }
      setDrawing([toWallPoint(screenPoint(e), docRef.current.camera)])
      return
    }

    if (tool === 'eraser' && e.button === 0) {
      const at = toWallPoint(screenPoint(e), docRef.current.camera)
      const items = docRef.current.items
      const erasing: EraseDrag = { mode: 'erase', last: at, items, before: items, removed: [], cut: false }
      dragRef.current = erasing
      eraseTo(erasing, at, docRef.current.camera.zoom)
      return
    }

    if (id && item && e.button === 0) {
      if (item.locked) { setSelectedIds(new Set()); return }
      const members = groupOf(docRef.current.items, id)
      const selected = selectedRef.current
      const next = pressSelection(selected, id, e.shiftKey, members)
      // the group is already picked whole, so a click without a drag means this member
      const narrowTo = !e.shiftKey && members.length > 1 && selected.size === members.length && members.every(m => selected.has(m))
        ? id
        : undefined

      // alt drags out a copy and leaves the originals where they are
      const clip = e.altKey && next.has(id) ? clipSelection(docRef.current.items, next) : null
      const bounds = clip ? boundsOf(clip.items) : null
      if (clip && bounds) {
        const before = { items: docRef.current.items, selected: next }
        const copies = placeClip(clip, before.items, { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 })
        const withCopies = [...before.items, ...copies]
        const copyIds = new Set(copies.map(c => c.id))
        setItems(withCopies, { record: false })
        setSelectedIds(copyIds)
        movingRef.current = copyIds
        dragRef.current = { mode: 'move', startX: e.clientX, startY: e.clientY, origin: withCopies, moved: false, before }
        return
      }

      setSelectedIds(next)
      if (!e.shiftKey) setItems(bringToFront(docRef.current.items, id), { record: false })
      movingRef.current = withFrameContents(docRef.current.items, next)
      dragRef.current = { mode: 'move', startX: e.clientX, startY: e.clientY, origin: docRef.current.items, moved: false, narrowTo }
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

  /** a stroke goes the moment it's touched; the drag keeps the wall, so a release before the next render loses none */
  const eraseTo = (drag: EraseDrag, at: Point, zoom: number): void => {
    const radius = ERASER_RADIUS / zoom
    if (eraserMode === 'part') {
      const cut = eraseParts(drag.items, drag.last, at, radius)
      drag.last = at
      if (!cut.touched) return
      drag.items = cut.items
      drag.removed.push(...cut.erased)
      drag.cut = true
      setItems(drag.items, { record: false })
      return
    }

    const hit = new Set(eraseAlong(drag.items, drag.last, at, radius))
    drag.last = at
    if (hit.size === 0) return
    drag.removed.push(...drag.items.filter(i => hit.has(i.id)))
    drag.items = drag.items.filter(i => !hit.has(i.id))
    setItems(drag.items, { record: false })
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

  const paintGuides = (guides: Guide[], zoom: number): void => {
    if (viewportRef.current) paintWallGuides(viewportRef.current, guides, zoom)
  }

  const paintGaps = (gaps: GapMark[], zoom: number): void => {
    if (viewportRef.current) paintWallGaps(viewportRef.current, gaps, zoom)
  }

  /** the part of the wall on screen */
  const viewRect = (cam: WallCamera): Rect | undefined => {
    const rect = viewportRef.current?.getBoundingClientRect()
    return rect
      ? rectFromPoints(toWallPoint({ x: 0, y: 0 }, cam), toWallPoint({ x: rect.width, y: rect.height }, cam))
      : undefined
  }

  // redraw after a mid-move render writes state positions back
  useLayoutEffect(() => {
    if (liveItemsRef.current) paintItems(liveItemsRef.current, movingRef.current)
    // a live sweep wins; diffing against the elements covers added or removed items
    paintSelection(marqueeSelRef.current ?? selectedIds)
  })

  /** bare numbers so a position can be replayed later */
  const applyPointerMove = (e: { clientX: number; clientY: number; shiftKey: boolean; ctrlKey: boolean }) => {
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

    if (drag.mode === 'erase') {
      eraseTo(drag, toWallPoint(screenPoint(e), cam), cam.zoom)
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
      // touching one member sweeps up its group
      const next = withGroups(docRef.current.items, new Set([...drag.base, ...hit]))
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
      // the grid wins when it's on, and Ctrl moves freely
      const guided = snapping || e.ctrlKey ? null : alignGuides(moved, moving, GUIDE_SNAP_PX / cam.zoom, viewRect(cam))
      const live = guided && (guided.dx || guided.dy)
        ? moveItems(moved, moving, guided.dx, guided.dy)
        : snapMoving(moved, moving, snapping)
      // drawn by hand, committed on release like a pan
      liveItemsRef.current = live
      paintItems(live, moving)
      paintGuides(guided?.guides ?? [], cam.zoom)
      paintGaps(guided?.gaps ?? [], cam.zoom)
    } else {
      const size = resizedSize(drag.w, drag.h, dx, dy, snapping)
      setItems(
        docRef.current.items.map(i =>
          // a text box's height follows its words, the drag only sets how wide they run
          i.id === drag.id ? { ...i, ...(i.kind === 'text' ? { width: size.width } : size) } : i
        ),
        { record: false }
      )
    }
  }

  /** keep only the newest position for the frame */
  const onPointerMove = (e: React.PointerEvent) => {
    // a paste lands under the pointer
    pointerRef.current = { clientX: e.clientX, clientY: e.clientY }
    // tracked here: a menu-only button starts no drag and would open on a long sweep
    const press = rightPressRef.current
    if (press && !press.moved &&
      Math.hypot(e.clientX - press.clientX, e.clientY - press.clientY) > CLICK_SLOP) {
      press.moved = true
    }
    if (!dragRef.current) return
    pendingMoveRef.current = { clientX: e.clientX, clientY: e.clientY, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey || e.metaKey }
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
    paintGuides([], 1)
    paintGaps([], 1)

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
      // joined in the style the next dragged arrow would have
      if (release.grow && drag.side) {
        growFrom(drag.fromId, drag.side, style)
        return
      }
      if (release.draw) {
        addItem('arrow', release.draw.to !== null
          ? { from: release.draw.from, to: release.draw.to, ...style }
          : { from: release.draw.from, toPoint: toWallPoint(screenPoint(e), docRef.current.camera), ...style })
      }
      if (release.armed !== undefined) setArrowFrom(release.armed)
      if (release.handBack) setTool('select')
      return
    }

    if (drag?.mode === 'erase') {
      if (drag.removed.length > 0 || drag.cut) {
        // the whole sweep is one undo step and one bin entry; the cuts a sweep along a line made are one stroke again
        const removed = drag.cut ? joinStrokes(drag.removed) : drag.removed
        setItems(drag.items, { record: false, ...(removed.length > 0 ? { removed } : {}) })
        historyRef.current = pushHistory(replacePresent(historyRef.current, stepWith(drag.before)), stepWith(drag.items))
        setHistoryTick(t => t + 1)
      }
      return
    }

    if (drag?.mode === 'draw') {
      const path = drawing
      setDrawing(null)

      if (tool === 'lasso') {
        const items = docRef.current.items
        const picked = path ? withGroups(items, new Set(lassoPick(items, path))) : new Set<string>()
        setSelectedIds(picked)
        // what was caught moves with the select tool
        if (picked.size > 0) setTool('select')
        return
      }

      const highlight = tool === 'highlighter'
      const ink = path && inkFromPath(path, docRef.current.items, {
        color: penColor,
        strokeWidth: highlight ? penWidth * HIGHLIGHT_SCALE : penWidth,
        ...(highlight ? { highlight: true } : {}),
        ...(smoothing ? { smooth: SMOOTHING_STRENGTH } : {})
      })
      if (ink) {
        setItems([...docRef.current.items, ink])
        setSelectedIds(new Set())
      }
      return
    }

    const hover = railHoverRef.current
    railHoverRef.current = { overRail: false, columnId: null }
    setDropColumnId(null)

    // items released over the rail go back, or they park behind it; alt copies just go
    if (drag?.mode === 'move' && hover.overRail) {
      if (drag.before) {
        setItems(drag.before.items, { record: false })
        setSelectedIds(drag.before.selected)
        return
      }
      setItems(drag.origin, { record: false })
      if (hover.columnId) void handOffToColumn(hover.columnId)
      return
    }

    // an alt press that never moved made copies nobody asked for
    if (drag?.mode === 'move' && drag.before && !drag.moved) {
      setItems(drag.before.items, { record: false })
      setSelectedIds(drag.before.selected)
      return
    }

    if (drag?.mode === 'move' && !drag.moved && drag.narrowTo) {
      setSelectedIds(new Set([drag.narrowTo]))
      return
    }

    // one undo step per gesture, unmoved moves skip it
    if (recordsHistory(drag)) {
      // an alt-drag undoes to before the copies, not to copies stacked on the originals
      const base = drag?.mode === 'move' && drag.before
        ? replacePresent(historyRef.current, stepWith(drag.before.items))
        : historyRef.current
      historyRef.current = pushHistory(base, stepWith(movedItems ?? docRef.current.items))
      setHistoryTick(t => t + 1)
    }
  }


  /** off the wall, a paste goes to the middle of the view */
  const onPointerLeave = (): void => {
    pointerRef.current = null
  }

  return {
    screenPoint,
    onWheel,
    onPointerLeave,
    jumpTo,
    exportWall,
    zoomBy,
    zoomReset,
    zoomToSelection,
    fitToContent,
    arrowAt,
    onPointerDown,
    onPointerMove,
    endDrag
  }
}

export type WallPointer = ReturnType<typeof useWallPointer>
