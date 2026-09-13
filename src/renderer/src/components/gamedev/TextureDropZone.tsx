import type { DragEventHandler } from 'react'
import { Download, Loader } from 'lucide-react'

interface TextureDropZoneProps {
  onDragOver: DragEventHandler<HTMLDivElement>
  onDrop: DragEventHandler<HTMLDivElement>
  onClick: () => void
  processing: boolean
  label: string
  /** what you get back, under the prompt */
  outcome?: string
}

export default function TextureDropZone({ onDragOver, onDrop, onClick, processing, label, outcome }: TextureDropZoneProps) {
  return (
    <div
      onDragOver={onDragOver}
      onDrop={onDrop}
      onClick={onClick}
      className="texture-drop-zone"
      style={{
        // not flex: 1, it grew into a 900px dashed box on tall windows
        minHeight: '260px',
        maxHeight: '420px',
        borderRadius: 'var(--radius-lg)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 'var(--space-4)',
        cursor: 'pointer',
        transition: 'border-color var(--duration-fast), background var(--duration-fast)',
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
            {/* say what comes out, not just what goes in */}
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
