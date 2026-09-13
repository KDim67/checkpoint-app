/**
 * Right-click menus for the Wall. Two, not one: an item menu is about that
 * item, a canvas menu about that spot, and sharing one would leave half the
 * entries disabled at any moment, which reads as broken.
 *
 * Screen coordinates, flipped near the edges. A menu that opens off-screen is a
 * dead end by the time the user finds out.
 */

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'

export interface MenuEntry {
  label: string
  icon?: React.ReactNode
  onClick: () => void
  /** Draws the entry in the danger colour and separates it from the rest. */
  destructive?: boolean
  /** Right-aligned shortcut hint. */
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

  // Measured after paint: the height depends on how many entries this menu has,
  // so it cannot be known before rendering.
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
    // Capture, so a click that also lands on the canvas closes the menu first.
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
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-2)',
                width: '100%',
                textAlign: 'left',
                background: 'none',
                border: 'none',
                padding: '6px var(--space-2)',
                borderRadius: 'var(--radius-sm)',
                cursor: entry.disabled ? 'not-allowed' : 'pointer',
                opacity: entry.disabled ? 0.4 : 1,
                fontSize: 'var(--text-xs)',
                color: entry.destructive ? 'var(--color-error)' : 'var(--color-text-base)'
              }}
              onMouseEnter={e => {
                if (!entry.disabled) e.currentTarget.style.background = 'var(--color-surface-offset)'
              }}
              onMouseLeave={e => { e.currentTarget.style.background = 'none' }}
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
