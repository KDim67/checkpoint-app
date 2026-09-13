import { Link2 } from 'lucide-react'
import type { RelationType } from '@shared/types'
import type { ItemRelations } from './useItemRelations'

export default function RelationsPanel({ links, placeholder }: { links: ItemRelations; placeholder: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', marginTop: 'var(--space-2)' }}>
      <span className="label-caps">
        Linked Relations
      </span>

      {links.relations.length > 0 && (
        <div className="col">
          {links.relations.map(rel => {
            const isFromCurrent = rel.from_id === links.itemId
            const peerId = isFromCurrent ? rel.to_id : rel.from_id
            const label = rel.type === 'blocks'
              ? (isFromCurrent ? 'blocks' : 'is blocked by')
              : rel.type === 'duplicates'
                ? 'duplicates'
                : 'relates to'

            return (
              <div
                key={rel.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  background: 'var(--color-surface-2)',
                  border: '1px solid var(--color-surface-offset)',
                  padding: 'var(--space-2) var(--space-4)',
                  borderRadius: 'var(--radius-md)',
                  fontSize: 'var(--text-xs)'
                }}
              >
                <span className="row">
                  <Link2 size={12} className="text-muted" />
                  <span style={{ color: 'var(--color-text-muted)', fontWeight: 'var(--weight-semibold)' }}>{label}</span>
                  <span className="text-base">Item #{peerId.substring(0, 8)}</span>
                </span>

                <button
                  onClick={() => links.remove(rel.id)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--color-error)',
                    cursor: 'pointer',
                    padding: 0
                  }}
                >
                  Remove
                </button>
              </div>
            )
          })}
        </div>
      )}

      <div style={{ display: 'flex', gap: 'var(--space-2)', position: 'relative' }}>
        <select
          value={links.type}
          onChange={e => links.setType(e.target.value as RelationType)}
          style={{
            background: 'var(--color-surface-2)',
            border: '1px solid var(--color-surface-offset)',
            color: 'var(--color-text-base)',
            borderRadius: 'var(--radius-md)',
            padding: 'var(--space-2) var(--space-3)',
            fontSize: 'var(--text-xs)',
            outline: 'none',
            flexShrink: 0
          }}
        >
          <option value="relates_to">Relates To</option>
          <option value="blocks">Blocks</option>
          <option value="duplicates">Duplicates</option>
        </select>

        <input
          type="text"
          value={links.query}
          onChange={e => links.setQuery(e.target.value)}
          placeholder={placeholder}
          className="input-fill"
        />

        {links.results.length > 0 && (
          <div style={{
            position: 'absolute',
            bottom: '100%',
            left: 0,
            right: 0,
            marginBottom: '4px',
            background: 'var(--color-surface-elevated)',
            border: '1px solid var(--color-surface-offset)',
            borderRadius: 'var(--radius-md)',
            boxShadow: '0 -10px 15px -3px rgba(0,0,0,0.3)',
            maxHeight: '150px',
            overflowY: 'auto',
            zIndex: 200,
            display: 'flex',
            flexDirection: 'column',
            gap: '1px'
          }}>
            {links.results.map(res => (
              <button
                key={res.id}
                onClick={() => links.add(res.id)}
                className="bg-clear hover-bg-offset"
                style={{
                  border: 'none',
                  color: 'var(--color-text-base)',
                  padding: 'var(--space-2)',
                  fontSize: 'var(--text-xs)',
                  textAlign: 'left',
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '2px'
                }}
              >
                <strong style={{ fontSize: '11px' }}>{res.title}</strong>
                <span className="text-nano">#{res.id.substring(0, 8)} | context: {res.context}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
