import React, { useState, useRef, useEffect } from 'react'
import { useAppStore, type ActiveView } from '../store/appStore'

// Icons (SVG inline, no icon-lib dependency)

function IconLog(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
      <line x1="16" y1="13" x2="8" y2="13"/>
      <line x1="16" y1="17" x2="8" y2="17"/>
      <polyline points="10 9 9 9 8 9"/>
    </svg>
  )
}

function IconKanban(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="3" y="3" width="18" height="18" rx="2"/>
      <path d="M9 3v18"/>
      <path d="M15 3v18"/>
    </svg>
  )
}

function IconBacklog(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <line x1="8" y1="6" x2="21" y2="6"/>
      <line x1="8" y1="12" x2="21" y2="12"/>
      <line x1="8" y1="18" x2="21" y2="18"/>
      <line x1="3" y1="6" x2="3.01" y2="6"/>
      <line x1="3" y1="12" x2="3.01" y2="12"/>
      <line x1="3" y1="18" x2="3.01" y2="18"/>
    </svg>
  )
}

function IconCookbook(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="12" cy="12" r="3"/>
      <path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/>
    </svg>
  )
}

function IconSettings(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="12" cy="12" r="3"/>
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
    </svg>
  )
}

function IconChevronDown(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <polyline points="6 9 12 15 18 9"/>
    </svg>
  )
}

function IconPlus(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <line x1="12" y1="5" x2="12" y2="19"/>
      <line x1="5" y1="12" x2="19" y2="12"/>
    </svg>
  )
}

// Nav Item Data

const NAV_ITEMS: Array<{
  view: ActiveView
  label: string
  Icon: React.FC<React.SVGProps<SVGSVGElement>>
}> = [
  { view: 'log',      label: 'Log',      Icon: IconLog },
  { view: 'kanban',   label: 'Kanban',   Icon: IconKanban },
  { view: 'backlog',  label: 'Backlog',  Icon: IconBacklog },
  { view: 'cookbook', label: 'Cookbook', Icon: IconCookbook }
]

// Context Popover

interface ContextPopoverProps {
  onClose: () => void
}

