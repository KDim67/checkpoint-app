import React, { useEffect, useState, useRef } from 'react'
import { inPaintOrder, patchItems, itemAtPoint, gridSpacing, toWallPoint, arrowGeometry, arrowAnchors, arrowDash, arrowHeadPoints, arrowHeadInset, ARROW_SHAPES, ARROW_LINES, ARROW_HEAD_MODES, setActiveWall, type WallItem } from '../../../../shared/wallModel'
import { pressSelection } from '../../../../shared/wallPointer'
import WallItemLayer from './WallItemLayer'
import WallMinimap from './WallMinimap'
import { decodeWallDrag, WALL_DRAG_MIME } from '../../../../shared/wallBoard'
import WallSelectionBar from './WallSelectionBar'
import { isWritable } from '../../../../shared/wallShape'
import { WALL_GAP_SLOTS, WALL_GUIDE_SLOTS, paintWallItems } from './wallPaint'
import WallPresenter from './WallPresenter'
import { frameLabel } from '../../../../shared/wallFrames'
import { HIGHLIGHT_OPACITY, HIGHLIGHT_SCALE } from '../../../../shared/wallInk'
import WallPenSettings from './WallPenSettings'
import { describeLink, isLinkable, pastedLink } from '../../../../shared/wallLink'
import WallRemotePresence from './WallRemotePresence'
import { useRemotePresence } from './useRemotePresence'
import { peerPresenceColor, type PeerLiveMoveMessage } from '../../../../shared/collabProtocol'
import type { WallViewState } from './useWallView'

