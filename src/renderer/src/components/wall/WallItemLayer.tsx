import React from 'react'
import { Lock, RotateCw } from 'lucide-react'
import type { WallItem } from '../../../../shared/wallModel'
import type { Item, NoteMetadata } from '../../../../shared/types'
import WallItemView from './WallItemView'

interface Props {
  item: WallItem
  card?: Item
  note?: NoteMetadata
  editing: boolean
  /** four connect dots */
  connectable: boolean
  /** resize and rotate handles */
  showHandles: boolean
  /** where a dragged arrow would land */
  arrowTarget: boolean
  /** where an arrow is dragged from */
  arrowFrom: boolean
  onTextChange: (id: string, text: string) => void
  onFinishEditing: () => void
}

/** memoised: the box around each item cost ~90ms a render; selection is a data attribute, not a prop */
function WallItemLayer({ item, card, note, editing, connectable, showHandles, arrowTarget, arrowFrom, onTextChange, onFinishEditing }: Props) {
  return (
    <div
      data-wall-item={item.id}
      data-wall-arrow-target={arrowTarget || undefined}
      data-wall-arrow-from={arrowFrom || undefined}
      style={{
        position: 'absolute',
        left: 0, top: 0,
        width: `${item.width}px`, height: `${item.height}px`,
        // 2D translate: no layout, and translate3d gave hundreds of items their own layers
        transform: `translate(${item.x}px, ${item.y}px)${item.rotation ? ` rotate(${item.rotation}deg)` : ''}`,
        // own layer so canvas repaints don't re-rasterise big photos
        willChange: item.kind === 'image' ? 'transform' : undefined,
        // ink lets presses through, only the stroke takes them
        pointerEvents: item.kind === 'ink' ? 'none' : undefined,
        cursor: item.locked ? 'default' : 'grab',
        // selected outline lives in index.css via data-wall-selected
        outline: arrowTarget
          ? '3px solid var(--color-secondary)'
          : arrowFrom ? '2px dashed var(--color-secondary)' : undefined,
        outlineOffset: '2px'
      }}
    >
      <WallItemView
        item={item}
        card={card}
        note={note}
        editing={editing}
        onTextChange={onTextChange}
        onFinishEditing={onFinishEditing}
      />

      {item.locked && (
        <div className="wall-lock-selected" style={{ position: 'absolute', top: '-8px', right: '-8px', color: 'var(--color-text-faint)' }}>
          <Lock size={12} />
        </div>
      )}

      {/* a marker, or a locked item ignoring presses reads as broken */}
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

      {/* select mode only: pen and arrow own the gesture, locked items connect to nothing */}
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

      {/* single unlocked selection only */}
      {showHandles && (
        <>
          {/* 22px grab area around a 12px dot */}
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
