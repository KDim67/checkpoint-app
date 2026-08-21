import React, { useRef, createContext, useContext, useState, useCallback } from 'react'
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
        padding: 'var(--space-4)'
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      onClick={onCancel}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--color-surface-1)',
          border: '1px solid var(--color-surface-offset)',
          borderRadius: 'var(--radius-lg)',
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
          padding: 'var(--space-5) var(--space-6) var(--space-2)'
        }}>
          <h2
            id="confirm-dialog-title"
            style={{
              fontSize: 'var(--text-lg)',
              fontWeight: 'var(--weight-semibold)',
              color: 'var(--color-text-base)',
              margin: 0
            }}
          >
            {title}
          </h2>
        </div>

        {/* Content */}
        <div style={{
          padding: '0 var(--space-6) var(--space-6)',
          flex: 1
        }}>
          <p style={{
            fontSize: 'var(--text-sm)',
            color: 'var(--color-text-muted)',
            lineHeight: 1.5,
            margin: 0
          }}>
            {message}
          </p>
        </div>

        {/* Actions */}
        <div style={{
          background: 'var(--color-surface-2)',
          padding: 'var(--space-4) var(--space-6)',
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 'var(--space-3)',
          borderTop: '1px solid var(--color-surface-offset)'
        }}>
          <button
            ref={cancelBtnRef}
            type="button"
            onClick={onCancel}
            style={{
              background: 'transparent',
              border: '1px solid var(--color-surface-offset)',
              color: 'var(--color-text-base)',
              borderRadius: 'var(--radius-md)',
              padding: 'var(--space-2) var(--space-4)',
              fontSize: 'var(--text-sm)',
              fontWeight: 'var(--weight-medium)',
              cursor: 'pointer',
              transition: 'background var(--duration-fast) var(--ease-default)'
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-surface-offset)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            {cancelText}
          </button>
          
          <button
            type="button"
            onClick={onConfirm}
            style={{
              background: isDestructive ? 'var(--color-error)' : 'var(--color-secondary)',
              border: 'none',
              color: isDestructive ? 'white' : 'var(--color-text-inverted)',
              borderRadius: 'var(--radius-md)',
              padding: 'var(--space-2) var(--space-4)',
              fontSize: 'var(--text-sm)',
              fontWeight: 'var(--weight-semibold)',
              cursor: 'pointer',
              transition: 'filter var(--duration-fast) var(--ease-default)'
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

interface ConfirmOptions {
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  isDestructive?: boolean
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>

const ConfirmContext = createContext<ConfirmFn | undefined>(undefined)

/**
 * Promise-based wrapper around ConfirmDialog, so a call site reads the same
 * shape as the native confirm() it replaces:
 *
 *   if (!(await confirm({ title, message }))) return
 *
 * Native confirm() blocks the renderer process and draws an OS chrome dialog
 * that ignores the app's theme, which is why none of these are left.
 */
export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<{
    options: ConfirmOptions
    resolve: (value: boolean) => void
  } | null>(null)

  const confirm = useCallback<ConfirmFn>(options => {
    return new Promise<boolean>(resolve => {
      setPending(prev => {
        // A second request while one is open would strand the first promise
        // forever; treat being displaced as a cancel.
        prev?.resolve(false)
        return { options, resolve }
      })
    })
  }, [])

  const settle = (value: boolean) => {
    pending?.resolve(value)
    setPending(null)
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <ConfirmDialog
        isOpen={pending !== null}
        title={pending?.options.title ?? ''}
        message={pending?.options.message ?? ''}
        confirmText={pending?.options.confirmText}
        cancelText={pending?.options.cancelText}
        isDestructive={pending?.options.isDestructive}
        onConfirm={() => settle(true)}
        onCancel={() => settle(false)}
      />
    </ConfirmContext.Provider>
  )
}

export function useConfirm(): ConfirmFn {
  const context = useContext(ConfirmContext)
  if (!context) {
    throw new Error('useConfirm must be used within a ConfirmProvider')
  }
  return context
}
