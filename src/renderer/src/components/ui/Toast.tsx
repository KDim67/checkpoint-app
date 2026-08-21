import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react'

interface ToastAction {
  label: string
  onClick: () => void
}

type ToastType = 'info' | 'success' | 'error' | 'warning'

interface ToastMessage {
  id: string
  text: string
  action?: ToastAction
  type?: ToastType
}

interface ToastContextType {
  toast: (text: string, options?: { action?: ToastAction; type?: ToastType; duration?: number }) => void
}

const ToastContext = createContext<ToastContextType | undefined>(undefined)

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastMessage[]>([])
  const timersRef = useRef<Record<string, NodeJS.Timeout>>({})

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id))
    if (timersRef.current[id]) {
      clearTimeout(timersRef.current[id])
      delete timersRef.current[id]
    }
  }, [])

  // Timers outlive the toasts they dismiss if the provider unmounts mid-flight.
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
    timersRef.current[id] = setTimeout(() => removeToast(id), 2000)
  }, [removeToast])

  const toast = useCallback((
    text: string,
    options?: { action?: ToastAction; type?: ToastType; duration?: number }
  ) => {
    const id = Math.random().toString(36).substring(2, 9)
    const newToast: ToastMessage = {
      id,
      text,
      action: options?.action,
      type: options?.type || 'info'
    }

    setToasts(prev => [...prev, newToast])

    const duration = options?.duration ?? 4000
    timersRef.current[id] = setTimeout(() => {
      removeToast(id)
    }, duration)
  }, [removeToast])

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      
      {/* Toast Container */}
      <div
        role="status"
        aria-live="polite"
        style={{
          position: 'fixed',
          bottom: 'var(--space-6)',
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 9999,
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
                  onClick={() => {
                    t.action?.onClick()
                    removeToast(t.id)
                  }}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--color-secondary)',
                    cursor: 'pointer',
                    fontSize: 'var(--text-sm)',
                    fontWeight: 'var(--weight-bold)',
                    padding: 0,
                    whiteSpace: 'nowrap'
                  }}
                  onMouseEnter={e => (e.currentTarget.style.filter = 'brightness(1.15)')}
                  onMouseLeave={e => (e.currentTarget.style.filter = 'none')}
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
