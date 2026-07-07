import React, { useState, useRef } from 'react'
import { Plus } from 'lucide-react'
import useEscapeKey from '../ui/useEscapeKey'
import useFocusTrap from '../ui/useFocusTrap'
import ColorPicker from '../ui/ColorPicker'

interface AddColumnModalProps {
  onClose: () => void
  onSubmit: (name: string, wipLimit: number | null, color?: string, colorMode?: 'header' | 'full') => void
  existingNames: string[]
}

export default function AddColumnModal({ onClose, onSubmit, existingNames }: AddColumnModalProps) {
  const [name, setName] = useState('')
  const [wipLimit, setWipLimit] = useState<string>('')
  const [color, setColor] = useState<string | undefined>(undefined)
  const [colorMode, setColorMode] = useState<'header' | 'full'>('header')
  const [error, setError] = useState<string | null>(null)

  const inputRef = useRef<HTMLInputElement | null>(null)
  const containerRef = useFocusTrap(true, inputRef)
  useEscapeKey(onClose, true)

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    const trimmedName = name.trim()
    if (!trimmedName) {
      setError('Column title cannot be empty.')
      return
    }

    if (existingNames.some(existingName => existingName.toLowerCase() === trimmedName.toLowerCase())) {
      setError(`A column named "${trimmedName}" already exists.`)
      return
    }

    const parsedWip = wipLimit.trim() === '' ? null : parseInt(wipLimit)
    if (parsedWip !== null && (isNaN(parsedWip) || parsedWip <= 0)) {
      setError('WIP limit must be a positive integer.')
      return
    }

    onSubmit(trimmedName, parsedWip, color, colorMode)
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <style>{`
        .modal-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.7);
          z-index: 1000;
          display: flex;
          align-items: center;
          justify-content: center;
          backdrop-filter: blur(4px);
          animation: modal-fade-in 150ms var(--ease-enter);
        }
        .modal-form {
          width: 400px;
          background: var(--color-surface-1);
          border: 1px solid var(--color-surface-offset);
          border-radius: var(--radius-lg);
          padding: var(--space-6);
          display: flex;
          flex-direction: column;
          gap: var(--space-4);
          box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);
          animation: modal-scale-in 250ms var(--ease-spring);
        }
        @keyframes modal-fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes modal-scale-in {
          from { transform: scale(0.93); opacity: 0; }
          to { transform: scale(1); opacity: 1; }
        }
      `}</style>

      <form
        ref={containerRef as React.RefObject<HTMLFormElement>}
        className="modal-form"
        onSubmit={handleFormSubmit}
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="col-modal-title"
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <Plus style={{ color: 'var(--color-secondary)' }} size={20} />
          <h2 id="col-modal-title" style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-semibold)', margin: 0 }}>
            Create Custom Column
          </h2>
        </div>

        <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', margin: 0 }}>
          Add a new column stage to this context's Kanban workflow.
        </p>

        {/* Error Alert Box */}
        {error && (
          <div style={{
            fontSize: 'var(--text-xs)',
            color: 'var(--color-error)',
            background: 'var(--color-error-muted)',
            padding: 'var(--space-2) var(--space-3)',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid rgba(239, 68, 68, 0.2)'
          }}>
            ⚠️ {error}
          </div>
        )}

        {/* Column Name Input */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1.5)' }}>
          <label htmlFor="col-name-input" style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text-muted)' }}>
            Column Title
          </label>
          <input
            ref={inputRef}
            id="col-name-input"
            type="text"
            value={name}
            onChange={e => { setName(e.target.value); setError(null) }}
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
            onChange={e => { setWipLimit(e.target.value); setError(null) }}
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

        {/* Column Theme & Mode */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          <label style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text-muted)' }}>
            Column Theme & Display Mode
          </label>
          
          <div style={{ display: 'flex', gap: '8px', marginBottom: '4px' }}>
            <button
              type="button"
              onClick={() => setColorMode('header')}
              style={{
                flex: 1,
                padding: '6px',
                fontSize: '11px',
                fontWeight: 'var(--weight-bold)',
                borderRadius: '4px',
                border: colorMode === 'header' ? '1px solid var(--color-secondary)' : '1px solid var(--color-surface-offset)',
                background: colorMode === 'header' ? 'var(--color-secondary)' : 'var(--color-surface-2)',
                color: colorMode === 'header' ? '#0f172a' : 'var(--color-text-base)',
                cursor: 'pointer'
              }}
            >
              Header Accent
            </button>
            <button
              type="button"
              onClick={() => setColorMode('full')}
              style={{
                flex: 1,
                padding: '6px',
                fontSize: '11px',
                fontWeight: 'var(--weight-bold)',
                borderRadius: '4px',
                border: colorMode === 'full' ? '1px solid var(--color-secondary)' : '1px solid var(--color-surface-offset)',
                background: colorMode === 'full' ? 'var(--color-secondary)' : 'var(--color-surface-2)',
                color: colorMode === 'full' ? '#0f172a' : 'var(--color-text-base)',
                cursor: 'pointer'
              }}
            >
              Full Column Fill
            </button>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', alignItems: 'center' }}>
            {['none', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#a855f7', '#ec4899'].map(cVal => (
              <button
                type="button"
                key={cVal}
                onClick={() => setColor(cVal === 'none' ? undefined : cVal)}
                style={{
                  width: '18px',
                  height: '18px',
                  borderRadius: '4px',
                  background: cVal === 'none' ? 'transparent' : cVal,
                  border: (color === cVal || (cVal === 'none' && !color)) ? '2px solid var(--color-text-base)' : (cVal === 'none' ? '1px dashed var(--color-text-muted)' : '1px solid transparent'),
                  cursor: 'pointer',
                  padding: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '9px',
                  color: 'var(--color-text-base)'
                }}
                title={cVal === 'none' ? 'Default Accent' : cVal}
              >
                {cVal === 'none' && '×'}
              </button>
            ))}
            <ColorPicker
              value={color || ''}
              onCommit={cVal => setColor(cVal || undefined)}
              swatchSize={20}
              hexInputWidth={58}
              title="Custom Column Color"
            />
          </div>
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
