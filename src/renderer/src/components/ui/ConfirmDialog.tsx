import React, { useRef, createContext, useContext, useState, useCallback, useMemo } from 'react'
import useEscapeKey from './useEscapeKey'
import useFocusTrap from './useFocusTrap'

/**
 * One answer in a stacked choice list.
 *
 * A row rather than a button, because past three answers a button row stops
 * being readable: the labels have to shrink to fit, and a label alone cannot
 * say what the answer does. The row has space to say it.
 */
export interface PickChoice {
  key: string
  label: string
  /** One line on what this answer does. Shown under the label. */
  detail?: string
  isDestructive?: boolean
}

interface ConfirmDialogProps {
  isOpen: boolean
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  isDestructive?: boolean
  /** Extra emphasis for irreversible actions, shown below the message. */
  warning?: string
  /**
   * When set, the answers are a stacked list and the button row is just Cancel.
   *
   * This replaced a third button that sat between cancelling and going through
   * with it. Three buttons fit, but a label on its own cannot say what the
   * answer does, and the question that wanted them was which of three things to
   * do with a board you are about to overwrite.
   */
  choices?: PickChoice[]
  onConfirm: () => void
  onPick?: (key: string) => void
  onCancel: () => void
}

export default function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  isDestructive = false,
  warning,
  choices,
  onConfirm,
  onPick,
  onCancel
}: ConfirmDialogProps) {
  const picking = Boolean(choices && choices.length > 0 && onPick)
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
          // A dialog that explains its answers can outgrow a short window, and
          // the button row is the part that must never be the bit off screen.
          maxHeight: '85vh',
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
          flex: 1,
          minHeight: 0,
          overflowY: 'auto'
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

          {choices && choices.length > 0 && onPick && (
            <div style={{
              marginTop: 'var(--space-4)',
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-2)'
            }}>
              {choices.map(choice => (
                <PickRow key={choice.key} choice={choice} onClick={() => onPick(choice.key)} />
              ))}
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

          {!picking && (
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
          )}
        </div>
      </div>
    </div>
  )
}

function PickRow({ choice, onClick }: { choice: PickChoice; onClick: () => void }) {
  const [hover, setHover] = useState(false)
  const accent = choice.isDestructive ? 'var(--color-error)' : 'var(--color-secondary)'
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: hover ? 'var(--color-surface-2)' : 'transparent',
        border: `1px solid ${hover ? accent : 'var(--color-surface-offset)'}`,
        borderRadius: 'var(--radius-md)',
        padding: 'var(--space-3)',
        textAlign: 'left',
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        gap: '2px',
        transition: 'background var(--duration-fast) var(--ease-default), border-color var(--duration-fast) var(--ease-default)'
      }}
    >
      <span style={{
        fontSize: 'var(--text-sm)',
        fontWeight: 'var(--weight-semibold)',
        color: choice.isDestructive ? 'var(--color-error)' : 'var(--color-text-base)'
      }}>
        {choice.label}
      </span>
      {choice.detail && (
        <span style={{
          fontSize: 'var(--text-xs)',
          color: 'var(--color-text-muted)',
          lineHeight: 1.4
        }}>
          {choice.detail}
        </span>
      )}
    </button>
  )
}

interface ConfirmOptions {
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  isDestructive?: boolean
  warning?: string
}

interface PickOptions extends ConfirmOptions {
  /** Answered by pressing one of these. 'cancel' is not a usable key. */
  choices: PickChoice[]
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>
/** The key of the row that was pressed, or null for every way of refusing. */
type PickFn = (options: PickOptions) => Promise<string | null>

const ConfirmContext = createContext<{ confirm: ConfirmFn; pick: PickFn } | undefined>(undefined)

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
    options: ConfirmOptions & { choices?: PickChoice[] }
    resolve: (value: string) => void
  } | null>(null)

  const ask = useCallback((options: ConfirmOptions & { choices?: PickChoice[] }) => {
    return new Promise<string>(resolve => {
      setPending(prev => {
        // A second request while one is open would strand the first promise
        // forever; treat being displaced as a cancel.
        prev?.resolve('cancel')
        return { options, resolve }
      })
    })
  }, [])

  const pick = useCallback<PickFn>(
    options => ask(options).then(value => (value === 'cancel' ? null : value)),
    [ask]
  )

  // Anything but the confirm button is a no, which is what every call site
  // already assumes.
  const confirm = useCallback<ConfirmFn>(
    options => ask(options).then(value => value === 'confirm'),
    [ask]
  )

  const settle = (value: string) => {
    pending?.resolve(value)
    setPending(null)
  }

  const api = useMemo(() => ({ confirm, pick }), [confirm, pick])

  return (
    <ConfirmContext.Provider value={api}>
      {children}
      <ConfirmDialog
        isOpen={pending !== null}
        title={pending?.options.title ?? ''}
        message={pending?.options.message ?? ''}
        confirmText={pending?.options.confirmText}
        cancelText={pending?.options.cancelText}
        isDestructive={pending?.options.isDestructive}
        warning={pending?.options.warning}
        choices={pending?.options.choices}
        onConfirm={() => settle('confirm')}
        onPick={key => settle(key)}
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

/**
 * The same dialog with its answers as a stacked list, for a question with more
 * answers than a button row can label, or answers that need explaining.
 */
export function usePick(): PickFn {
  return useConfirmContext().pick
}
