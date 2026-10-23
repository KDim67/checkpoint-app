import React from 'react'
import useFocusTrap from './useFocusTrap'
import useEscapeKey from './useEscapeKey'
import { usePresenceState } from '../../lib/presence'

interface ModalShellProps {
  /** accessible name; the visible heading stays in children */
  label: string
  onClose: () => void
  width?: string
  /** off for destructive prompts */
  closeOnBackdrop?: boolean
  children: React.ReactNode
}

/** dialog role, focus trap and Escape that the hand-rolled copies lacked */
export default function ModalShell({
  label,
  onClose,
  width = '400px',
  closeOnBackdrop = true,
  children
}: ModalShellProps) {
  // leaving inside Presence, it gives focus back at once and plays its exit
  const presence = usePresenceState()
  const open = presence === 'open'
  const containerRef = useFocusTrap(open)
  useEscapeKey(onClose, open)

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      className="motion-backdrop"
      data-state={presence}
      onClick={closeOnBackdrop ? e => e.target === e.currentTarget && onClose() : undefined}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.6)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 999,
        padding: 'var(--space-4)'
      }}
    >
      <div
        className="motion-pop"
        data-state={presence}
        style={{
          background: 'var(--color-surface-elevated)',
          border: '1px solid var(--color-surface-offset)',
          borderRadius: 'var(--radius-lg)',
          padding: 'var(--space-6)',
          width,
          maxWidth: '100%',
          maxHeight: '85vh',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-4)',
          boxShadow: 'var(--shadow-lg)'
        }}
      >
        {children}
      </div>
    </div>
  )
}
