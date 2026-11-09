import React, { useState, useRef, useEffect, useCallback } from 'react'
import { readViewFeatures, defaultViewEnabledMap, type ViewEnabledMap } from '../lib/features'
import { getBoolSetting } from '../lib/settings'
import { useAppStore, type ActiveView } from '../store/appStore'
import Logo from './ui/Logo'
import * as syncApi from '../data/sync'
import { defaultBindings, loadBindings, type ShortcutBindings } from '../lib/shortcuts'
import { useRenewalAttention } from './renewals/useRenewalAttention'
import { iconUrl } from '../lib/workspaceIcon'
import { withViewTransition } from '../lib/viewTransition'
import { preloadScreen } from './screens'

// inline SVG, no icon lib

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

function IconCalendar(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="3" y="4" width="18" height="18" rx="2"/>
      <path d="M16 2v4"/>
      <path d="M8 2v4"/>
      <path d="M3 10h18"/>
      <path d="M8 14h.01"/>
      <path d="M12 14h.01"/>
      <path d="M16 14h.01"/>
      <path d="M8 18h.01"/>
      <path d="M12 18h.01"/>
    </svg>
  )
}

function IconRenewals(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M21 7.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3.5"/>
      <path d="M16 2v4"/>
      <path d="M8 2v4"/>
      <path d="M3 10h5"/>
      <circle cx="16" cy="16" r="6"/>
      <path d="M16 14v2l1 1"/>
    </svg>
  )
}

const NAV_ITEMS: Array<{
  view: ActiveView
  label: string
  Icon: React.FC<React.SVGProps<SVGSVGElement>>
}> = [
  { view: 'kanban',      label: 'Kanban',      Icon: IconKanban },
  { view: 'log',         label: 'Log',         Icon: IconLog },
  { view: 'backlog',     label: 'Backlog',     Icon: IconBacklog },
  { view: 'calendar',    label: 'Calendar',    Icon: IconCalendar },
  { view: 'renewals',    label: 'Renewals',    Icon: IconRenewals },
  { view: 'focus',       label: 'Focus',       Icon: IconFocus },
  { view: 'notes',       label: 'Notes',       Icon: IconNotes },
  { view: 'wall',        label: 'Wall',        Icon: IconWall },
  { view: 'clipboard',   label: 'Clipboard',   Icon: IconClipboard },
  { view: 'analytics',   label: 'Analytics',   Icon: IconAnalytics },
  { view: 'cookbook',    label: 'AI Cookbook', Icon: IconCookbook },
  { view: 'cheatsheets', label: 'Cheatsheets', Icon: IconCheatsheets }
]

