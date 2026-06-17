import React, { useState, useEffect } from 'react'
import {
  Settings,
  Layers,
  Sparkles,
  Palette,
  Monitor,
  Zap,
  Info,
  CheckCircle,
  AlertCircle,
  RefreshCw,
  Layout
} from 'lucide-react'
import SettingsSection, {
  FieldRow,
  SettingsInput,
  ToggleSwitch,
  Divider,
  RowBetween
} from './settings/SettingsSection'
import ContextManager from './settings/ContextManager'
import AppearanceSettings from './settings/AppearanceSettings'
import FeatureToggleCenter from './settings/FeatureToggleCenter'
import AboutPanel from './settings/AboutPanel'
import { useAppStore } from '../store/appStore'

// Tab definition
type SettingsTab =
  | 'general'
  | 'contexts'
  | 'kanban'
  | 'ai'
  | 'appearance'
  | 'widget'
  | 'features'
  | 'about'

const TABS: { id: SettingsTab; label: string; icon: React.ReactNode }[] = [
  { id: 'general',    label: 'General',          icon: <Settings size={14} /> },
  { id: 'contexts',   label: 'Contexts',          icon: <Layers size={14} /> },
  { id: 'kanban',     label: 'Kanban',            icon: <Layout size={14} /> },
  { id: 'ai',         label: 'AI',                icon: <Sparkles size={14} /> },
  { id: 'appearance', label: 'Appearance',        icon: <Palette size={14} /> },
  { id: 'widget',     label: 'Widget',            icon: <Monitor size={14} /> },
  { id: 'features',   label: 'Feature Toggles',  icon: <Zap size={14} /> },
  { id: 'about',      label: 'About',             icon: <Info size={14} /> }
]

// Kanban per-context column config
interface ColumnConfig {
  id: string
  name: string
  wipLimit: number | null
}

