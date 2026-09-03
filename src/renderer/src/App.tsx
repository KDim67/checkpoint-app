import React, { useState, useRef, useEffect, lazy, Suspense, useCallback } from 'react'
import { useAppStore, type ActiveView } from './store/appStore'
import { Sidebar } from './components/Sidebar'
import { ToastProvider } from './components/ui/Toast'
import ErrorBoundary from './components/ui/ErrorBoundary'
import { ConfirmProvider } from './components/ui/ConfirmDialog'
import FocusTimerEngine from './components/focus/FocusTimerEngine'
import { applyFontSize } from './lib/fontScale'
import { applyStoredTheme, watchTheme } from './lib/themeBoot'
import Lightbox from './components/ui/Lightbox'
import { readViewFeatures, firstEnabledView, resolveStartView } from './lib/features'
import { getNumberSetting, setNumberSetting } from './lib/settings'
import { getBoolSetting, setBoolSetting } from './lib/settings'
import { createWorkspace, slugifyWorkspace, type WorkspaceEntry } from './lib/createWorkspace'

const ONBOARDING_SEEN_KEY = 'onboarding_seen'
/** Same palette the context manager assigns from, so colours stay consistent. */
const ONBOARDING_COLORS = ['#1e45fc', '#cdf12b', '#10b981', '#f97316', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899']
import {
  APP_SHORTCUTS,
  loadBindings,
  defaultBindings,
  comboFromEvent,
  isTypingTarget,
  type ShortcutBindings
} from './lib/shortcuts'

// Lazy-loaded views (code split per view)
const CommandPalette = lazy(() => import('./components/CommandPalette'))
const OnboardingModal = lazy(() => import('./components/OnboardingModal'))
const TrayPanel      = lazy(() => import('./components/TrayPanel'))
const LogView      = lazy(() => import('./components/LogView'))
const KanbanView   = lazy(() => import('./components/KanbanView'))
const BacklogView  = lazy(() => import('./components/BacklogView'))
const CookbookView = lazy(() => import('./components/CookbookView'))
const SettingsView = lazy(() => import('./components/SettingsView'))
const WidgetView    = lazy(() => import('./components/WidgetView'))
const FocusView     = lazy(() => import('./components/FocusView'))
const NotesView     = lazy(() => import('./components/NotesView'))
const ClipboardView = lazy(() => import('./components/ClipboardView'))
const AnalyticsView = lazy(() => import('./components/AnalyticsView'))
const HudView       = lazy(() => import('./components/HudView'))
const CheatsheetsView = lazy(() => import('./components/CheatsheetsView'))
const GameDevView = lazy(() => import('./components/GameDevView'))

// Lazy-loaded right panel
// These only render when the right panel is open, but importing them eagerly
// pulled ~7,000 lines (AiStreamPanel + ChatMessage alone) into the startup
// chunk for every launch, including launches that never open the panel.
const AiStreamPanel   = lazy(() => import('./components/AiStreamPanel'))
const GitPanel        = lazy(() => import('./components/GitPanel'))
const ItemDetailPanel = lazy(() => import('./components/ItemDetailPanel'))

// View-level skeleton (shown while lazy chunks load)
function ViewSkeleton() {
  return (
    <div style={{ padding: 'var(--space-6)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <div className="skeleton" style={{ height: '24px', width: '180px' }} />
      <div className="skeleton" style={{ height: '14px', width: '320px', opacity: 0.6 }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', marginTop: 'var(--space-4)' }}>
        {[1,2,3,4,5].map(i => (
          <div key={i} className="skeleton" style={{ height: '52px', borderRadius: 'var(--radius-md)', opacity: 1 - i * 0.1 }} />
        ))}
      </div>
    </div>
  )
}

// Theme Toggle
function ThemeToggle() {
  const [theme, setTheme] = React.useState<'dark' | 'light'>(() => {
    return (document.documentElement.getAttribute('data-theme') as 'dark' | 'light') || 'dark'
  })

  // Track external theme changes (startup application of the persisted
  // setting, or the Appearance settings tab) so the icon never goes stale.
  React.useEffect(() => {
    const observer = new MutationObserver(() => {
      const current = (document.documentElement.getAttribute('data-theme') as 'dark' | 'light') || 'dark'
      setTheme(current)
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])

  const toggleTheme = () => {
    // Read the live attribute (not state) so we can never double-toggle out of sync
    const current = (document.documentElement.getAttribute('data-theme') as 'dark' | 'light') || 'dark'
    const nextTheme = current === 'dark' ? 'light' : 'dark'
    setTheme(nextTheme)
    document.documentElement.setAttribute('data-theme', nextTheme)
    // Persist so the choice survives restarts (same key the Settings page uses)
    window.electronAPI.db.setSetting('app_theme', nextTheme).catch(console.error)
  }

  return (
    <button
      onClick={toggleTheme}
      aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
      style={{
        width: '28px',
        height: '22px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
        color: 'var(--color-text-muted)',
        borderRadius: 'var(--radius-sm)',
        transition: 'background var(--duration-fast) var(--ease-default), color var(--duration-fast) var(--ease-default)',
        WebkitAppRegion: 'no-drag' as React.CSSProperties['WebkitAppRegion']
      }}
      onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-surface-offset)')}
      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
    >
      {theme === 'dark' ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="4"/>
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>
        </svg>
      )}
    </button>
  )
}

// Titlebar
function Titlebar() {
  return (
    <div className="titlebar">
      <div style={{ display: 'flex', alignItems: 'center', userSelect: 'none' }}>
        <span
          style={{
            fontSize: 'var(--text-xs)',
            fontWeight: 'var(--weight-bold)',
            color: 'var(--color-secondary)',
            letterSpacing: 'var(--tracking-widest)',
            textTransform: 'uppercase'
          }}
        >
          Checkpoint
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', WebkitAppRegion: 'no-drag' as React.CSSProperties['WebkitAppRegion'] }}>
        <ThemeToggle />
        {window.electronAPI.app.platform === 'linux' && (
          <div className="titlebar-controls" style={{ display: 'flex', gap: 'var(--space-0-5)' }}>
            <TitlebarButton onClick={() => window.electronAPI.app.minimize()} label="Minimize">
              <svg width="10" height="1" viewBox="0 0 10 1"><line x1="0" y1="0.5" x2="10" y2="0.5" stroke="currentColor" strokeWidth="1.5"/></svg>
            </TitlebarButton>
            <TitlebarButton onClick={() => window.electronAPI.app.maximize()} label="Maximize">
              <svg width="10" height="10" viewBox="0 0 10 10"><rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1.2"/></svg>
            </TitlebarButton>
            <TitlebarButton onClick={() => window.electronAPI.app.close()} label="Close" isClose>
              <svg width="10" height="10" viewBox="0 0 10 10"><line x1="0" y1="0" x2="10" y2="10" stroke="currentColor" strokeWidth="1.5"/><line x1="10" y1="0" x2="0" y2="10" stroke="currentColor" strokeWidth="1.5"/></svg>
            </TitlebarButton>
          </div>
        )}
      </div>
    </div>
  )
}

function TitlebarButton({
  onClick,
  label,
  children,
  isClose = false
}: {
  onClick: () => void
  label: string
  children: React.ReactNode
  isClose?: boolean
}) {
  const [hover, setHover] = React.useState(false)
  return (
    <button
      aria-label={label}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width: '28px',
        height: '22px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: hover ? (isClose ? 'var(--color-error)' : 'var(--color-surface-offset)') : 'transparent',
        border: 'none',
        cursor: 'pointer',
        color: hover && isClose ? 'white' : 'var(--color-text-faint)',
        borderRadius: 'var(--radius-sm)',
        transition: 'background var(--duration-fast) var(--ease-default), color var(--duration-fast) var(--ease-default)',
        WebkitAppRegion: 'no-drag' as React.CSSProperties['WebkitAppRegion']
      }}
    >
      {children}
    </button>
  )
}

// Right Panel
const MIN_PANEL_WIDTH = 280
const MAX_PANEL_WIDTH = 800
const DEFAULT_PANEL_WIDTH = 380
// The sidebar rail plus a usable strip of main content; below this the panel
// would cover the view it is meant to annotate.
const MIN_CONTENT_WIDTH = 360

function clampPanelWidth(width: number): number {
  const ceiling = Math.max(MIN_PANEL_WIDTH, Math.min(MAX_PANEL_WIDTH, window.innerWidth - MIN_CONTENT_WIDTH))
  return Math.max(MIN_PANEL_WIDTH, Math.min(ceiling, width))
}

type PanelTabId = 'ai-chat' | 'git' | 'item-detail'

function PanelTab({
  id,
  label,
  isSelected,
  onSelect
}: {
  id: PanelTabId
  label: string
  isSelected: boolean
  onSelect: () => void
}) {
  return (
    <button
      role="tab"
      id={`panel-tab-${id}`}
      aria-selected={isSelected}
      aria-controls="right-panel-body"
      // Roving tabindex: one stop for the whole tablist, arrows move within it.
      tabIndex={isSelected ? 0 : -1}
      onClick={onSelect}
      style={{
        background: 'transparent',
        border: 'none',
        color: isSelected ? 'var(--color-secondary)' : 'var(--color-text-faint)',
        fontSize: 'var(--text-xs)',
        fontWeight: isSelected ? 'var(--weight-semibold)' : 'var(--weight-normal)',
        padding: 'var(--space-1) var(--space-2)',
        borderRadius: 'var(--radius-sm)',
        cursor: 'pointer',
        transition: 'color var(--duration-fast) var(--ease-default)'
      }}
    >
      {label}
    </button>
  )
}

function RightPanel() {
  const rightPanelOpen = useAppStore(s => s.rightPanelOpen)
  const rightPanelContent = useAppStore(s => s.rightPanelContent)
  const setRightPanelContent = useAppStore(s => s.setRightPanelContent)
  const selectedItemId = useAppStore(s => s.selectedItemId)

  const [panelWidth, setPanelWidth] = useState(DEFAULT_PANEL_WIDTH)

  useEffect(() => {
    getNumberSetting('right_panel_width', DEFAULT_PANEL_WIDTH)
      .then(w => setPanelWidth(clampPanelWidth(w)))
      .catch(err => console.error('Failed to read right panel width:', err))
  }, [])
  // State, not a ref: the width transition has to be switched off during a drag,
  // and a ref mutation does not re-render, so the animated value stayed live and
  // the panel lerped a frame behind the cursor.
  const [isResizing, setIsResizing] = useState(false)

  const panelTabs: { id: PanelTabId; label: string }[] = [
    { id: 'ai-chat', label: 'AI Assistant' },
    { id: 'git', label: 'Git' },
    ...(selectedItemId ? [{ id: 'item-detail' as PanelTabId, label: 'Detail' }] : [])
  ]

  const handleTabKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const current = panelTabs.findIndex(t => t.id === rightPanelContent)
    const delta = e.key === 'ArrowRight' ? 1 : -1
    const next = panelTabs[(current + delta + panelTabs.length) % panelTabs.length]
    setRightPanelContent(next.id)
    document.getElementById(`panel-tab-${next.id}`)?.focus()
  }

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    setIsResizing(true)
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'

    const handleMouseMove = (moveEvent: MouseEvent) => {
      setPanelWidth(clampPanelWidth(window.innerWidth - moveEvent.clientX))
    }

    const handleMouseUp = () => {
      setIsResizing(false)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
      // Persisted on release rather than per-frame, to keep the drag off the
      // IPC channel entirely.
      setPanelWidth(w => {
        setNumberSetting('right_panel_width', w).catch(err => {
          console.error('Failed to save right panel width:', err)
        })
        return w
      })
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
  }

  // Shrinking the window must not leave the panel wider than the viewport.
  useEffect(() => {
    const onResize = () => setPanelWidth(w => clampPanelWidth(w))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  return (
    <div
      style={{
        width: rightPanelOpen ? `${panelWidth}px` : '0',
        overflow: 'hidden',
        transition: isResizing ? 'none' : 'width var(--duration-fast) cubic-bezier(0.32, 0.72, 0, 1)',
        borderLeft: rightPanelOpen ? '1px solid var(--color-surface-offset)' : 'none',
        background: 'var(--color-surface-1)',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        position: 'relative'
      }}
      aria-hidden={!rightPanelOpen}
    >
      {/* Resizer Handle */}
      {rightPanelOpen && (
        <div
          onMouseDown={handleMouseDown}
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: '6px',
            cursor: 'col-resize',
            zIndex: 10,
            transition: 'background 150ms ease'
          }}
          onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-secondary-muted)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          title="Drag to resize panel"
        />
      )}
      {rightPanelOpen && (
        <div style={{ width: `${panelWidth}px`, height: '100%', display: 'flex', flexDirection: 'column' }}>
          <div style={{
            height: '44px',
            borderBottom: '1px solid var(--color-surface-offset)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 var(--space-2) 0 var(--space-4)',
            flexShrink: 0
          }}>
            <div
              role="tablist"
              aria-label="Right panel"
              onKeyDown={handleTabKeyDown}
              style={{ display: 'flex', gap: 'var(--space-1)' }}
            >
              {panelTabs.map(tab => (
                <PanelTab
                  key={tab.id}
                  id={tab.id}
                  label={tab.label}
                  isSelected={rightPanelContent === tab.id}
                  onSelect={() => setRightPanelContent(tab.id)}
                />
              ))}
            </div>
            <button
              className="btn-icon"
              onClick={() => setRightPanelContent(null)}
              aria-label="Close panel"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
          <div
            id="right-panel-body"
            role="tabpanel"
            aria-labelledby={rightPanelContent ? `panel-tab-${rightPanelContent}` : undefined}
            style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}
          >
            <ErrorBoundary label="This panel" resetKey={rightPanelContent ?? ''}>
              <Suspense fallback={<div className="skeleton" style={{ margin: 'var(--space-4)', height: '64px', borderRadius: 'var(--radius-md)' }} />}>
                {rightPanelContent === 'ai-chat' && <AiStreamPanel />}
                {rightPanelContent === 'git' && <GitPanel />}
                {rightPanelContent === 'item-detail' && <ItemDetailPanel />}
              </Suspense>
            </ErrorBoundary>
          </div>
        </div>
      )}
    </div>
  )
}


