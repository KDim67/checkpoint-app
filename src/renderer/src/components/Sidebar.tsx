import React, { useState, useRef, useEffect, useCallback } from 'react'
import { readViewFeatures, defaultViewEnabledMap, type ViewEnabledMap } from '../lib/features'
import { getBoolSetting } from '../lib/settings'
import { useAppStore, type ActiveView } from '../store/appStore'
import Logo from './ui/Logo'

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

function IconWall(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="3" y="4" width="8" height="6" rx="1"/>
      <rect x="13" y="4" width="8" height="10" rx="1"/>
      <rect x="3" y="13" width="8" height="7" rx="1"/>
      <rect x="13" y="17" width="8" height="3" rx="1"/>
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

function IconFocus(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="12" cy="12" r="10"/>
      <polyline points="12 6 12 12 16 14"/>
    </svg>
  )
}

function IconNotes(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M16 3H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12l5-5V5a2 2 0 0 0-2-2z"/>
      <path d="M15 21v-6h6"/>
    </svg>
  )
}

function IconClipboard(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="8" y="2" width="8" height="4" rx="1" ry="1"/>
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>
    </svg>
  )
}

function IconAnalytics(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <line x1="18" y1="20" x2="18" y2="10"/>
      <line x1="12" y1="20" x2="12" y2="4"/>
      <line x1="6" y1="20" x2="6" y2="14"/>
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

function IconCheatsheets(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
      <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
    </svg>
  )
}

function IconGamepad(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <line x1="6" y1="12" x2="10" y2="12" />
      <line x1="8" y1="10" x2="8" y2="14" />
      <line x1="15" y1="13" x2="15.01" y2="13" />
      <line x1="18" y1="11" x2="18.01" y2="11" />
      <rect x="2" y="6" width="20" height="12" rx="3" />
    </svg>
  )
}

function IconSync(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/>
    </svg>
  )
}

// Nav Item Data

const NAV_ITEMS: Array<{
  view: ActiveView
  label: string
  Icon: React.FC<React.SVGProps<SVGSVGElement>>
}> = [
  { view: 'kanban',      label: 'Kanban',      Icon: IconKanban },
  { view: 'log',         label: 'Log',         Icon: IconLog },
  { view: 'backlog',     label: 'Backlog',     Icon: IconBacklog },
  { view: 'focus',       label: 'Focus',       Icon: IconFocus },
  { view: 'notes',       label: 'Notes',       Icon: IconNotes },
  { view: 'wall',        label: 'Wall',        Icon: IconWall },
  { view: 'clipboard',   label: 'Clipboard',   Icon: IconClipboard },
  { view: 'analytics',   label: 'Analytics',   Icon: IconAnalytics },
  { view: 'cookbook',    label: 'Cookbook',    Icon: IconCookbook },
  { view: 'cheatsheets', label: 'Cheatsheets', Icon: IconCheatsheets }
]

// Context Popover

interface ContextPopoverProps {
  onClose: () => void
}

/**
 * A real listbox: the options are the contexts, and the "Manage" action sits
 * outside it as a footer, because an action row is not a selectable option and
 * would make the listbox semantics a lie.
 */
function ContextPopover({ onClose }: ContextPopoverProps) {
  const activeContext = useAppStore(s => s.activeContext)
  const availableContexts = useAppStore(s => s.availableContexts)
  const contextsList = useAppStore(s => s.contextsList)
  const setContext = useAppStore(s => s.setContext)
  const setView = useAppStore(s => s.setView)
  const setSettingsTab = useAppStore(s => s.setSettingsTab)

  const listRef = useRef<HTMLDivElement>(null)
  const [activeIndex, setActiveIndex] = useState(() => {
    const i = availableContexts.indexOf(activeContext)
    return i === -1 ? 0 : i
  })

  useEffect(() => {
    listRef.current?.focus()
  }, [])

  // Keep the highlighted option in view when arrowing past the scroll edge.
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  const commit = (index: number) => {
    const ctx = availableContexts[index]
    if (ctx) setContext(ctx)
    onClose()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const last = availableContexts.length - 1
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setActiveIndex(i => (i >= last ? 0 : i + 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        setActiveIndex(i => (i <= 0 ? last : i - 1))
        break
      case 'Home':
        e.preventDefault()
        setActiveIndex(0)
        break
      case 'End':
        e.preventDefault()
        setActiveIndex(last)
        break
      case 'Enter':
      case ' ':
        e.preventDefault()
        commit(activeIndex)
        break
      case 'Escape':
        e.preventDefault()
        onClose()
        break
    }
  }

  return (
    <div
      style={{
        position: 'absolute',
        top: '12px',
        left: '62px',
        zIndex: 100,
        background: 'var(--color-surface-elevated)',
        border: '1px solid var(--color-surface-offset)',
        borderRadius: 'var(--radius-md)',
        boxShadow: 'var(--shadow-md)',
        minWidth: '220px',
        padding: '4px 0',
        animation: 'dropdown-in 150ms var(--ease-enter)'
      }}
    >
      <div id="context-popover-label" className="label-caps" style={{ padding: '6px 12px 4px', letterSpacing: '0.05em' }}>
        Workspaces / Contexts
      </div>
      <div
        ref={listRef}
        role="listbox"
        tabIndex={0}
        aria-labelledby="context-popover-label"
        aria-activedescendant={`context-option-${activeIndex}`}
        onKeyDown={handleKeyDown}
        style={{ maxHeight: '240px', overflowY: 'auto', outline: 'none' }}
        className="custom-scrollbar"
      >
        {availableContexts.map((ctx, index) => {
          const entry = contextsList.find(c => c.slug === ctx)
          const name = entry ? entry.name : ctx.replace(/-/g, ' ').replace(/\w/g, l => l.toUpperCase())
          const color = entry ? entry.color : 'var(--color-balance)'
          const isCurrent = ctx === activeContext
          const isActive = index === activeIndex

          return (
            <div
              key={ctx}
              id={`context-option-${index}`}
              data-index={index}
              role="option"
              aria-selected={isCurrent}
              onClick={() => commit(index)}
              onMouseEnter={() => setActiveIndex(index)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-2)',
                width: '100%',
                padding: '6px 12px',
                cursor: 'pointer',
                fontSize: 'var(--text-sm)',
                color: isCurrent ? 'var(--color-secondary)' : 'var(--color-text-base)',
                background: isActive ? 'var(--color-surface-offset)' : 'none',
                transition: 'background var(--duration-fast) var(--ease-default)'
              }}
            >
              <span style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                background: isCurrent ? 'var(--color-secondary)' : color,
                flexShrink: 0
              }} />
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {name}
              </span>
            </div>
          )
        })}
      </div>
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
        onClick={() => {
          setView('settings')
          setSettingsTab('contexts')
          onClose()
        }}
      >
        <IconPlus style={{ opacity: 0.7 }} />
        Manage / New Context
      </button>
    </div>
  )
}

