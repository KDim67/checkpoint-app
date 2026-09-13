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
      <div className="col-2px">
        <span className="text-item-bold">No Image Loaded</span>
        <span className="text-hint">{hint}</span>
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
