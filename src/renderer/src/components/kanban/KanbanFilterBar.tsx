import type { KanbanBoard } from './useKanbanBoard'

export default function KanbanFilterBar({ kanbanBoard }: { kanbanBoard: KanbanBoard }) {
  const {
    searchQuery, setSearchQuery, filterPriority, setFilterPriority, filterTagId, setFilterTagId,
    allTags
  } = kanbanBoard
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '6px var(--space-6)',
      borderBottom: '1px solid var(--color-surface-offset)',
      background: 'var(--color-surface-1)90',
      backdropFilter: 'blur(8px)',
      flexShrink: 0,
      gap: 'var(--space-4)',
      flexWrap: 'wrap'
    }}>
      {/* Search Input */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: '200px' }}>
        <input
          type="text"
          placeholder="Search cards (title, body, tag)..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          style={{
            width: '100%',
            background: 'var(--color-surface-2)',
            border: '1px solid var(--color-surface-offset)',
            color: 'var(--color-text-base)',
            borderRadius: 'var(--radius-md)',
            padding: '5px 10px',
            fontSize: 'var(--text-xs)',
            outline: 'none',
            transition: 'border-color var(--duration-fast)'
          }}
          onFocus={e => (e.target.style.borderColor = 'var(--color-secondary)')}
          onBlurCapture={e => (e.currentTarget.style.borderColor = 'var(--color-surface-offset)')}
        />
      </div>

      {/* Filters Group */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
        {/* Priority filter */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontSize: '10px', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-faint)', textTransform: 'uppercase' }}>Priority:</span>
          <select
            value={filterPriority}
            onChange={e => setFilterPriority(parseInt(e.target.value))}
            style={{
              background: 'var(--color-surface-2)',
              border: '1px solid var(--color-surface-offset)',
              color: 'var(--color-text-base)',
              borderRadius: 'var(--radius-sm)',
              padding: '3px 6px',
              fontSize: 'var(--text-xs)',
              outline: 'none'
            }}
          >
            <option value={-1}>All</option>
            <option value={3}>High</option>
            <option value={2}>Medium</option>
            <option value={1}>Low</option>
            <option value={0}>None</option>
          </select>
        </div>

        {/* Tag filter */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontSize: '10px', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-faint)', textTransform: 'uppercase' }}>Tag:</span>
          <select
            value={filterTagId}
            onChange={e => setFilterTagId(e.target.value)}
            style={{
              background: 'var(--color-surface-2)',
              border: '1px solid var(--color-surface-offset)',
              color: 'var(--color-text-base)',
              borderRadius: 'var(--radius-sm)',
              padding: '3px 6px',
              fontSize: 'var(--text-xs)',
              outline: 'none',
              maxWidth: '120px'
            }}
          >
            <option value="all">All</option>
            {allTags.map(tag => (
              <option key={tag.id} value={tag.id}>{tag.name}</option>
            ))}
          </select>
        </div>

        {/* Reset Filters button */}
        {(searchQuery || filterPriority !== -1 || filterTagId !== 'all') && (
          <button
            onClick={() => { setSearchQuery(''); setFilterPriority(-1); setFilterTagId('all') }}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--color-secondary)',
              fontSize: '11px',
              cursor: 'pointer',
              fontWeight: 'var(--weight-bold)',
              padding: '2px 4px'
            }}
          >
            Reset
          </button>
        )}
      </div>
    </div>
  )
}
