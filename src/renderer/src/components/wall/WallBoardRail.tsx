/**
 * The board as a rail beside the Wall. Not a second board, but a source and
 * a destination showing only what those two jobs need.
 *
 * Cards already on the wall are dimmed, not hidden: a board with cards missing
 * is a board that lies. Columns are drop targets and cards are not, because
 * ordering belongs to the board.
 */

import React from 'react'
import { Search, X, PanelLeftClose } from 'lucide-react'
import { PRIORITY_COLORS } from '../../lib/priority'
import {
  encodeWallDrag, ORPHAN_COLUMN_ID, WALL_DRAG_MIME, type BoardGroup
} from '../../../../shared/wallBoard'
import type { NoteMetadata } from '../../../../shared/types'

export type RailTab = 'board' | 'notes'

interface Props {
  width: number
  tab: RailTab
  onTabChange: (tab: RailTab) => void
  groups: BoardGroup[]
  notes: NoteMetadata[]
  /** Refs already placed on the open wall, so they can be marked as such. */
  placed: Set<string>
  query: string
  onQueryChange: (query: string) => void
  /** The column a wall drag is currently over, highlighted as a target. */
  dropColumnId: string | null
  onClose: () => void
}

export default function WallBoardRail({
  width, tab, onTabChange, groups, notes, placed, query, onQueryChange, dropColumnId, onClose
}: Props): React.JSX.Element {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const shownNotes = words.length
    ? notes.filter(n => words.every(w => n.title.toLowerCase().includes(w)))
    : notes

  const tabButton = (id: RailTab, label: string, count: number): React.JSX.Element => (
    <button
      onClick={() => onTabChange(id)}
      aria-pressed={tab === id}
      style={{
        flex: 1, padding: 'var(--space-2)', background: 'none', cursor: 'pointer',
        border: 'none', borderBottom: `2px solid ${tab === id ? 'var(--color-secondary)' : 'transparent'}`,
        color: tab === id ? 'var(--color-text-base)' : 'var(--color-text-faint)',
        fontSize: 'var(--text-xs)', fontWeight: tab === id ? 600 : 400
      }}
    >
      {label} <span style={{ opacity: 0.6 }}>{count}</span>
    </button>
  )

  return (
    <div
      data-wall-rail
      style={{
        width: `${width}px`, flexShrink: 0,
        display: 'flex', flexDirection: 'column', minHeight: 0,
        background: 'var(--color-surface-1)',
        borderRight: '1px solid var(--color-surface-offset)'
      }}
    >
      <div style={{
        display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
        padding: 'var(--space-2) var(--space-2) var(--space-2) var(--space-3)'
      }}>
        <span style={{
          flex: 1, fontSize: 'var(--text-xs)', fontWeight: 600,
          color: 'var(--color-text-muted)', letterSpacing: '0.03em', textTransform: 'uppercase'
        }}>
          Board
        </span>
        <button onClick={onClose} title="Hide the board" aria-label="Hide the board" className="btn-icon" style={{ width: '24px', height: '24px' }}>
          <PanelLeftClose size={13} />
        </button>
      </div>

      <div style={{ position: 'relative', padding: '0 var(--space-2) var(--space-2)' }}>
        <Search
          size={12}
          style={{ position: 'absolute', left: '16px', top: '8px', color: 'var(--color-text-faint)', pointerEvents: 'none' }}
        />
        <input
          value={query}
          onChange={e => onQueryChange(e.target.value)}
          onKeyDown={e => { if (e.key === 'Escape') onQueryChange('') }}
          placeholder="Filter"
          aria-label="Filter the board"
          style={{
            width: '100%', boxSizing: 'border-box',
            background: 'var(--color-surface-2)',
            border: '1px solid var(--color-surface-offset)',
            borderRadius: 'var(--radius-md)',
            color: 'var(--color-text-base)',
            padding: '4px 22px 4px 26px', fontSize: 'var(--text-xs)', outline: 'none'
          }}
        />
        {query && (
          <button
            onClick={() => onQueryChange('')}
            title="Clear"
            aria-label="Clear the filter"
            className="btn-icon"
            style={{ position: 'absolute', right: '14px', top: '4px', width: '20px', height: '20px' }}
          >
            <X size={11} />
          </button>
        )}
      </div>

      <div style={{ display: 'flex', borderBottom: '1px solid var(--color-surface-offset)' }}>
        {tabButton('board', 'Cards', groups.reduce((n, g) => n + g.cards.length, 0))}
        {tabButton('notes', 'Notes', shownNotes.length)}
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 'var(--space-2)' }}>
        {tab === 'board' && groups.length === 0 && (
          <p style={{ padding: 'var(--space-3)', fontSize: 'var(--text-xs)', color: 'var(--color-text-faint)', textAlign: 'center' }}>
            {query ? 'No cards match.' : 'This workspace has no cards yet.'}
          </p>
        )}

        {tab === 'board' && groups.map(group => {
          // Orphans have no column to hand back to, so they show but stay inert.
          const droppable = group.column.id !== ORPHAN_COLUMN_ID
          const isTarget = droppable && dropColumnId === group.column.id

          return (
            <div
              key={group.column.id}
              {...(droppable ? { 'data-wall-column': group.column.id } : {})}
              style={{
                marginBottom: 'var(--space-3)', borderRadius: 'var(--radius-md)',
                outline: isTarget ? '2px solid var(--color-secondary)' : 'none',
                outlineOffset: '2px',
                background: isTarget ? 'var(--color-secondary-muted)' : 'transparent',
                transition: 'background 120ms ease'
              }}
            >
              <div style={{
                display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
                padding: '2px var(--space-2) var(--space-2)'
              }}>
                <span style={{
                  width: '7px', height: '7px', borderRadius: '50%', flexShrink: 0,
                  background: group.column.color || 'var(--color-surface-offset)'
                }} />
                <span style={{
                  flex: 1, minWidth: 0, fontSize: '11px', fontWeight: 600,
                  color: 'var(--color-text-muted)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
                }}>
                  {group.column.name}
                </span>
                <span style={{ fontSize: '10px', color: 'var(--color-text-faint)', fontFamily: 'var(--font-mono)' }}>
                  {group.cards.length}
                </span>
              </div>

              {group.cards.length === 0 && (
                <p style={{ padding: '0 var(--space-2) var(--space-2)', fontSize: '10px', color: 'var(--color-text-faint)' }}>
                  {isTarget ? 'Drop to move here' : 'Empty'}
                </p>
              )}

              {group.cards.map(card => {
                const onWall = placed.has(card.id)
                return (
                  <div
                    key={card.id}
                    draggable
                    onDragStart={e => {
                      e.dataTransfer.setData(WALL_DRAG_MIME, encodeWallDrag({ kind: 'card', ref: card.id }))
                      e.dataTransfer.effectAllowed = 'copy'
                    }}
                    title={onWall ? `${card.title} (already on this wall)` : card.title}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
                      padding: 'var(--space-2)', marginBottom: '4px',
                      background: 'var(--color-surface-2)',
                      border: '1px solid var(--color-surface-offset)',
                      borderLeft: `2px solid ${PRIORITY_COLORS[card.priority]?.bar ?? 'transparent'}`,
                      borderRadius: 'var(--radius-sm)',
                      cursor: 'grab', opacity: onWall ? 0.5 : 1
                    }}
                  >
                    <span style={{
                      flex: 1, minWidth: 0, fontSize: 'var(--text-xs)', color: 'var(--color-text-base)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
                    }}>
                      {card.title}
                    </span>
                    {onWall && (
                      <span
                        aria-label="Already on this wall"
                        style={{
                          width: '5px', height: '5px', borderRadius: '50%', flexShrink: 0,
                          background: 'var(--color-secondary)'
                        }}
                      />
                    )}
                  </div>
                )
              })}
            </div>
          )
        })}

        {tab === 'notes' && shownNotes.length === 0 && (
          <p style={{ padding: 'var(--space-3)', fontSize: 'var(--text-xs)', color: 'var(--color-text-faint)', textAlign: 'center' }}>
            {query ? 'No notes match.' : 'No notes yet.'}
          </p>
        )}

        {tab === 'notes' && shownNotes.map(note => {
          const onWall = placed.has(note.title)
          return (
            <div
              key={note.title}
              draggable
              onDragStart={e => {
                e.dataTransfer.setData(WALL_DRAG_MIME, encodeWallDrag({ kind: 'doc', ref: note.title }))
                e.dataTransfer.effectAllowed = 'copy'
              }}
              title={note.title}
              style={{
                display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
                padding: 'var(--space-2)', marginBottom: '4px',
                background: 'var(--color-surface-2)',
                border: '1px solid var(--color-surface-offset)',
                borderRadius: 'var(--radius-sm)',
                cursor: 'grab', opacity: onWall ? 0.5 : 1
              }}
            >
              <span style={{
                flex: 1, minWidth: 0, fontSize: 'var(--text-xs)', color: 'var(--color-text-base)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
              }}>
                {note.title}
              </span>
              {onWall && (
                <span
                  aria-label="Already on this wall"
                  style={{ width: '5px', height: '5px', borderRadius: '50%', flexShrink: 0, background: 'var(--color-secondary)' }}
                />
              )}
            </div>
          )
        })}
      </div>

      {/* Said once here rather than in a tooltip nobody hovers for. */}
      <p style={{
        padding: 'var(--space-2) var(--space-3)', margin: 0,
        borderTop: '1px solid var(--color-surface-offset)',
        fontSize: '10px', lineHeight: 1.5, color: 'var(--color-text-faint)'
      }}>
        Drag onto the wall to place. Drag a card back onto a column to move it.
      </p>
    </div>
  )
}
