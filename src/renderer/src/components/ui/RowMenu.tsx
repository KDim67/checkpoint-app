/** a row's ⋯ menu: opens onto its first item, arrows move, Escape and Tab close, and the row under it never hears its keys or clicks */

import React, { useEffect, useId, useRef, useState } from 'react'

export interface RowMenuEntry {
  label: string
  icon?: React.ReactNode
  onSelect: () => void
  /** red, and set apart below the rest */
  danger?: boolean
}

interface Props {
  label: string
  trigger: React.ReactNode
  entries: RowMenuEntry[]
  /** -1 in a list that moves focus with the arrows, so only the current row's menu is a Tab stop */
  tabIndex?: number
}

export default function RowMenu({ label, trigger, entries, tabIndex }: Props): React.JSX.Element {
  const [open, setOpen] = useState<'first' | 'last' | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuId = useId()

  const items = (): HTMLButtonElement[] => [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])]

  const close = (refocus: boolean): void => {
    setOpen(null)
    if (refocus) buttonRef.current?.focus()
  }

  useEffect(() => {
    if (!open) return
    const list = items()
    ;(open === 'last' ? list[list.length - 1] : list[0])?.focus()
    const outside = (event: MouseEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(null)
    }
    document.addEventListener('mousedown', outside)
    return () => document.removeEventListener('mousedown', outside)
  }, [open])

  const onButtonKey = (event: React.KeyboardEvent): void => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      setOpen(event.key === 'ArrowUp' ? 'last' : 'first')
    }
  }

  const onMenuKey = (event: React.KeyboardEvent): void => {
    const list = items()
    const at = list.indexOf(document.activeElement as HTMLButtonElement)
    const go = (index: number): void => {
      event.preventDefault()
      list[(index + list.length) % list.length]?.focus()
    }
    if (event.key === 'ArrowDown') go(at + 1)
    else if (event.key === 'ArrowUp') go(at - 1)
    else if (event.key === 'Home') go(0)
    else if (event.key === 'End') go(list.length - 1)
    else if (event.key === 'Escape') {
      event.preventDefault()
      close(true)
    } else if (event.key === 'Tab') close(false)
  }

  const firstDanger = entries.findIndex(entry => entry.danger)

  return (
    <div
      ref={rootRef}
      className="row-menu-root"
      onClick={event => event.stopPropagation()}
      onKeyDown={event => event.stopPropagation()}
      onPointerDown={event => event.stopPropagation()}
    >
      <button
        ref={buttonRef}
        type="button"
        className="btn-ghost row-menu-trigger"
        tabIndex={tabIndex}
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open !== null}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen(current => (current ? null : 'first'))}
        onKeyDown={onButtonKey}
      >
        {trigger}
      </button>
      {open && (
        <div ref={menuRef} id={menuId} role="menu" aria-label={label} className="row-menu" onKeyDown={onMenuKey}>
          {entries.map((entry, index) => (
            <React.Fragment key={entry.label}>
              {index === firstDanger && index > 0 && <div role="separator" className="row-menu-separator" />}
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                className={entry.danger ? 'row-menu-item row-menu-item-danger' : 'row-menu-item'}
                onClick={() => {
                  close(true)
                  entry.onSelect()
                }}
              >
                {entry.icon}
                {entry.label}
              </button>
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  )
}
