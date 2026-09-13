import { inPaintOrder, patchItems, itemAtPoint, gridSpacing, toWallPoint, arrowGeometry, arrowAnchors, arrowDash, arrowHeadPoints, arrowHeadInset, ARROW_SHAPES, ARROW_LINES, ARROW_HEAD_MODES, type WallItem } from '../../../../shared/wallModel'
import WallItemLayer from './WallItemLayer'
import WallMinimap from './WallMinimap'
import { decodeWallDrag, WALL_DRAG_MIME } from '../../../../shared/wallBoard'
import WallSelectionBar from './WallSelectionBar'
import WallPenSettings from './WallPenSettings'
import { describeLink, isLinkable, pastedLink } from '../../../../shared/wallLink'
import type { WallViewState } from './useWallView'

export default function WallCanvas({ wallView }: { wallView: WallViewState }) {
  const {
    setView, setPendingNoteTitle, doc, loading, selectedIds, setSelectedIds, editingId,
    setEditingId, picker, setPicker, tool, penColor, setPenColor, penWidth, setPenWidth, smoothing,
    setSmoothing, drawing, arrowFrom, arrowDrag, arrowEndHover, arrowShape, setArrowShape, arrowLine,
    setArrowLine, arrowHeads, setArrowHeads, marquee, busy, spaceHeld, swatchOpen, setSwatchOpen,
    viewportRef, marqueeRectRef, docRef, cardsById, itemsById, notesByTitle, selectedItems, single,
    arrowsSelected, setItems, setCamera, onItemTextChange, onItemFinishEditing, onItemAutoSize, addItem,
    removeSelected, duplicateSelected, toggleLock, openCard, placeImageFiles, screenPoint, onWheel,
    arrowAt, onPointerDown, onPointerMove, onPointerLeave, endDrag, camera, canvasBackground, dotColor, floatingRef,
    floatingPos, linkPickFor, linkOpen, setLinkOpen, setItemLink, startLinkPick, followLink,
    wallIndex, activeWall, labelOf, previewing, addBookmark
  } = wallView

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

  return (
    <div
      ref={viewportRef}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
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
        const at = toWallPoint(screenPoint(e), docRef.current.camera)
        const hit = itemAtPoint(docRef.current.items, at)
        if (!hit) {
          // connectors have no box, ask first
          const arrow = arrowAt(at)
          if (arrow) { setSelectedIds(new Set([arrow.id])); setEditingId(arrow.id); return }
          addItem('note', {}, at)
          return
        }
        if (hit.locked) return
        if (hit.kind === 'card') openCard(hit)
        else if (hit.kind === 'doc') {
          // Notes opens the title on arrival
          if (hit.ref) {
            setPendingNoteTitle(hit.ref)
            setView('notes')
          }
        }
        else if (hit.kind === 'bookmark') { if (hit.link) followLink(hit.link) }
        else if (hit.kind !== 'image') setEditingId(hit.id)
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
        if (files.some(f => f.type.startsWith('image/'))) { void placeImageFiles(files, at); return }

        // a link dragged out of a browser; uri-list lines starting with # are comments
        const uri = e.dataTransfer.getData('text/uri-list').split(/\r?\n/).find(line => line && !line.startsWith('#'))
        const link = pastedLink(uri ?? e.dataTransfer.getData('text/plain'))
        if (link && !link.startsWith('wall:')) addBookmark(link, at)
      }}
      style={{
        flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden',
        cursor: spaceHeld ? 'grab' : linkPickFor ? 'alias' : tool === 'pen' ? 'crosshair' : tool === 'arrow' ? 'copy' : undefined,
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
        // promoted up front, or the first pan frame repaints the whole board
        willChange: 'transform',
      }}>
        {/* one layer for all arrows, redrawn from their items */}
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
            // stop behind heads so thick strokes don't fill the notch
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

          {/* drawn in its final style */}
          {arrowDrag && (() => {
            const from = itemsById.get(arrowDrag.fromId)
            if (!from) return null

            // snap to the item under the pointer, else follow it
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

        {/* not an item until the pointer comes up */}
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
          // a bookmark is its own link, a chip would repeat it
          const link = item.link && isLinkable(item.kind) ? describe(item.link) : null
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
              onAutoSize={onItemAutoSize}
              linkLabel={link?.label}
              linkMissing={link?.missing}
              linkExternal={link?.external}
              onFollowLink={followLink}
              previewing={previewing.has(item.id)}
            />
          )
        })}
      </div>

      {/* labels above lines and items; arrow labels live in text like frames */}
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
                    // an emptied label is removed, not a blank chip
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

      {/* both ends grabbable, sized against zoom */}
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
                  // square tail, round head
                  ...(which === 'start' && heads !== 'both' ? { borderRadius: '20%' } : {}),
                  cursor: 'grab'
                }}
              />
            ))}
          </div>
        )
      })()}

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

      {/* floated above the selection */}
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
          linkOpen={linkOpen}
          setLinkOpen={setLinkOpen}
          linkLabel={single?.link ? describe(single.link).label : undefined}
          setItemLink={setItemLink}
          startLinkPick={startLinkPick}
          followLink={followLink}
        />
      )}

      {picker && (
        <div onPointerDown={() => setPicker(null)} style={{ position: 'absolute', inset: 0, zIndex: 10 }} />
      )}

      {/* minimap from the fourth item on */}
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
