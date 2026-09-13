import React, { useState, useRef, useEffect, lazy, Suspense, useCallback } from 'react'
import { useAppStore, type ActiveView } from './store/appStore'
import { useAiEnabled } from './lib/useAiEnabled'
import { Sidebar } from './components/Sidebar'
import { ToastProvider } from './components/ui/Toast'
import ErrorBoundary from './components/ui/ErrorBoundary'
import { ConfirmProvider } from './components/ui/ConfirmDialog'
import FocusTimerEngine from './components/focus/FocusTimerEngine'
import { applyFontSize } from './lib/fontScale'
import { applyStoredTheme, watchTheme } from './lib/themeBoot'
import Lightbox from './components/ui/Lightbox'
import UpdateIndicator from './components/ui/UpdateIndicator'
import { readViewFeatures, firstEnabledView, resolveStartView } from './lib/features'
import {
  getBoolSetting,
  getEnumSetting,
  getNumberSetting,
  getStringSetting,
  setBoolSetting,
  setNumberSetting,
  setStringSetting
} from './lib/settings'
import { createWorkspace, slugifyWorkspace, type WorkspaceEntry } from './lib/createWorkspace'

const ONBOARDING_SEEN_KEY = 'onboarding_seen'
/** same palette as the workspace manager */
const ONBOARDING_COLORS = ['#1e45fc', '#cdf12b', '#10b981', '#f97316', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899']
import {
  APP_SHORTCUTS,
  loadBindings,
  defaultBindings,
  comboFromEvent,
  isTypingTarget,
  type ShortcutBindings
} from './lib/shortcuts'
import { readWorkspaceList, writeWorkspaceList } from './lib/workspaceList'
import { getContexts } from './data/workspaces'
import * as appApi from './data/app'
import * as customizerApi from './data/customizer'
import * as mcpApi from './data/mcp'
import { onThemeUpdate } from './data/theme'

const CommandPalette = lazy(() => import('./components/CommandPalette'))
const OnboardingTour = lazy(() => import('./components/OnboardingTour'))
const TrayPanel      = lazy(() => import('./components/TrayPanel'))
const LogView      = lazy(() => import('./components/LogView'))
const KanbanView   = lazy(() => import('./components/KanbanView'))
const BacklogView  = lazy(() => import('./components/BacklogView'))
const CookbookView = lazy(() => import('./components/CookbookView'))
const WallView      = lazy(() => import('./components/wall/WallView'))
const SettingsView = lazy(() => import('./components/SettingsView'))
const WidgetView    = lazy(() => import('./components/WidgetView'))
const FocusView     = lazy(() => import('./components/FocusView'))
const NotesView     = lazy(() => import('./components/NotesView'))
const ClipboardView = lazy(() => import('./components/ClipboardView'))
const AnalyticsView = lazy(() => import('./components/AnalyticsView'))
const HudView       = lazy(() => import('./components/HudView'))
const CheatsheetsView = lazy(() => import('./components/CheatsheetsView'))
const GameDevView = lazy(() => import('./components/GameDevView'))

// lazy: eager imports pulled ~7,000 lines into every startup, panel open or not
const AiStreamPanel   = lazy(() => import('./components/AiStreamPanel'))
const GitPanel        = lazy(() => import('./components/GitPanel'))
const ItemDetailPanel = lazy(() => import('./components/ItemDetailPanel'))

function ViewSkeleton() {
  return (
    <div style={{ padding: 'var(--space-6)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <div className="skeleton" style={{ height: '24px', width: '180px' }} />
      <div className="skeleton" style={{ height: '14px', width: '320px', opacity: 0.6 }} />
      <div className="col-mt">
        {[1,2,3,4,5].map(i => (
          <div key={i} className="skeleton" style={{ height: '52px', borderRadius: 'var(--radius-md)', opacity: 1 - i * 0.1 }} />
        ))}
      </div>
    </div>
  )
}

function ThemeToggle() {
  const [theme, setTheme] = React.useState<'dark' | 'light'>(() => {
    return (document.documentElement.getAttribute('data-theme') as 'dark' | 'light') || 'dark'
  })

  // follow external theme changes so the icon never goes stale
  React.useEffect(() => {
    const observer = new MutationObserver(() => {
      const current = (document.documentElement.getAttribute('data-theme') as 'dark' | 'light') || 'dark'
      setTheme(current)
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])

  const toggleTheme = () => {
    // read the live attribute, not state, so a double toggle can't desync
    const current = (document.documentElement.getAttribute('data-theme') as 'dark' | 'light') || 'dark'
    const nextTheme = current === 'dark' ? 'light' : 'dark'
    setTheme(nextTheme)
    document.documentElement.setAttribute('data-theme', nextTheme)
    // same key as the Settings page
    setStringSetting('app_theme', nextTheme).catch(console.error)
  }

  return (
    <button
      onClick={toggleTheme}
      aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
      className="bg-clear hover-bg-offset"
      style={{
        width: '28px',
        height: '22px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        border: 'none',
        cursor: 'pointer',
        color: 'var(--color-text-muted)',
        borderRadius: 'var(--radius-sm)',
        transition: 'background var(--duration-fast) var(--ease-default), color var(--duration-fast) var(--ease-default)',
        WebkitAppRegion: 'no-drag' as React.CSSProperties['WebkitAppRegion']
      }}
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

function Titlebar() {
  const setView = useAppStore(s => s.setView)
  const setSettingsTab = useAppStore(s => s.setSettingsTab)
  const platform = appApi.platform()
  const isWindows = platform === 'win32'
  const isMac = platform === 'darwin'

  return (
    <div
      className="titlebar"
      style={{
        paddingLeft: isMac ? '76px' : undefined,
        paddingRight: isWindows ? '144px' : undefined
      }}
    >
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
        <UpdateIndicator
          onOpen={() => {
            setView('settings')
            setSettingsTab('about')
          }}
        />
        <ThemeToggle />
        {platform === 'linux' && (
          <div className="titlebar-controls" style={{ display: 'flex', gap: 'var(--space-0-5)' }}>
            <TitlebarButton onClick={() => appApi.minimize()} label="Minimize">
              <svg width="10" height="1" viewBox="0 0 10 1"><line x1="0" y1="0.5" x2="10" y2="0.5" stroke="currentColor" strokeWidth="1.5"/></svg>
            </TitlebarButton>
            <TitlebarButton onClick={() => appApi.maximize()} label="Maximize">
              <svg width="10" height="10" viewBox="0 0 10 10"><rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1.2"/></svg>
            </TitlebarButton>
            <TitlebarButton onClick={() => appApi.close()} label="Close" isClose>
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

const MIN_PANEL_WIDTH = 280
const MAX_PANEL_WIDTH = 800
const DEFAULT_PANEL_WIDTH = 380
// sidebar rail plus a usable strip of content; narrower and the panel covers the view
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
      // roving tabindex: one tab stop, arrows move within
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
  const aiEnabled = useAiEnabled()
  const rightPanelOpen = useAppStore(s => s.rightPanelOpen)
  const rightPanelContent = useAppStore(s => s.rightPanelContent)
  const setRightPanelContent = useAppStore(s => s.setRightPanelContent)
  const selectedItemId = useAppStore(s => s.selectedItemId)

  const [panelWidth, setPanelWidth] = useState(DEFAULT_PANEL_WIDTH)

  // peer connections are built synchronously and can't await a setting, so the transport caches it
  useEffect(() => {
    void import('./lib/webrtcTransport').then(({ refreshTurnServer }) => refreshTurnServer())
  }, [])

  /** stray drops would navigate the window away; real drop zones handle theirs first */
  useEffect(() => {
    const swallow = (e: DragEvent): void => e.preventDefault()
    window.addEventListener('dragover', swallow)
    window.addEventListener('drop', swallow)
    return () => {
      window.removeEventListener('dragover', swallow)
      window.removeEventListener('drop', swallow)
    }
  }, [])

  useEffect(() => {
    getNumberSetting('right_panel_width', DEFAULT_PANEL_WIDTH)
      .then(w => setPanelWidth(clampPanelWidth(w)))
      .catch(err => console.error('Failed to read right panel width:', err))
  }, [])
  // state not a ref: the width transition must switch off mid-drag or the panel lags a frame
  const [isResizing, setIsResizing] = useState(false)

  const panelTabs: { id: PanelTabId; label: string }[] = [
    ...(aiEnabled ? [{ id: 'ai-chat' as PanelTabId, label: 'AI Assistant' }] : []),
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
      // persisted on release, keeps the drag off IPC
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

  // shrinking the window mustn't leave the panel wider than the viewport
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
      {/* resizer handle */}
      {rightPanelOpen && (
        <div
          onMouseDown={handleMouseDown}
          className="right-panel-resizer"
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
                {rightPanelContent === 'ai-chat' && aiEnabled && <AiStreamPanel />}
                {rightPanelContent === 'ai-chat' && !aiEnabled && (
                  <p style={{ padding: 'var(--space-4)', fontSize: 'var(--text-xs)', color: 'var(--color-text-faint)' }}>
                    The assistant is switched off in Settings, Features.
                  </p>
                )}
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

// top-level shells so App()'s hooks are never conditional
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
/** satellite windows never run App's startup effect, so they'd ignore the user's theme */
function useSatelliteTheme(): void {
  useEffect(() => {
    applyStoredTheme()
    return watchTheme()
  }, [])
}

// no transparent wrapper: the panel draws its own surface, a flex parent would letterbox it
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

export default function App() {
  const activeView = useAppStore(s => s.activeView)
  const setView = useAppStore(s => s.setView)
  const setAvailableWorkspaces = useAppStore(s => s.setAvailableWorkspaces)
  const setWorkspaceList = useAppStore(s => s.setWorkspaceList)
  const setWorkspace = useAppStore(s => s.setWorkspace)
  const toggleRightPanel = useAppStore(s => s.toggleRightPanel)
  // the shortcut handler binds once, so it reads the flag through a ref
  const appAiEnabled = useAiEnabled()
  const aiEnabledRef = useRef(appAiEnabled)
  aiEnabledRef.current = appAiEnabled
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [showOnboarding, setShowOnboarding] = useState(false)

  // shown once; read, not pushed, so a slow first paint can't race it
  useEffect(() => {
    let cancelled = false
    getBoolSetting(ONBOARDING_SEEN_KEY, false)
      .then(seen => { if (!cancelled && !seen) setShowOnboarding(true) })
      .catch(() => {})

    // replays come through the shared cross-view event
    const replay = (): void => setShowOnboarding(true)
    window.addEventListener('replay-onboarding', replay)
    return () => { cancelled = true; window.removeEventListener('replay-onboarding', replay) }
  }, [])

  /** Done/Skip are remembered, Escape isn't: one stray press used to retire the tour for good */
  const closeOnboarding = useCallback((remember: boolean) => {
    setShowOnboarding(false)
    if (remember) setBoolSetting(ONBOARDING_SEEN_KEY, true).catch(() => {})
  }, [])

  /** shares createWorkspace with Settings, so both make identical workspaces */
  const createOnboardingWorkspace = useCallback(async (name: string, templateId: string) => {
    const slug = slugifyWorkspace(name)
    if (!slug) throw new Error('That name has no letters or numbers in it.')

    const existing = await readWorkspaceList()
    if (existing.some(c => c.slug === slug)) {
      throw new Error(`A workspace called "${slug}" already exists.`)
    }

    const entry: WorkspaceEntry = {
      slug,
      name: name.trim(),
      color: ONBOARDING_COLORS[existing.length % ONBOARDING_COLORS.length]
    }
    const { list } = await createWorkspace(existing, entry, templateId)

    setWorkspaceList(list)
    setAvailableWorkspaces(list.map(c => c.slug))
    setWorkspace(slug)
  }, [setWorkspaceList, setAvailableWorkspaces, setWorkspace])

  // renderer-bound, a global shortcut would steal Ctrl+K from other apps
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        // not during the tour: it opened over the tour and one Escape closed both for good
        if (showOnboarding) return
        setPaletteOpen(open => !open)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [showOnboarding])

  // capture phase and swallows the click, so skip images standing in for a card, button or link
  useEffect(() => {
    const handleImageClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (target.tagName !== 'IMG') return

      const img = target as HTMLImageElement
      // chrome and logos are decoration
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

  // an explicit default context wins over the last active one; it used to be saved but never read
  const loadContexts = useCallback(async () => {
    try {
      const contexts = await getContexts()
      if (contexts.length > 0) {
        setAvailableWorkspaces(contexts)

        let list: WorkspaceEntry[] = await readWorkspaceList()
        if (list.length === 0) {
          list = contexts.map((slug, i) => ({
            slug,
            name: slug.charAt(0).toUpperCase() + slug.slice(1),
            color: ['#1e45fc', '#cdf12b', '#10b981', '#f97316', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899'][i % 8]
          }))
          writeWorkspaceList(list).catch(() => {})
        }
        setWorkspaceList(list)

        const defaultContext = await getStringSetting('default_context', '')
        const savedContext = await getStringSetting('active_context', '')
        const startContext =
          defaultContext && contexts.includes(defaultContext) ? defaultContext
          : savedContext && contexts.includes(savedContext) ? savedContext
          : contexts[0] // fall back to the first context
        if (startContext) {
          setWorkspace(startContext)
        }
      }
    } catch {
      // db not ready yet, keep defaults
    }
  }, [setAvailableWorkspaces, setWorkspaceList, setWorkspace])

  // apply the start view before the redirect guard, or checkEnabledViews bounces it
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

    getBoolSetting('appearance_compact', false).then((compact) => {
      if (compact) document.documentElement.setAttribute('data-compact', 'true')
    }).catch(console.error)

    // saved by Settings but never read on boot, so every launch reset to dark
    getStringSetting('app_theme', '').then((t) => {
      if (!t) return
      if (t === 'system') {
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
        document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light')
      } else if (t === 'dark' || t === 'light') {
        document.documentElement.setAttribute('data-theme', t)
      }
    }).catch(console.error)

    // used to apply only once the Appearance tab opened
    getEnumSetting('appearance_font_size', ['small', 'medium', 'large'] as const, 'medium')
      .then(applyFontSize)
      .catch(console.error)

    // the engine's startup broadcast lands before mount; subscribe for edits, fetch below for this launch
    const applyThemeCss = (css: string): void => {
      let el = document.getElementById('user-theme') as HTMLStyleElement | null
      if (!el) {
        el = document.createElement('style')
        el.id = 'user-theme'
        document.head.appendChild(el)
      }
      el.textContent = css

      const fontMatch = css.match(/--font-sans\s*:\s*([^;}\n]+)/)
      if (fontMatch) {
        const fontValue = fontMatch[1].trim()
        applyGoogleFont(fontValue)
      } else {
        const elFont = document.getElementById('custom-google-font')
        if (elFont) elFont.remove()
      }
    }

    const unsubTheme = onThemeUpdate(applyThemeCss)
    // fetch what applies now, independent of any broadcast
    customizerApi.getCss()
      .then(css => { if (css) applyThemeCss(css) })
      .catch(console.error)

    const unsubNavigate = appApi.onNavigateToView((view: string) => {
      setView(view as ActiveView)
    })

    // MCP writes skip the IPC views refresh on; re-dispatch the DOM events they already listen for
    const unsubMcp = mcpApi.onDataChanged(() => {
      window.dispatchEvent(new CustomEvent('kanban-refresh'))
      window.dispatchEvent(new CustomEvent('item-updated'))
      window.dispatchEvent(new CustomEvent('wall-refresh'))
    })

    // matched against the user's bindings
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
          if (aiEnabledRef.current) toggleRightPanel('ai-chat')
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

  // leave a view that just got disabled in settings
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
      case 'wall':      return <WallView />
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
        {/* outermost net: a throw in the titlebar or sidebar would otherwise white out the window */}
        <ErrorBoundary label="Checkpoint">
        <Suspense fallback={null}>
          <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
          {showOnboarding && (
            <OnboardingTour
              onCreateWorkspace={createOnboardingWorkspace}
              onClose={closeOnboarding}
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

// picks a standalone shell or the full app
export function AppRouter() {
  const hash = window.location.hash
  if (hash === '#widget') return <WidgetShell />
  if (hash === '#hud')    return <HudShell />
  if (hash === '#tray')   return <TrayShell />
  return <App />
}