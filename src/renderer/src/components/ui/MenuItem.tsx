/** one row style for the three workspace switchers that each copied it */

import React from 'react'

interface MenuItemProps {
  onClick: () => void
  children: React.ReactNode
  /** before the label, same muted weight */
  icon?: React.ReactNode
  /** undefined for action rows, which read quieter than choices */
  active?: boolean
}

export default function MenuItem({ onClick, children, icon, active }: MenuItemProps) {
  return (
    <button
      className="bg-clear hover-bg-offset"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-2)',
        width: '100%',
        padding: '6px 12px',
        border: 'none',
        cursor: 'pointer',
        fontSize: 'var(--text-sm)',
        color: active === undefined
          ? 'var(--color-text-muted)'
          : active ? 'var(--color-secondary)' : 'var(--color-text-base)',
        textAlign: 'left',
        transition: 'background var(--duration-fast) var(--ease-default)'
      }}
      onClick={onClick}
    >
      {icon}
      {children}
    </button>
  )
}

/** hairline above the last entry */
export function MenuDivider() {
  return <div className="rule" />
}

/** anchored under its trigger; the parent must be positioned */
export function MenuPanel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        position: 'absolute',
        top: 'calc(100% + 4px)',
        left: 0,
        zIndex: 100,
        background: 'var(--color-surface-elevated)',
        border: '1px solid var(--color-surface-offset)',
        borderRadius: 'var(--radius-md)',
        boxShadow: 'var(--shadow-md)',
        minWidth: '180px',
        padding: '4px 0',
        animation: 'dropdown-in 150ms var(--ease-enter)'
      }}
    >
      {children}
    </div>
  )
}
