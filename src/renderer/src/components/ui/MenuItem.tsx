/**
 * A row in a dropdown menu: full width, quiet until hovered.
 *
 * The workspace switcher exists in the sidebar, the board header and the log
 * header, and each carried its own copy of these styles and the two hover
 * handlers that go with them.
 */

import React from 'react'

interface MenuItemProps {
  onClick: () => void
  children: React.ReactNode
  /** Shown before the label, at the same muted weight. */
  icon?: React.ReactNode
}

export default function MenuItem({ onClick, children, icon }: MenuItemProps) {
  return (
    <button
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-2)',
        width: '100%',
        padding: '6px 12px',
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        fontSize: 'var(--text-sm)',
        color: 'var(--color-text-muted)',
        textAlign: 'left'
      }}
      onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-surface-offset)')}
      onMouseLeave={e => (e.currentTarget.style.background = 'none')}
      onClick={onClick}
    >
      {icon}
      {children}
    </button>
  )
}

/** The hairline these menus put above their last entry. */
export function MenuDivider() {
  return <div style={{ height: '1px', background: 'var(--color-surface-offset)', margin: '4px 0' }} />
}
