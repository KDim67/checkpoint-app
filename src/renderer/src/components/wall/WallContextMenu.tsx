/** item and canvas menus apart, half-disabled entries read broken; flipped near edges */

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'

export interface MenuEntry {
  label: string
  icon?: React.ReactNode
  onClick: () => void
  /** danger colour, separated */
  destructive?: boolean
  /** right-aligned shortcut hint */
  hint?: string
  disabled?: boolean
}

interface Props {
  x: number
  y: number
  entries: MenuEntry[]
  onClose: () => void
}

const WIDTH = 208

export default function WallContextMenu({ x, y, entries, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x, y })

  // after paint, the height depends on the entries
  useLayoutEffect(() => {
    const height = ref.current?.offsetHeight ?? 0
    setPos({
      x: x + WIDTH > window.innerWidth ? Math.max(8, x - WIDTH) : x,
      y: y + height > window.innerHeight ? Math.max(8, y - height) : y
    })
  }, [x, y, entries.length])

  useEffect(() => {
    const dismiss = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose() }
    // capture, so a click that also hits the canvas closes first
    window.addEventListener('pointerdown', dismiss, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', dismiss, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return (
    <div
      ref={ref}
      role="menu"
      style={{
        position: 'fixed',
        left: `${pos.x}px`,
        top: `${pos.y}px`,
        width: `${WIDTH}px`,
        zIndex: 9999,
        background: 'var(--color-surface-elevated)',
        border: '1px solid var(--color-surface-offset)',
        borderRadius: 'var(--radius-md)',
        boxShadow: 'var(--shadow-lg)',
        padding: '4px',
        animation: 'dropdown-in 120ms var(--ease-enter)'
      }}
    >
      {entries.map((entry, i) => {
        const previous = entries[i - 1]
        const needsRule = entry.destructive && previous && !previous.destructive
        return (
          <React.Fragment key={entry.label}>
            {needsRule && (
              <div style={{ height: '1px', background: 'var(--color-surface-offset)', margin: '4px 2px' }} />
            )}
            <button
              role="menuitem"
              disabled={entry.disabled}
              onClick={() => { entry.onClick(); onClose() }}
              className="bg-clear wall-context-menu-entry"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-2)',
                width: '100%',
                textAlign: 'left',
                border: 'none',
                padding: '6px var(--space-2)',
                borderRadius: 'var(--radius-sm)',
                cursor: entry.disabled ? 'not-allowed' : 'pointer',
                opacity: entry.disabled ? 0.4 : 1,
                fontSize: 'var(--text-xs)',
                color: entry.destructive ? 'var(--color-error)' : 'var(--color-text-base)'
              }}
            >
              <span style={{ display: 'flex', width: '14px', flexShrink: 0, color: 'var(--color-text-faint)' }}>
                {entry.icon}
              </span>
              <span className="flex-1">{entry.label}</span>
              {entry.hint && (
                <span className="text-mono-micro">
                  {entry.hint}
                </span>
              )}
            </button>
          </React.Fragment>
        )
      })}
    </div>
  )
}
