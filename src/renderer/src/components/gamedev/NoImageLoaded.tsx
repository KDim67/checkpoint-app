import type { MouseEventHandler, ReactNode } from 'react'

interface NoImageLoadedProps {
  icon: ReactNode
  hint: string
  onChoose: MouseEventHandler<HTMLButtonElement>
}

export default function NoImageLoaded({ icon, hint, onChoose }: NoImageLoadedProps) {
  return (
    <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-3)' }}>
      {icon}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
        <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-base)' }}>No Image Loaded</span>
        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>{hint}</span>
      </div>
      <button
        onClick={onChoose}
        style={{
          background: 'var(--color-primary)',
          border: 'none',
          borderRadius: 'var(--radius-md)',
          color: 'white',
          fontWeight: 'var(--weight-semibold)',
          fontSize: 'var(--text-xs)',
          padding: '10px 20px',
          cursor: 'pointer',
        }}
      >
        Choose Image
      </button>
    </div>
  )
}
