import React, { useContext, useState, useCallback, useRef, useEffect } from 'react'
import { EXIT_MS, TOAST_DISMISS_MS } from '../../lib/timings'
import { prefersReducedMotion } from '../../lib/presence'
import { errorMessage } from '../../../../shared/errors'
import { ToastContext } from './toastContext'
import { useAppStore } from '../../store/appStore'
import { isTypingTarget } from '../../lib/shortcuts'

export interface ToastAction {
  label: string
  onClick: () => void
}

type ToastType = 'info' | 'success' | 'error' | 'warning'

interface ToastMessage {
  id: string
  text: string
  action?: ToastAction
  type?: ToastType
  /** playing its exit, gone once it ends */
  leaving?: boolean
}

const MAX_TOASTS = 3

export interface ToastOptions {
  id?: string
  action?: ToastAction
  type?: ToastType
  duration?: number
}

export interface ToastContextType {
  toast: (text: string, options?: ToastOptions) => void
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastMessage[]>([])
  const timersRef = useRef<Record<string, NodeJS.Timeout>>({})

  const removeToast = useCallback((id: string) => {
    if (timersRef.current[id]) {
      clearTimeout(timersRef.current[id])
      delete timersRef.current[id]
    }
    const drop = (): void => setToasts(prev => prev.filter(t => t.id !== id))
    if (prefersReducedMotion()) {
      drop()
      return
    }
    // it fades out first rather than vanishing; the same timer list clears it if the provider goes
    setToasts(prev => prev.map(t => (t.id === id ? { ...t, leaving: true } : t)))
    timersRef.current[`${id}:exit`] = setTimeout(() => {
      delete timersRef.current[`${id}:exit`]
      drop()
    }, EXIT_MS)
  }, [])

  // timers outlive their toasts if the provider unmounts mid-flight
  useEffect(() => {
    const timers = timersRef.current
    return () => {
      Object.values(timers).forEach(clearTimeout)
    }
  }, [])

  const holdToast = useCallback((id: string) => {
    const timer = timersRef.current[id]
    if (timer) {
      clearTimeout(timer)
      delete timersRef.current[id]
    }
  }, [])

  const resumeToast = useCallback((id: string) => {
    if (timersRef.current[id]) return
    timersRef.current[id] = setTimeout(() => removeToast(id), TOAST_DISMISS_MS)
  }, [removeToast])

  const toast = useCallback((
    text: string,
    options?: ToastOptions
  ) => {
    const id = options?.id || Math.random().toString(36).substring(2, 9)
    const duration = options?.duration ?? (options?.action ? 6000 : 4000)

    if (timersRef.current[id]) {
      clearTimeout(timersRef.current[id])
      delete timersRef.current[id]
    }
    if (timersRef.current[`${id}:exit`]) {
      clearTimeout(timersRef.current[`${id}:exit`])
      delete timersRef.current[`${id}:exit`]
    }

    const newToast: ToastMessage = {
      id,
      text,
      action: options?.action,
      type: options?.type || 'info',
      leaving: false
    }

    setToasts(prev => {
      const existingIdx = prev.findIndex(t => t.id === id)
      if (existingIdx >= 0) {
        const next = [...prev]
        next[existingIdx] = newToast
        return next
      }
      const trimmed = prev.length >= MAX_TOASTS ? prev.slice(prev.length - (MAX_TOASTS - 1)) : prev
      return [...trimmed, newToast]
    })

    timersRef.current[id] = setTimeout(() => {
      removeToast(id)
    }, duration)
  }, [removeToast])

  useEffect(() => {
    const handleUndoKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey && !e.altKey) {
        if (isTypingTarget(e.target)) return
        const activeView = useAppStore.getState().activeView
        if (activeView === 'wall') return // Wall handles its own canvas undo

        const activeToast = [...toasts].reverse().find(t => !t.leaving && t.action)
        if (activeToast?.action) {
          e.preventDefault()
          activeToast.action.onClick()
          removeToast(activeToast.id)
        }
      }
    }
    window.addEventListener('keydown', handleUndoKey)
    return () => window.removeEventListener('keydown', handleUndoKey)
  }, [toasts, removeToast])

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      
      <div
        role="status"
        aria-live="polite"
        style={{
          position: 'fixed',
          bottom: 'var(--space-6)',
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 'var(--z-float)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-2)',
          pointerEvents: 'none'
        }}
      >
        {toasts.map(t => {
          let typeColor = 'var(--color-text-base)'
          if (t.type === 'success') typeColor = 'var(--color-success)'
          if (t.type === 'error') typeColor = 'var(--color-error)'
          if (t.type === 'warning') typeColor = 'var(--color-warning)'

          return (
            <div
              key={t.id}
              className="toast-item"
              data-state={t.leaving ? 'closing' : 'open'}
              onMouseEnter={() => holdToast(t.id)}
              onMouseLeave={() => resumeToast(t.id)}
              onFocusCapture={() => holdToast(t.id)}
              onBlurCapture={() => resumeToast(t.id)}
              style={{
                background: 'var(--color-surface-elevated)',
                border: '1px solid var(--color-surface-offset)',
                borderRadius: 'var(--radius-md)',
                boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.4), 0 4px 6px -4px rgba(0, 0, 0, 0.4)',
                padding: 'var(--space-3) var(--space-4)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 'var(--space-6)',
                pointerEvents: 'auto',
                minWidth: '280px',
                maxWidth: '420px'
              }}
            >
              <span style={{
                color: typeColor,
                fontSize: 'var(--text-sm)',
                fontWeight: 'var(--weight-normal)',
                lineHeight: 1.4,
                wordBreak: 'break-word'
              }}>
                {t.text}
              </span>
              
              {t.action && (
                <button
                  type="button"
                  onClick={() => {
                    t.action?.onClick()
                    removeToast(t.id)
                  }}
                  className="hover-brighten"
                  style={{
                    background: 'var(--color-surface-offset)',
                    border: '1px solid var(--color-surface-offset)',
                    borderRadius: 'var(--radius-sm)',
                    color: 'var(--color-secondary)',
                    cursor: 'pointer',
                    fontSize: 'var(--text-xs)',
                    fontWeight: 'var(--weight-bold)',
                    padding: '3px 8px',
                    whiteSpace: 'nowrap',
                    transition: 'background var(--duration-fast), color var(--duration-fast)'
                  }}
                >
                  {t.action.label}
                </button>
              )}
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const context = useContext(ToastContext)
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider')
  }
  return context
}

/**
 * says a failed action out loud, as "Could not <what>: <reason>", and logs it; a failure only in the
 * console looked like success. Stable, so effects can list it without running again
 */
export function useFailureReport(): (what: string, err: unknown) => void {
  // a window without toasts, the tray or a widget, still logs instead of crashing
  const toast = useContext(ToastContext)?.toast
  const toastRef = useRef(toast)
  toastRef.current = toast
  return useCallback((what: string, err: unknown) => {
    console.error(`Failed to ${what}:`, err)
    toastRef.current?.(`Could not ${what}: ${errorMessage(err)}`, { type: 'error' })
  }, [])
}
