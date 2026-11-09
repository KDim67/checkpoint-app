import { X } from 'lucide-react'
import type { KanbanBoard } from './useKanbanBoard'

export default function KanbanFilterBar({ kanbanBoard }: { kanbanBoard: KanbanBoard }) {
  const {
    searchQuery, setSearchQuery, filterPriority, setFilterPriority, filterTagId, setFilterTagId,
    allTags
  } = kanbanBoard

  const cards = kanbanBoard.cards ?? []
  const columns = kanbanBoard.columns ?? []
  const getCardsForColumn = kanbanBoard.getCardsForColumn
  const totalActive = cards.filter(c => c.status !== 'archived').length
  const visibleCount = typeof getCardsForColumn === 'function' && columns.length > 0
    ? columns.reduce((acc, col) => acc + (getCardsForColumn(col.id)?.length || 0), 0)
    : 0
  const hiddenCount = typeof getCardsForColumn === 'function' && columns.length > 0 ? Math.max(0, totalActive - visibleCount) : 0
  const hasActiveFilter = Boolean(searchQuery.trim() || filterPriority !== -1 || filterTagId !== 'all')

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
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', flex: 1, minWidth: '200px' }}>
        <input
          type="text"
          placeholder="Search cards (title, body, tag)..."
          aria-label="Search cards"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          className="border-offset focus-border-accent"
          style={{
            width: '100%',
            background: 'var(--color-surface-2)',
            color: 'var(--color-text-base)',
            borderRadius: 'var(--radius-md)',
            padding: searchQuery ? '5px 28px 5px 10px' : '5px 10px',
            fontSize: 'var(--text-xs)',
            outline: 'none',
            transition: 'border-color var(--duration-fast)'
          }}
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => setSearchQuery('')}
            aria-label="Clear search"
            title="Clear search"
            style={{
              position: 'absolute',
              right: '6px',
              top: '50%',
              transform: 'translateY(-50%)',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--color-text-muted)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '2px'
            }}
          >
            <X size={12} />
          </button>
        )}
      </div>

      <div className="row-lg">
        <div className="row-6px">
          <span style={{ fontSize: 'var(--text-2xs)', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-faint)', textTransform: 'uppercase' }}>Priority:</span>
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
            }}
          >
            <option value={-1}>All</option>
            <option value={3}>High</option>
            <option value={2}>Medium</option>
            <option value={1}>Low</option>
            <option value={0}>None</option>
          </select>
        </div>

        <div className="row-6px">
          <span style={{ fontSize: 'var(--text-2xs)', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-faint)', textTransform: 'uppercase' }}>Tag:</span>
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
              maxWidth: '120px'
            }}
          >
            <option value="all">All</option>
            {allTags.map(tag => (
              <option key={tag.id} value={tag.id}>{tag.name}</option>
            ))}
          </select>
        </div>

        {hasActiveFilter && (
          <button
            onClick={() => { setSearchQuery(''); setFilterPriority(-1); setFilterTagId('all') }}
            aria-label="Clear all filters"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              background: 'var(--color-surface-2)',
              border: '1px solid var(--color-surface-offset)',
              borderRadius: 'var(--radius-full)',
              color: 'var(--color-secondary)',
              fontSize: 'var(--text-xs)',
              cursor: 'pointer',
              fontWeight: 'var(--weight-bold)',
              padding: '2px 8px',
              transition: 'background var(--duration-fast), border-color var(--duration-fast)'
            }}
          >
            <X size={12} style={{ color: 'var(--color-text-muted)' }} />
            <span>Reset</span>
            {hiddenCount > 0 && (
              <span
                style={{
                  background: 'var(--color-primary-muted, var(--color-surface-offset))',
                  color: 'var(--color-primary, var(--color-text-base))',
                  fontSize: 'var(--text-2xs)',
                  fontWeight: 'var(--weight-bold)',
                  borderRadius: 'var(--radius-full)',
                  padding: '1px 6px',
                  lineHeight: 1.2
                }}
              >
                {hiddenCount} hidden
              </span>
            )}
          </button>
        )}
      </div>
    </div>
  )
}
