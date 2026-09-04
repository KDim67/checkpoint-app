import React, { useState, useRef, useEffect } from 'react'
import {
  Plus, Search, Hash, Pin, PinOff, CalendarDays, ChevronDown,
  Clock, ArrowDownAZ, HardDrive, X, Loader2, FolderInput
} from 'lucide-react'
import type { NoteMetadata } from '../../../../shared/types'
import { NOTE_TEMPLATES, formatRelativeTime, type SortKey } from './notesUtils'

export interface SidebarItem {
  note: NoteMetadata
  snippet?: string
}

interface NotesSidebarProps {
  items: SidebarItem[]
  allTags: string[]
  totalCount: number
  activeTitle: string | null
  pinned: Set<string>
  loading: boolean
  searching: boolean
  searchQuery: string
  onSearchChange: (q: string) => void
  sort: SortKey
  onSortChange: (s: SortKey) => void
  selectedTag: string | null
  onSelectTag: (t: string | null) => void
  onSelect: (title: string) => void
  onTogglePin: (title: string) => void
  onCreate: (templateId?: string) => void
  onDaily: () => void
  onImportVault: () => void
}

const SORTS: { key: SortKey; label: string; icon: React.ReactNode }[] = [
  { key: 'updated', label: 'Recently updated', icon: <Clock size={13} /> },
  { key: 'title', label: 'Title (A–Z)', icon: <ArrowDownAZ size={13} /> },
  { key: 'size', label: 'Largest first', icon: <HardDrive size={13} /> }
]

