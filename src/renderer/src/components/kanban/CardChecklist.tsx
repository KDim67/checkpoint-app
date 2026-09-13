import type { Dispatch, SetStateAction } from 'react'
import { CheckSquare, Trash2 } from 'lucide-react'

export type ChecklistItem = { id: string; text: string; done: boolean }

interface CardChecklistProps {
  items: ChecklistItem[]
  draft: string
  setDraft: Dispatch<SetStateAction<string>>
  onAdd: (text: string) => void
  onToggle: (itemId: string) => void
  onDelete: (itemId: string) => void
}

export default function CardChecklist({ items, draft, setDraft, onAdd, onToggle, onDelete }: CardChecklistProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', borderTop: '1px solid var(--color-surface-offset)', paddingTop: 'var(--space-4)', marginTop: 'var(--space-2)' }}>
      <div className="row-between">
        <span style={{ fontSize: '11px', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-muted)', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <CheckSquare size={13} className="text-accent" />
          Sub-Task Checklist
        </span>
        {items.length > 0 && (
          <span style={{ fontSize: '10px', color: 'var(--color-text-faint)' }}>
            {items.filter(c => c.done).length} of {items.length} tasks completed
          </span>
        )}
      </div>

      {/* Checklist Progress Bar */}
      {items.length > 0 && (
        <div className="col-6px">
          <div style={{ height: '6px', background: 'var(--color-surface-2)', borderRadius: '3px', overflow: 'hidden' }}>
            <div style={{ width: `${items.length > 0 ? Math.round((items.filter(i => i.done).length / items.length) * 100) : 0}%`, height: '100%', background: 'var(--color-secondary)', borderRadius: '3px', transition: 'width 200ms ease' }} />
          </div>
        </div>
      )}

      {/* Checklist Items */}
      <div className="col-4px">
        {items.map(item => (
          <div
            key={item.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '6px var(--space-2)',
              background: 'var(--color-surface-2)',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--color-surface-offset)'
            }}
          >
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', flex: 1, minWidth: 0 }}>
              <input
                type="checkbox"
                checked={item.done}
                onChange={() => onToggle(item.id)}
              />
              <span style={{
                fontSize: 'var(--text-xs)',
                color: item.done ? 'var(--color-text-faint)' : 'var(--color-text-base)',
                textDecoration: item.done ? 'line-through' : 'none',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap'
              }}>
                {item.text}
              </span>
            </label>
            <button
              onClick={() => onDelete(item.id)}
              style={{ background: 'transparent', border: 'none', color: 'var(--color-text-faint)', cursor: 'pointer', padding: '2px' }}
              onMouseEnter={e => e.currentTarget.style.color = 'var(--color-error)'}
              onMouseLeave={e => e.currentTarget.style.color = 'var(--color-text-faint)'}
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>

      {/* Add Checklist Item Form */}
      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
        <input
          type="text"
          placeholder="Add sub-task..."
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault()
              onAdd(draft)
              setDraft('')
            }
          }}
          style={{
            flex: 1,
            background: 'var(--color-surface-2)',
            border: '1px solid var(--color-surface-offset)',
            color: 'var(--color-text-base)',
            borderRadius: 'var(--radius-md)',
            padding: 'var(--space-2) var(--space-3)',
            fontSize: 'var(--text-xs)',
            outline: 'none'
          }}
        />
        <button
          onClick={() => {
            onAdd(draft)
            setDraft('')
          }}
          style={{
            background: 'var(--color-surface-offset)',
            border: 'none',
            borderRadius: 'var(--radius-md)',
            color: 'var(--color-text-base)',
            fontWeight: 'var(--weight-semibold)',
            fontSize: 'var(--text-xs)',
            padding: '0 var(--space-4)',
            cursor: 'pointer'
          }}
        >
          Add Item
        </button>
      </div>
    </div>
  )
}
