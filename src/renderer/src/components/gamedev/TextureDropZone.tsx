import type { DragEventHandler } from 'react'
import { Download, Loader } from 'lucide-react'

interface TextureDropZoneProps {
  onDragOver: DragEventHandler<HTMLDivElement>
  onDrop: DragEventHandler<HTMLDivElement>
  onClick: () => void
  processing: boolean
  label: string
  /** What the tool gives back, said under the prompt. */
  outcome?: string
}

export default function TextureDropZone({ onDragOver, onDrop, onClick, processing, label, outcome }: TextureDropZoneProps) {
  return (
    <div
      onDragOver={onDragOver}
      onDrop={onDrop}
      onClick={onClick}
      style={{
        // Not flex: 1. The drop target grew to whatever height was
        // going, which on a tall window left a nine hundred pixel dashed
        // box with a small label adrift in the middle of it.
        minHeight: '260px',
        maxHeight: '420px',
        border: '2px dashed var(--color-surface-offset)',
        borderRadius: 'var(--radius-lg)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 'var(--space-4)',
        cursor: 'pointer',
        background: 'var(--color-surface-1)',
        transition: 'border-color var(--duration-fast), background var(--duration-fast)',
      }}
      onMouseOver={e => {
        e.currentTarget.style.borderColor = 'var(--color-primary)'
        e.currentTarget.style.background = 'var(--color-surface-2)'
      }}
      onMouseOut={e => {
        e.currentTarget.style.borderColor = 'var(--color-surface-offset)'
        e.currentTarget.style.background = 'var(--color-surface-1)'
      }}
    >
      {processing ? (
        <>
          <Loader size={32} className="animate-spin text-accent" />
          <span className="text-sm-muted">Processing texture...</span>
        </>
      ) : (
        <>
          <div style={{
            width: '64px',
            height: '64px',
            borderRadius: 'var(--radius-full)',
            background: 'var(--color-surface-2)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: '1px solid var(--color-surface-offset)'
          }}>
            <Download size={24} style={{ color: 'var(--color-text-muted)', transform: 'rotate(180deg)' }} />
          </div>
          <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span className="text-item-strong">
              {label}
            </span>
            <span className="text-hint">
              or click to browse local files (.png, .jpg, .jpeg, .tga, .bmp)
            </span>
            {/* What comes back. An empty drop target says what to put in
                and never said what you get out. */}
            {outcome && (
              <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--color-text-faint)', marginTop: 'var(--space-2)' }}>
                {outcome}
              </span>
            )}
          </div>
        </>
      )}
    </div>
  )
}
