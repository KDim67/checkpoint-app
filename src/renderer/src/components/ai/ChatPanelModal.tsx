import type { ReactNode } from 'react'
import { X } from 'lucide-react'

interface ChatPanelModalProps {
  icon: ReactNode
  title: ReactNode
  /** Buttons that sit before the close button in the header. */
  actions?: ReactNode
  onClose: () => void
  children: ReactNode
}

export default function ChatPanelModal({ icon, title, actions, onClose, children }: ChatPanelModalProps) {
  const close = (
    <button
      onClick={onClose}
      style={{ background: 'transparent', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', padding: '2px' }}
    >
      <X size={14} />
    </button>
  )

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 100,
        background: 'rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'var(--space-4)'
      }}
    >
      <div
        style={{
          background: 'var(--color-surface-1)',
          border: '1px solid var(--color-surface-offset)',
          borderRadius: 'var(--radius-md)',
          width: '100%',
          maxHeight: '90%',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
          overflow: 'hidden'
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: 'var(--space-3) var(--space-4)',
            borderBottom: '1px solid var(--color-surface-offset)',
            background: 'var(--color-surface-2)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexShrink: 0
          }}
        >
          <div className="row">
            {icon}
            <span style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-base)' }}>
              {title}
            </span>
          </div>
          {actions ? (
            <div className="row">
              {actions}
              {close}
            </div>
          ) : close}
        </div>
        {children}
      </div>
    </div>
  )
}