export default function NotesSidebar(props: NotesSidebarProps): React.JSX.Element {
  const {
    items, allTags, totalCount, activeTitle, pinned, loading, searching,
    searchQuery, onSearchChange, sort, onSortChange, selectedTag, onSelectTag,
    onSelect, onTogglePin, onCreate, onDaily, onImportVault
  } = props

  const [templateMenu, setTemplateMenu] = useState(false)
  const [sortMenu, setSortMenu] = useState(false)
  const [showAllTags, setShowAllTags] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const sortRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!templateMenu && !sortMenu) return
    const handler = (e: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setTemplateMenu(false)
      if (sortRef.current && !sortRef.current.contains(e.target as Node)) setSortMenu(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [templateMenu, sortMenu])

  const visibleTags = showAllTags ? allTags : allTags.slice(0, 8)
  const activeSort = SORTS.find(s => s.key === sort) ?? SORTS[0]

  return (
    <div className="notes-sidebar">
      {/* Header */}
      <div style={{ padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', borderBottom: '1px solid var(--color-surface-offset)', flexShrink: 0 }}>
        <div className="row-between">
          <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-base)', display: 'flex', alignItems: 'center', gap: '6px' }}>
            Notes
            <span style={{ fontSize: '10px', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text-faint)', background: 'var(--color-surface-2)', borderRadius: 'var(--radius-full)', padding: '1px 7px' }}>
              {totalCount}
            </span>
          </span>
          <div style={{ display: 'flex', gap: '2px' }}>
            <button
              className="notes-icon-btn"
              title="Import an Obsidian vault"
              aria-label="Import an Obsidian vault"
              onClick={onImportVault}
            >
              <FolderInput size={15} />
            </button>
            <button
              className="notes-icon-btn"
              title="Open today's daily note"
              aria-label="Open today's daily note"
              onClick={onDaily}
            >
              <CalendarDays size={15} />
            </button>
          </div>
        </div>

        {/* New note split-button */}
        <div style={{ display: 'flex', position: 'relative' }} ref={menuRef}>
          <button
            onClick={() => onCreate()}
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 'var(--space-2)',
              background: 'var(--color-secondary)',
              color: 'var(--color-text-inverted)',
              border: 'none',
              borderRadius: 'var(--radius-md) 0 0 var(--radius-md)',
              padding: '8px',
              fontWeight: 'var(--weight-bold)',
              fontSize: 'var(--text-sm)',
              cursor: 'pointer'
            }}
          >
            <Plus size={16} />
            New Note
          </button>
          <button
            onClick={() => setTemplateMenu(v => !v)}
            title="New from template"
            aria-label="New from template"
            style={{
              background: 'var(--color-secondary)',
              color: 'var(--color-text-inverted)',
              border: 'none',
              borderLeft: '1px solid rgba(0,0,0,0.15)',
              borderRadius: '0 var(--radius-md) var(--radius-md) 0',
              padding: '0 8px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center'
            }}
          >
            <ChevronDown size={14} />
          </button>

          {templateMenu && (
            <div style={{
              position: 'absolute',
              top: 'calc(100% + 4px)',
              left: 0,
              right: 0,
              background: 'var(--color-surface-elevated)',
              border: '1px solid var(--color-surface-offset)',
              borderRadius: 'var(--radius-md)',
              boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
              zIndex: 40,
              overflow: 'hidden'
            }}>
              {NOTE_TEMPLATES.map(t => (
                <button
                  key={t.id}
                  onClick={() => { setTemplateMenu(false); onCreate(t.id) }}
                  className="notes-menu-item"
                >
                  <span style={{ fontWeight: 'var(--weight-semibold)', fontSize: 'var(--text-xs)', color: 'var(--color-text-base)' }}>{t.label}</span>
                  <span style={{ fontSize: '10px', color: 'var(--color-text-faint)' }}>{t.description}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Search */}
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          {searching
            ? <Loader2 size={14} className="notes-spin" style={{ position: 'absolute', left: '10px', color: 'var(--color-primary)' }} />
            : <Search size={14} style={{ position: 'absolute', left: '10px', color: 'var(--color-text-faint)' }} />}
          <input
            type="text"
            placeholder="Search title, tags & text…"
            value={searchQuery}
            onChange={e => onSearchChange(e.target.value)}
            style={{
              width: '100%',
              background: 'var(--color-surface-2)',
              border: '1px solid var(--color-surface-offset)',
              borderRadius: 'var(--radius-md)',
              color: 'var(--color-text-base)',
              fontSize: 'var(--text-xs)',
              padding: '6px 28px 6px 30px',
              outline: 'none'
            }}
          />
          {searchQuery && (
            <button
              onClick={() => onSearchChange('')}
              title="Clear search"
              aria-label="Clear search"
              style={{ position: 'absolute', right: '8px', background: 'none', border: 'none', color: 'var(--color-text-faint)', cursor: 'pointer', display: 'flex', padding: 0 }}
            >
              <X size={13} />
            </button>
          )}
        </div>

        {/* Sort control */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'relative' }} ref={sortRef}>
          <span style={{ fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-faint)' }}>
            {searchQuery ? 'Search results' : 'Sorted by'}
          </span>
          {!searchQuery && (
            <>
              <button
                onClick={() => setSortMenu(v => !v)}
                className="notes-sort-btn"
              >
                {activeSort.icon}
                {activeSort.label}
                <ChevronDown size={12} />
              </button>
              {sortMenu && (
                <div style={{
                  position: 'absolute',
                  top: 'calc(100% + 4px)',
                  right: 0,
                  background: 'var(--color-surface-elevated)',
                  border: '1px solid var(--color-surface-offset)',
                  borderRadius: 'var(--radius-md)',
                  boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
                  zIndex: 40,
                  overflow: 'hidden',
                  minWidth: '160px'
                }}>
                  {SORTS.map(s => (
                    <button
                      key={s.key}
                      onClick={() => { onSortChange(s.key); setSortMenu(false) }}
                      className="notes-menu-item"
                      style={{ flexDirection: 'row', alignItems: 'center', gap: '8px', color: s.key === sort ? 'var(--color-secondary)' : 'var(--color-text-base)' }}
                    >
                      {s.icon}
                      <span style={{ fontSize: 'var(--text-xs)' }}>{s.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* List */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {loading ? (
          <div style={{ padding: 'var(--space-4)', color: 'var(--color-text-faint)', fontSize: 'var(--text-xs)', textAlign: 'center' }}>
            Loading notes…
          </div>
        ) : items.length === 0 ? (
          <div style={{ padding: 'var(--space-6)', color: 'var(--color-text-faint)', fontSize: 'var(--text-xs)', textAlign: 'center', lineHeight: 1.6 }}>
            {searchQuery ? `No notes match “${searchQuery}”.` : selectedTag ? 'No notes with this tag.' : 'No notes yet. Create your first note.'}
          </div>
        ) : (
          items.map(({ note, snippet }) => {
            const isActive = note.title === activeTitle
            const isPinned = pinned.has(note.title)
            return (
              <div
                key={note.title}
                className={`notes-list-item ${isActive ? 'active' : ''}`}
                onClick={() => onSelect(note.title)}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '6px' }}>
                  <span style={{ fontWeight: 'var(--weight-semibold)', fontSize: 'var(--text-sm)', color: 'var(--color-text-base)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: '5px' }}>
                    {isPinned && <Pin size={11} style={{ color: 'var(--color-secondary)', flexShrink: 0 }} fill="var(--color-secondary)" />}
                    {note.title}
                  </span>
                  <button
                    className="notes-pin-toggle"
                    title={isPinned ? 'Unpin' : 'Pin to top'}
                    aria-label={isPinned ? 'Unpin note' : 'Pin note'}
                    onClick={e => { e.stopPropagation(); onTogglePin(note.title) }}
                  >
                    {isPinned ? <PinOff size={12} /> : <Pin size={12} />}
                  </button>
                </div>

                {(snippet || note.excerpt) && (
                  <span style={{
                    fontSize: '11px',
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
                  <span style={{ fontSize: '10px', color: 'var(--color-text-faint)', flexShrink: 0 }}>
                    {formatRelativeTime(note.updatedAt)}
                  </span>
                  {note.tags.length > 0 && (
                    <div style={{ display: 'flex', gap: '3px', flexWrap: 'wrap', overflow: 'hidden' }}>
                      {note.tags.slice(0, 3).map(tag => (
                        <span key={tag} style={{ fontSize: '9px', background: 'var(--color-surface-2)', border: '1px solid var(--color-surface-offset)', color: 'var(--color-text-muted)', padding: '0 5px', borderRadius: 'var(--radius-sm)', whiteSpace: 'nowrap' }}>
                          {tag.replace(/^#/, '')}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* Tag filter */}
      {allTags.length > 0 && (
        <div style={{ padding: 'var(--space-3) var(--space-4)', borderTop: '1px solid var(--color-surface-offset)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', maxHeight: '180px', overflowY: 'auto', flexShrink: 0 }}>
          <div className="row-between">
            <span style={{ fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-faint)' }}>
              Filter by tag
            </span>
            {selectedTag && (
              <button onClick={() => onSelectTag(null)} style={{ fontSize: '9px', background: 'none', border: 'none', color: 'var(--color-primary)', cursor: 'pointer', padding: 0 }}>
                Clear
              </button>
            )}
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-1-5)', flexWrap: 'wrap' }}>
            {visibleTags.map(tag => {
              const isActive = selectedTag === tag
              return (
                <button
                  key={tag}
                  className={`tag-pill ${isActive ? 'active' : ''}`}
                  onClick={() => onSelectTag(isActive ? null : tag)}
                >
                  <Hash size={9} />
                  {tag.replace(/^#/, '')}
                </button>
              )
            })}
            {allTags.length > 8 && (
              <button className="tag-pill" onClick={() => setShowAllTags(v => !v)}>
                {showAllTags ? 'Show less' : `+${allTags.length - 8} more`}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
