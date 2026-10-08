import React, { useEffect, useRef, useState } from 'react'
import MenuItem from '../ui/MenuItem'

export interface MenuEntry {
  label: string
  icon?: React.ReactNode
  onSelect: () => void
}

interface Props {
  label: string
  trigger: React.ReactNode
  entries: MenuEntry[]
}

/** a row's menu; right-aligned since the rows sit against the panel's right edge */
export default function RenewalMenu({ label, trigger, entries }: Props): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const outside = (e: MouseEvent): void => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const escape = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      // the row's own keys would act on Escape too
      e.stopPropagation()
      setOpen(false)
      buttonRef.current?.focus()
    }
    document.addEventListener('mousedown', outside)
    document.addEventListener('keydown', escape, true)
    return () => {
      document.removeEventListener('mousedown', outside)
      document.removeEventListener('keydown', escape, true)
    }
  }, [open])

  return (
    <div ref={rootRef} className="relative" onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
      <button
        ref={buttonRef}
        type="button"
        className="btn-ghost"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
      >
        {trigger}
      </button>
      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute',
            top: 'calc(100% + var(--space-1))',
            right: 0,
            zIndex: 'var(--z-float)',
            background: 'var(--color-surface-elevated)',
            border: '1px solid var(--color-surface-offset)',
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-md)',
            minWidth: '180px',
            padding: 'var(--space-1) 0',
            animation: 'dropdown-in var(--duration-fast) var(--ease-enter)'
          }}
        >
          {entries.map(entry => (
            <MenuItem
              key={entry.label}
              icon={entry.icon}
              onClick={() => {
                setOpen(false)
                entry.onSelect()
              }}
            >
              {entry.label}
            </MenuItem>
          ))}
        </div>
      )}
    </div>
  )
}