function KanbanSettings({ activeContext }: { activeContext: string }) {
  const [columns, setColumns] = useState<ColumnConfig[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      try {
        const key = `kanban_columns_${activeContext}`
        const val = await window.electronAPI.db.getSetting(key)
        if (val) {
          setColumns(JSON.parse(val as string))
        } else {
          const defaults: ColumnConfig[] = [
            { id: 'open',        name: 'Backlog',     wipLimit: null },
            { id: 'in_progress', name: 'In Progress', wipLimit: null },
            { id: 'in_review',   name: 'In Review',   wipLimit: null },
            { id: 'done',        name: 'Done',         wipLimit: null }
          ]
          setColumns(defaults)
        }
      } catch (err) { console.error(err) }
      setLoading(false)
    }
    load()
  }, [activeContext])

  const save = async (updated: ColumnConfig[]) => {
    const key = `kanban_columns_${activeContext}`
    await window.electronAPI.db.setSetting(key, JSON.stringify(updated))
    setColumns(updated)
  }

  const updateCol = (id: string, patch: Partial<ColumnConfig>) =>
    save(columns.map(c => c.id === id ? { ...c, ...patch } : c))

  if (loading) return <div style={{ color: 'var(--color-text-faint)', fontSize: 'var(--text-sm)' }}>Loading…</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-faint)', margin: 0 }}>
        Configure columns for context <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-secondary)' }}>#{activeContext}</code>.
        Double-click column headers in the Kanban board to rename inline.
      </p>
      {columns.map(col => (
        <div
          key={col.id}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-3)',
            padding: 'var(--space-3)',
            background: 'var(--color-surface-2)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--color-surface-offset)'
          }}
        >
          <input
            value={col.name}
            onChange={e => updateCol(col.id, { name: e.target.value })}
            style={{
              flex: 1,
              background: 'var(--color-surface-1)',
              border: '1px solid var(--color-surface-offset)',
              color: 'var(--color-text-base)',
              borderRadius: '4px',
              padding: '4px 8px',
              fontSize: 'var(--text-sm)',
              outline: 'none'
            }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexShrink: 0 }}>
            <label style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
              WIP Limit
            </label>
            <input
              type="number"
              min={0}
              value={col.wipLimit ?? 0}
              onChange={e => {
                const n = parseInt(e.target.value) || 0
                updateCol(col.id, { wipLimit: n === 0 ? null : n })
              }}
              placeholder="∞"
              style={{
                width: '60px',
                background: 'var(--color-surface-1)',
                border: '1px solid var(--color-surface-offset)',
                color: 'var(--color-text-base)',
                borderRadius: '4px',
                padding: '4px 8px',
                fontSize: 'var(--text-sm)',
                outline: 'none',
                textAlign: 'center'
              }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

// Widget Settings
function WidgetSettings() {
  const isWindows = window.electronAPI.app.platform === 'win32'
  const [enabled, setEnabled] = useState(false)
  const [position, setPosition] = useState<'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'>('bottom-right')
  const [opacity, setOpacity] = useState(0.9)

  useEffect(() => {
    const load = async () => {
      const e = await window.electronAPI.db.getSetting('widget_enabled')
      const p = await window.electronAPI.db.getSetting('widget_position')
      const o = await window.electronAPI.db.getSetting('widget_opacity')
      if (e) setEnabled(e === 'true')
      if (p) setPosition(p as typeof position)
      if (o) setOpacity(Number(o))
    }
    load()
  }, [])

  if (!isWindows) {
    return (
      <div style={{
        padding: 'var(--space-4)',
        background: 'var(--color-surface-2)',
        borderRadius: 'var(--radius-md)',
        color: 'var(--color-text-faint)',
        fontSize: 'var(--text-sm)'
      }}>
        The desktop widget is only available on Windows.
      </div>
    )
  }

  const handleToggle = async (v: boolean) => {
    setEnabled(v)
    await window.electronAPI.db.setSetting('widget_enabled', String(v))
    await window.electronAPI.widget.toggle()
  }

  const handlePosition = async (p: typeof position) => {
    setPosition(p)
    await window.electronAPI.db.setSetting('widget_position', p)
    await window.electronAPI.widget.setPosition(p)
  }

  const handleOpacity = async (o: number) => {
    setOpacity(o)
    await window.electronAPI.db.setSetting('widget_opacity', String(o))
    await window.electronAPI.widget.setOpacity(o)
  }

  const POSITIONS: { value: typeof position; label: string }[] = [
    { value: 'top-left',     label: '↖ Top Left'      },
    { value: 'top-right',    label: '↗ Top Right'     },
    { value: 'bottom-left',  label: '↙ Bottom Left'   },
    { value: 'bottom-right', label: '↘ Bottom Right'  }
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      <RowBetween>
        <div>
          <div style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)', color: 'var(--color-text-base)' }}>
            Show Desktop Widget
          </div>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-faint)', marginTop: '2px' }}>
            Transparent always-on-top overlay, never steals focus from your IDE.
          </div>
        </div>
        <ToggleSwitch checked={enabled} onChange={handleToggle} />
      </RowBetween>

      {enabled && (
        <>
          <Divider />
          <FieldRow label="Position">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
              {POSITIONS.map(p => (
                <button
                  key={p.value}
                  onClick={() => handlePosition(p.value)}
                  style={{
                    padding: 'var(--space-2) var(--space-3)',
                    background: position === p.value ? 'var(--color-secondary-muted)' : 'var(--color-surface-2)',
                    border: `1px solid ${position === p.value ? 'var(--color-secondary)' : 'var(--color-surface-offset)'}`,
                    color: position === p.value ? 'var(--color-secondary)' : 'var(--color-text-muted)',
                    borderRadius: 'var(--radius-md)',
                    cursor: 'pointer',
                    fontSize: 'var(--text-xs)',
                    transition: 'all 100ms ease'
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </FieldRow>

          <FieldRow label={`Opacity, ${Math.round(opacity * 100)}%`}>
            <input
              type="range"
              min={0.3}
              max={1.0}
              step={0.05}
              value={opacity}
              onChange={e => handleOpacity(parseFloat(e.target.value))}
              style={{ accentColor: 'var(--color-secondary)', cursor: 'pointer', width: '100%' }}
            />
          </FieldRow>
        </>
      )}
    </div>
  )
}

// AI Settings
function AiSettings() {
  const [baseURL, setBaseURL] = useState('http://localhost:11434/v1')
  const [apiKey, setApiKey] = useState('ollama')
  const [model, setModel] = useState('llama3')
  const [temperature, setTemperature] = useState(0.7)
  const [maxTokens, setMaxTokens] = useState(2048)
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle')
  const [connectionError, setConnectionError] = useState('')

  useEffect(() => {
    const load = async () => {
      try {
        const dbBaseUrl  = await window.electronAPI.db.getSetting('ai_base_url')
        const dbApiKey   = await window.electronAPI.db.getSetting('ai_api_key')
        const dbModel    = await window.electronAPI.db.getSetting('ai_model')
        const dbTemp     = await window.electronAPI.db.getSetting('ai_temperature')
        const dbMaxToks  = await window.electronAPI.db.getSetting('ai_max_tokens')
        if (dbBaseUrl)  setBaseURL(dbBaseUrl as string)
        if (dbApiKey)   setApiKey(dbApiKey as string)
        if (dbModel)    setModel(dbModel as string)
        if (dbTemp)     setTemperature(Number(dbTemp))
        if (dbMaxToks)  setMaxTokens(Number(dbMaxToks))
      } catch (err) { console.error('Failed to load AI settings:', err) }
    }
    load()
  }, [])

  const save = (key: string, val: string | number) =>
    window.electronAPI.db.setSetting(key, val)

  const handleTest = async () => {
    setConnectionStatus('testing'); setConnectionError('')
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      const trimmedKey = apiKey.trim()
      if (trimmedKey && trimmedKey !== 'ollama') headers['Authorization'] = `Bearer ${trimmedKey}`
      const res = await fetch(`${baseURL.replace(/\/+$/, '')}/models`, { method: 'GET', headers })
      if (res.ok) { setConnectionStatus('success') }
      else {
        const text = await res.text().catch(() => '')
        setConnectionStatus('error')
        setConnectionError(`HTTP ${res.status}: ${text || res.statusText}`)
      }
    } catch (err) {
      setConnectionStatus('error')
      setConnectionError((err as Error).message || 'Network request failed')
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <FieldRow label="Base URL">
        <SettingsInput
          value={baseURL}
          onChange={setBaseURL}
          onBlur={() => save('ai_base_url', baseURL.trim())}
          placeholder="e.g. http://localhost:11434/v1"
        />
      </FieldRow>
      <FieldRow label="API Key">
        <SettingsInput
          type="password"
          value={apiKey}
          onChange={setApiKey}
          onBlur={() => save('ai_api_key', apiKey.trim())}
          placeholder="ollama or cloud API key"
        />
      </FieldRow>
      <FieldRow label="Default Model">
        <SettingsInput
          value={model}
          onChange={setModel}
          onBlur={() => save('ai_model', model.trim())}
          placeholder="e.g. llama3"
        />
      </FieldRow>

      <FieldRow label={`Temperature, ${temperature.toFixed(1)}`}>
        <input
          type="range" min={0} max={1} step={0.1} value={temperature}
          onChange={e => { setTemperature(parseFloat(e.target.value)); save('ai_temperature', parseFloat(e.target.value)) }}
          style={{ accentColor: 'var(--color-secondary)', cursor: 'pointer', width: '100%' }}
        />
      </FieldRow>

      <FieldRow label="Max Tokens">
        <SettingsInput
          type="number"
          value={maxTokens}
          onChange={v => { const n = parseInt(v) || 0; setMaxTokens(n); save('ai_max_tokens', n) }}
        />
      </FieldRow>

      <Divider />

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
        <button
          onClick={handleTest}
          disabled={connectionStatus === 'testing'}
          style={{
            background: 'var(--color-surface-offset)',
            border: '1px solid var(--color-surface-offset)',
            color: 'var(--color-text-base)',
            borderRadius: 'var(--radius-md)',
            padding: 'var(--space-2) var(--space-4)',
            fontSize: 'var(--text-xs)',
            fontWeight: 'var(--weight-semibold)',
            cursor: connectionStatus === 'testing' ? 'default' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px'
          }}
        >
          {connectionStatus === 'testing' && (
            <RefreshCw size={12} style={{ animation: 'spin 1s linear infinite' }} />
          )}
          Test Connection
        </button>

        {connectionStatus === 'success' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#10b981', fontSize: 'var(--text-xs)' }}>
            <CheckCircle size={14} />
            Connection Successful
          </div>
        )}
        {connectionStatus === 'error' && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '2px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--color-error)', fontSize: 'var(--text-xs)' }}>
              <AlertCircle size={14} />
              Connection Failed
            </div>
            {connectionError && (
              <span style={{ fontSize: '10px', color: 'var(--color-text-faint)' }}>{connectionError}</span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// General Settings
function GeneralSettings() {
  const activeContext = useAppStore(s => s.activeContext)
  const availableContexts = useAppStore(s => s.availableContexts)
  const setContext = useAppStore(s => s.setContext)

  const [theme, setTheme] = useState<'dark' | 'light' | 'system'>('dark')

  useEffect(() => {
    const load = async () => {
      const t = await window.electronAPI.db.getSetting('app_theme')
      if (t) setTheme(t as typeof theme)
    }
    load()
  }, [])

  const applyTheme = (t: typeof theme) => {
    if (t === 'system') {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
      document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light')
    } else {
      document.documentElement.setAttribute('data-theme', t)
    }
  }

  const handleTheme = async (t: typeof theme) => {
    setTheme(t)
    applyTheme(t)
    await window.electronAPI.db.setSetting('app_theme', t)
  }

  const THEME_OPTIONS: { value: typeof theme; label: string; desc: string }[] = [
    { value: 'dark',   label: '🌙 Dark',   desc: 'Easy on the eyes' },
    { value: 'light',  label: '☀️ Light',  desc: 'High contrast'    },
    { value: 'system', label: '💻 System', desc: 'Follows OS'       }
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      <FieldRow label="App Theme">
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          {THEME_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => handleTheme(opt.value)}
              style={{
                flex: 1,
                padding: 'var(--space-2) var(--space-3)',
                background: theme === opt.value ? 'var(--color-secondary-muted)' : 'var(--color-surface-2)',
                border: `1px solid ${theme === opt.value ? 'var(--color-secondary)' : 'var(--color-surface-offset)'}`,
                borderRadius: 'var(--radius-md)',
                color: theme === opt.value ? 'var(--color-secondary)' : 'var(--color-text-muted)',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '2px',
                fontSize: 'var(--text-sm)',
                fontWeight: 'var(--weight-medium)',
                transition: 'all 100ms ease'
              }}
            >
              <span>{opt.label}</span>
              <span style={{ fontSize: '10px', opacity: 0.6 }}>{opt.desc}</span>
            </button>
          ))}
        </div>
      </FieldRow>

      <Divider />

      <FieldRow label="Default Context" hint="The context loaded when the app starts.">
        <select
          value={activeContext}
          onChange={e => {
            setContext(e.target.value)
            window.electronAPI.db.setSetting('default_context', e.target.value)
          }}
          style={{
            background: 'var(--color-surface-2)',
            border: '1px solid var(--color-surface-offset)',
            color: 'var(--color-text-base)',
            borderRadius: 'var(--radius-md)',
            padding: 'var(--space-2) var(--space-3)',
            fontSize: 'var(--text-sm)',
            outline: 'none',
            cursor: 'pointer',
            width: '100%'
          }}
        >
          {availableContexts.map(ctx => (
            <option key={ctx} value={ctx}>{ctx}</option>
          ))}
        </select>
      </FieldRow>
    </div>
  )
}

// Main SettingsView
export default function SettingsView() {
  const [activeTab, setActiveTab] = useState<SettingsTab>('general')
  const activeContext = useAppStore(s => s.activeContext)
  const isWindows = window.electronAPI.app.platform === 'win32'

  const visibleTabs = TABS.filter(t => {
    if (t.id === 'widget' && !isWindows) return false
    return true
  })

  const renderTabContent = () => {
    switch (activeTab) {
      case 'general':    return <GeneralSettings />
      case 'contexts':   return <ContextManager />
      case 'kanban':     return <KanbanSettings activeContext={activeContext} />
      case 'ai':         return <AiSettings />
      case 'appearance': return <AppearanceSettings />
      case 'widget':     return <WidgetSettings />
      case 'features':   return <FeatureToggleCenter />
      case 'about':      return <AboutPanel />
      default:           return null
    }
  }

  const activeTabInfo = visibleTabs.find(t => t.id === activeTab)

  return (
    <div style={{
      display: 'flex',
      height: '100%',
      background: 'var(--color-background)',
      overflow: 'hidden'
    }}>
      {/* Sidebar nav */}
      <nav style={{
        width: '200px',
        flexShrink: 0,
        borderRight: '1px solid var(--color-surface-offset)',
        background: 'var(--color-surface-1)',
        padding: 'var(--space-4) var(--space-3)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-1)',
        overflowY: 'auto'
      }}>
        <div style={{
          fontSize: 'var(--text-xs)',
          fontWeight: 'var(--weight-bold)',
          color: 'var(--color-text-faint)',
          textTransform: 'uppercase',
          letterSpacing: 'var(--tracking-wide)',
          padding: 'var(--space-2) var(--space-2)',
          marginBottom: 'var(--space-2)'
        }}>
          Settings
        </div>
        {visibleTabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-2)',
              padding: 'var(--space-2) var(--space-3)',
              borderRadius: 'var(--radius-md)',
              border: 'none',
              background: activeTab === tab.id ? 'var(--color-secondary-muted)' : 'transparent',
              color: activeTab === tab.id ? 'var(--color-secondary)' : 'var(--color-text-muted)',
              cursor: 'pointer',
              fontSize: 'var(--text-sm)',
              fontWeight: activeTab === tab.id ? 'var(--weight-semibold)' : 'var(--weight-regular)',
              textAlign: 'left',
              width: '100%',
              transition: 'background 100ms ease, color 100ms ease'
            }}
            onMouseEnter={e => {
              if (activeTab !== tab.id) {
                e.currentTarget.style.background = 'var(--color-surface-offset)'
                e.currentTarget.style.color = 'var(--color-text-base)'
              }
            }}
            onMouseLeave={e => {
              if (activeTab !== tab.id) {
                e.currentTarget.style.background = 'transparent'
                e.currentTarget.style.color = 'var(--color-text-muted)'
              }
            }}
          >
            <span style={{ flexShrink: 0, opacity: 0.8 }}>{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </nav>

      {/* Content area */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: 'var(--space-6)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-6)'
      }}>
        {/* Page title */}
        <div>
          <h1 style={{
            margin: 0,
            fontSize: 'var(--text-xl)',
            fontWeight: 'var(--weight-semibold)',
            color: 'var(--color-text-base)',
            letterSpacing: 'var(--tracking-tight)'
          }}>
            {activeTabInfo?.label}
          </h1>
        </div>

        {/* Tab content */}
        <SettingsSection
          icon={activeTabInfo?.icon}
          title={activeTabInfo?.label ?? ''}
        >
          {renderTabContent()}
        </SettingsSection>
      </div>
    </div>
  )
}