function ContextPopover({ onClose }: ContextPopoverProps) {
  const activeContext = useAppStore(s => s.activeContext)
  const availableContexts = useAppStore(s => s.availableContexts)
  const setContext = useAppStore(s => s.setContext)

  return (
    <div
      style={{
        position: 'absolute',
        top: '42px',
        left: '62px',
        zIndex: 100,
        background: 'var(--color-surface-elevated)',
        border: '1px solid var(--color-surface-offset)',
        borderRadius: 'var(--radius-md)',
        boxShadow: 'var(--shadow-md)',
        minWidth: '200px',
        padding: '4px 0',
        animation: 'dropdown-in 150ms var(--ease-enter)'
      }}
    >
      <style>{`
        @keyframes dropdown-in {
          from { opacity: 0; transform: scale(0.95) translateY(-4px); }
          to   { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}</style>
      {availableContexts.map(ctx => (
        <button
          key={ctx}
          onClick={() => { setContext(ctx); onClose() }}
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
            color: ctx === activeContext ? 'var(--color-secondary)' : 'var(--color-text-base)',
            textAlign: 'left',
            transition: 'background var(--duration-fast) var(--ease-default)'
          }}
          onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-surface-offset)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'none')}
        >
          <span style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            background: ctx === activeContext ? 'var(--color-secondary)' : 'var(--color-balance)',
            flexShrink: 0
          }} />
          {ctx.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
        </button>
      ))}
      <div style={{ height: '1px', background: 'var(--color-surface-offset)', margin: '4px 0' }} />
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
        onClick={onClose}
      >
        <IconPlus style={{ opacity: 0.7 }} />
        New Context
      </button>
    </div>
  )
}

// Sidebar

export function Sidebar() {
  const activeView = useAppStore(s => s.activeView)
  const activeContext = useAppStore(s => s.activeContext)
  const setView = useAppStore(s => s.setView)

  const [contextOpen, setContextOpen] = useState(false)
  const [tooltip, setTooltip] = useState<{ label: string; y: number } | null>(null)
  const sidebarRef = useRef<HTMLDivElement>(null)

  // Close context popover on outside click
  useEffect(() => {
    if (!contextOpen) return
    const handler = (e: MouseEvent) => {
      if (sidebarRef.current && !sidebarRef.current.contains(e.target as Node)) {
        setContextOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [contextOpen])

  const ctxLabel = activeContext.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
  const ctxInitial = ctxLabel[0]?.toUpperCase() ?? 'D'

  function handleNavClick(view: ActiveView) {
    if (document.startViewTransition) {
      document.startViewTransition(() => setView(view))
    } else {
      setView(view)
    }
  }

  return (
    <div
      ref={sidebarRef}
      style={{
        width: '56px',
        height: '100%',
        background: 'var(--color-surface-1)',
        borderRight: '1px solid var(--color-surface-offset)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: 'var(--space-3) 0',
        gap: 'var(--space-1)',
        flexShrink: 0,
        position: 'relative'
      }}
    >
      {/* Context switcher */}
      <button
        id="context-switcher"
        title={ctxLabel}
        aria-label={`Active context: ${ctxLabel}. Click to switch.`}
        aria-expanded={contextOpen}
        aria-haspopup="listbox"
        onClick={() => setContextOpen(v => !v)}
        style={{
          width: '32px',
          height: '32px',
          borderRadius: 'var(--radius-sm)',
          background: contextOpen ? 'var(--color-secondary-muted)' : 'var(--color-surface-2)',
          border: `1px solid ${contextOpen ? 'var(--color-secondary)' : 'var(--color-surface-offset)'}`,
          color: 'var(--color-secondary)',
          fontSize: 'var(--text-sm)',
          fontWeight: 'var(--weight-bold)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 'var(--space-2)',
          transition: 'background var(--duration-fast) var(--ease-default), border-color var(--duration-fast) var(--ease-default)',
          flexShrink: 0
        }}
      >
        {ctxInitial}
      </button>

      {contextOpen && <ContextPopover onClose={() => setContextOpen(false)} />}

      <div style={{ height: '1px', width: '32px', background: 'var(--color-surface-offset)', margin: '2px 0 4px' }} />

      {/* Nav items */}
      <nav aria-label="Main navigation" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', width: '100%', alignItems: 'center' }}>
        {NAV_ITEMS.map(({ view, label, Icon }) => {
          const isActive = activeView === view
          return (
            <button
              key={view}
              id={`nav-${view}`}
              aria-label={label}
              aria-current={isActive ? 'page' : undefined}
              onClick={() => handleNavClick(view)}
              onMouseEnter={e => {
                const rect = e.currentTarget.getBoundingClientRect()
                setTooltip({ label, y: rect.top + rect.height / 2 })
              }}
              onMouseLeave={() => setTooltip(null)}
              style={{
                width: '40px',
                height: '40px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 'var(--radius-md)',
                border: 'none',
                background: isActive ? 'var(--color-secondary-muted)' : 'transparent',
                color: isActive ? 'var(--color-secondary)' : 'var(--color-balance)',
                cursor: 'pointer',
                position: 'relative',
                transition: 'background var(--duration-fast) var(--ease-default), color var(--duration-fast) var(--ease-default)'
              }}
            >
              {/* Active indicator, left border dot */}
              {isActive && (
                <span style={{
                  position: 'absolute',
                  left: 0,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  width: '2px',
                  height: '20px',
                  background: 'var(--color-secondary)',
                  borderRadius: '0 2px 2px 0'
                }} />
              )}
              <Icon />
            </button>
          )
        })}
      </nav>

      {/* Tooltip */}
      {tooltip && (
        <div
          aria-hidden="true"
          style={{
            position: 'fixed',
            left: '66px',
            top: tooltip.y - 14,
            background: 'var(--color-surface-elevated)',
            border: '1px solid var(--color-surface-offset)',
            borderRadius: 'var(--radius-sm)',
            padding: '4px 8px',
            fontSize: 'var(--text-xs)',
            color: 'var(--color-text-base)',
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
            zIndex: 9999,
            boxShadow: 'var(--shadow-sm)',
            animation: 'tooltip-in 100ms var(--ease-enter)'
          }}
        >
          {tooltip.label}
        </div>
      )}

      {/* Settings, pinned to bottom */}
      <button
        id="nav-settings"
        aria-label="Settings"
        aria-current={activeView === 'settings' ? 'page' : undefined}
        onClick={() => handleNavClick('settings')}
        style={{
          marginTop: 'auto',
          width: '40px',
          height: '40px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 'var(--radius-md)',
          border: 'none',
          background: activeView === 'settings' ? 'var(--color-secondary-muted)' : 'transparent',
          color: activeView === 'settings' ? 'var(--color-secondary)' : 'var(--color-balance)',
          cursor: 'pointer',
          transition: 'background var(--duration-fast) var(--ease-default), color var(--duration-fast) var(--ease-default)'
        }}
      >
        <IconSettings />
      </button>

      <style>{`
        @keyframes tooltip-in {
          from { opacity: 0; transform: translateX(-4px); }
          to   { opacity: 1; transform: translateX(0); }
        }
        #nav-log:not([aria-current]):hover,
        #nav-kanban:not([aria-current]):hover,
        #nav-backlog:not([aria-current]):hover,
        #nav-cookbook:not([aria-current]):hover,
        #nav-settings:not([aria-current]):hover {
          background: var(--color-surface-offset) !important;
          color: var(--color-text-base) !important;
        }
      `}</style>
    </div>
  )
}

// Chevron export
export { IconChevronDown }
