import type { MouseEventHandler } from 'react'

interface ActiveTextureHeaderProps {
  label: string
  path: string | null | undefined
  onChange: MouseEventHandler<HTMLButtonElement>
  onClear: MouseEventHandler<HTMLButtonElement>
}

export default function ActiveTextureHeader({ label, path, onChange, onClear }: ActiveTextureHeaderProps) {
  return (
    <div className="panel-row">
      <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: '2px' }}>
        <span className="text-caption">{label}</span>
        <span style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-base)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={path || ''}>
          {path ? path.split(/[\\/]/).pop() : 'Direct Memory'}
        </span>
      </div>

      <div className="flex-gap">
        <button
          onClick={onChange}
          style={{
            background: 'var(--color-surface-2)',
            border: '1px solid var(--color-surface-offset)',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--color-text-base)',
            fontSize: '11px',
            padding: '6px 12px',
            cursor: 'pointer'
          }}
        >
          Change Texture
        </button>
        <button
          onClick={onClear}
          style={{
            background: 'transparent',
            border: '1px solid var(--color-error-muted)',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--color-error)',
            fontSize: '11px',
            padding: '6px 12px',
            cursor: 'pointer'
          }}
        >
          Clear
        </button>
      </div>
    </div>
  )
}
