import type { Dispatch, SetStateAction } from 'react'
import { Search } from 'lucide-react'
import type { WallItem } from '../../../../shared/wallModel'

interface WallSearchProps {
  query: string
  setQuery: Dispatch<SetStateAction<string>>
  matches: WallItem[]
  jumpTo: (item: WallItem) => void
  labelOf: (item: WallItem) => string | undefined
}

export default function WallSearch({ query, setQuery, matches, jumpTo, labelOf }: WallSearchProps) {
  return (
    <div className="relative">
      <Search
        size={12}
        style={{ position: 'absolute', left: '8px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-faint)', pointerEvents: 'none' }}
      />
      <input
        value={query}
        onChange={e => setQuery(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Escape') { setQuery(''); (e.target as HTMLInputElement).blur() }
          // Enter jumps to the best match, no mouse needed
          if (e.key === 'Enter' && matches.length > 0) { jumpTo(matches[0]); setQuery('') }
        }}
        placeholder="Find on this wall"
        aria-label="Find on this wall"
        style={{
          width: '170px',
          background: 'var(--color-surface-2)',
          border: '1px solid var(--color-surface-offset)',
          borderRadius: 'var(--radius-md)',
          color: 'var(--color-text-base)',
          padding: '4px 8px 4px 24px',
          fontSize: 'var(--text-xs)',
          outline: 'none'
        }}
      />

      {query.trim() !== '' && matches.length === 0 && (
        <div style={{
          position: 'absolute', top: '100%', right: 0, marginTop: '4px', zIndex: 25,
          width: '260px', padding: 'var(--space-3)',
          background: 'var(--color-surface-elevated)',
          border: '1px solid var(--color-surface-offset)',
          borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg)',
          fontSize: 'var(--text-xs)', color: 'var(--color-text-faint)'
        }}>
          Nothing on this wall matches.
        </div>
      )}

      {matches.length > 0 && (
        <div style={{
          position: 'absolute', top: '100%', right: 0, marginTop: '4px', zIndex: 25,
          width: '260px', maxHeight: '260px', overflowY: 'auto',
          background: 'var(--color-surface-elevated)',
          border: '1px solid var(--color-surface-offset)',
          borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg)', padding: '4px'
        }}>
          {matches.slice(0, 12).map(m => (
            <button
              key={m.id}
              onClick={() => { jumpTo(m); setQuery('') }}
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
  )
}
