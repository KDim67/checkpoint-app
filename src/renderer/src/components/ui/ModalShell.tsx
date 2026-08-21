import React from 'react'
import useFocusTrap from './useFocusTrap'
import useEscapeKey from './useEscapeKey'

interface ModalShellProps {
  /** Accessible name for the dialog. The visible heading stays in children. */
  label: string
  onClose: () => void
  width?: string
  /** Off for destructive prompts, where a stray backdrop click should not dismiss. */
  closeOnBackdrop?: boolean
  children: React.ReactNode
}

/**
 * Backdrop and panel for the one-off dialogs scattered across the settings and
 * board views. Carries the dialog role, focus trap and Escape handling that
 * each hand-rolled copy was missing.
 */
export default function ModalShell({
  label,
  onClose,
  width = '400px',
  closeOnBackdrop = true,
  children
}: ModalShellProps) {
  const containerRef = useFocusTrap(true)
  useEscapeKey(onClose, true)

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      aria-label={label}
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
          boxShadow: 'var(--shadow-lg)',
          animation: 'modal-pop-in 200ms var(--ease-enter)'
        }}
      >
        {children}
      </div>
    </div>
  )
}
