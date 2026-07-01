import React from 'react'

interface EmptyStateProps {
  icon?: React.ReactNode
  title: string
  description: string
  actionLabel?: string
  onActionClick?: () => void
  style?: React.CSSProperties
}

export default function EmptyState({
  icon,
  title,
  description,
  actionLabel,
  onActionClick,
  style
}: EmptyStateProps) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'var(--space-12, 48px) var(--space-6, 24px)',
        textAlign: 'center',
        maxWidth: '420px',
        margin: '0 auto',
        height: '100%',
        ...style
      }}
    >
      {icon && (
        <div style={{
          marginBottom: 'var(--space-4, 16px)',
          color: 'var(--color-text-faint, #4b5563)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}>
          {icon}
        </div>
      )}
      
      <h3 style={{
        fontSize: 'var(--text-md, 16px)',
        fontWeight: 'var(--weight-semibold, 600)',
        color: 'var(--color-text-base, #ffffff)',
        margin: '0 0 var(--space-2, 8px) 0'
      }}>
        {title}
      </h3>
      
      <p style={{
        fontSize: 'var(--text-sm, 14px)',
        color: 'var(--color-text-muted, #94a3b8)',
        lineHeight: 1.5,
        margin: '0 0 var(--space-6, 24px) 0'
      }}>
        {description}
      </p>
      
      {actionLabel && onActionClick && (
        <button
          onClick={onActionClick}
          style={{
            background: 'var(--color-secondary, #3b82f6)',
            border: 'none',
            color: 'var(--color-text-inverted, #ffffff)',
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
          {actionLabel}
        </button>
      )}
    </div>
  )
}
