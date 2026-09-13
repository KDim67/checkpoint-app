import React, { useState } from 'react'

export default function HeaderBtn({
  children,
  onClick,
  title,
  icon,
  active = false
}: {
  children: React.ReactNode
  onClick: () => void
  title: string
  icon: React.ReactNode
  active?: boolean
}) {
  const [hover, setHover] = useState(false)
  return (
    <button
      onClick={onClick}
      title={title}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: active
          ? 'var(--color-secondary-muted)'
          : hover ? 'var(--color-surface-2)' : 'transparent',
        border: active
          ? '1px solid var(--color-secondary)'
          : '1px solid var(--color-surface-offset)',
        color: active
          ? 'var(--color-secondary)'
          : hover ? 'var(--color-text-base)' : 'var(--color-text-muted)',
        borderRadius: 'var(--radius-md)',
        padding: '0 var(--space-3)',
        height: '32px',
        fontSize: 'var(--text-xs)',
        fontWeight: 'var(--weight-medium)',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-1-5)',
        transition: 'background 100ms ease, border-color 100ms ease, color 100ms ease',
        whiteSpace: 'nowrap'
      }}
    >
      {icon}
      {/* hidden by a container query when narrow, see .kanban-btn-label */}
      <span className="kanban-btn-label">{children}</span>
    </button>
  )
}