export function Sidebar() {
  const activeView = useAppStore(s => s.activeView)
  const activeWorkspace = useAppStore(s => s.activeWorkspace)
  const workspaceList = useAppStore(s => s.workspaceList)
  const setView = useAppStore(s => s.setView)
  const setSettingsTab = useAppStore(s => s.setSettingsTab)
  const focusIsRunning = useAppStore(s => s.focusIsRunning)

  const goBack = useAppStore(s => s.goBack)
  const [brokenIcon, setBrokenIcon] = useState<string | null>(null)
  const onWorkspaces = activeView === 'workspaces'
  const [tooltip, setTooltip] = useState<{ label: string; y: number; keys?: string } | null>(null)
  /** the label teaches the key: Wall, Ctrl+6 */
  const [bindings, setBindings] = useState<ShortcutBindings>(defaultBindings)
  useEffect(() => {
    const load = (): void => { loadBindings().then(setBindings).catch(() => {}) }
    load()
    window.addEventListener('settings-update-shortcuts', load)
    return () => window.removeEventListener('settings-update-shortcuts', load)
  }, [])
  const [enabledViews, setEnabledViews] = useState<ViewEnabledMap>(defaultViewEnabledMap)
  const renewalsDue = useRenewalAttention(enabledViews.renewals)
  const [syncEnabled, setSyncEnabled] = useState(false)
  const [isSyncing, setIsSyncing] = useState(false)
  const [syncProgress, setSyncProgress] = useState('Idle')
  const sidebarRef = useRef<HTMLDivElement>(null)
  const showTooltip = (el: HTMLElement, label: string, keys?: string): void => {
    const rect = el.getBoundingClientRect()
    setTooltip({ label, y: rect.top + rect.height / 2, keys: keys || undefined })
  }

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
        const status = await syncApi.getStatus()
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

  // poll only while sync is on, it used to IPC every 5s regardless
  useEffect(() => {
    if (!syncEnabled) return
    const interval = setInterval(checkSyncStatus, 5000)
    return () => clearInterval(interval)
  }, [syncEnabled, checkSyncStatus])

  const activeContextEntry = workspaceList.find(c => c.slug === activeWorkspace)
  const ctxLabel = activeContextEntry ? activeContextEntry.name : activeWorkspace.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
  const ctxInitial = ctxLabel[0]?.toUpperCase() ?? 'D'
  // the workspace's own picture when it has one that loads
  const picture = activeContextEntry?.icon && activeContextEntry.icon !== brokenIcon ? activeContextEntry.icon : null

  function handleNavClick(view: ActiveView) {
    if (view === activeView) return
    withViewTransition(() => setView(view))
  }

  return (
    <div
      ref={sidebarRef}
      // named so the tour can spotlight the whole rail
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
      {/* the logo opens the Workspaces page, and a second click goes back */}
      <button
        id="context-switcher"
        title={`Workspaces. You're in ${ctxLabel}.`}
        aria-label={`Workspaces, current workspace ${ctxLabel}`}
        aria-current={onWorkspaces ? 'page' : undefined}
        onClick={() => withViewTransition(() => (onWorkspaces ? goBack() : setView('workspaces')))}
        className="sidebar-context-trigger"
        style={{
          position: 'relative',
          padding: '4px',
          borderRadius: 'var(--radius-md)',
          border: `1px solid ${onWorkspaces ? 'var(--color-secondary)' : 'transparent'}`,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 'var(--space-2)',
          transition: 'all var(--duration-fast) var(--ease-default)',
          flexShrink: 0
        }}
      >
        {/* a workspace with a picture takes the big spot, so where you are is the first thing you see; the logo steps into the badge */}
        {picture ? (
          <img
            src={iconUrl(picture)}
            alt=""
            draggable={false}
            onError={() => setBrokenIcon(picture)}
            style={{
              display: 'block',
              width: '32px',
              height: '32px',
              objectFit: 'cover',
              borderRadius: 'var(--radius-md)',
              border: `1.5px solid ${activeContextEntry?.color || 'var(--color-secondary)'}`
            }}
          />
        ) : (
          <div style={{ filter: 'drop-shadow(0 2px 6px rgba(187, 254, 43, 0.35))', display: 'flex' }}>
            <Logo size={32} />
          </div>
        )}
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
            fontSize: 'var(--text-xs)',
            fontWeight: 'var(--weight-extrabold)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            lineHeight: 1,
            overflow: 'hidden',
            boxShadow: '0 1px 4px rgba(0,0,0,0.5)'
          }}
        >
          {picture ? <Logo size={9} /> : ctxInitial}
        </span>
      </button>

      <div style={{ height: '1px', width: '32px', background: 'var(--color-surface-offset)', margin: '2px 0 4px' }} />

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
                aria-label={view === 'renewals' && renewalsDue > 0 ? `${label}, ${renewalsDue} need a look` : label}
                aria-current={isActive ? 'page' : undefined}
                onClick={() => handleNavClick(view)}
                // its code is fetched as the pointer or the keyboard arrives, ahead of the click
                onMouseEnter={e => { preloadScreen(view); showTooltip(e.currentTarget, label, bindings[`view_${view}`]) }}
                onMouseLeave={() => setTooltip(null)}
                onFocus={e => { preloadScreen(view); showTooltip(e.currentTarget, label, bindings[`view_${view}`]) }}
                onBlur={() => setTooltip(null)}
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

                {view === 'renewals' && renewalsDue > 0 && (
                  <span
                    aria-hidden="true"
                    style={{
                      position: 'absolute',
                      top: '2px',
                      right: '2px',
                      minWidth: '16px',
                      height: '16px',
                      padding: '0 var(--space-1)',
                      borderRadius: 'var(--radius-full)',
                      background: 'var(--color-warning)',
                      color: 'var(--color-text-inverted)',
                      fontSize: 'var(--text-xxs)',
                      fontWeight: 'var(--weight-bold)',
                      lineHeight: '16px',
                      boxShadow: '0 0 0 2px var(--color-surface-1)'
                    }}
                  >
                    {renewalsDue > 9 ? '9+' : renewalsDue}
                  </span>
                )}

                {/* running-timer dot, visible from any view */}
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

        <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', alignItems: 'center', width: '100%' }}>
          {syncEnabled && (
            <button
              id="nav-sync-indicator"
              aria-label="Device Sync Status"
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
            onMouseEnter={e => { preloadScreen('settings'); showTooltip(e.currentTarget, 'Settings', bindings.open_settings) }}
            onMouseLeave={() => setTooltip(null)}
            onFocus={e => { preloadScreen('settings'); showTooltip(e.currentTarget, 'Settings', bindings.open_settings) }}
            onBlur={() => setTooltip(null)}
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
            zIndex: 'var(--z-float)',
            boxShadow: 'var(--shadow-sm)',
            animation: 'tooltip-in 100ms var(--ease-enter)'
          }}
        >
          {tooltip.label}
          {tooltip.keys && (
            <span className="text-mono-micro" style={{ marginLeft: 'var(--space-2)', color: 'var(--color-text-faint)' }}>
              {tooltip.keys}
            </span>
          )}
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

export { IconChevronDown }