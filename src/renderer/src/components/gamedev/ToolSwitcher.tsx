import React, { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronLeft, Check } from 'lucide-react'
import { GAMEDEV_TOOLS, findTool, groupOf } from './toolCatalogue'
import type { GameDevTab } from './types'

interface Props {
  activeTab: GameDevTab
  onPick: (id: GameDevTab) => void
  /** Back to the launcher. */
  onHome: () => void
}

/**
 * The header inside an open tool: where you are, and how to get anywhere else.
 *
 * A menu rather than a second sidebar. The window already has one down the left
 * and a second rail beside it read as two competing navigations.
 */
export default function ToolSwitcher({ activeTab, onPick, onHome }: Props) {
  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)
  const current = findTool(activeTab)

  useEffect(() => {
    if (!open) return
    const onDocPointerDown = (e: PointerEvent): void => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onDocPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDocPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // A tool picked from the menu leaves the menu open behind it otherwise.
  const pick = (id: GameDevTab): void => {
    setOpen(false)
    onPick(id)
  }

  return (
    <div className="row-md">
      <style>{`
        .gamedev-crumb {
          display: flex;
          align-items: center;
          gap: 4px;
          padding: 6px 10px 6px 6px;
          background: transparent;
          border: 1px solid transparent;
          border-radius: var(--radius-md);
          color: var(--color-text-muted);
          font-size: var(--text-xs);
          font-family: inherit;
          cursor: pointer;
          white-space: nowrap;
        }
        .gamedev-crumb:hover {
          background: var(--color-surface-2);
          color: var(--color-text-base);
        }
        .gamedev-switch {
          display: flex;
          align-items: center;
          gap: var(--space-2);
          padding: 6px 10px;
          background: var(--color-surface-1);
          border: 1px solid var(--color-surface-offset);
          border-radius: var(--radius-md);
          color: var(--color-text-base);
          font-size: var(--text-sm);
          font-weight: var(--weight-semibold);
          font-family: inherit;
          cursor: pointer;
        }
        .gamedev-switch:hover { border-color: var(--color-secondary); }
        .gamedev-switch-item {
          display: flex;
          align-items: center;
          gap: var(--space-2);
          width: 100%;
          padding: 7px 10px;
          background: transparent;
          border: none;
          border-radius: var(--radius-md);
          color: var(--color-text-muted);
          font-size: var(--text-xs);
          font-family: inherit;
          text-align: left;
          cursor: pointer;
        }
        .gamedev-switch-item:hover {
          background: var(--color-surface-2);
          color: var(--color-text-base);
        }
        .gamedev-switch-item.active {
          color: var(--color-secondary);
          font-weight: var(--weight-semibold);
        }
      `}</style>

      <button type="button" className="gamedev-crumb" onClick={onHome}>
        <ChevronLeft size={14} />
        All tools
      </button>

      <div ref={boxRef} className="relative">
        <button
          type="button"
          className="gamedev-switch"
          onClick={() => setOpen(o => !o)}
          aria-haspopup="menu"
          aria-expanded={open}
        >
          <span style={{ color: 'var(--color-secondary)', display: 'flex' }}>{current?.icon}</span>
          {current?.label ?? 'Tool'}
          <ChevronDown size={14} className="text-faint" />
        </button>

        {open && (
          <div
            role="menu"
            style={{
              position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 30,
              minWidth: '220px', padding: 'var(--space-2)',
              background: 'var(--color-surface-1)',
              border: '1px solid var(--color-surface-offset)',
              borderRadius: 'var(--radius-lg)',
              boxShadow: 'var(--shadow-md)'
            }}
          >
            {GAMEDEV_TOOLS.map(section => (
              <div key={section.group} style={{ marginBottom: 'var(--space-2)' }}>
                <div style={{
                  fontSize: '9px', fontWeight: 'var(--weight-bold)',
                  textTransform: 'uppercase', letterSpacing: '0.07em',
                  color: 'var(--color-text-faint)', padding: '4px 10px'
                }}>
                  {section.group}
                </div>
                {section.tools.map(tool => (
                  <button
                    key={tool.id}
                    type="button"
                    role="menuitem"
                    className={`gamedev-switch-item ${tool.id === activeTab ? 'active' : ''}`}
                    onClick={() => pick(tool.id)}
                  >
                    {tool.icon}
                    <span className="flex-1">{tool.label}</span>
                    {tool.id === activeTab && <Check size={13} />}
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      <span className="text-hint-faint">
        {groupOf(activeTab)}
      </span>
    </div>
  )
}