// Google Fonts Downloader
const GOOGLE_FONTS_URLS: Record<string, string> = {
  "'Outfit', sans-serif": 'https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&display=swap',
  "'Roboto', sans-serif": 'https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap',
  "'Playfair Display', serif": 'https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,600;1,400&display=swap'
}

function applyGoogleFont(fontValue: string) {
  const url = GOOGLE_FONTS_URLS[fontValue]
  let el = document.getElementById('custom-google-font') as HTMLLinkElement | null
  if (url) {
    if (!el) {
      el = document.createElement('link')
      el.id = 'custom-google-font'
      el.rel = 'stylesheet'
      document.head.appendChild(el)
    }
    el.href = url
  } else {
    if (el) el.remove()
  }
}

// Hash-route shells (widget & HUD live in their own BrowserWindows)
// These must be top-level components so the hooks inside App() are never
// called conditionally (Rules of Hooks).
function WidgetShell() {
  useSatelliteTheme()
  return (
    <div style={{ background: 'transparent', width: '100vw', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <ErrorBoundary label="The widget">
        <Suspense fallback={null}><WidgetView /></Suspense>
      </ErrorBoundary>
    </div>
  )
}
/**
 * The tray popup. No transparent wrapper: the panel draws its own rounded
 * surface and shadow, and a centring flex parent would letterbox it.
 */
/**
 * Applies the user's theme in a window that is not the main one.
 *
 * These shells are separate renderer instances that never run App's startup
 * effect, so without this they render the shipped dark palette however the app
 * is themed, which is why quick capture stayed dark under a custom theme.
 */
function useSatelliteTheme(): void {
  useEffect(() => {
    applyStoredTheme()
    return watchTheme()
  }, [])
}

function TrayShell() {
  return (
    <ErrorBoundary label="The tray panel">
      <Suspense fallback={null}><TrayPanel /></Suspense>
    </ErrorBoundary>
  )
}
function HudShell() {
  useSatelliteTheme()
  return (
    <div style={{ background: 'transparent', width: '100vw', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <ErrorBoundary label="Quick capture">
        <Suspense fallback={null}><HudView /></Suspense>
      </ErrorBoundary>
    </div>
  )
}

// App
export default function App() {
  const activeView = useAppStore(s => s.activeView)
  const setView = useAppStore(s => s.setView)
  const setAvailableContexts = useAppStore(s => s.setAvailableContexts)
  const setContextsList = useAppStore(s => s.setContextsList)
  const setContext = useAppStore(s => s.setContext)
  const toggleRightPanel = useAppStore(s => s.toggleRightPanel)
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [showOnboarding, setShowOnboarding] = useState(false)

  // Shown once, then never again unless replayed from Settings. Read rather
  // than pushed, so a slow first paint cannot race it: the panel appears when
  // the answer arrives instead of flashing and disappearing.
  useEffect(() => {
    let cancelled = false
    getBoolSetting(ONBOARDING_SEEN_KEY, false)
      .then(seen => { if (!cancelled && !seen) setShowOnboarding(true) })
      .catch(() => {})

    // Settings asks for a replay through the same event the rest of the app
    // uses to talk across views.
    const replay = (): void => setShowOnboarding(true)
    window.addEventListener('replay-onboarding', replay)
    return () => { cancelled = true; window.removeEventListener('replay-onboarding', replay) }
  }, [])

  const dismissOnboarding = useCallback(() => {
    setShowOnboarding(false)
    setBoolSetting(ONBOARDING_SEEN_KEY, true).catch(() => {})
  }, [])

  /**
   * Creates the workspace the first-run panel asked for and switches to it.
   *
   * Shares createWorkspace with the context manager in Settings, so a workspace
   * made here is identical to one made there.
   */
  const createOnboardingWorkspace = useCallback(async (name: string, templateId: string) => {
    const slug = slugifyWorkspace(name)
    if (!slug) throw new Error('That name has no letters or numbers in it.')

    const raw = await window.electronAPI.db.getSetting('contexts_list') as string | null
    let existing: WorkspaceEntry[] = []
    try { existing = raw ? JSON.parse(raw) : [] } catch { existing = [] }
    if (existing.some(c => c.slug === slug)) {
      throw new Error(`A workspace called "${slug}" already exists.`)
    }

    const entry: WorkspaceEntry = {
      slug,
      name: name.trim(),
      color: ONBOARDING_COLORS[existing.length % ONBOARDING_COLORS.length]
    }
    const { list } = await createWorkspace(existing, entry, templateId)

    setContextsList(list)
    setAvailableContexts(list.map(c => c.slug))
    setContext(slug)
  }, [setContextsList, setAvailableContexts, setContext])

  // Ctrl/Cmd+K, bound in the renderer rather than as a global shortcut: a global
  // one would fire while Checkpoint is in the background and steal the keystroke
  // from whatever the user is actually typing in.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen(open => !open)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // Opens the lightbox when an image is clicked directly. Runs in the capture
  // phase and swallows the event, so it has to bow out whenever the image is
  // standing in for a control, a card, button or link, otherwise clicking a
  // card's thumbnail zooms the image instead of opening the card.
  useEffect(() => {
    const handleImageClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (target.tagName !== 'IMG') return

      const img = target as HTMLImageElement
      // Chrome and logos are decoration, not content.
      if (img.alt === 'Checkpoint Logo' || img.closest('#context-switcher')) return
      if (img.closest('button, a, [role="button"], [data-no-lightbox]')) return

      const src = img.src || img.getAttribute('src')
      if (!src) return

      const isAttachedMedia = src.startsWith('checkpoint-media://') || src.startsWith('blob:')
      const isMarkdownImg = img.closest('.markdown-body') !== null
      if (isAttachedMedia || isMarkdownImg) {
        e.preventDefault()
        e.stopPropagation()
        setLightboxSrc(src)
      }
    }
    document.addEventListener('click', handleImageClick, true)
    return () => document.removeEventListener('click', handleImageClick, true)
  }, [])

  // Bootstrap: load available contexts from DB on mount.
  // An explicitly-set "default context" (Settings → General) wins over the
  // last-active one, previously that setting was saved but never read.
  const loadContexts = useCallback(async () => {
    try {
      const contexts = await window.electronAPI.db.getContexts()
      if (contexts.length > 0) {
        setAvailableContexts(contexts)

        const rawList = await window.electronAPI.db.getSetting('contexts_list') as string | null
        let list: any[] = []
        if (rawList) {
          try {
            list = JSON.parse(rawList)
          } catch {}
        }
        if (list.length === 0) {
          list = contexts.map((slug, i) => ({
            slug,
            name: slug.charAt(0).toUpperCase() + slug.slice(1),
            color: ['#1e45fc', '#cdf12b', '#10b981', '#f97316', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899'][i % 8]
          }))
          window.electronAPI.db.setSetting('contexts_list', JSON.stringify(list)).catch(() => {})
        }
        setContextsList(list)

        const defaultContext = await window.electronAPI.db.getSetting('default_context') as string | null
        const savedContext = await window.electronAPI.db.getSetting('active_context') as string | null
        const startContext =
          defaultContext && contexts.includes(defaultContext) ? defaultContext
          : savedContext && contexts.includes(savedContext) ? savedContext
          : contexts[0] // Fallback to first available context
        if (startContext) {
          setContext(startContext)
        }
      }
    } catch {
      // DB not yet initialized, use defaults
    }
  }, [setAvailableContexts, setContextsList, setContext])

  // Land on the configured start view before the redirect guard runs, so a
  // restored view is not immediately bounced by checkEnabledViews.
  const startViewAppliedRef = useRef(false)
  const shortcutBindingsRef = useRef<ShortcutBindings>(defaultBindings())

  useEffect(() => {
    const load = () => {
      loadBindings()
        .then(b => { shortcutBindingsRef.current = b })
        .catch(err => console.error('Failed to load shortcuts:', err))
    }
    load()
    window.addEventListener('settings-update-shortcuts', load)
    return () => window.removeEventListener('settings-update-shortcuts', load)
  }, [])

  useEffect(() => {
    resolveStartView()
      .then(view => {
        if (view) setView(view)
      })
      .catch(err => console.error('Failed to resolve start view:', err))
      .finally(() => {
        startViewAppliedRef.current = true
      })
  }, [setView])

  useEffect(() => {
    loadContexts()

    // Load and apply compact mode setting
    window.electronAPI.db.getSetting('appearance_compact').then((cm) => {
      if (cm === 'true') {
        document.documentElement.setAttribute('data-compact', 'true')
      }
    }).catch(console.error)

    // Apply the persisted interface theme, previously saved by Settings but
    // never read on boot, so the app silently reset to dark every launch.
    window.electronAPI.db.getSetting('app_theme').then((t) => {
      if (!t) return
      if (t === 'system') {
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
        document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light')
      } else if (t === 'dark' || t === 'light') {
        document.documentElement.setAttribute('data-theme', t)
      }
    }).catch(console.error)

    // Apply the persisted font scale, previously only applied once the
    // Appearance settings tab was opened.
    window.electronAPI.db.getSetting('appearance_font_size').then((fs) => {
      if (fs === 'small' || fs === 'medium' || fs === 'large') {
        applyFontSize(fs)
      }
    }).catch(console.error)

    // Hot-reload user theme CSS.
    //
    // The push alone was not enough: the customization engine starts before this
    // component mounts, so its startup broadcast arrived with nobody listening
    // and a saved preset silently reverted to the defaults on every launch. The
    // subscription handles later edits; the fetch below covers this launch.
    const applyThemeCss = (css: string): void => {
      let el = document.getElementById('user-theme') as HTMLStyleElement | null
      if (!el) {
        el = document.createElement('style')
        el.id = 'user-theme'
        document.head.appendChild(el)
      }
      el.textContent = css

      // Extract --font-sans from CSS if present
      const fontMatch = css.match(/--font-sans\s*:\s*([^;}\n]+)/)
      if (fontMatch) {
        const fontValue = fontMatch[1].trim()
        applyGoogleFont(fontValue)
      } else {
        const elFont = document.getElementById('custom-google-font')
        if (elFont) elFont.remove()
      }
    }

    const unsubTheme = window.electronAPI.onThemeUpdate(applyThemeCss)
    // Ask for whatever should be applied now, independent of any broadcast.
    window.electronAPI.customizer
      .getCss()
      .then(css => { if (css) applyThemeCss(css) })
      .catch(console.error)

    // Navigation hotkey listener
    const unsubNavigate = window.electronAPI.app.onNavigateToView((view: string) => {
      setView(view as ActiveView)
    })

    // An MCP client writes straight to the database from the main process,
    // bypassing the IPC calls the views normally refresh on. Re-dispatching the
    // DOM events the views already listen for means no view needs to know that
    // an external agent exists.
    const unsubMcp = window.electronAPI.mcp.onDataChanged(() => {
      window.dispatchEvent(new CustomEvent('kanban-refresh'))
      window.dispatchEvent(new CustomEvent('item-updated'))
    })

    // Global keyboard navigation shortcuts, matched against the user's bindings.
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return
      const combo = comboFromEvent(e)
      if (!combo) return

      const bindings = shortcutBindingsRef.current
      const shortcut = APP_SHORTCUTS.find(s => bindings[s.id] && bindings[s.id] === combo)
      if (!shortcut) return

      e.preventDefault()
      switch (shortcut.action.kind) {
        case 'view':
          setView(shortcut.action.view)
          break
        case 'toggleAiPanel':
          toggleRightPanel('ai-chat')
          break
        case 'openSettings':
          setView('settings')
          break
      }
    }

    window.addEventListener('keydown', handleGlobalKeyDown)

    return () => {
      unsubTheme()
      unsubNavigate()
      unsubMcp()
      window.removeEventListener('keydown', handleGlobalKeyDown)
    }
  }, [loadContexts, setView, toggleRightPanel])

  // Safeguard: redirect if the view we are on gets disabled in settings.
  const checkEnabledViews = useCallback(async () => {
    if (!startViewAppliedRef.current) return
    try {
      const enabled = await readViewFeatures()
      if (!enabled[activeView]) {
        setView(firstEnabledView(enabled))
      }
    } catch (err) {
      console.error('Failed checking enabled views in App:', err)
    }
  }, [activeView, setView])

  useEffect(() => {
    checkEnabledViews()
    window.addEventListener('settings-update-features', checkEnabledViews)
    return () => window.removeEventListener('settings-update-features', checkEnabledViews)
  }, [checkEnabledViews])

  function renderView() {
    switch (activeView) {
      case 'log':       return <LogView />
      case 'kanban':    return <KanbanView />
      case 'backlog':   return <BacklogView />
      case 'focus':     return <FocusView />
      case 'notes':     return <NotesView />
      case 'clipboard': return <ClipboardView />
      case 'cookbook':  return <CookbookView />
      case 'analytics': return <AnalyticsView />
      case 'settings':  return <SettingsView />
      case 'cheatsheets': return <CheatsheetsView />
      case 'gamedev':   return <GameDevView />
      default:          return null
    }
  }

  return (
    <ToastProvider>
      <ConfirmProvider>
        <FocusTimerEngine />
        {/* Outermost net: the per-view and per-panel boundaries below handle
            almost everything, but a throw in the shell chrome itself (Titlebar,
            Sidebar) would otherwise still take the window to white. */}
        <ErrorBoundary label="Checkpoint">
        <Suspense fallback={null}>
          <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
          {showOnboarding && (
            <OnboardingModal
              onCreateWorkspace={createOnboardingWorkspace}
              onClose={dismissOnboarding}
            />
          )}
        </Suspense>
        <div className="app-shell">
          <Titlebar />
          <div className="app-body">
            <Sidebar />
            <main
              id="main-content"
              className="app-content"
              role="main"
              aria-label={`${activeView} view`}
            >
              <ErrorBoundary label="This view" resetKey={activeView}>
                <Suspense fallback={<ViewSkeleton />}>
                  {renderView()}
                </Suspense>
              </ErrorBoundary>
            </main>
            <RightPanel />
          </div>
        </div>
        </ErrorBoundary>
        <Lightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />
      </ConfirmProvider>
    </ToastProvider>
  )
}

// Root router, selects between standalone shells and the full app
// This is what main.tsx should render (or App can be renamed; kept as default
// export for back-compat and the router wraps it).
export function AppRouter() {
  const hash = window.location.hash
  if (hash === '#widget') return <WidgetShell />
  if (hash === '#hud')    return <HudShell />
  if (hash === '#tray')   return <TrayShell />
  return <App />
}