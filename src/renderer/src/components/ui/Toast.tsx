import React, { createContext, useContext, useState, useCallback, useRef } from 'react'

interface ToastAction {
  label: string
  onClick: () => void
}

interface ToastMessage {
  id: string
  text: string
  action?: ToastAction
  type?: 'info' | 'success' | 'error'
}

interface ToastContextType {
  toast: (text: string, options?: { action?: ToastAction; type?: 'info' | 'success' | 'error'; duration?: number }) => void
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

  const toast = useCallback((
    text: string,
    options?: { action?: ToastAction; type?: 'info' | 'success' | 'error'; duration?: number }
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
          bottom: 'var(--space-6, 24px)',
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 9999,
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-2, 8px)',
          pointerEvents: 'none'
        }}
      >
        <style>{`
          @keyframes toast-in {
            from { opacity: 0; transform: translateY(12px) scale(0.95); }
            to { opacity: 1; transform: translateY(0) scale(1); }
          }
          .toast-item {
            animation: toast-in 0.2s cubic-bezier(0.16, 1, 0.3, 1) forwards;
          }
        `}</style>
        {toasts.map(t => {
          let typeColor = 'var(--color-text-base, #ffffff)'
          if (t.type === 'success') typeColor = 'var(--color-success, #10b981)'
          if (t.type === 'error') typeColor = 'var(--color-error, #ef4444)'

          return (
            <div
              key={t.id}
              className="toast-item"
              style={{
                background: 'var(--color-surface-elevated, #1b2035)',
                border: '1px solid var(--color-surface-offset, #2c324c)',
                borderRadius: 'var(--radius-md, 6px)',
                boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.4), 0 4px 6px -4px rgba(0, 0, 0, 0.4)',
                padding: 'var(--space-3, 12px) var(--space-4, 16px)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 'var(--space-6, 24px)',
                pointerEvents: 'auto',
                minWidth: '280px',
                maxWidth: '420px'
              }}
            >
              <span style={{
                color: typeColor,
                fontSize: 'var(--text-sm, 14px)',
                fontWeight: 'var(--weight-normal, 400)',
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
                    color: 'var(--color-secondary, #3b82f6)',
                    cursor: 'pointer',
                    fontSize: 'var(--text-sm, 14px)',
                    fontWeight: 'var(--weight-bold, 700)',
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
