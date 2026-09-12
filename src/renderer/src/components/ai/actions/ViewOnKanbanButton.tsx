import type { MouseEventHandler } from 'react'
import { ArrowRight, Layout } from 'lucide-react'

export default function ViewOnKanbanButton({ onClick }: { onClick: MouseEventHandler<HTMLButtonElement> }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: 'var(--color-secondary)',
        border: 'none',
        color: 'var(--color-text-inverted)',
        borderRadius: 'var(--radius-sm)',
        padding: '4px 10px',
        fontSize: '11px',
        fontWeight: 'bold',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: '5px',
        boxShadow: '0 2px 6px rgba(0,0,0,0.2)',
        transition: 'opacity 150ms ease'
      }}
      onMouseEnter={e => (e.currentTarget.style.opacity = '0.9')}
      onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
    >
      <Layout size={12} />
      <span>View on Kanban</span>
      <ArrowRight size={11} />
    </button>
  )
}