// Sidebar

export function Sidebar() {
  const activeView = useAppStore(s => s.activeView)
  const activeContext = useAppStore(s => s.activeContext)
  const contextsList = useAppStore(s => s.contextsList)
  const setView = useAppStore(s => s.setView)
  const setSettingsTab = useAppStore(s => s.setSettingsTab)
  const focusIsRunning = useAppStore(s => s.focusIsRunning)

  const [contextOpen, setContextOpen] = useState(false)
  const contextTriggerRef = useRef<HTMLButtonElement>(null)

  // Focus moves into the popover on open, so it has to come back on close or
  // the tab order restarts from the top of the document.
  const closeContextPopover = useCallback(() => {
    setContextOpen(false)
    contextTriggerRef.current?.focus()
  }, [])
  const [tooltip, setTooltip] = useState<{ label: string; y: number } | null>(null)
  const [enabledViews, setEnabledViews] = useState<ViewEnabledMap>(defaultViewEnabledMap)
  const [syncEnabled, setSyncEnabled] = useState(false)
  const [isSyncing, setIsSyncing] = useState(false)
  const [syncProgress, setSyncProgress] = useState('Idle')
  const sidebarRef = useRef<HTMLDivElement>(null)

  const checkFeatures = async () => {
    try {
      setEnabledViews(await readViewFeatures())
    } catch (err) {
      console.error('Failed to read settings in Sidebar:', err)
    }
  }

  const checkSyncStatus = useCallback(async () => {
    try {
      const isEnabled = await getBoolSetting('sync_enabled', false)
      setSyncEnabled(isEnabled)
      if (isEnabled) {
        const status = await window.electronAPI.sync.getStatus()
        setIsSyncing(status.isSyncing)
        setSyncProgress(status.progress || 'Idle')
      } else {
        setIsSyncing(false)
        setSyncProgress('Disabled')
      }
    } catch (err) {
      console.error('Failed to read sync status in Sidebar:', err)
    }
  }, [])

  useEffect(() => {
    checkFeatures()
    window.addEventListener('settings-update-features', checkFeatures)
    return () => window.removeEventListener('settings-update-features', checkFeatures)
  }, [])

  useEffect(() => {
    checkSyncStatus()
    window.addEventListener('settings-update-sync', checkSyncStatus)
    return () => window.removeEventListener('settings-update-sync', checkSyncStatus)
  }, [checkSyncStatus])

  // Poll only while sync is on. The interval used to run for the whole session
  // regardless, doing an IPC round-trip every 5s just to re-learn it was off.
  useEffect(() => {
    if (!syncEnabled) return
    const interval = setInterval(checkSyncStatus, 5000)
    return () => clearInterval(interval)
  }, [syncEnabled, checkSyncStatus])

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

  const activeContextEntry = contextsList.find(c => c.slug === activeContext)
  const ctxLabel = activeContextEntry ? activeContextEntry.name : activeContext.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
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
      // Named so the first-run tour can spotlight the whole rail at once, 
      // the workspace switcher and the view icons are one idea to a newcomer.
      id="app-sidebar"
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
      {/* Interactive Logo Context Switcher */}
      <button
        ref={contextTriggerRef}
        id="context-switcher"
        title={`Active Context: ${ctxLabel}. Click to view all contexts.`}
        aria-label={`Active context: ${ctxLabel}. Click to view contexts list.`}
        aria-expanded={contextOpen}
        aria-haspopup="listbox"
        onClick={() => setContextOpen(v => !v)}
        style={{
          position: 'relative',
          padding: '4px',
          borderRadius: 'var(--radius-md)',
          background: contextOpen ? 'var(--color-secondary-muted)' : 'transparent',
          border: `1px solid ${contextOpen ? 'var(--color-secondary)' : 'transparent'}`,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 'var(--space-2)',
          transition: 'all var(--duration-fast) var(--ease-default)',
          flexShrink: 0
        }}
        onMouseEnter={e => {
          if (!contextOpen) e.currentTarget.style.background = 'var(--color-surface-2)'
        }}
        onMouseLeave={e => {
          if (!contextOpen) e.currentTarget.style.background = 'transparent'
        }}
      >
        <div style={{ filter: 'drop-shadow(0 2px 6px rgba(187, 254, 43, 0.35))', display: 'flex' }}>
          <Logo size={32} />
        </div>
        <span
          style={{
            position: 'absolute',
            bottom: '0px',
            right: '0px',
            width: '14px',
            height: '14px',
            borderRadius: '50%',
            background: 'var(--color-surface-1)',
            border: `1.5px solid ${activeContextEntry?.color || 'var(--color-secondary)'}`,
            color: activeContextEntry?.color || 'var(--color-secondary)',
            fontSize: '8.5px',
            fontWeight: 'var(--weight-extrabold)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            lineHeight: 1,
            boxShadow: '0 1px 4px rgba(0,0,0,0.5)'
          }}
        >
          {ctxInitial}
        </span>
      </button>

      {contextOpen && <ContextPopover onClose={closeContextPopover} />}

      <div style={{ height: '1px', width: '32px', background: 'var(--color-surface-offset)', margin: '2px 0 4px' }} />

      {/* Nav items */}
      <nav
        aria-label="Main navigation"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-1)',
          width: '100%',
          alignItems: 'center',
          flex: 1
        }}
      >
        {[...NAV_ITEMS, { view: 'gamedev' as ActiveView, label: 'Game Dev', Icon: IconGamepad }]
          .filter(item => enabledViews[item.view])
          .map(({ view, label, Icon }) => {
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

                {/* Running-timer indicator, visible from any view, so a session
                    never silently ticks away unnoticed while you work elsewhere */}
                {view === 'focus' && focusIsRunning && !isActive && (
                  <span
                    aria-hidden="true"
                    style={{
                      position: 'absolute',
                      top: '4px',
                      right: '4px',
                      width: '8px',
                      height: '8px',
                      borderRadius: '50%',
                      background: 'var(--color-secondary)',
                      boxShadow: '0 0 0 2px var(--color-surface-1)',
                      animation: 'focus-pulse 1.6s ease-in-out infinite'
                    }}
                  />
                )}
              </button>
            )
          })}

        {/* Bottom actions container */}
        <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', alignItems: 'center', width: '100%' }}>
          {syncEnabled && (
            <button
              id="nav-sync-indicator"
              aria-label="P2P Network Sync Status"
              onClick={() => {
                setView('settings')
                setSettingsTab('sync')
              }}
              onMouseEnter={e => {
                const rect = e.currentTarget.getBoundingClientRect()
                setTooltip({ label: `Sync engine active: ${syncProgress}`, y: rect.top + rect.height / 2 })
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
                background: 'transparent',
                color: isSyncing ? 'var(--color-secondary)' : 'var(--color-text-muted)',
                cursor: 'pointer',
                transition: 'all var(--duration-fast) var(--ease-default)'
              }}
            >
              <IconSync className={isSyncing ? 'animate-spin' : ''} style={{ width: '18px', height: '18px' }} />
            </button>
          )}

          <button
            id="nav-settings"
            aria-label="Settings"
            aria-current={activeView === 'settings' ? 'page' : undefined}
            onClick={() => handleNavClick('settings')}
            onMouseEnter={e => {
              const rect = e.currentTarget.getBoundingClientRect()
              setTooltip({ label: 'Settings', y: rect.top + rect.height / 2 })
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
              background: activeView === 'settings' ? 'var(--color-secondary-muted)' : 'transparent',
              color: activeView === 'settings' ? 'var(--color-secondary)' : 'var(--color-balance)',
              cursor: 'pointer',
              transition: 'background var(--duration-fast) var(--ease-default), color var(--duration-fast) var(--ease-default)'
            }}
          >
            <IconSettings />
          </button>
        </div>
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

      <style>{`
        #nav-log:not([aria-current]):hover,
        #nav-kanban:not([aria-current]):hover,
        #nav-backlog:not([aria-current]):hover,
        #nav-focus:not([aria-current]):hover,
        #nav-notes:not([aria-current]):hover,
        #nav-clipboard:not([aria-current]):hover,
        #nav-analytics:not([aria-current]):hover,
        #nav-cookbook:not([aria-current]):hover,
        #nav-cheatsheets:not([aria-current]):hover,
        #nav-gamedev:not([aria-current]):hover,
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