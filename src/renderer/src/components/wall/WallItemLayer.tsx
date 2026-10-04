import React from 'react'
import { ExternalLink, Link2, Lock, RotateCw } from 'lucide-react'
import type { ImageCrop, WallItem } from '../../../../shared/wallModel'
import type { Side } from '../../../../shared/wallGrow'
import type { TopicPlace } from '../../../../shared/wallMindMap'
import type { Corner } from '../../../../shared/wallPointer'
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
  /** primitives, an object per render would undo the memo */
  linkLabel?: string
  linkMissing?: boolean
  linkExternal?: boolean
  onFollowLink: (link: string) => void
  previewing?: boolean
  onAutoSize?: (id: string, height: number) => void
  /** Tab while writing, the next item beside this one */
  onGrow?: (id: string, side: Side) => void
  /** a search is on and this isn't in it */
  dimmed?: boolean
  /** peers who currently have this item selected */
  remoteSelectedBy?: { peerId: string; name: string; color: string }[]
  /** board tag colours by lowercased name, held in the hook so the memo holds */
  tagColors?: Map<string, string>
  /** Tab and Enter in a mind map topic */
  onMapTopic?: (id: string, place: TopicPlace) => void
  /** a sticky being written in has run out of room for its words */
  onNeedRoom?: (id: string, extra: number) => void
  /** this image is being cropped */
  cropping?: boolean
  onCrop?: (id: string, crop: ImageCrop | null, natural?: { width: number; height: number }) => void
}

/** a grip on each corner, and the resize cursor that points along its diagonal */
const CORNER_HANDLES: { corner: Corner; place: React.CSSProperties; cursor: string }[] = [
  { corner: 'nw', place: { left: '-11px', top: '-11px' }, cursor: 'nwse-resize' },
  { corner: 'ne', place: { right: '-11px', top: '-11px' }, cursor: 'nesw-resize' },
  { corner: 'sw', place: { left: '-11px', bottom: '-11px' }, cursor: 'nesw-resize' },
  { corner: 'se', place: { right: '-11px', bottom: '-11px' }, cursor: 'nwse-resize' }
]

/** memoised: the box around each item cost ~90ms a render; selection is a data attribute, not a prop */
function WallItemLayer({ item, card, note, editing, connectable, showHandles, arrowTarget, arrowFrom, onTextChange, onFinishEditing, linkLabel, linkMissing, linkExternal, onFollowLink, previewing, onAutoSize, onGrow, dimmed, remoteSelectedBy, tagColors, onMapTopic, onNeedRoom, cropping, onCrop }: Props) {
  const link = item.link
  const linkTitle = linkMissing
    ? `${linkLabel}. Edit the link to point somewhere else.`
    : linkExternal ? `Open ${link}` : `Go to ${linkLabel}`

  return (
    <div
      data-wall-item={item.id}
      data-wall-arrow-target={arrowTarget || undefined}
      data-wall-arrow-from={arrowFrom || undefined}
      data-wall-dimmed={dimmed || undefined}
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
          : arrowFrom
            ? '2px dashed var(--color-secondary)'
            : remoteSelectedBy && remoteSelectedBy.length > 0
              ? `2px solid ${remoteSelectedBy[0].color}`
              : undefined,
        outlineOffset: '2px'
      }}
    >
      {remoteSelectedBy && remoteSelectedBy.length > 0 && (
        <div
          data-wall-remote-selection-badge
          style={{
            position: 'absolute',
            top: '-20px',
            left: '0px',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
            padding: '1px 6px',
            borderRadius: '4px',
            background: remoteSelectedBy[0].color,
            color: '#ffffff',
            fontSize: '10px',
            fontWeight: 600,
            lineHeight: 1.25,
            whiteSpace: 'nowrap',
            boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
            pointerEvents: 'none',
            zIndex: 10,
            userSelect: 'none'
          }}
        >
          {remoteSelectedBy.map(p => p.name).join(', ')}
        </div>
      )}
      <WallItemView
        item={item}
        card={card}
        note={note}
        editing={editing}
        onTextChange={onTextChange}
        onFinishEditing={onFinishEditing}
        previewing={previewing}
        onAutoSize={onAutoSize}
        onGrow={onGrow}
        tagColors={tagColors}
        onMapTopic={onMapTopic}
        onNeedRoom={onNeedRoom}
        cropping={cropping}
        onCrop={onCrop}
      />

      {/* under the item, a frame's label already owns the top edge */}
      {link && linkLabel !== undefined && (
        <button
          type="button"
          data-wall-link
          data-missing={linkMissing || undefined}
          className="wall-link-chip"
          title={linkTitle}
          aria-label={linkTitle}
          onClick={() => onFollowLink(link)}
          style={{ position: 'absolute', left: 0, top: '100%', marginTop: '6px' }}
        >
          {linkExternal ? <ExternalLink size={11} /> : <Link2 size={11} />}
          <span className="truncate">{linkLabel}</span>
        </button>
      )}

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
              data-wall-side={side}
              title="Click to add the next item here, or drag to connect this to something"
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
          {/* every corner pulls, the opposite one stays; 22px grab area around a 12px dot */}
          {CORNER_HANDLES.map(({ corner, place, cursor }) => (
            <div
              key={corner}
              data-wall-handle={corner}
              title={item.kind === 'image' ? 'Drag to resize, hold Shift to stretch' : 'Drag to resize, hold Shift to keep the shape'}
              style={{
                position: 'absolute', ...place, width: '22px', height: '22px',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor
              }}
            >
              <span style={{
                width: '12px', height: '12px',
                background: 'var(--color-secondary)', border: '2px solid var(--color-surface-1)',
                borderRadius: '2px'
              }} />
            </div>
          ))}
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
