/** cards render from the live item, so renames follow and deletions say so */

import React, { useLayoutEffect, useRef } from 'react'
import { FileQuestion, FileText, Globe } from 'lucide-react'
import { inkNaturalSize, inkPath, type WallItem } from '../../../../shared/wallModel'
import type { Item, NoteMetadata } from '../../../../shared/types'
import { parseWallLink } from '../../../../shared/wallLink'
import WallRichText from './WallRichText'
import WallTextEditor from './WallTextEditor'

const PRIORITY_LABEL: Record<number, string> = { 1: 'Low', 2: 'Med', 3: 'High' }

const NOTE_FONT = 13
const NOTE_FONT_MIN = 8

/** shrinks to fit instead of clipping the last lines, never past the default size; set on the element, no re-render */
function NoteText({ text, width, height }: { text?: string; width: number; height: number }) {
  const ref = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    let size = NOTE_FONT
    el.style.fontSize = `${size}px`
    // one measure for a note that fits, which is most of them
    while (size > NOTE_FONT_MIN && el.scrollHeight > el.clientHeight + 1) {
      size -= 1
      el.style.fontSize = `${size}px`
    }
  }, [text, width, height])

  return (
    <div ref={ref} style={{
      color: '#1a1a1a', lineHeight: 1.45, overflow: 'hidden',
      whiteSpace: 'pre-wrap', wordBreak: 'break-word', height: '100%'
    }}>
      {text ? <WallRichText text={text} /> : <span style={{ opacity: 0.45 }}>Double-click to write</span>}
    </div>
  )
}