export default function WallCanvas({ wallView }: { wallView: WallViewState }) {
  const {
    doc, loading, selectedIds, setSelectedIds, editingId,
    setEditingId, picker, setPicker, tool, penColor, penWidth, smoothing,
    setSmoothing, drawing, arrowFrom, arrowDrag, arrowEndHover, arrowShape, setArrowShape, arrowLine,
    setArrowLine, arrowHeads, setArrowHeads, marquee, busy, spaceHeld, swatchOpen, setSwatchOpen,
    viewportRef, marqueeRectRef, docRef, cardsById, itemsById, notesByTitle, selectedItems, single,
    arrowsSelected, setItems, setCamera, onItemTextChange, onItemFinishEditing, onItemAutoSize, growItemRoom, rememberStickyColor, cropping, applyCrop, addItem,
    removeSelected, duplicateSelected, toggleLock, placeImageFiles, mergeWallItems, screenPoint, onWheel,
    arrowAt, onPointerDown, onPointerMove, onPointerLeave, endDrag, camera, canvasBackground, dotColor, floatingRef,
    floatingPos, linkPickFor, linkOpen, setLinkOpen, setItemLink, startLinkPick, followLink,
    wallIndex, activeWall, labelOf, previewing, addBookmark, growFrom, searching, matchIds, presenting,
    frames, stepPresenting, stopPresenting, setTool, eraserMode, setEraserMode, penPresets, choosePenColor,
    choosePenWidth, pickPreset, isReadOnly, collab, commitIndex, panCameraRef, tagColors, tagNames,
    tagSelection, untagSelection, gatherTags, addMapTopic, openItem, announcement, alignOpen, setAlignOpen,
    setCropping, turnSelection
  } = wallView

  const myName = collab?.displayName || collab?.osUserName || 'Anonymous'
  const {
    cursors: remoteCursors,
    peerSelectedMap,
    followingPeer,
    followingPeerId,
    stopFollowing,
    broadcastCursor,
    broadcastSelection
  } = useRemotePresence({
    wallId: activeWall?.id ?? 'default',
    myName,
    viewportRef,
    camera,
    setCamera,
    panCameraRef,
    onSwitchWall: (targetWallId: string) => {
      if (wallIndex) {
        commitIndex(setActiveWall(wallIndex, targetWallId))
      }
    }
  })

  const [laserPoints, setLaserPoints] = useState<{ x: number; y: number; time: number }[]>([])
  const laserPointsRef = useRef<{ x: number; y: number; time: number }[]>([])
  const [laserTip, setLaserTip] = useState<{ x: number; y: number } | null>(null)

  useEffect(() => {
    if (tool !== 'laser') {
      setLaserTip(null)
    }
  }, [tool])

  const hasLaserPoints = laserPoints.length > 0
  useEffect(() => {
    if (!hasLaserPoints) return
    const timer = setInterval(() => {
      const now = Date.now()
      const filtered = laserPointsRef.current.filter(p => now - p.time < 1100)
      if (filtered.length !== laserPointsRef.current.length) {
        laserPointsRef.current = filtered
        setLaserPoints(filtered)
      }
    }, 40)
    return () => clearInterval(timer)
  }, [hasLaserPoints])

  useEffect(() => {
    const handleReactionClick = (e: Event) => {
      const detail = (e as CustomEvent<{ itemId: string; emoji: string; delta?: number }>).detail
      if (!detail || !detail.itemId || !detail.emoji) return
      const item = docRef.current.items.find(i => i.id === detail.itemId)
      if (!item) return
      const delta = detail.delta ?? 1
      const currentCount = item.reactions?.[detail.emoji] ?? 0
      const nextCount = Math.max(0, currentCount + delta)
      const nextReactions = { ...(item.reactions ?? {}) }
      if (nextCount > 0) {
        nextReactions[detail.emoji] = nextCount
      } else {
        delete nextReactions[detail.emoji]
      }
      setItems(
        patchItems(docRef.current.items, new Set([item.id]), {
          reactions: Object.keys(nextReactions).length > 0 ? nextReactions : undefined
        })
      )
    }

    window.addEventListener('wall-reaction-click', handleReactionClick)
    return () => window.removeEventListener('wall-reaction-click', handleReactionClick)
  }, [docRef, setItems])

  // Live remote item movement preview
  useEffect(() => {
    const handlePeerLiveMove = (e: Event) => {
      const detail = (e as CustomEvent<PeerLiveMoveMessage>).detail
      if (!detail || !viewportRef.current) return
      if (detail.wallId !== (activeWall?.id ?? 'default')) return

      const viewport = viewportRef.current
      const currentItems = docRef.current.items
      const byId = new Map(currentItems.map(i => [i.id, i]))

      if (detail.items.length === 0) {
        // Gesture ended - clear remote moving attributes and outlines
        viewport.querySelectorAll<HTMLElement>('[data-wall-peer-moving]').forEach(el => {
          el.removeAttribute('data-wall-peer-moving')
          el.style.outline = ''
        })
        return
      }

      const movedItems: WallItem[] = []
      const movedIds = new Set<string>()

      for (const moved of detail.items) {
        const existing = byId.get(moved.id)
        if (!existing) continue
        const updated = { ...existing, x: moved.x, y: moved.y }
        movedItems.push(updated)
        movedIds.add(moved.id)

        const el = viewport.querySelector<HTMLElement>(`[data-wall-item="${moved.id}"]`)
        if (el) {
          el.setAttribute('data-wall-peer-moving', detail.name || detail.peerId)
          el.style.outline = `2px dashed ${detail.color || peerPresenceColor(detail.peerId)}`
        }
      }

      if (movedItems.length > 0) {
        paintWallItems(viewport, movedItems, movedIds)
      }
    }

    window.addEventListener('collab-peer-live-move', handlePeerLiveMove)
    return () => window.removeEventListener('collab-peer-live-move', handlePeerLiveMove)
  }, [activeWall?.id, docRef, viewportRef])

  useEffect(() => {
    broadcastSelection(Array.from(selectedIds))
  }, [selectedIds, broadcastSelection])

  /** the chip's words, from this wall's items and the wall list */
  const describe = (link: string) => describeLink(link, {
    activeWallId: activeWall?.id ?? '',
    wallName: id => wallIndex?.walls.find(w => w.id === id)?.name,
    itemLabel: id => {
      const target = itemsById.get(id)
      return target ? labelOf(target) : undefined
    },
    itemExists: id => itemsById.has(id)
  })

  const renderArrow = (arrow: WallItem) => {
    const ends = arrowAnchors(arrow, itemsById)
    if (!ends) return null

    const width = arrow.strokeWidth ?? 2
    const stroke = arrow.color || 'var(--color-text-muted)'
    const selected = selectedIds.has(arrow.id)
    const heads = arrow.arrowHeads ?? ARROW_HEAD_MODES[0]
    const inset = arrowHeadInset(width)
    const g = arrowGeometry(ends.from, ends.to, arrow.arrowShape ?? ARROW_SHAPES[0], {
      end: heads !== 'none' ? inset : 0,
      start: heads === 'both' ? inset : 0
    })

    return (
      <g
        key={arrow.id}
        data-wall-arrow={arrow.id}
        data-wall-item={arrow.id}
        opacity={searching ? 0.2 : selected ? 1 : 0.85}
        style={{ cursor: 'pointer' }}
      >
        {/* Invisible fat hit target for reliable clicking and hover */}
        <path
          d={g.d}
          fill="none"
          stroke="transparent"
          strokeWidth={Math.max(24, width + 16)}
          strokeLinecap="round"
          strokeLinejoin="round"
          data-wall-item={arrow.id}
          style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
        />
        <path
          d={g.d}
          fill="none"
          stroke={selected ? 'var(--color-secondary)' : stroke}
          strokeWidth={width + (selected ? 2 : 0)}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={arrowDash(arrow.arrowLine ?? ARROW_LINES[0], width)}
          data-wall-item={arrow.id}
          style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
        />
        {heads !== 'none' && (
          <polygon
            points={arrowHeadPoints(g.end, g.endAngle, width)}
            fill={selected ? 'var(--color-secondary)' : stroke}
            data-wall-item={arrow.id}
            style={{ pointerEvents: 'all', cursor: 'pointer' }}
          />
        )}
        {heads === 'both' && (
          <polygon
            points={arrowHeadPoints(g.start, g.startAngle, width)}
            fill={selected ? 'var(--color-secondary)' : stroke}
            data-wall-item={arrow.id}
            style={{ pointerEvents: 'all', cursor: 'pointer' }}
          />
        )}
      </g>
    )
  }

  return (
    <div
      ref={viewportRef}
      onWheel={e => {
        if (followingPeerId) stopFollowing()
        onWheel(e)
      }}
      onPointerDown={e => {
        if (followingPeerId) stopFollowing()
        onPointerDown(e)
      }}
      onPointerMove={e => {
        onPointerMove(e)
        const at = toWallPoint(screenPoint(e), docRef.current.camera)
        broadcastCursor(at.x, at.y)
        if (tool === 'laser') {
          const now = Date.now()
          const next = [...laserPointsRef.current.filter(p => now - p.time < 1100), { x: at.x, y: at.y, time: now }]
          laserPointsRef.current = next
          setLaserPoints(next)
          setLaserTip(at)
        }
      }}
      onPointerLeave={onPointerLeave}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      // the menu opens on release, the only place a click differs from a pan
      onContextMenu={e => e.preventDefault()}
      // by coordinate: pointer capture retargets dblclick to the viewport
      onDoubleClick={e => {
        // double-clicking a word in an edited note selects it
        if ((e.target as HTMLElement).closest('input, textarea, [contenteditable="true"]')) return

        // panels are canvas children; without this a palette dblclick made a note
        if ((e.target as HTMLElement).closest('[data-wall-ui], [data-wall-link]')) return
        const targetEl = (e.target as Element).closest<Element>('[data-wall-item]')
        const targetId = targetEl ? (targetEl.getAttribute('data-wall-item') ?? (targetEl as HTMLElement).dataset?.wallItem) : undefined
        const targetArrow = targetId ? docRef.current.items.find(i => i.id === targetId && i.kind === 'arrow') : null
        if (targetArrow) {
          setSelectedIds(new Set([targetArrow.id]))
          setEditingId(targetArrow.id)
          return
        }
        const at = toWallPoint(screenPoint(e), docRef.current.camera)
        const hit = itemAtPoint(docRef.current.items, at)
        if (!hit) {
          // connectors have no box, ask first
          const arrow = arrowAt(at)
          if (arrow) { setSelectedIds(new Set([arrow.id])); setEditingId(arrow.id); return }
          addItem('note', {}, at)
          return
        }
        // the same thing Enter does on the selection
        openItem(hit)
      }}
      onDragOver={e => {
        e.preventDefault()
      // copy, the card stays on the board
        if (e.dataTransfer.types.includes(WALL_DRAG_MIME)) e.dataTransfer.dropEffect = 'copy'
      }}
      onDrop={e => {
        e.preventDefault()
        const at = toWallPoint(screenPoint(e), docRef.current.camera)
        const dragged = decodeWallDrag(e.dataTransfer.getData(WALL_DRAG_MIME))
      // at the cursor, the point of dragging
        if (dragged) { addItem(dragged.kind, { ref: dragged.ref }, at); return }

        const files = Array.from(e.dataTransfer.files ?? [])
        const jsonFile = files.find(f => f.name.toLowerCase().endsWith('.json') || f.type === 'application/json')
        if (jsonFile) {
          void jsonFile.text().then(text => {
            mergeWallItems(text, at)
          })
          return
        }
        if (files.some(f => f.type.startsWith('image/'))) { void placeImageFiles(files, at); return }

        const textPlain = e.dataTransfer.getData('text/plain')
        if (textPlain && textPlain.trim().startsWith('{') && (textPlain.includes('"checkpointType"') || textPlain.includes('"items"'))) {
          if (mergeWallItems(textPlain, at)) return
        }

        // a link dragged out of a browser; uri-list lines starting with # are comments
        const uri = e.dataTransfer.getData('text/uri-list').split(/\r?\n/).find(line => line && !line.startsWith('#'))
        const link = pastedLink(uri ?? textPlain)
        if (link && !link.startsWith('wall:')) addBookmark(link, at)
      }}
      style={{
        flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden',
        cursor: spaceHeld ? 'grab' : linkPickFor ? 'alias' : tool === 'arrow' ? 'copy' : tool === 'eraser' ? 'cell' : tool === 'laser' ? 'none' : tool !== 'select' ? 'crosshair' : undefined,
        backgroundColor: canvasBackground,
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
            from the board. Nothing sorts itself. Put things where you want them, and guides
            show up only when one comes close to another.
          </span>
          {/* a new wall is the thing people miss; this is where they are looking */}
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-faint)', maxWidth: '440px', lineHeight: 1.6 }}>
            The name at the top left switches walls, renames this one, or starts another.
          </span>
        </div>
      )}

      {/* 1. Back vector layer: All frames and behind-items arrows in a single viewport-bounded SVG */}
      <svg
        data-wall-vector-svg
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          overflow: 'hidden',
          pointerEvents: 'none',
          zIndex: 1
        }}
      >
        <g
          data-wall-camera-layer
          style={{
            transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`,
            transformOrigin: '0 0'
          }}
        >
          {/* Frame outlines (drawn behind non-frame items) */}
          {doc.items.filter(i => i.kind === 'frame').map(frame => {
            const isSelected = selectedIds.has(frame.id)
            const stroke = frame.color || 'var(--color-surface-elevated)'
            return (
              <g
                key={frame.id}
                data-wall-frame-wrap={frame.id}
                style={{
                  transform: `translate(${frame.x}px, ${frame.y}px)${frame.rotation ? ` rotate(${frame.rotation}deg)` : ''}`,
                  transformOrigin: '0 0'
                }}
              >
                <rect
                  data-wall-item={frame.id}
                  data-wall-frame-rect={frame.id}
                  x={0}
                  y={0}
                  width={frame.width}
                  height={frame.height}
                  rx={8}
                  ry={8}
                  fill="none"
                  stroke={isSelected ? 'var(--color-secondary)' : stroke}
                  strokeWidth={isSelected ? 3 : 2}
                  style={{ pointerEvents: 'stroke', cursor: 'grab' }}
                />
              </g>
            )
          })}

          {/* Arrows behind items */}
          {doc.items.filter(i => i.kind === 'arrow' && i.layer !== 'front').map(renderArrow)}
        </g>
      </svg>

      {/* 2. Interactive HTML Layer for notes, images, cards, inputs */}
      <div data-wall-camera-layer style={{
        position: 'absolute', top: 0, left: 0,
        transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`,
        transformOrigin: '0 0',
        zIndex: 2
      }}>

        {inPaintOrder(doc.items).filter(i => i.kind !== 'arrow').map(item => {
          const isSelected = selectedIds.has(item.id)
          // a bookmark is its own link, a chip would repeat it
          const link = item.link && isLinkable(item.kind) ? describe(item.link) : null
          return (
            <WallItemLayer
              key={item.id}
              item={item}
              card={item.kind === 'card' ? cardsById.get(item.ref ?? '') : undefined}
              note={item.kind === 'doc' ? notesByTitle.get(item.ref ?? '') : undefined}
              editing={editingId === item.id}
              connectable={tool === 'select' && presenting === null && !item.locked && item.kind !== 'frame'}
              showHandles={isSelected && single?.id === item.id && !item.locked}
              arrowTarget={arrowDrag?.overId === item.id || arrowEndHover === item.id}
              arrowFrom={arrowFrom === item.id}
              onTextChange={onItemTextChange}
              onFinishEditing={onItemFinishEditing}
              onAutoSize={onItemAutoSize}
              onGrow={growFrom}
              linkLabel={link?.label}
              linkMissing={link?.missing}
              linkExternal={link?.external}
              onFollowLink={followLink}
              previewing={previewing.has(item.id)}
              dimmed={searching && !matchIds.has(item.id)}
              remoteSelectedBy={peerSelectedMap.get(item.id)}
              tagColors={tagColors}
              onMapTopic={addMapTopic}
              onNeedRoom={growItemRoom}
              cropping={cropping === item.id}
              zoom={cropping === item.id || item.kind === 'image' ? camera.zoom : undefined}
              onCrop={applyCrop}
            />
          )
        })}

        {/* lines a drag snaps to, shown and placed by hand while moving */}
        {WALL_GUIDE_SLOTS.map(slot => (
          <div key={slot} data-wall-guide={slot} className="wall-guide" style={{ display: 'none' }} />
        ))}
        {WALL_GAP_SLOTS.map(slot => (
          <div key={slot} data-wall-gap={slot} className="wall-gap-guide" style={{ display: 'none' }} />
        ))}
      </div>

      {/* 3. Front vector layer: In-front arrows and active gesture/connection previews */}
      <svg
        data-wall-vector-svg-front
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          overflow: 'hidden',
          pointerEvents: 'none',
          zIndex: 3
        }}
      >
        <defs>
          <filter id="wall-laser-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <g
          data-wall-camera-layer
          style={{
            transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`,
            transformOrigin: '0 0'
          }}
        >
          {/* Laser pointer trail */}
          {(laserPoints.length > 0 || (tool === 'laser' && laserTip)) && (() => {
            const now = Date.now()
            const valid = laserPoints.filter(pt => now - pt.time < 1100)
            const tip = laserTip ?? (valid.length > 0 ? valid[valid.length - 1] : null)

            return (
              <g data-wall-laser-trail filter="url(#wall-laser-glow)">
                {valid.slice(1).map((pt, idx) => {
                  const prev = valid[idx]
                  const age = now - pt.time
                  const ratio = Math.max(0, 1 - age / 1100)
                  return (
                    <line
                      key={`${pt.x}-${pt.y}-${idx}`}
                      x1={prev.x}
                      y1={prev.y}
                      x2={pt.x}
                      y2={pt.y}
                      stroke="#ff2a6d"
                      strokeWidth={Math.max(2, 5 * ratio)}
                      strokeLinecap="round"
                      opacity={ratio * 0.9}
                    />
                  )
                })}
                {tip && (
                  <circle
                    cx={tip.x}
                    cy={tip.y}
                    r={Math.max(3.5, 5 / camera.zoom)}
                    fill="#ffffff"
                    stroke="#ff2a6d"
                    strokeWidth={Math.max(1.5, 2.5 / camera.zoom)}
                  />
                )}
              </g>
            )
          })()}

          {/* Arrows in front of items */}
          {doc.items.filter(i => i.kind === 'arrow' && i.layer === 'front').map(renderArrow)}

          {/* arrowDrag preview */}
          {arrowDrag && (() => {
            const from = itemsById.get(arrowDrag.fromId)
            if (!from) return null

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

          {/* drawing preview (pen / highlighter / lasso) */}
          {drawing && drawing.length > 1 && (
            <polyline
              points={drawing.map(pt => `${pt.x},${pt.y}`).join(' ')}
              fill="none"
              stroke={tool === 'lasso' ? 'var(--color-secondary)' : penColor}
              strokeWidth={tool === 'lasso' ? 1.5 / camera.zoom : tool === 'highlighter' ? penWidth * HIGHLIGHT_SCALE : penWidth}
              strokeDasharray={tool === 'lasso' ? `${6 / camera.zoom} ${4 / camera.zoom}` : undefined}
              opacity={tool === 'highlighter' ? HIGHLIGHT_OPACITY : undefined}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
        </g>
      </svg>

      {/* 4. Overlays layer for arrow labels, selection handles, and remote presence */}
      <div data-wall-camera-layer style={{
        position: 'absolute', top: 0, left: 0,
        transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`,
        transformOrigin: '0 0',
        pointerEvents: 'none',
        zIndex: 4
      }}>
        {/* Remote peer cursors layer inside main camera container */}
        <div style={{ position: 'absolute', left: 0, top: 0, width: '1px', height: '1px', zIndex: 20, pointerEvents: 'none' }}>
          <WallRemotePresence cursors={remoteCursors} zoom={camera.zoom} />
        </div>

        {/* labels above lines and items; arrow labels live in text like frames */}
        <div style={{ position: 'absolute', left: 0, top: 0, width: '1px', height: '1px', zIndex: 5, pointerEvents: 'none' }}>
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
                data-wall-item={arrow.id}
                onPointerDown={e => {
                  e.stopPropagation()
                  setSelectedIds(e.shiftKey ? pressSelection(selectedIds, arrow.id, true) : new Set([arrow.id]))
                }}
                onDoubleClick={e => { e.stopPropagation(); setEditingId(arrow.id) }}
                style={{
                  position: 'absolute', left: 0, top: 0,
                  transform: `translate(${mid.x}px, ${mid.y}px) translate(-50%, -50%)`,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 'max-content',
                  minWidth: 'max-content',
                  maxWidth: '320px',
                  padding: '3px 8px',
                  background: 'var(--color-surface-1)',
                  border: `1px solid ${selectedIds.has(arrow.id) ? 'var(--color-secondary)' : 'var(--color-surface-offset)'}`,
                  borderRadius: 'var(--radius-sm)',
                  boxShadow: 'var(--shadow-sm, 0 1px 3px rgba(0,0,0,0.3))',
                  color: 'var(--color-text-base)',
                  fontSize: '12px', lineHeight: 1.35,
                  pointerEvents: 'auto', cursor: 'pointer',
                  userSelect: 'none',
                  boxSizing: 'border-box'
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
                      // an emptied label is removed, not a blank chip
                      setItems(patchItems(docRef.current.items, new Set([arrow.id]), {
                        text: text || undefined
                      }))
                    }}
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLInputElement).blur()
                    }}
                    style={{
                      minWidth: '100px',
                      maxWidth: '300px',
                      background: 'none',
                      border: 'none',
                      outline: 'none',
                      color: 'var(--color-text-base)',
                      font: 'inherit',
                      padding: 0,
                      textAlign: 'center',
                      cursor: 'text'
                    }}
                  />
                ) : (
                  <span style={{
                    wordBreak: 'normal',
                    overflowWrap: 'break-word',
                    whiteSpace: 'pre-wrap',
                    textAlign: 'center',
                    maxWidth: '300px'
                  }}>
                    {arrow.text}
                  </span>
                )}
              </div>
            )
          })}
        </div>

        {/* both ends grabbable, sized against zoom */}
        {single?.kind === 'arrow' && (() => {
          const ends = arrowAnchors(single, itemsById)
          if (!ends) return null

          const heads = single.arrowHeads ?? ARROW_HEAD_MODES[0]
          const g = arrowGeometry(ends.from, ends.to, single.arrowShape ?? ARROW_SHAPES[0])
          const size = 12 / camera.zoom
          const ring = 2 / camera.zoom

          return (
            <div style={{ position: 'absolute', left: 0, top: 0, width: '1px', height: '1px', zIndex: 6, pointerEvents: 'auto' }}>
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
                    // square tail, round head
                    ...(which === 'start' && heads !== 'both' ? { borderRadius: '20%' } : {}),
                    cursor: 'grab'
                  }}
                />
              ))}
            </div>
          )
        })()}
      </div>

      {/* screen space, doesn't scale with the camera */}
      {marquee && (() => {
        // the hand-drawn box is ahead of state, don't shrink it mid-sweep
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

      {/* floated above the selection; words being written in have their own bar */}
      {floatingPos && selectedItems.length > 0 && presenting === null && !isReadOnly && !(editingId !== null && isWritable(itemsById.get(editingId)?.kind ?? '')) && (
        <WallSelectionBar
          floatingPos={floatingPos}
          floatingRef={floatingRef}
          swatchOpen={swatchOpen}
          setSwatchOpen={setSwatchOpen}
          alignOpen={alignOpen}
          setAlignOpen={setAlignOpen}
          onCropImage={setCropping}
          onStickyColor={rememberStickyColor}
          onTurn={turnSelection}
          single={single}
          arrowsSelected={arrowsSelected}
          items={doc.items}
          selectedIds={selectedIds}
          setItems={setItems}
          setEditingId={setEditingId}
          duplicateSelected={duplicateSelected}
          toggleLock={toggleLock}
          removeSelected={removeSelected}
          linkOpen={linkOpen}
          setLinkOpen={setLinkOpen}
          linkLabel={single?.link ? describe(single.link).label : undefined}
          setItemLink={setItemLink}
          startLinkPick={startLinkPick}
          followLink={followLink}
          tagNames={tagNames}
          tagColors={tagColors}
          onAddTag={tagSelection}
          onRemoveTag={untagSelection}
          onGatherTags={gatherTags}
        />
      )}

      {picker && (
        <div onPointerDown={() => setPicker(null)} style={{ position: 'absolute', inset: 0, zIndex: 10 }} />
      )}

      {/* minimap from the fourth item on */}
      {doc.items.length > 3 && presenting === null && (
        <WallMinimap
          items={doc.items}
          selectedIds={selectedIds}
          camera={camera}
          viewportRef={viewportRef}
          docRef={docRef}
          setCamera={setCamera}
        />
      )}

      {tool !== 'select' && presenting === null && (
        <WallPenSettings
          tool={tool}
          setTool={setTool}
          penColor={penColor}
          setPenColor={choosePenColor}
          penWidth={penWidth}
          setPenWidth={choosePenWidth}
          eraserMode={eraserMode}
          setEraserMode={setEraserMode}
          presets={tool === 'pen' || tool === 'highlighter' ? penPresets[tool] : undefined}
          activePreset={tool === 'pen' || tool === 'highlighter' ? penPresets.active[tool] : undefined}
          onPickPreset={pickPreset}
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

      {presenting !== null && frames[presenting] && (
        <WallPresenter
          index={presenting}
          count={frames.length}
          label={frameLabel(frames[presenting], presenting)}
          onStep={stepPresenting}
          onExit={stopPresenting}
        />
      )}

      {followingPeer && (
        <div
          data-wall-following-banner="true"
          style={{
            position: 'absolute',
            top: 'var(--space-4)',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 40,
            background: 'var(--color-surface-elevated)',
            border: '1px solid var(--color-surface-offset)',
            boxShadow: 'var(--shadow-lg)',
            borderRadius: 'var(--radius-full)',
            padding: '6px 14px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '12px',
            color: 'var(--color-text-base)',
            pointerEvents: 'auto',
            animation: 'dropdown-in 150ms var(--ease-enter)'
          }}
        >
          <span
            style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              background: followingPeer.color,
              boxShadow: `0 0 6px ${followingPeer.color}`
            }}
          />
          <span>
            Following <strong>{followingPeer.name}</strong>
          </span>
          <button
            type="button"
            onClick={() => stopFollowing()}
            title="Stop following (Esc)"
            style={{
              background: 'var(--color-surface-offset)',
              border: 'none',
              borderRadius: 'var(--radius-full)',
              padding: '2px 8px',
              fontSize: '11px',
              fontWeight: 'var(--weight-semibold)',
              color: 'var(--color-text-muted)',
              cursor: 'pointer',
              marginLeft: '4px'
            }}
          >
            Stop (Esc)
          </button>
        </div>
      )}

      {/* what the keyboard just selected, for a screen reader; never seen */}
      <div className="wall-announcer" role="status" aria-live="polite">{announcement}</div>

    {busy && (
        <div
          aria-live="polite"
          style={{
            position: 'absolute', bottom: 'var(--space-4)', left: '50%', transform: 'translateX(-50%)',
            padding: 'var(--space-2) var(--space-4)',
            background: 'var(--color-surface-elevated)',
            border: '1px solid var(--color-surface-offset)',
            borderRadius: 'var(--radius-full)',
            boxShadow: 'var(--shadow-lg)',
            fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)',
            zIndex: 30
          }}
        >
          {busy}…
        </div>
      )}
    </div>
  )
}
