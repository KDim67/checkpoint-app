/** one note in the list; far down a long one it's held as its title alone until it comes near, rather than built with the rest */

import React from 'react'
import { Pin, PinOff } from 'lucide-react'
import type { NoteMetadata } from '../../../../shared/types'
import { createHeightMemory, useDrawWhenNear, type NearWatcher } from '../../lib/drawWhenNear'
import { formatRelativeTime } from './notesUtils'

/** the first notes draw straight away, more than a tall window shows */
export const EAGER_NOTES = 30

const noteHeights = createHeightMemory(84)

interface Props {
  note: NoteMetadata
  snippet?: string
  active: boolean
  pinned: boolean
  eager: boolean
  watcher: NearWatcher | null
  onSelect: (title: string) => void
  onTogglePin: (title: string) => void
}

function NoteRow({ note, snippet, active, pinned, eager, watcher, onSelect, onTogglePin }: Props): React.JSX.Element {
  const { drawn, ref, heldPx } = useDrawWhenNear(watcher, noteHeights, note.title, eager)
  const className = `notes-list-item ${active ? 'active' : ''}`

  if (!drawn) {
    return (
      <div ref={el => { ref.current = el }} className={`${className} notes-list-item-held`} style={{ height: heldPx }} onClick={() => onSelect(note.title)}>
        <span className="notes-list-item-title">{note.title}</span>
      </div>
    )
  }

  return (
    <div ref={el => { ref.current = el }} className={className} onClick={() => onSelect(note.title)}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '6px' }}>
        <span className="notes-list-item-title" style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          {pinned && <Pin size={11} className="icon-accent" fill="var(--color-secondary)" />}
          {note.title}
        </span>
        <button
          className="notes-pin-toggle"
          title={pinned ? 'Unpin' : 'Pin to top'}
          aria-label={pinned ? 'Unpin note' : 'Pin note'}
          onClick={e => { e.stopPropagation(); onTogglePin(note.title) }}
        >
          {pinned ? <PinOff size={12} /> : <Pin size={12} />}
        </button>
      </div>

      {(snippet || note.excerpt) && (
        <span style={{
          fontSize: 'var(--text-xs)',
          color: 'var(--color-text-muted)',
          lineHeight: 1.45,
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden'
        }}>
          {snippet || note.excerpt}
        </span>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px' }}>
        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-faint)', flexShrink: 0 }}>
          {formatRelativeTime(note.updatedAt)}
        </span>
        {note.tags.length > 0 && (
          <div style={{ display: 'flex', gap: '3px', flexWrap: 'wrap', overflow: 'hidden' }}>
            {note.tags.slice(0, 3).map(tag => (
              <span key={tag} style={{ fontSize: 'var(--text-2xs)', background: 'var(--color-surface-2)', border: '1px solid var(--color-surface-offset)', color: 'var(--color-text-muted)', padding: '0 5px', borderRadius: 'var(--radius-sm)', whiteSpace: 'nowrap' }}>
                {tag.replace(/^#/, '')}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// typing in a note redrew every row of a long list on every key
export default React.memo(NoteRow)