/** as tall as its words: dragging it wider reflows them and the box follows */
function TextBox({ item, style, onAutoSize }: {
  item: WallItem
  style: React.CSSProperties
  onAutoSize?: (id: string, height: number) => void
}) {
  const ref = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    // the words' own height, not the stored box around them
    const height = ref.current?.offsetHeight
    if (height && onAutoSize) onAutoSize(item.id, height)
  }, [item.id, item.text, item.width, onAutoSize])

  return (
    <div ref={ref} style={{ ...style, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
      {item.text ? <WallRichText text={item.text} /> : <span style={{ opacity: 0.4 }}>Double-click to write</span>}
    </div>
  )
}

interface Props {
  item: WallItem
  /** when the referenced card still exists */
  card?: Item
  /** for doc items */
  note?: NoteMetadata
  /** canvas-driven so only one item edits at a time */
  editing: boolean
  onTextChange: (id: string, text: string) => void
  onFinishEditing: () => void
  /** a bookmark whose page main is still reading */
  previewing?: boolean
  /** a text box reporting the height of its words */
  onAutoSize?: (id: string, height: number) => void
}

function WallItemView({ item, card, note, editing, onTextChange, onFinishEditing, previewing, onAutoSize }: Props) {
  const base: React.CSSProperties = {
    width: '100%',
    height: '100%',
    boxSizing: 'border-box',
    overflow: 'hidden'
  }

  if (item.kind === 'note') {
    const bg = item.color || '#f6c453'
    return (
      <div className="wall-paper" style={{
        ...base,
        background: bg,
        borderRadius: '2px',
        // the shadow makes it read as paper, not the colour
        boxShadow: '0 2px 6px rgba(0,0,0,0.28)',
        padding: '12px'
      }}>
        {editing ? (
          <WallTextEditor
            value={item.text ?? ''}
            onChange={text => onTextChange(item.id, text)}
            onFinish={onFinishEditing}
            style={{
              width: '100%', height: '100%', resize: 'none', border: 'none', padding: 0,
              outline: 'none', background: 'transparent', color: '#1a1a1a',
              fontFamily: 'var(--font-sans)', fontSize: `${NOTE_FONT}px`, lineHeight: 1.45
            }}
          />
        ) : (
          <NoteText text={item.text} width={item.width} height={item.height} />
        )}
      </div>
    )
  }

  if (item.kind === 'text') {
    // one style for writing and reading, or the box jumps when editing ends
    const textStyle: React.CSSProperties = {
      color: item.color || 'var(--color-text-base)',
      fontFamily: 'var(--font-sans)', fontSize: '20px', fontWeight: 600, lineHeight: 1.3
    }
    return (
      <div style={base}>
        {editing ? (
          <WallTextEditor
            value={item.text ?? ''}
            onChange={text => onTextChange(item.id, text)}
            onFinish={onFinishEditing}
            onHeight={height => onAutoSize?.(item.id, height)}
            style={{
              ...textStyle, display: 'block', width: '100%', height: '100%', padding: 0,
              resize: 'none', border: 'none', outline: 'none', background: 'transparent', overflow: 'hidden'
            }}
          />
        ) : (
          <TextBox item={item} style={textStyle} onAutoSize={onAutoSize} />
        )}
      </div>
    )
  }

  // outline plus label above, an annotation not a container
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

  // by title, rendered from live metadata so it's never stale
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
      <div className="wall-paper" style={{
        ...base,
        display: 'flex', flexDirection: 'column', gap: '6px',
        padding: 'var(--space-3)',
        background: 'var(--color-surface-1)',
        border: `1px solid ${item.color || 'var(--color-surface-offset)'}`,
        borderLeft: `3px solid ${item.color || 'var(--color-secondary)'}`,
        borderRadius: 'var(--radius-md)',
        boxShadow: '0 2px 8px rgba(0,0,0,0.25)'
      }}>
        <div className="row-6px">
          <FileText size={12} className="icon-faint" />
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

  // a pasted page; the whole card is its link, so it wears no chip
  if (item.kind === 'bookmark') {
    const link = parseWallLink(item.link)
    const host = link?.type === 'url' ? link.host : ''
    return (
      <div className="wall-paper" style={{
        ...base,
        display: 'flex', flexDirection: 'column', gap: '6px',
        padding: 'var(--space-3)',
        background: 'var(--color-surface-1)',
        border: `1px solid ${item.color || 'var(--color-surface-offset)'}`,
        borderRadius: 'var(--radius-md)',
        boxShadow: '0 2px 8px rgba(0,0,0,0.25)'
      }}>
        <div className="row-6px">
          {item.ref ? (
            <img
              src={`checkpoint-media://${item.ref}`}
              alt=""
              width={14}
              height={14}
              draggable={false}
              style={{ flexShrink: 0, borderRadius: '3px', objectFit: 'contain' }}
            />
          ) : (
            <Globe size={14} className="icon-faint" style={{ flexShrink: 0 }} />
          )}
          <span className="truncate" style={{ fontSize: '11px', color: 'var(--color-text-faint)' }}>
            {host}
          </span>
        </div>
        <span style={{
          fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)',
          color: 'var(--color-text-base)', lineHeight: 1.35, wordBreak: 'break-word',
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden'
        }}>
          {item.text || host}
        </span>
        {previewing ? (
          <span style={{ fontSize: '11px', color: 'var(--color-text-faint)' }}>Fetching the page…</span>
        ) : item.summary && (
          <span style={{
            fontSize: '11px', color: 'var(--color-text-muted)', lineHeight: 1.45,
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden'
          }}>
            {item.summary}
          </span>
        )}
      </div>
    )
  }

  // ink
  if (item.kind === 'ink') {
    const natural = inkNaturalSize(item)
    return (
      <svg
        width="100%"
        height="100%"
        // the drawn box as viewBox, so resizing scales instead of cropping
        viewBox={`0 0 ${natural.width} ${natural.height}`}
        preserveAspectRatio="none"
        style={{ display: 'block', overflow: 'visible', pointerEvents: 'none' }}
      >
        {/* fat invisible hit path; a stroke's empty box would swallow drags meant for items under it */}
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
      <img className="wall-paper"
        // display-sized copy, 2x for a little zoom; see mediaPreview.ts
        src={`checkpoint-media://${item.ref}?w=${Math.round(item.width * 2)}`}
        alt={item.text || 'Wall image'}
        draggable={false}
        // async decode, a sync one hitches mid-drag
        decoding="async"
        style={{
          ...base,
          objectFit: 'cover',
          borderRadius: 'var(--radius-sm)',
          boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
          display: 'block'
        }}
      />
    )
  }

  // referenced, never copied: a deleted card leaves a marker
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
    <div className="wall-paper" style={{
      ...base,
      display: 'flex', flexDirection: 'column', gap: '6px',
      padding: 'var(--space-3)',
      background: 'var(--color-surface-1)',
      border: `1px solid ${item.color || 'var(--color-surface-offset)'}`,
      borderLeft: `3px solid ${item.color || 'var(--color-primary)'}`,
      borderRadius: 'var(--radius-md)',
      boxShadow: '0 2px 8px rgba(0,0,0,0.25)'
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

// memoised so a drag re-renders only the moved items
export default React.memo(WallItemView)
