import React, { useRef, createContext, useContext, useState, useCallback, useMemo } from 'react'
import useEscapeKey from './useEscapeKey'
import useFocusTrap from './useFocusTrap'

interface ConfirmDialogProps {
  isOpen: boolean
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  /**
   * A third way out, between cancelling and going through with it. Set only
   * where the choice is genuinely three-way, such as replacing a board or
   * keeping both copies of it.
   */
  altText?: string
  isDestructive?: boolean
  /** Extra emphasis for irreversible actions, shown below the message. */
  warning?: string
  onConfirm: () => void
  onAlt?: () => void
  onCancel: () => void
}

export default function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  altText,
  isDestructive = false,
  warning,
  onConfirm,
  onAlt,
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

          {warning && (
            <div style={{
              marginTop: 'var(--space-3)',
              fontSize: 'var(--text-xs)',
              color: 'var(--color-warning)',
              background: 'var(--color-warning-muted)',
              border: '1px solid var(--color-warning)',
              padding: 'var(--space-3)',
              borderRadius: 'var(--radius-md)',
              lineHeight: 1.4
            }}>
              {warning}
            </div>
          )}
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

          {altText && onAlt && (
            <button
              type="button"
              onClick={onAlt}
              style={{
                background: 'var(--color-surface-offset)',
                border: '1px solid var(--color-surface-offset)',
                color: 'var(--color-text-base)',
                borderRadius: 'var(--radius-md)',
                padding: 'var(--space-2) var(--space-4)',
                fontSize: 'var(--text-sm)',
                fontWeight: 'var(--weight-medium)',
                cursor: 'pointer',
                transition: 'filter var(--duration-fast) var(--ease-default)'
              }}
              onMouseEnter={e => (e.currentTarget.style.filter = 'brightness(1.2)')}
              onMouseLeave={e => (e.currentTarget.style.filter = 'none')}
            >
              {altText}
            </button>
          )}

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
  altText?: string
  isDestructive?: boolean
  warning?: string
}

/**
 * Which button was pressed. Escape and the backdrop both count as 'cancel',
 * so a question with three answers still has exactly one way to refuse it.
 */
export type ConfirmChoice = 'confirm' | 'alt' | 'cancel'

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>
type ChooseFn = (options: ConfirmOptions) => Promise<ConfirmChoice>

const ConfirmContext = createContext<{ confirm: ConfirmFn; choose: ChooseFn } | undefined>(undefined)

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
    resolve: (value: ConfirmChoice) => void
  } | null>(null)

  const choose = useCallback<ChooseFn>(options => {
    return new Promise<ConfirmChoice>(resolve => {
      setPending(prev => {
        // A second request while one is open would strand the first promise
        // forever; treat being displaced as a cancel.
        prev?.resolve('cancel')
        return { options, resolve }
      })
    })
  }, [])

  // Anything but the confirm button is a no, which is what every existing
  // call site already assumes.
  const confirm = useCallback<ConfirmFn>(
    options => choose(options).then(choice => choice === 'confirm'),
    [choose]
  )

  const settle = (value: ConfirmChoice) => {
    pending?.resolve(value)
    setPending(null)
  }

  const api = useMemo(() => ({ confirm, choose }), [confirm, choose])

  return (
    <ConfirmContext.Provider value={api}>
      {children}
      <ConfirmDialog
        isOpen={pending !== null}
        title={pending?.options.title ?? ''}
        message={pending?.options.message ?? ''}
        confirmText={pending?.options.confirmText}
        cancelText={pending?.options.cancelText}
        altText={pending?.options.altText}
        isDestructive={pending?.options.isDestructive}
        warning={pending?.options.warning}
        onConfirm={() => settle('confirm')}
        onAlt={() => settle('alt')}
        onCancel={() => settle('cancel')}
      />
    </ConfirmContext.Provider>
  )
}

function useConfirmContext() {
  const context = useContext(ConfirmContext)
  if (!context) {
    throw new Error('useConfirm must be used within a ConfirmProvider')
  }
  return context
}

export function useConfirm(): ConfirmFn {
  return useConfirmContext().confirm
}

/** The same dialog with a third button, for a question that has three answers. */
export function useChoose(): ChooseFn {
  return useConfirmContext().choose
}
