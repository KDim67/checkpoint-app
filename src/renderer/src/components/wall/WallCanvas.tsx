import { inPaintOrder, patchItems, itemAtPoint, gridSpacing, toWallPoint, arrowGeometry, arrowAnchors, arrowDash, arrowHeadPoints, arrowHeadInset, ARROW_SHAPES, ARROW_LINES, ARROW_HEAD_MODES, type WallItem } from '../../../../shared/wallModel'
import WallItemLayer from './WallItemLayer'
import WallMinimap from './WallMinimap'
import { decodeWallDrag, WALL_DRAG_MIME } from '../../../../shared/wallBoard'
import WallSelectionBar from './WallSelectionBar'
import WallPenSettings from './WallPenSettings'
import type { WallViewState } from './useWallView'

export default function WallCanvas({ wallView }: { wallView: WallViewState }) {
  const {
    setView, setPendingNoteTitle, doc, loading, selectedIds, setSelectedIds, editingId,
    setEditingId, picker, setPicker, tool, penColor, setPenColor, penWidth, setPenWidth, smoothing,
    setSmoothing, drawing, arrowFrom, arrowDrag, arrowEndHover, arrowShape, setArrowShape, arrowLine,
    setArrowLine, arrowHeads, setArrowHeads, marquee, busy, spaceHeld, swatchOpen, setSwatchOpen,
    viewportRef, marqueeRectRef, docRef, cardsById, itemsById, notesByTitle, selectedItems, single,
    arrowsSelected, setItems, setCamera, onItemTextChange, onItemFinishEditing, addItem,
    removeSelected, duplicateSelected, toggleLock, openCard, placeImageFiles, screenPoint, onWheel,
    arrowAt, onPointerDown, onPointerMove, endDrag, camera, canvasBackground, dotColor, floatingRef,
    floatingPos
  } = wallView
  return (
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

        // The floating panels are children of the canvas, and this handler
        // works from coordinates rather than the target, so without the
        // guard a double-click on the ink palette made a note behind it.
        if ((e.target as HTMLElement).closest('[data-wall-ui]')) return
        const at = toWallPoint(screenPoint(e), docRef.current.camera)
        const hit = itemAtPoint(docRef.current.items, at)
        if (!hit) {
          // A connector has no box to hit, so it is asked for by hand
          // before the empty canvas gets to make a note.
          const arrow = arrowAt(at)
          if (arrow) { setSelectedIds(new Set([arrow.id])); setEditingId(arrow.id); return }
          addItem('note', {}, at)
          return
        }
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
        cursor: spaceHeld ? 'grab' : tool === 'pen' ? 'crosshair' : tool === 'arrow' ? 'copy' : undefined,
        background: canvasBackground,
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
            from the board. Nothing snaps and nothing sorts. Put things where you want them.
          </span>
        </div>
      )}

      <div data-wall-camera-layer style={{
        position: 'absolute', top: 0, left: 0,
        transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`,
        transformOrigin: '0 0',
        // Promoted up front. A plain 2D transform is not given its own
        // compositor layer, so the first frame of a pan repainted the whole
        // board on the main thread; only then did Chromium notice the
        // transform was moving and promote it, which is why a pan used to
        // stall once at the start and run smoothly ever after.
        willChange: 'transform',
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
            const ends = arrowAnchors(arrow, itemsById)
            if (!ends) return null

            const width = arrow.strokeWidth ?? 2
            const stroke = arrow.color || 'var(--color-text-muted)'
            const selected = selectedIds.has(arrow.id)
            const heads = arrow.arrowHeads ?? ARROW_HEAD_MODES[0]
            // Stopped behind whichever ends carry a head, so a thick stroke
            // does not fill in the notch it is supposed to meet.
            const inset = arrowHeadInset(width)
            const g = arrowGeometry(ends.from, ends.to, arrow.arrowShape ?? ARROW_SHAPES[0], {
              end: heads !== 'none' ? inset : 0,
              start: heads === 'both' ? inset : 0
            })

            return (
              <g key={arrow.id} data-wall-arrow={arrow.id} opacity={selected ? 1 : 0.85}>
                <path
                  d={g.d}
                  fill="none"
                  stroke={stroke}
                  strokeWidth={width + (selected ? 2 : 0)}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeDasharray={arrowDash(arrow.arrowLine ?? ARROW_LINES[0], width)}
                />
                {heads !== 'none' && (
                  <polygon points={arrowHeadPoints(g.end, g.endAngle, width)} fill={stroke} />
                )}
                {heads === 'both' && (
                  <polygon points={arrowHeadPoints(g.start, g.startAngle, width)} fill={stroke} />
                )}
              </g>
            )
          })}

          {/* The connector being dragged out. Drawn in the style it will
              have, so what is on screen is what gets made. */}
          {arrowDrag && (() => {
            const from = itemsById.get(arrowDrag.fromId)
            if (!from) return null

            // Snaps to the item under the pointer when there is one, and
            // otherwise follows the pointer itself as a point with no size.
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
            <WallItemLayer
              key={item.id}
              item={item}
              card={item.kind === 'card' ? cardsById.get(item.ref ?? '') : undefined}
              note={item.kind === 'doc' ? notesByTitle.get(item.ref ?? '') : undefined}
              editing={editingId === item.id}
              connectable={tool === 'select' && !item.locked && item.kind !== 'frame'}
              showHandles={isSelected && single?.id === item.id && !item.locked}
              arrowTarget={arrowDrag?.overId === item.id || arrowEndHover === item.id}
              arrowFrom={arrowFrom === item.id}
              onTextChange={onItemTextChange}
              onFinishEditing={onItemFinishEditing}
            />
          )
        })}
      </div>

      {/* Labels, above the lines and the items so they stay readable.
          An arrow's label lives in `text`, the same field a frame's does. */}
      <div data-wall-camera-layer style={{
        position: 'absolute', left: 0, top: 0, width: '1px', height: '1px',
        transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`,
        transformOrigin: '0 0', zIndex: 5, pointerEvents: 'none',
        willChange: 'transform'
      }}>
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
              onPointerDown={e => { e.stopPropagation(); setSelectedIds(new Set([arrow.id])) }}
              onDoubleClick={e => { e.stopPropagation(); setEditingId(arrow.id) }}
              style={{
                position: 'absolute', left: 0, top: 0,
                transform: `translate(${mid.x}px, ${mid.y}px) translate(-50%, -50%)`,
                maxWidth: '220px',
                padding: '2px 6px',
                background: 'var(--color-surface-1)',
                border: `1px solid ${selectedIds.has(arrow.id) ? 'var(--color-secondary)' : 'var(--color-surface-offset)'}`,
                borderRadius: 'var(--radius-sm)',
                color: 'var(--color-text-base)',
                fontSize: '12px', lineHeight: 1.3,
                pointerEvents: 'auto', cursor: 'text'
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
                    // An emptied label is removed rather than kept as a
                    // blank chip sitting on the line.
                    setItems(patchItems(docRef.current.items, new Set([arrow.id]), {
                      text: text || undefined
                    }))
                  }}
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLInputElement).blur()
                  }}
                  style={{
                    width: '120px', background: 'none', border: 'none', outline: 'none',
                    color: 'var(--color-text-base)', font: 'inherit', padding: 0
                  }}
                />
              ) : (
                <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{arrow.text}</span>
              )}
            </div>
          )
        })}
      </div>

      {/* Both ends of the selected connector, as something to grab. Drawn
          in the canvas layer so they sit exactly on the line, but sized
          against the zoom so they stay the same size to grab. */}
      {single?.kind === 'arrow' && (() => {
        const ends = arrowAnchors(single, itemsById)
        if (!ends) return null

        const heads = single.arrowHeads ?? ARROW_HEAD_MODES[0]
        const g = arrowGeometry(ends.from, ends.to, single.arrowShape ?? ARROW_SHAPES[0])
        const size = 12 / camera.zoom
        const ring = 2 / camera.zoom

        return (
          <div data-wall-camera-layer style={{
            position: 'absolute', left: 0, top: 0, width: '1px', height: '1px',
            transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`,
            transformOrigin: '0 0', zIndex: 6,
            willChange: 'transform'
          }}>
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
                  // Square at the tail, round at the head, so which end is
                  // which is readable without hovering either of them.
                  ...(which === 'start' && heads !== 'both' ? { borderRadius: '20%' } : {}),
                  cursor: 'grab'
                }}
              />
            ))}
          </div>
        )
      })()}

      {/* Marquee, drawn in screen space so it does not scale with the camera. */}
      {marquee && (() => {
        // The box drawn by hand is ahead of the one in state, and a render
        // mid-sweep must not shrink it back to where the press was.
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

      {/* Controls for the current selection, floated above it. */}
      {floatingPos && selectedItems.length > 0 && (
        <WallSelectionBar
          floatingPos={floatingPos}
          floatingRef={floatingRef}
          swatchOpen={swatchOpen}
          setSwatchOpen={setSwatchOpen}
          single={single}
          arrowsSelected={arrowsSelected}
          items={doc.items}
          selectedIds={selectedIds}
          setItems={setItems}
          setEditingId={setEditingId}
          duplicateSelected={duplicateSelected}
          toggleLock={toggleLock}
          removeSelected={removeSelected}
        />
      )}

      {picker && (
        <div onPointerDown={() => setPicker(null)} style={{ position: 'absolute', inset: 0, zIndex: 10 }} />
      )}

      {/* A minimap only earns its space once there is something to lose track
          of, so it appears with the fourth item rather than sitting empty. */}
      {doc.items.length > 3 && (
        <WallMinimap
          items={doc.items}
          selectedIds={selectedIds}
          camera={camera}
          viewportRef={viewportRef}
          docRef={docRef}
          setCamera={setCamera}
        />
      )}

      {tool !== 'select' && (
        <WallPenSettings
          tool={tool}
          penColor={penColor}
          setPenColor={setPenColor}
          penWidth={penWidth}
          setPenWidth={setPenWidth}
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
  )
}
