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
        padding: 'var(--space-12) var(--space-6)',
        textAlign: 'center',
        maxWidth: '420px',
        margin: '0 auto',
        height: '100%',
        ...style
      }}
    >
      {icon && (
        <div style={{
          marginBottom: 'var(--space-4)',
          color: 'var(--color-text-faint)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}>
          {icon}
        </div>
      )}
      
      <h3 style={{
        fontSize: 'var(--text-md)',
        fontWeight: 'var(--weight-semibold)',
        color: 'var(--color-text-base)',
        margin: '0 0 var(--space-2) 0'
      }}>
        {title}
      </h3>
      
      <p style={{
        fontSize: 'var(--text-sm)',
        color: 'var(--color-text-muted)',
        lineHeight: 1.5,
        margin: '0 0 var(--space-6) 0'
      }}>
        {description}
      </p>
      
      {actionLabel && onActionClick && (
        <button
          onClick={onActionClick}
          className="hover-brighten-sm"
          style={{
            background: 'var(--color-secondary)',
            border: 'none',
            color: 'var(--color-text-inverted)',
            borderRadius: 'var(--radius-md)',
            padding: 'var(--space-2) var(--space-4)',
            fontSize: 'var(--text-sm)',
            fontWeight: 'var(--weight-semibold)',
            cursor: 'pointer',
            transition: 'filter var(--duration-fast) var(--ease-default)'
          }}
        >
          {actionLabel}
        </button>
      )}
    </div>
  )
}
