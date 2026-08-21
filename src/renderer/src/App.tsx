import React, { useState, useRef, useEffect, lazy, Suspense, useCallback } from 'react'
import { useAppStore, type ActiveView } from './store/appStore'
import { Sidebar } from './components/Sidebar'
import AiStreamPanel from './components/AiStreamPanel'
import GitPanel from './components/GitPanel'
import ItemDetailPanel from './components/ItemDetailPanel'
import { ToastProvider } from './components/ui/Toast'
import FocusTimerEngine from './components/focus/FocusTimerEngine'
import { applyFontSize } from './components/settings/AppearanceSettings'
import Lightbox from './components/ui/Lightbox'
import { readViewFeatures, firstEnabledView } from './lib/features'

// Lazy-loaded views (code split per view)
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
function RightPanel() {
  const rightPanelOpen = useAppStore(s => s.rightPanelOpen)
  const rightPanelContent = useAppStore(s => s.rightPanelContent)
  const setRightPanelContent = useAppStore(s => s.setRightPanelContent)
  const selectedItemId = useAppStore(s => s.selectedItemId)

  const [panelWidth, setPanelWidth] = useState(380)
  const isResizingRef = useRef(false)

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    isResizingRef.current = true
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!isResizingRef.current) return
      const newWidth = window.innerWidth - moveEvent.clientX
      if (newWidth >= 280 && newWidth <= 800) {
        setPanelWidth(newWidth)
      }
    }

    const handleMouseUp = () => {
      isResizingRef.current = false
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
  }

  return (
    <div
      style={{
        width: rightPanelOpen ? `${panelWidth}px` : '0',
        overflow: 'hidden',
        transition: isResizingRef.current ? 'none' : 'width var(--duration-fast) cubic-bezier(0.32, 0.72, 0, 1)',
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
            <div role="tablist" style={{ display: 'flex', gap: 'var(--space-1)' }}>
              <button
                role="tab"
                aria-selected={rightPanelContent === 'ai-chat'}
                onClick={() => setRightPanelContent('ai-chat')}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: rightPanelContent === 'ai-chat' ? 'var(--color-secondary)' : 'var(--color-text-faint)',
                  fontSize: 'var(--text-xs)',
                  fontWeight: rightPanelContent === 'ai-chat' ? 'var(--weight-semibold)' : 'var(--weight-normal)',
                  padding: 'var(--space-1) var(--space-2)',
                  borderRadius: 'var(--radius-sm)',
                  cursor: 'pointer',
                  transition: 'color var(--duration-fast) var(--ease-default)'
                }}
              >
                AI Assistant
              </button>
              <button
                role="tab"
                aria-selected={rightPanelContent === 'git'}
                onClick={() => setRightPanelContent('git')}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: rightPanelContent === 'git' ? 'var(--color-secondary)' : 'var(--color-text-faint)',
                  fontSize: 'var(--text-xs)',
                  fontWeight: rightPanelContent === 'git' ? 'var(--weight-semibold)' : 'var(--weight-normal)',
                  padding: 'var(--space-1) var(--space-2)',
                  borderRadius: 'var(--radius-sm)',
                  cursor: 'pointer',
                  transition: 'color var(--duration-fast) var(--ease-default)'
                }}
              >
                Git
              </button>
              {selectedItemId && (
                <button
                  role="tab"
                  aria-selected={rightPanelContent === 'item-detail'}
                  onClick={() => setRightPanelContent('item-detail')}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: rightPanelContent === 'item-detail' ? 'var(--color-secondary)' : 'var(--color-text-faint)',
                    fontSize: 'var(--text-xs)',
                    fontWeight: rightPanelContent === 'item-detail' ? 'var(--weight-semibold)' : 'var(--weight-normal)',
                    padding: 'var(--space-1) var(--space-2)',
                    borderRadius: 'var(--radius-sm)',
                    cursor: 'pointer',
                    transition: 'color var(--duration-fast) var(--ease-default)'
                  }}
                >
                  Detail
                </button>
              )}
            </div>
            <button
              className="btn-icon"
              onClick={() => setRightPanelContent(null)}
              aria-label="Close panel"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
          {rightPanelContent === 'ai-chat' && <AiStreamPanel />}
          {rightPanelContent === 'git' && <GitPanel />}
          {rightPanelContent === 'item-detail' && <ItemDetailPanel />}
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
  return (
    <div style={{ background: 'transparent', width: '100vw', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <Suspense fallback={null}><WidgetView /></Suspense>
    </div>
  )
}
function HudShell() {
  return (
    <div style={{ background: 'transparent', width: '100vw', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <Suspense fallback={null}><HudView /></Suspense>
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

  // Global Image Click Listener for Lightbox Preview
  useEffect(() => {
    const handleImageClick = (e: MouseEvent) => {
      const target = e.target as HTMLImageElement
      if (target.tagName === 'IMG') {
        // Exclude application logos / UI icons from triggering the lightbox preview
        if (target.alt === 'Checkpoint Logo' || target.closest('#context-switcher')) {
          return
        }
        const src = target.src || target.getAttribute('src')
        if (src) {
          const isAttachedMedia = src.startsWith('checkpoint-media://') || src.startsWith('blob:')
          const isMarkdownImg = target.closest('.markdown-body') !== null
          if (isAttachedMedia || isMarkdownImg) {
            e.preventDefault()
            e.stopPropagation()
            setLightboxSrc(src)
          }
        }
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

    // Hot-reload user theme CSS
    const unsubTheme = window.electronAPI.onThemeUpdate((css: string) => {
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
    })

    // Navigation hotkey listener
    const unsubNavigate = window.electronAPI.app.onNavigateToView((view: string) => {
      setView(view as ActiveView)
    })

    // Global keyboard navigation shortcuts
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) {
        if (e.key === 'l' || e.key === 'L') {
          e.preventDefault()
          toggleRightPanel('ai-chat')
          return
        }

        if (e.key === ',') {
          e.preventDefault()
          setView('settings')
          return
        }

        const keyNum = parseInt(e.key)
        if (!isNaN(keyNum) && keyNum >= 1 && keyNum <= 8) {
          const views: ActiveView[] = [
            'log',
            'kanban',
            'backlog',
            'focus',
            'notes',
            'clipboard',
            'cookbook',
            'analytics'
          ]
          e.preventDefault()
          setView(views[keyNum - 1])
        }
      }
    }

    window.addEventListener('keydown', handleGlobalKeyDown)

    return () => {
      unsubTheme()
      unsubNavigate()
      window.removeEventListener('keydown', handleGlobalKeyDown)
    }
  }, [loadContexts, setView, toggleRightPanel])

  // Safeguard: redirect if the view we are on gets disabled in settings.
  const checkEnabledViews = useCallback(async () => {
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
      <FocusTimerEngine />
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
            <Suspense fallback={<ViewSkeleton />}>
              {renderView()}
            </Suspense>
          </main>
          <RightPanel />
        </div>
      </div>
      <Lightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />
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
  return <App />
}