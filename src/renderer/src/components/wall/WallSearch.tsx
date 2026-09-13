import { useState, type Dispatch, type SetStateAction } from 'react'
import { Search, X } from 'lucide-react'
import type { WallItem } from '../../../../shared/wallModel'
import { isSearching, SEARCH_KINDS, type SearchKind } from '../../../../shared/wallFind'

interface WallSearchProps {
  query: string
  setQuery: Dispatch<SetStateAction<string>>
  kind: SearchKind
  setKind: Dispatch<SetStateAction<SearchKind>>
  matches: WallItem[]
  jumpTo: (item: WallItem) => void
  labelOf: (item: WallItem) => string | undefined
}

export default function WallSearch({ query, setQuery, kind, setKind, matches, jumpTo, labelOf }: WallSearchProps) {
  const [focused, setFocused] = useState(false)
  const searching = isSearching(query, kind)

  const clear = (): void => {
    setQuery('')
    setKind('all')
  }

  return (
    <div className="relative">
      <Search
        size={12}
        style={{ position: 'absolute', left: '8px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-faint)', pointerEvents: 'none' }}
      />
      <input
        value={query}
        onChange={e => setQuery(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={e => {
          if (e.key === 'Escape') { clear(); (e.target as HTMLInputElement).blur() }
          // Enter jumps to the best match and ends the search, no mouse needed
          if (e.key === 'Enter' && matches.length > 0) { jumpTo(matches[0]); clear() }
        }}
        placeholder="Find on this wall"
        aria-label="Find on this wall"
        style={{
          width: '170px',
          background: 'var(--color-surface-2)',
          border: '1px solid var(--color-surface-offset)',
          borderRadius: 'var(--radius-md)',
          color: 'var(--color-text-base)',
          padding: '4px 24px 4px 24px',
          fontSize: 'var(--text-xs)',
          outline: 'none'
        }}
      />
      {searching && (
        <button
          onClick={clear}
          title="Clear the search"
          aria-label="Clear the search"
          className="btn-icon"
          style={{ position: 'absolute', right: '2px', top: '50%', transform: 'translateY(-50%)', width: '20px', height: '20px' }}
        >
          <X size={11} />
        </button>
      )}

      {(focused || searching) && (
        <div
          // keeps focus in the box, a chip that blurred it would close before its click landed
          onMouseDown={e => e.preventDefault()}
          style={{
            position: 'absolute', top: '100%', right: 0, marginTop: '4px', zIndex: 25,
            width: '280px', padding: '4px',
            background: 'var(--color-surface-elevated)',
            border: '1px solid var(--color-surface-offset)',
            borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg)'
          }}
        >
          <div role="group" aria-label="Kind of item" style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', padding: '4px' }}>
            {SEARCH_KINDS.map(option => (
              <button
                key={option.kind}
                onClick={() => setKind(option.kind)}
                aria-pressed={kind === option.kind}
                style={{
                  border: '1px solid var(--color-surface-offset)', borderRadius: 'var(--radius-full)',
                  padding: '1px var(--space-2)', fontSize: '10px', cursor: 'pointer',
                  background: kind === option.kind ? 'var(--color-secondary-muted)' : 'transparent',
                  color: kind === option.kind ? 'var(--color-secondary)' : 'var(--color-text-muted)'
                }}
              >
                {option.label}
              </button>
            ))}
          </div>

          {searching && matches.length === 0 && (
            <div style={{ padding: 'var(--space-2)', fontSize: 'var(--text-xs)', color: 'var(--color-text-faint)' }}>
              Nothing on this wall matches.
            </div>
          )}

          {matches.length > 0 && (
            <div style={{ maxHeight: '240px', overflowY: 'auto' }}>
              {matches.slice(0, 50).map(m => (
                <button
                  key={m.id}
                  // the search stays, so the next result is one more click
                  onClick={() => jumpTo(m)}
                  className="bg-clear hover-bg-offset"
                  style={{
                    display: 'block', width: '100%', textAlign: 'left',
                    border: 'none', cursor: 'pointer', padding: 'var(--space-2)',
                    borderRadius: 'var(--radius-sm)', color: 'var(--color-text-base)',
                    fontSize: 'var(--text-xs)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
                  }}
                >
                  {labelOf(m) || '(untitled)'}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
