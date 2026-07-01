import React, { useEffect, useRef } from 'react'
import useEscapeKey from './useEscapeKey'
import useFocusTrap from './useFocusTrap'

interface ConfirmDialogProps {
  isOpen: boolean
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  isDestructive?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export default function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  isDestructive = false,
  onConfirm,
  onCancel
}: ConfirmDialogProps) {
  // Lock body scroll when open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [isOpen])

  const cancelBtnRef = useRef<HTMLButtonElement | null>(null)
  const containerRef = useFocusTrap(isOpen, cancelBtnRef)
  useEscapeKey(onCancel, isOpen)

  if (!isOpen) return null

  return (
    <div
      ref={containerRef}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0, 0, 0, 0.7)',
        backdropFilter: 'blur(4px)',
        zIndex: 10000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'var(--space-4, 16px)'
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
    >
      <div
        style={{
          background: 'var(--color-surface-1, #121625)',
          border: '1px solid var(--color-surface-offset, #2c324c)',
          borderRadius: 'var(--radius-lg, 8px)',
          width: '100%',
          maxWidth: '400px',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 10px 10px -5px rgba(0, 0, 0, 0.5)',
          animation: 'confirm-in 0.15s cubic-bezier(0.16, 1, 0.3, 1) forwards',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden'
        }}
      >

        
        {/* Header */}
        <div style={{
          padding: 'var(--space-5, 20px) var(--space-6, 24px) var(--space-2, 8px)'
        }}>
          <h2
            id="confirm-dialog-title"
            style={{
              fontSize: 'var(--text-lg, 18px)',
              fontWeight: 'var(--weight-semibold, 600)',
              color: 'var(--color-text-base, #ffffff)',
              margin: 0
            }}
          >
            {title}
          </h2>
        </div>

        {/* Content */}
        <div style={{
          padding: '0 var(--space-6, 24px) var(--space-6, 24px)',
          flex: 1
        }}>
          <p style={{
            fontSize: 'var(--text-sm, 14px)',
            color: 'var(--color-text-muted, #94a3b8)',
            lineHeight: 1.5,
            margin: 0
          }}>
            {message}
          </p>
        </div>

        {/* Actions */}
        <div style={{
          background: 'var(--color-surface-2, #1b2035)',
          padding: 'var(--space-4, 16px) var(--space-6, 24px)',
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 'var(--space-3, 12px)',
          borderTop: '1px solid var(--color-surface-offset, #2c324c)'
        }}>
          <button
            ref={cancelBtnRef}
            type="button"
            onClick={onCancel}
            style={{
              background: 'transparent',
              border: '1px solid var(--color-surface-offset, #2c324c)',
              color: 'var(--color-text-base, #ffffff)',
              borderRadius: 'var(--radius-md, 6px)',
              padding: 'var(--space-2, 8px) var(--space-4, 16px)',
              fontSize: 'var(--text-sm, 14px)',
              fontWeight: 'var(--weight-medium, 500)',
              cursor: 'pointer',
              transition: 'background var(--duration-fast, 150ms) var(--ease-default)'
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-surface-offset, #2c324c)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            {cancelText}
          </button>
          
          <button
            type="button"
            onClick={onConfirm}
            style={{
              background: isDestructive ? 'var(--color-error, #ef4444)' : 'var(--color-secondary, #3b82f6)',
              border: 'none',
              color: isDestructive ? 'white' : 'var(--color-text-inverted, #ffffff)',
              borderRadius: 'var(--radius-md, 6px)',
              padding: 'var(--space-2, 8px) var(--space-4, 16px)',
              fontSize: 'var(--text-sm, 14px)',
              fontWeight: 'var(--weight-semibold, 700)',
              cursor: 'pointer',
              transition: 'filter var(--duration-fast, 150ms) var(--ease-default)'
            }}
            onMouseEnter={e => (e.currentTarget.style.filter = 'brightness(1.1)')}
            onMouseLeave={e => (e.currentTarget.style.filter = 'none')}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}
