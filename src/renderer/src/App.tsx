import React, { useEffect, lazy, Suspense, useCallback } from 'react'
import { useAppStore } from './store/appStore'
import { Sidebar } from './components/Sidebar'
import AiStreamPanel from './components/AiStreamPanel'

// Lazy-loaded views (code split per view)
const LogView      = lazy(() => import('./components/LogView'))
const KanbanView   = lazy(() => import('./components/KanbanView'))
const BacklogView  = lazy(() => import('./components/BacklogView'))
const CookbookView = lazy(() => import('./components/CookbookView'))
const SettingsView = lazy(() => import('./components/SettingsView'))
const WidgetView   = lazy(() => import('./components/WidgetView'))

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

  const toggleTheme = () => {
    const nextTheme = theme === 'dark' ? 'light' : 'dark'
    setTheme(nextTheme)
    document.documentElement.setAttribute('data-theme', nextTheme)
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
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', userSelect: 'none' }}>
        {/* Brand mark */}
        <div style={{
          width: '18px',
          height: '18px',
          borderRadius: '4px',
          background: 'var(--color-primary)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0
        }}>
          <div style={{ width: '8px', height: '8px', borderRadius: '2px', background: 'var(--color-secondary)' }} />
        </div>
        <span style={{
          fontSize: 'var(--text-xs)',
          fontWeight: 'var(--weight-semibold)',
          color: 'var(--color-text-muted)',
          letterSpacing: 'var(--tracking-widest)',
          textTransform: 'uppercase'
        }}>
          Checkpoint
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', WebkitAppRegion: 'no-drag' as React.CSSProperties['WebkitAppRegion'] }}>
        <ThemeToggle />
        {window.electronAPI.app.platform !== 'darwin' && (
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
  const toggleRightPanel = useAppStore(s => s.toggleRightPanel)

  return (
    <div
      style={{
        width: rightPanelOpen ? '320px' : '0',
        overflow: 'hidden',
        transition: 'width var(--duration-slow) cubic-bezier(0.32, 0.72, 0, 1)',
        borderLeft: rightPanelOpen ? '1px solid var(--color-surface-offset)' : 'none',
        background: 'var(--color-surface-1)',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0
      }}
      aria-hidden={!rightPanelOpen}
    >
      {rightPanelOpen && (
        <div style={{ width: '320px', height: '100%', display: 'flex', flexDirection: 'column' }}>
          <div style={{
            height: '44px',
            borderBottom: '1px solid var(--color-surface-offset)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 var(--space-4)',
            flexShrink: 0
          }}>
            <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text-muted)' }}>
              {rightPanelContent === 'ai-chat' ? 'AI Assistant' : 'Item Detail'}
            </span>
            <button
              className="btn-icon"
              onClick={() => toggleRightPanel()}
              aria-label="Close panel"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
          {rightPanelContent === 'ai-chat' ? (
            <AiStreamPanel />
          ) : (
            <div style={{ flex: 1, padding: 'var(--space-4)', overflow: 'auto', color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
              <p>Item detail panel, coming in Phase 4.</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/* eslint-disable @typescript-eslint/no-explicit-any */
// SQLite Database Debug Panel (Dev Only)
function DebugDbPanel() {
  const [createdId, setCreatedId] = React.useState<string | null>(null)
  const [log, setLog] = React.useState<string>('')

  const handleCreate = async () => {
    try {
      const item = await window.electronAPI.db.createItem({
        type: 'card',
        context: 'default',
        title: 'Verify Phase 2',
        body: 'A temporary card to test database operations.',
        status: 'open',
        priority: 1,
        position: 100.0,
        due_at: null,
        metadata: '{}'
      }) as any
      setCreatedId(item.id)
      setLog(`[CREATE SUCCESS] Created item ID: ${item.id}\n${JSON.stringify(item, null, 2)}`)
    } catch (err: any) {
      setLog(`[CREATE ERROR] ${err.message}`)
    }
  }

  const handleRead = async () => {
    try {
      const result = await window.electronAPI.db.getItems('default', 'card', 0, 10) as any
      setLog(`[READ SUCCESS] Total items: ${result.total}\n${JSON.stringify(result, null, 2)}`)
    } catch (err: any) {
      setLog(`[READ ERROR] ${err.message}`)
    }
  }

  const handleUpdate = async () => {
    if (!createdId) {
      setLog('[UPDATE ERROR] Click CREATE first to generate a card!')
      return
    }
    try {
      const item = await window.electronAPI.db.updateItem(createdId, {
        status: 'done',
        title: 'Verify Phase 2 (Updated)'
      }) as any
      setLog(`[UPDATE SUCCESS] Updated item:\n${JSON.stringify(item, null, 2)}`)
    } catch (err: any) {
      setLog(`[UPDATE ERROR] ${err.message}`)
    }
  }

  const handleDelete = async () => {
    if (!createdId) {
      setLog('[DELETE ERROR] Click CREATE first to generate a card!')
      return
    }
    try {
      await window.electronAPI.db.deleteItem(createdId)
      setCreatedId(null)
      setLog('[DELETE SUCCESS] Deleted item ID: ' + createdId)
    } catch (err: any) {
      setLog(`[DELETE ERROR] ${err.message}`)
    }
  }

  const handleSearch = async () => {
    try {
      const result = await window.electronAPI.db.searchItems({ query: 'Verify', page: 0, pageSize: 10 }) as any
      setLog(`[SEARCH SUCCESS] Found:\n${JSON.stringify(result, null, 2)}`)
    } catch (err: any) {
      setLog(`[SEARCH ERROR] ${err.message}`)
    }
  }

  const handleErrorTest = async () => {
    try {
      await window.electronAPI.db.createItem({
        type: 'invalid-type-to-trigger-zod',
        context: '',
        title: 123
      } as any)
      setLog('[ERROR TEST] FAILED: Malformed payload was unexpectedly accepted!')
    } catch (err: any) {
      setLog(`[ERROR TEST SUCCESS] Zod rejected malformed payload:\n${err.message}`)
    }
  }

  return (
    <div style={{
      margin: 'var(--space-6)',
      padding: 'var(--space-4)',
      background: 'var(--color-surface-2)',
      border: '1px dashed var(--color-balance)',
      borderRadius: 'var(--radius-lg)',
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--space-3)',
      color: 'var(--color-text-base)'
    }}>
      <h3 style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-bold)', color: 'var(--color-secondary)', margin: 0 }}>
        SQLite Database Debug Panel (Dev Only)
      </h3>
      <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        <button className="btn-ghost" style={{ border: '1px solid var(--color-balance)' }} onClick={handleCreate}>CREATE</button>
        <button className="btn-ghost" style={{ border: '1px solid var(--color-balance)' }} onClick={handleRead}>READ</button>
        <button className="btn-ghost" style={{ border: '1px solid var(--color-balance)' }} onClick={handleUpdate}>UPDATE</button>
        <button className="btn-ghost" style={{ border: '1px solid var(--color-balance)' }} onClick={handleDelete}>DELETE</button>
        <button className="btn-ghost" style={{ border: '1px solid var(--color-balance)' }} onClick={handleSearch}>SEARCH</button>
        <button className="btn-ghost" style={{ border: '1px solid var(--color-balance)', color: 'var(--color-error)' }} onClick={handleErrorTest}>TEST ERROR</button>
      </div>
      <pre style={{
        margin: 0,
        padding: 'var(--space-2)',
        background: 'var(--color-background)',
        borderRadius: 'var(--radius-md)',
        fontSize: 'var(--text-xs)',
        fontFamily: 'var(--font-mono)',
        color: 'var(--color-text-base)',
        maxHeight: '180px',
        overflow: 'auto',
        whiteSpace: 'pre-wrap'
      }}>
        {log || 'Click any button above to test SQLite CRUD operations.'}
      </pre>
    </div>
  )
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// App
export default function App() {
  // Phase 9: Widget window uses the #widget hash route, render it standalone
  if (window.location.hash === '#widget') {
    return (
      <div style={{ background: 'transparent', width: '100vw', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Suspense fallback={null}>
          <WidgetView />
        </Suspense>
      </div>
    )
  }

  const activeView = useAppStore(s => s.activeView)
  const setAvailableContexts = useAppStore(s => s.setAvailableContexts)

  // Bootstrap: load available contexts from DB on mount
  const loadContexts = useCallback(async () => {
    try {
      const contexts = await window.electronAPI.db.getContexts()
      if (contexts.length > 0) setAvailableContexts(contexts)
    } catch {
      // DB not yet initialized, use defaults
    }
  }, [setAvailableContexts])

  useEffect(() => {
    loadContexts()

    // Hot-reload user theme CSS
    const unsubTheme = window.electronAPI.onThemeUpdate((css: string) => {
      let el = document.getElementById('user-theme') as HTMLStyleElement | null
      if (!el) {
        el = document.createElement('style')
        el.id = 'user-theme'
        document.head.appendChild(el)
      }
      el.textContent = css
    })
    return unsubTheme
  }, [loadContexts])

  function renderView() {
    switch (activeView) {
      case 'log':      return <LogView />
      case 'kanban':   return <KanbanView />
      case 'backlog':  return <BacklogView />
      case 'cookbook': return <CookbookView />
      case 'settings': return <SettingsView />
      default:         return null
    }
  }

  return (
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
          {import.meta.env.DEV && <DebugDbPanel />}
        </main>
        <RightPanel />
      </div>
    </div>
  )
}
