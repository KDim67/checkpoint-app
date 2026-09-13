import { X } from 'lucide-react'

export default function DrawerCloseButton({ onClick, title }: { onClick: () => void; title?: string }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="text-muted hover-text-base"
      style={{
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
        padding: '4px',
        display: 'flex'
      }}
    >
      <X size={20} />
    </button>
  )
}
