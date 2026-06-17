import React, { useState } from 'react'
import { Plus } from 'lucide-react'

interface AddColumnModalProps {
  onClose: () => void
  onSubmit: (name: string, wipLimit: number | null) => void
}

export default function AddColumnModal({ onClose, onSubmit }: AddColumnModalProps) {
  const [name, setName] = useState('')
  const [wipLimit, setWipLimit] = useState<string>('')

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return

    const parsedWip = wipLimit.trim() === '' ? null : parseInt(wipLimit)
    if (parsedWip !== null && (isNaN(parsedWip) || parsedWip <= 0)) return

    onSubmit(name.trim(), parsedWip)
  }

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'rgba(0, 0, 0, 0.7)',
      zIndex: 1000,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      backdropFilter: 'blur(4px)'
    }}
    onClick={onClose}
    >
      <form
        onSubmit={handleFormSubmit}
        onClick={e => e.stopPropagation()}
        style={{
          width: '400px',
          background: 'var(--color-surface-1)',
          border: '1px solid var(--color-surface-offset)',
          borderRadius: 'var(--radius-lg)',
          padding: 'var(--space-6)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-4)',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <Plus style={{ color: 'var(--color-secondary)' }} size={20} />
          <h2 style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-semibold)', margin: 0 }}>
            Create Custom Column
          </h2>
        </div>

        <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', margin: 0 }}>
          Add a new column stage to this context's Kanban workflow.
        </p>

        {/* Column Name Input */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1.5)' }}>
          <label htmlFor="col-name-input" style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text-muted)' }}>
            Column Title
          </label>
          <input
            id="col-name-input"
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. In Review, QA, Testing..."
            autoFocus
            required
            style={{
              background: 'var(--color-surface-2)',
              border: '1px solid var(--color-surface-offset)',
              color: 'var(--color-text-base)',
              borderRadius: 'var(--radius-md)',
              padding: 'var(--space-2.5) var(--space-3.5)',
              fontSize: 'var(--text-sm)',
              outline: 'none'
            }}
          />
        </div>

        {/* WIP Limit Input */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1.5)' }}>
          <label htmlFor="col-wip-input" style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text-muted)' }}>
            WIP Limit (Optional)
          </label>
          <input
            id="col-wip-input"
            type="number"
            value={wipLimit}
            onChange={e => setWipLimit(e.target.value)}
            placeholder="No limit"
            min={1}
            style={{
              background: 'var(--color-surface-2)',
              border: '1px solid var(--color-surface-offset)',
              color: 'var(--color-text-base)',
              borderRadius: 'var(--radius-md)',
              padding: 'var(--space-2.5) var(--space-3.5)',
              fontSize: 'var(--text-sm)',
              outline: 'none'
            }}
          />
        </div>

        {/* Form Actions */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'transparent',
              border: '1px solid var(--color-surface-offset)',
              color: 'var(--color-text-base)',
              borderRadius: 'var(--radius-md)',
              padding: 'var(--space-2) var(--space-4)',
              fontSize: 'var(--text-sm)',
              cursor: 'pointer'
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-surface-offset)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            Cancel
          </button>
          
          <button
            type="submit"
            style={{
              background: 'var(--color-secondary)',
              border: 'none',
              color: 'var(--color-text-inverted)',
              borderRadius: 'var(--radius-md)',
              padding: 'var(--space-2) var(--space-4)',
              fontSize: 'var(--text-sm)',
              fontWeight: 'var(--weight-semibold)',
              cursor: 'pointer'
            }}
            onMouseEnter={e => (e.currentTarget.style.filter = 'brightness(1.15)')}
            onMouseLeave={e => (e.currentTarget.style.filter = 'none')}
          >
            Create Column
          </button>
        </div>
      </form>
    </div>
  )
}
