/**
 * One item on the Wall. Split from the canvas, which is about camera, pointer
 * maths and persistence; the two change for different reasons.
 *
 * The card case matters most: it renders from the live item passed in, never
 * from anything stored on the wall, so a retitled card follows and a deleted
 * one says so instead of showing stale text.
 */

import React from 'react'
import { FileQuestion, FileText } from 'lucide-react'
import { inkNaturalSize, inkPath, type WallItem } from '../../../../shared/wallModel'
import type { Item, NoteMetadata } from '../../../../shared/types'

const PRIORITY_LABEL: Record<number, string> = { 1: 'Low', 2: 'Med', 3: 'High' }

interface Props {
  item: WallItem
  /** The real card, when this item references one that still exists. */
  card?: Item
  /** The real note, for a doc item. */
  note?: NoteMetadata
  selected: boolean
  /** Editing is driven by the canvas so only one item edits at a time. */
  editing: boolean
  onTextChange: (id: string, text: string) => void
  onFinishEditing: () => void
}

function WallItemView({ item, card, note, selected, editing, onTextChange, onFinishEditing }: Props) {
  const base: React.CSSProperties = {
    width: '100%',
    height: '100%',
    boxSizing: 'border-box',
    overflow: 'hidden'
  }

  // Sticky note
  if (item.kind === 'note') {
    const bg = item.color || '#f6c453'
    return (
      <div style={{
        ...base,
        background: bg,
        borderRadius: '2px',
        // A sticky note reads as paper because of the shadow, not the colour.
        boxShadow: selected ? 'none' : '0 2px 6px rgba(0,0,0,0.28)',
        padding: '12px'
      }}>
        {editing ? (
          <textarea
            autoFocus
            value={item.text ?? ''}
            onChange={e => onTextChange(item.id, e.target.value)}
            onBlur={onFinishEditing}
            onKeyDown={e => { if (e.key === 'Escape') onFinishEditing() }}
            style={{
              width: '100%', height: '100%', resize: 'none', border: 'none',
              outline: 'none', background: 'transparent', color: '#1a1a1a',
              fontFamily: 'var(--font-sans)', fontSize: '13px', lineHeight: 1.45
            }}
          />
        ) : (
          <div style={{
            color: '#1a1a1a', fontSize: '13px', lineHeight: 1.45,
            whiteSpace: 'pre-wrap', wordBreak: 'break-word', height: '100%'
          }}>
            {item.text || <span style={{ opacity: 0.45 }}>Double-click to write</span>}
          </div>
        )}
      </div>
    )
  }

  // Free text
  if (item.kind === 'text') {
    return (
      <div style={{ ...base, display: 'flex', alignItems: 'center' }}>
        {editing ? (
          <input
            autoFocus
            value={item.text ?? ''}
            onChange={e => onTextChange(item.id, e.target.value)}
            onBlur={onFinishEditing}
            onKeyDown={e => { if (e.key === 'Escape' || e.key === 'Enter') onFinishEditing() }}
            style={{
              width: '100%', border: 'none', outline: 'none', background: 'transparent',
              color: item.color || 'var(--color-text-base)',
              fontFamily: 'var(--font-sans)', fontSize: '20px', fontWeight: 600
            }}
          />
        ) : (
          <span style={{
            color: item.color || 'var(--color-text-base)',
            fontSize: '20px', fontWeight: 600, lineHeight: 1.3,
            whiteSpace: 'pre-wrap', wordBreak: 'break-word'
          }}>
            {item.text || <span style={{ opacity: 0.4 }}>Double-click to write</span>}
          </span>
        )}
      </div>
    )
  }

  // Frame
  // Drawn as an outline with the label above it, so whatever it groups stays
  // fully visible. A frame is an annotation, not a container.
  if (item.kind === 'frame') {
    const stroke = item.color || 'var(--color-surface-elevated)'
    return (
      <div style={{ ...base, position: 'relative', overflow: 'visible' }}>
        <div style={{
          position: 'absolute', bottom: '100%', left: 0, marginBottom: '4px',
          maxWidth: '100%', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
        }}>
          {editing ? (
            <input
              autoFocus
              value={item.text ?? ''}
              onChange={e => onTextChange(item.id, e.target.value)}
              onBlur={onFinishEditing}
              onKeyDown={e => { if (e.key === 'Escape' || e.key === 'Enter') onFinishEditing() }}
              style={{
                border: 'none', outline: 'none', background: 'transparent',
                color: stroke, fontFamily: 'var(--font-sans)', fontSize: '13px', fontWeight: 600
              }}
            />
          ) : (
            <span style={{ color: stroke, fontSize: '13px', fontWeight: 600 }}>
              {item.text || 'Frame'}
            </span>
          )}
        </div>
        <div style={{
          width: '100%', height: '100%',
          border: `2px solid ${stroke}`,
          borderRadius: 'var(--radius-md)',
          background: 'transparent'
        }} />
      </div>
    )
  }

  // A note from the Notes view
  // Referenced by title, like a card is by id, and rendered from the live
  // metadata so a renamed or edited note is never shown stale.
  if (item.kind === 'doc') {
    if (!note) {
      return (
        <div style={{
          ...base,
          display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
          padding: 'var(--space-3)',
          background: 'var(--color-surface-2)',
          border: '1px dashed var(--color-surface-offset)',
          borderRadius: 'var(--radius-md)',
          color: 'var(--color-text-faint)', fontSize: 'var(--text-xs)'
        }}>
          <FileQuestion size={14} />
          This note no longer exists
        </div>
      )
    }
    return (
      <div style={{
        ...base,
        display: 'flex', flexDirection: 'column', gap: '6px',
        padding: 'var(--space-3)',
        background: 'var(--color-surface-1)',
        border: `1px solid ${item.color || 'var(--color-surface-offset)'}`,
        borderLeft: `3px solid ${item.color || 'var(--color-secondary)'}`,
        borderRadius: 'var(--radius-md)',
        boxShadow: selected ? 'none' : '0 2px 8px rgba(0,0,0,0.25)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <FileText size={12} style={{ color: 'var(--color-text-faint)', flexShrink: 0 }} />
          <span style={{
            fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)',
            color: 'var(--color-text-base)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
          }}>
            {note.title}
          </span>
        </div>
        <span style={{
          fontSize: '11px', color: 'var(--color-text-muted)', lineHeight: 1.45,
          display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical', overflow: 'hidden'
        }}>
          {note.excerpt || 'Empty note'}
        </span>
      </div>
    )
  }

  // Image
  if (item.kind === 'ink') {
    const natural = inkNaturalSize(item)
    return (
      <svg
        width="100%"
        height="100%"
        // The box the stroke was drawn in. Keeping it as the viewBox is what
        // makes resizing scale the drawing rather than crop it.
        viewBox={`0 0 ${natural.width} ${natural.height}`}
        preserveAspectRatio="none"
        style={{ display: 'block', overflow: 'visible', pointerEvents: 'none' }}
      >
        {/* A fat invisible copy underneath, and the only part that takes a
            press. The box around a diagonal stroke is mostly empty space, and
            leaving that clickable meant one stroke could blanket everything
            under it and swallow every drag aimed at the items beneath. */}
        <path
          d={inkPath(item)}
          fill="none"
          stroke="transparent"
          strokeWidth={(item.strokeWidth ?? 4) + 14}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ pointerEvents: 'stroke' }}
        />
        <path
          d={inkPath(item)}
          fill="none"
          stroke={item.color || 'var(--color-text-base)'}
          strokeWidth={item.strokeWidth ?? 4}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    )
  }

  if (item.kind === 'image') {
    return (
      <img
        // Asks for a copy sized for the box rather than the original, which
        // Chromium would decode at full resolution however small it is drawn.
        // Doubled so it still holds up zoomed in a little. See mediaPreview.ts.
        src={`checkpoint-media://${item.ref}?w=${Math.round(item.width * 2)}`}
        alt={item.text || 'Wall image'}
        draggable={false}
        // Off the main thread: decoding a large photo synchronously stalls the
        // frame it lands on, which is felt as a hitch mid-drag.
        decoding="async"
        style={{
          ...base,
          objectFit: 'cover',
          borderRadius: 'var(--radius-sm)',
          boxShadow: selected ? 'none' : '0 2px 8px rgba(0,0,0,0.3)',
          display: 'block'
        }}
      />
    )
  }

  // Card
  // Referenced, never copied. A card deleted from the board leaves a marker
  // rather than stale text pretending the work still exists.
  if (!card) {
    return (
      <div style={{
        ...base,
        display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
        padding: 'var(--space-3)',
        background: 'var(--color-surface-2)',
        border: '1px dashed var(--color-surface-offset)',
        borderRadius: 'var(--radius-md)',
        color: 'var(--color-text-faint)', fontSize: 'var(--text-xs)'
      }}>
        <FileQuestion size={14} />
        This card no longer exists
      </div>
    )
  }

  return (
    <div style={{
      ...base,
      display: 'flex', flexDirection: 'column', gap: '6px',
      padding: 'var(--space-3)',
      background: 'var(--color-surface-1)',
      border: `1px solid ${item.color || 'var(--color-surface-offset)'}`,
      borderLeft: `3px solid ${item.color || 'var(--color-primary)'}`,
      borderRadius: 'var(--radius-md)',
      boxShadow: selected ? 'none' : '0 2px 8px rgba(0,0,0,0.25)'
    }}>
      <span style={{
        fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)',
        color: 'var(--color-text-base)', lineHeight: 1.35,
        display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden'
      }}>
        {card.title}
      </span>

      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', marginTop: 'auto' }}>
        <span style={{
          fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.05em',
          color: 'var(--color-text-faint)', fontFamily: 'var(--font-mono)'
        }}>
          {card.status}
        </span>
        {card.priority > 0 && (
          <span style={{
            fontSize: '9px', padding: '1px 5px', borderRadius: '3px',
            background: 'var(--color-surface-offset)', color: 'var(--color-text-muted)'
          }}>
            {PRIORITY_LABEL[card.priority]}
          </span>
        )}
        {(card.tags ?? []).slice(0, 2).map(t => (
          <span key={t.id} style={{
            fontSize: '9px', padding: '1px 5px', borderRadius: '3px',
            background: `${t.color}22`, color: t.color
          }}>
            {t.name}
          </span>
        ))}
      </div>
    </div>
  )
}

// Memoised because moving one item re-renders the wall. The unmoved items are
// handed the same objects again, so with this they are skipped, and a drag
// costs the items it moves rather than every card, note and stroke on screen.
export default React.memo(WallItemView)
