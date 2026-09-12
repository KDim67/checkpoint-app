import { X } from 'lucide-react'

export default function DrawerCloseButton({ onClick, title }: { onClick: () => void; title?: string }) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        background: 'transparent',
        border: 'none',
        color: 'var(--color-text-muted)',
        cursor: 'pointer',
        padding: '4px',
        display: 'flex'
      }}
      onMouseEnter={e => (e.currentTarget.style.color = 'var(--color-text-base)')}
      onMouseLeave={e => (e.currentTarget.style.color = 'var(--color-text-muted)')}
    >
      <X size={20} />
    </button>
  )
}
