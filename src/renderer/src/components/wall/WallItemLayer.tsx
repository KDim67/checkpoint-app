import React from 'react'
import { Lock, RotateCw } from 'lucide-react'
import type { WallItem } from '../../../../shared/wallModel'
import type { Item, NoteMetadata } from '../../../../shared/types'
import WallItemView from './WallItemView'

interface Props {
  item: WallItem
  card?: Item
  note?: NoteMetadata
  selected: boolean
  editing: boolean
  /** Whether the four connect dots are offered on this item. */
  connectable: boolean
  /** Whether the resize and rotate handles are offered on this item. */
  showHandles: boolean
  /** Already resolved to a CSS value, so the memo below compares a string. */
  outline: string
  onTextChange: (id: string, text: string) => void
  onFinishEditing: () => void
}

/**
 * One item on the wall, with everything drawn around it.
 *
 * Split from WallView and memoised because this is where a render was going.
 * The item itself was already memoised, but the box around it was not, and it
 * carries ten more elements: the outline, the lock markers, four connect dots
 * and the resize handles. Rebuilding those for every item on the wall cost
 * around ninety milliseconds a render, so selecting, hovering or drawing
 * anything stuttered even though not one item had actually changed.
 */
function WallItemLayer({ item, card, note, selected, editing, connectable, showHandles, outline, onTextChange, onFinishEditing }: Props) {
  return (
    <div
      data-wall-item={item.id}
      style={{
        position: 'absolute',
        left: 0, top: 0,
        width: `${item.width}px`, height: `${item.height}px`,
        // translate, not left/top. Moving an item this way costs no
        // layout, and a layout here repaints the whole canvas layer,
        // which means resampling every image on the wall per frame.
        // The 2D form, not translate3d: the 3D one gave every item
        // a compositor layer of its own, and with hundreds of them
        // each render paid to work out the overlaps between them
        // all, which is what made a click on a full board stall.
        transform: `translate(${item.x}px, ${item.y}px)${item.rotation ? ` rotate(${item.rotation}deg)` : ''}`,
        // Images get their own compositor layer so a repaint of the
        // canvas does not re-rasterise them. They are the expensive
        // ones: a photo can be tens of megapixels behind a 280px box.
        willChange: item.kind === 'image' ? 'transform' : undefined,
        // Ink lets presses through: only its stroke takes them.
        pointerEvents: item.kind === 'ink' ? 'none' : undefined,
        cursor: item.locked ? 'default' : 'grab',
        outline,
        outlineOffset: '2px'
      }}
    >
      <WallItemView
        item={item}
        card={card}
        note={note}
        selected={selected}
        editing={editing}
        onTextChange={onTextChange}
        onFinishEditing={onFinishEditing}
      />

      {item.locked && selected && (
        <div style={{ position: 'absolute', top: '-8px', right: '-8px', color: 'var(--color-text-faint)' }}>
          <Lock size={12} />
        </div>
      )}

      {/* A locked item ignores every press. Without a marker that
          reads as the app being broken rather than as a choice. */}
      {item.locked && (
        <span
          title="Locked. Right-click to unlock."
          style={{
            position: 'absolute', right: '-6px', top: '-6px',
            width: '18px', height: '18px', borderRadius: '50%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'var(--color-surface-elevated)',
            border: '1px solid var(--color-surface-offset)',
            color: 'var(--color-text-faint)', pointerEvents: 'none'
          }}
        >
          <Lock size={10} />
        </span>
      )}

      {/* Drag one of these to any other item to connect the two.
          Only in select mode: the pen and the arrow already own
          the whole gesture, and a locked item connects to nothing. */}
      {connectable && (
        <>
          {([
            ['top', { left: '50%', top: '-13px', marginLeft: '-9px' }],
            ['right', { right: '-13px', top: '50%', marginTop: '-9px' }],
            ['bottom', { left: '50%', bottom: '-13px', marginLeft: '-9px' }],
            ['left', { left: '-13px', top: '50%', marginTop: '-9px' }]
          ] as const).map(([side, position]) => (
            <div
              key={side}
              className="wall-connect"
              data-wall-connect={item.id}
              title="Drag to connect this to something"
              style={{
                position: 'absolute', ...position,
                width: '18px', height: '18px',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'crosshair', zIndex: 3
              }}
            >
              <span className="wall-connect-dot" style={{ width: '10px', height: '10px' }} />
            </div>
          ))}
        </>
      )}

      {/* Handles only for a single unlocked selection: dragging one
          corner of five items has no obvious meaning. */}
      {showHandles && (
        <>
          {/* A 22px grab area around a 12px dot. The handle used
              to be exactly as big as it looked, which made resizing
              a matter of hitting a 12px corner. */}
          <div
            data-wall-handle="se"
            style={{
              position: 'absolute', right: '-11px', bottom: '-11px', width: '22px', height: '22px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'nwse-resize'
            }}
          >
            <span style={{
              width: '12px', height: '12px',
              background: 'var(--color-secondary)', border: '2px solid var(--color-surface-1)',
              borderRadius: '2px'
            }} />
          </div>
          <div
            data-wall-handle="rotate"
            title="Drag to rotate, hold Shift for 15° steps"
            style={{
              position: 'absolute', left: '50%', top: '-30px', transform: 'translateX(-50%)',
              width: '24px', height: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'grab'
            }}
          >
            <span style={{
              width: '16px', height: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'var(--color-surface-1)', border: '1px solid var(--color-secondary)',
              borderRadius: '50%', color: 'var(--color-secondary)'
            }}>
              <RotateCw size={9} />
            </span>
          </div>
        </>
      )}
    </div>
  )
}

export default React.memo(WallItemLayer)
