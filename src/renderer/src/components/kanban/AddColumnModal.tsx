import React, { useState, useRef } from 'react'
import { Plus } from 'lucide-react'
import useEscapeKey from '../ui/useEscapeKey'
import useFocusTrap from '../ui/useFocusTrap'
import ColorPicker from '../ui/ColorPicker'
import FormActions from '../ui/FormActions'
import ColorSwatchButtons from '../ui/ColorSwatchButtons'

interface AddColumnModalProps {
  onClose: () => void
  onSubmit: (name: string, wipLimit: number | null, color?: string, colorMode?: 'header' | 'full', description?: string) => void
  existingNames: string[]
}

export default function AddColumnModal({ onClose, onSubmit, existingNames }: AddColumnModalProps) {
  const [name, setName] = useState('')
  const [wipLimit, setWipLimit] = useState<string>('')
  const [description, setDescription] = useState('')
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

    onSubmit(trimmedName, parsedWip, color, colorMode, description.trim() || undefined)
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
        <div className="row">
          <Plus className="text-accent" size={20} />
          <h2 id="col-modal-title" style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-semibold)', margin: 0 }}>
            Create Custom Column
          </h2>
        </div>

        <p className="text-hint-flush">
          Add a new column stage to this context's Kanban workflow.
        </p>

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

        <div className="col-sm">
          <label htmlFor="col-name-input" className="text-hint-strong">
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

        <div className="col-sm">
          <label htmlFor="col-wip-input" className="text-hint-strong">
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

        {/* definition of done: column tooltip, and what the assistant fills in */}
        <div className="col-sm">
          <label htmlFor="col-desc-input" className="text-hint-strong">
            Definition of Done (Optional)
          </label>
          <input
            id="col-desc-input"
            type="text"
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="e.g. Reviewed, tested, and merged…"
            maxLength={200}
            style={{
              background: 'var(--color-surface-2)',
              border: '1px solid var(--color-surface-offset)',
              color: 'var(--color-text-base)',
              borderRadius: 'var(--radius-md)',
              padding: 'var(--space-2.5) var(--space-3.5)',
              fontSize: 'var(--text-sm)'
            }}
          />
        </div>

        <div className="col">
          <label className="text-hint-strong">
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
            <ColorSwatchButtons value={color} onPick={setColor} />
            <ColorPicker
              value={color || ''}
              onCommit={cVal => setColor(cVal || undefined)}
              swatchSize={20}
              hexInputWidth={58}
              title="Custom Column Color"
            />
          </div>
        </div>

        <FormActions onCancel={onClose} submitLabel="Create Column" />
      </form>
    </div>
  )
}
