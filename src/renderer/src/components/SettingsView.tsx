import React, { useState, useEffect } from 'react'
import type { AiMemory } from '../../../shared/types'
import { useConfirm } from './ui/ConfirmDialog'
import {
  Settings,
  Layers,
  Sparkles,
  Palette,
  Paintbrush,
  Monitor,
  Zap,
  Info,
  CheckCircle,
  AlertCircle,
  RefreshCw,
  Layout,
  Archive,
  Keyboard,
  Boxes,
  Plus,
  Trash2,
  Mail,
  ChevronDown,
  Cloud,
  Server,
  HardDrive,
  Plug, Bell, PanelTop, Moon, Sun, MonitorCog } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import SettingsSection, {
  FieldRow,
  SettingsInput,
  ToggleSwitch,
  Divider,
  RowBetween
} from './settings/SettingsSection'
import ContextManager from './settings/ContextManager'
import SyncSettings from './settings/SyncSettings'
import ExportPanel from './settings/ExportPanel'
import NotificationSettings from './settings/NotificationSettings'
import StartupSettings from './settings/StartupSettings'
import McpSettings from './settings/McpSettings'
import AppearanceSettings from './settings/AppearanceSettings'
import FeatureToggleCenter from './settings/FeatureToggleCenter'
import AboutPanel from './settings/AboutPanel'
import ThemeCustomizer from './settings/ThemeCustomizer'
import HotkeyBinder from './settings/HotkeyBinder'
import ExtensionsTab from './settings/ExtensionsTab'
import { useToast } from './ui/Toast'
import { loadBoardConfig, patchBoardConfig, type ColumnConfig } from '../lib/boardConfig'
import {
  VIEW_FEATURES,
  readViewFeatures,
  defaultViewEnabledMap,
  START_VIEW_LAST_USED,
  type ViewEnabledMap
} from '../lib/features'
import { getStringSetting, setStringSetting } from '../lib/settings'
import { useAppStore } from '../store/appStore'
import { useAiEnabled } from '../lib/useAiEnabled'
import {
  loadProviders, persistProviders, activateProvider, providerFromPreset,
  isLocalUrl, PROVIDER_PRESETS, type AiProvider, type ProviderPreset
} from './ai/aiProviders'

// Tab definition
// Merged layout: Widget lives inside General, Kanban inside Workspaces & Board,
// Theme Builder inside Appearance, Extensions inside Features & Plugins.
// Imported rather than redeclared. This file used to keep its own copy of the
// union, which meant the store and the view could drift, and the store is what
// actually decides which tab is open, so the copy here was only ever a way to
// get them out of step.
import type { SettingsTab } from '../store/appStore'
import { loadEmailSamples, saveEmailSamples, type EmailSample } from '../lib/emailSamples'
import { MAX_EMAIL_SAMPLES } from '../../../shared/emailSamples'

interface TabInfo {
  id: SettingsTab
  label: string
  icon: React.ReactNode
  description: string
}

const TAB_GROUPS: { group: string; tabs: TabInfo[] }[] = [
  {
    group: 'Application',
    tabs: [
      { id: 'general',    label: 'General',            icon: <Settings size={14} />, description: 'Startup behavior and desktop integration.' },
      { id: 'appearance', label: 'Appearance & Theme', icon: <Palette size={14} />,  description: 'Interface theme, text scale, density and full color customization.' }
    ]
  },
  {
    group: 'Workspace',
    tabs: [
      { id: 'contexts', label: 'Workspaces & Board', icon: <Layers size={14} />,   description: 'Manage workspaces and the Kanban columns of the active one.' },
      { id: 'ai',       label: 'AI Assistant',       icon: <Sparkles size={14} />, description: 'Model providers, generation options, email voice and persistent memory.' }
    ]
  },
  {
    group: 'System',
    tabs: [
      { id: 'hotkeyBinder', label: 'Keyboard Shortcuts', icon: <Keyboard size={14} />, description: 'Rebind the global hotkeys registered by Checkpoint.' },
      { id: 'features',     label: 'Features & Plugins', icon: <Zap size={14} />,      description: 'Toggle background subsystems and manage user plugins.' },
      { id: 'notifications', label: 'Notifications',      icon: <Bell size={14} />,     description: 'What Checkpoint tells you about, and when it stays quiet.' },
      { id: 'backup',       label: 'Database Backup',    icon: <Archive size={14} />,  description: 'Automated database snapshots, retention and restore points.' },
      { id: 'storage',      label: 'Storage & Export',    icon: <HardDrive size={14} />, description: 'Manage local attachment vaults and clean up orphaned files.' },
      { id: 'sync',         label: 'P2P Network Sync',   icon: <RefreshCw size={14} />, description: 'Sync database and note directories with other machines.' },
      { id: 'mcp',          label: 'MCP Server',         icon: <Plug size={14} />,      description: 'Let external AI agents read and edit Checkpoint over a local connection.' },
      { id: 'about',        label: 'About',              icon: <Info size={14} />,     description: 'Version, credits and diagnostics.' }
    ]
  }
]

const ALL_TABS: TabInfo[] = TAB_GROUPS.flatMap(g => g.tabs)

// Old tab ids (pre-merge) still navigable from anywhere in the app
const LEGACY_TAB_ALIASES: Record<string, SettingsTab> = {
  kanban: 'contexts',
  themeCustomizer: 'appearance',
  extensions: 'features',
  widget: 'general'
}

// Kanban per-context column config
function KanbanSettings({ activeContext }: { activeContext: string }) {
  const [columns, setColumns] = useState<ColumnConfig[]>([])
  const [loading, setLoading] = useState(true)
  // Track local (not-yet-saved) edits to column names separately
  const [localNames, setLocalNames] = useState<Record<string, string>>({})

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      try {
        // Shares the board document with the Kanban view and the AI action
        // blocks. This tab used to keep its own ColumnConfig type and read the
        // raw column key, so it silently dropped colour and colour-mode on
        // every save. Any column styled on the board lost that styling as soon
        // as its WIP limit was edited here.
        const config = await loadBoardConfig(activeContext)
        setColumns(config.columns)
        setLocalNames(Object.fromEntries(config.columns.map(c => [c.id, c.name])))
      } catch (err) { console.error(err) }
      setLoading(false)
    }
    load()
  }, [activeContext])

  const save = async (updated: ColumnConfig[]) => {
    await patchBoardConfig(activeContext, { columns: updated })
    setColumns(updated)
  }

  // Save name only on blur, not on every keystroke
  const handleNameBlur = (id: string) => {
    const newName = localNames[id]?.trim()
    if (!newName) return
    const updated = columns.map(c => c.id === id ? { ...c, name: newName } : c)
    save(updated)
  }

  const updateColWip = (id: string, wipLimit: number | null) =>
    save(columns.map(c => c.id === id ? { ...c, wipLimit } : c))

  if (loading) return <div style={{ color: 'var(--color-text-faint)', fontSize: 'var(--text-sm)' }}>Loading…</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-faint)', margin: 0 }}>
        Set a WIP limit of 0 for unlimited. You can also rename columns by double-clicking their headers on the board itself.
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
            value={localNames[col.id] ?? col.name}
            onChange={e => setLocalNames(prev => ({ ...prev, [col.id]: e.target.value }))}
            onBlur={() => handleNameBlur(col.id)}
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
                // Track locally but don't save yet
                setColumns(prev => prev.map(c => c.id === col.id ? { ...c, wipLimit: n === 0 ? null : n } : c))
              }}
              onBlur={e => {
                const n = parseInt(e.target.value) || 0
                updateColWip(col.id, n === 0 ? null : n)
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
    await window.electronAPI.widget.toggle(v)
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
        <ToggleSwitch checked={enabled} onChange={handleToggle} label="Show Desktop Widget" />
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


function MemoryVaultManager() {
  const activeContext = useAppStore(s => s.activeContext)
  const [memories, setMemories] = useState<AiMemory[]>([])
  const [newKey, setNewKey] = useState('')
  const [newContent, setNewContent] = useState('')
  const [loading, setLoading] = useState(true)

  const loadMemories = async () => {
    try {
      const list = await window.electronAPI.memory.getMemories(activeContext)
      setMemories(list || [])
    } catch (e) { console.warn('Failed to load memories:', e) }
    finally { setLoading(false) }
  }

  useEffect(() => { loadMemories() }, [activeContext])

  const handleAddMemory = async () => {
    if (!newKey.trim() || !newContent.trim()) return
    try {
      await window.electronAPI.memory.saveMemory({
        context: activeContext || 'default',
        category: 'semantic',
        memory_key: newKey.trim(),
        content: newContent.trim()
      })
      setNewKey('')
      setNewContent('')
      loadMemories()
    } catch (e) { console.warn('Failed to save memory:', e) }
  }

  const handleDeleteMemory = async (id: string) => {
    try {
      await window.electronAPI.memory.deleteMemory(id)
      loadMemories()
    } catch (e) { console.warn('Failed to delete memory:', e) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div className="row-between">
        <div style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text-base)' }}>
          AI Persistent Memory Vault ({memories.length})
        </div>
        <span style={{ fontSize: '10px', color: 'var(--color-text-faint)' }}>Active Context: {activeContext || 'default'}</span>
      </div>
      <div style={{ fontSize: '11px', color: 'var(--color-text-faint)', lineHeight: 1.4 }}>
        Manage stored project rules, preferences, and game lore recalled automatically during AI chat sessions.
      </div>

      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', background: 'var(--color-surface-2)', padding: '10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-surface-offset)' }}>
        <input
          type="text"
          value={newKey}
          onChange={e => setNewKey(e.target.value)}
          placeholder="Memory Key (e.g. antagonist_name)"
          style={{ flex: '1 1 180px', background: 'var(--color-surface-1)', border: '1px solid var(--color-surface-offset)', borderRadius: 'var(--radius-sm)', padding: '6px 8px', color: '#fff', fontSize: '11px', outline: 'none' }}
        />
        <input
          type="text"
          value={newContent}
          onChange={e => setNewContent(e.target.value)}
          placeholder="Memory Content (e.g. Chronos, master of time loops)"
          style={{ flex: '2 1 240px', background: 'var(--color-surface-1)', border: '1px solid var(--color-surface-offset)', borderRadius: 'var(--radius-sm)', padding: '6px 8px', color: '#fff', fontSize: '11px', outline: 'none' }}
        />
        <button
          onClick={handleAddMemory}
          style={{ background: 'var(--color-secondary)', border: 'none', color: '#fff', borderRadius: 'var(--radius-sm)', padding: '6px 12px', fontSize: '11px', fontWeight: 'bold', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
        >
          <Plus size={12} />
          <span>Save Memory</span>
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '220px', overflowY: 'auto' }}>
        {memories.map(mem => (
          <div key={mem.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--color-surface-1)', border: '1px solid var(--color-surface-offset)', padding: '8px 10px', borderRadius: 'var(--radius-sm)', fontSize: '11px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
              <div style={{ fontWeight: 'bold', color: 'var(--color-secondary)' }}>{mem.memory_key} <span style={{ fontSize: '9px', opacity: 0.6, color: '#fff' }}>({mem.category})</span></div>
              <div style={{ color: 'var(--color-text-base)' }}>{mem.content}</div>
            </div>
            <button onClick={() => handleDeleteMemory(mem.id)} style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', padding: '4px' }}>
              <Trash2 size={13} />
            </button>
          </div>
        ))}
        {memories.length === 0 && !loading && (
          <div style={{ fontSize: '11px', color: 'var(--color-text-faint)', fontStyle: 'italic', textAlign: 'center', padding: '12px' }}>
            No memories stored for this context yet. Add facts above or let the AI auto-save rules during chat.
          </div>
        )}
      </div>
    </div>
  )
}

// AI Settings
function AiSettings() {
  const { toast } = useToast()
  const [baseURL, setBaseURL] = useState('http://localhost:11434/v1')
  const [apiKey, setApiKey] = useState('ollama')
  const [model, setModel] = useState('llama3')
  const [temperature, setTemperature] = useState(0.7)
  const [maxTokens, setMaxTokens] = useState(2048)
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle')
  const [connectionError, setConnectionError] = useState('')

  // Provider profiles (the active one is mirrored into baseURL/apiKey/model above)
  const [providers, setProviders] = useState<AiProvider[]>([])
  const [activeId, setActiveId] = useState<string>('')
  const [showPresetMenu, setShowPresetMenu] = useState(false)

  const [emailSamples, setEmailSamples] = useState<EmailSample[]>([
    { id: 'sample_1', title: 'Sample Email 1', body: '' }
  ])

  useEffect(() => {
    const load = async () => {
      try {
        // Load provider profiles (migrates the old flat settings on first run)
        const { providers: provs, activeId: active } = await loadProviders()
        setProviders(provs)
        setActiveId(active)
        const activeProv = provs.find(p => p.id === active)
        if (activeProv) {
          setBaseURL(activeProv.baseURL)
          setApiKey(activeProv.apiKey)
          setModel(activeProv.model)
        }

        const dbTemp     = await window.electronAPI.db.getSetting('ai_temperature')
        const dbMaxToks  = await window.electronAPI.db.getSetting('ai_max_tokens')

        // Explicit null check, not truthiness: temperature 0 is a valid and
        // meaningful setting (fully deterministic output), and `if (dbTemp)`
        // skipped it, so choosing 0 silently reverted to the default on reopen.
        if (dbTemp !== null && dbTemp !== undefined) setTemperature(Number(dbTemp))
        if (dbMaxToks !== null && dbMaxToks !== undefined) setMaxTokens(Number(dbMaxToks))
        const samples = await loadEmailSamples()
        if (samples.length > 0) setEmailSamples(samples)
      } catch (err) { console.error('Failed to load AI settings:', err) }
    }
    load()
  }, [])

  /**
   * Persists one setting. The failure path matters: this was fire-and-forget,
   * so a rejected write left the control showing the new value while the
   * database kept the old one, and the user had no way to know.
   */
  const save = (key: string, val: string | number): void => {
    window.electronAPI.db.setSetting(key, val).catch(err => {
      console.error(`Failed to save ${key}:`, err)
      toast(`Could not save that setting, ${err?.message || 'unknown error'}. Try again.`)
    })
  }

  // Provider profile management
  const activeProvider = providers.find(p => p.id === activeId) || null

  // Notify the AI panel so it reloads the active provider's model/endpoint.
  const notifyProviderChanged = (): void => {
    window.dispatchEvent(new CustomEvent('checkpoint-ai-provider-changed'))
  }

  const updateActiveProvider = (patch: Partial<AiProvider>) => {
    if (!activeId) return
    const next = providers.map(p => (p.id === activeId ? { ...p, ...patch } : p))
    setProviders(next)
    persistProviders(next, activeId).then(notifyProviderChanged)
  }

  const handleSwitchProvider = async (id: string) => {
    const p = providers.find(x => x.id === id)
    if (!p) return
    setActiveId(id)
    setBaseURL(p.baseURL); setApiKey(p.apiKey); setModel(p.model)
    setConnectionStatus('idle'); setConnectionError('')
    await activateProvider(providers, id)
    notifyProviderChanged()
  }

  const handleAddPreset = async (preset: ProviderPreset) => {
    const p = providerFromPreset(preset)
    const next = [...providers, p]
    setProviders(next)
    setActiveId(p.id)
    setBaseURL(p.baseURL); setApiKey(p.apiKey); setModel(p.model)
    setShowPresetMenu(false)
    setConnectionStatus('idle'); setConnectionError('')
    await persistProviders(next, p.id)
    notifyProviderChanged()
  }

  const handleDeleteProvider = async () => {
    if (providers.length <= 1) return
    const next = providers.filter(p => p.id !== activeId)
    const newActive = next[0].id
    setProviders(next)
    setActiveId(newActive)
    setBaseURL(next[0].baseURL); setApiKey(next[0].apiKey); setModel(next[0].model)
    setConnectionStatus('idle'); setConnectionError('')
    await persistProviders(next, newActive)
    notifyProviderChanged()
  }

  const handleUpdateSamples = (updated: EmailSample[]) => {
    const capped = updated.slice(0, MAX_EMAIL_SAMPLES)
    setEmailSamples(capped)
    saveEmailSamples(capped).catch(() => {})
  }

  const handleAddSample = () => {
    if (emailSamples.length >= MAX_EMAIL_SAMPLES) return
    const newSample: EmailSample = {
      id: `sample_${Date.now()}`,
      title: `Sample Email ${emailSamples.length + 1}`,
      body: ''
    }
    handleUpdateSamples([...emailSamples, newSample])
  }

  const handleRemoveSample = (id: string) => {
    if (emailSamples.length <= 1) {
      handleUpdateSamples([{ id: `sample_${Date.now()}`, title: 'Sample Email 1', body: '' }])
      return
    }
    handleUpdateSamples(emailSamples.filter(s => s.id !== id))
  }

  const handleSampleChange = (id: string, field: 'title' | 'body', val: string) => {
    handleUpdateSamples(
      emailSamples.map(s => (s.id === id ? { ...s, [field]: val } : s))
    )
  }

  const handleTest = async () => {
    setConnectionStatus('testing'); setConnectionError('')
    try {
      const res = await window.electronAPI.ai.testConnection(baseURL, apiKey)
      if (res.success) {
        setConnectionStatus('success')
      } else {
        setConnectionStatus('error')
        setConnectionError(res.error || 'Connection check failed')
      }
    } catch (err) {
      setConnectionStatus('error')
      setConnectionError((err as Error).message || 'IPC request failed')
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      {/* Provider profiles: keep several connections (local + cloud) and switch */}
      <FieldRow label="Provider">
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center', position: 'relative', width: '100%' }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <select
              value={activeId}
              onChange={e => handleSwitchProvider(e.target.value)}
              style={{
                width: '100%', appearance: 'none',
                background: 'var(--color-surface-2)', border: '1px solid var(--color-surface-offset)',
                borderRadius: 'var(--radius-md)', color: 'var(--color-text-base)',
                fontSize: 'var(--text-xs)', padding: '7px 28px 7px 10px', outline: 'none', cursor: 'pointer'
              }}
            >
              {providers.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name}{isLocalUrl(p.baseURL) ? '. Local' : '. Cloud'}
                </option>
              ))}
            </select>
            <ChevronDown size={13} style={{ position: 'absolute', right: '9px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-faint)', pointerEvents: 'none' }} />
          </div>
          <button
            onClick={() => setShowPresetMenu(v => !v)}
            title="Add a provider"
            style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'var(--color-surface-offset)', border: '1px solid var(--color-surface-offset)', color: 'var(--color-secondary)', borderRadius: 'var(--radius-md)', padding: '6px 10px', fontSize: '11px', fontWeight: 'bold', cursor: 'pointer' }}
          >
            <Plus size={13} /> Add
          </button>
          <button
            onClick={handleDeleteProvider}
            disabled={providers.length <= 1}
            title={providers.length <= 1 ? 'Keep at least one provider' : 'Delete this provider'}
            style={{ display: 'flex', alignItems: 'center', background: 'transparent', border: '1px solid var(--color-surface-offset)', color: providers.length <= 1 ? 'var(--color-text-faint)' : 'var(--color-text-muted)', borderRadius: 'var(--radius-md)', padding: '6px 8px', cursor: providers.length <= 1 ? 'default' : 'pointer' }}
          >
            <Trash2 size={13} />
          </button>

          {showPresetMenu && (
            <div style={{ position: 'absolute', top: 'calc(100% + 4px)', right: 0, zIndex: 30, background: 'var(--color-surface-elevated)', border: '1px solid var(--color-surface-offset)', borderRadius: 'var(--radius-md)', boxShadow: '0 8px 24px rgba(0,0,0,0.4)', overflow: 'hidden', minWidth: '260px' }}>
              {PROVIDER_PRESETS.map(preset => (
                <button
                  key={preset.id}
                  onClick={() => handleAddPreset(preset)}
                  style={{ display: 'flex', flexDirection: 'column', gap: '2px', width: '100%', textAlign: 'left', background: 'transparent', border: 'none', borderBottom: '1px solid var(--color-surface-offset)', padding: '8px 12px', cursor: 'pointer' }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-surface-offset)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: 'bold', color: 'var(--color-text-base)' }}>
                    {preset.local ? <Server size={12} /> : <Cloud size={12} />}
                    {preset.name}
                  </span>
                  <span style={{ fontSize: '10px', color: 'var(--color-text-faint)', lineHeight: 1.4 }}>{preset.hint}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </FieldRow>

      <FieldRow label="Name">
        <SettingsInput
          value={activeProvider?.name || ''}
          onChange={v => setProviders(prev => prev.map(p => (p.id === activeId ? { ...p, name: v } : p)))}
          onBlur={() => persistProviders(providers, activeId)}
          placeholder="e.g. Ollama, Gemini, Work OpenAI"
        />
      </FieldRow>
      <FieldRow label="Base URL">
        <SettingsInput
          value={baseURL}
          onChange={setBaseURL}
          onBlur={() => updateActiveProvider({ baseURL: baseURL.trim() })}
          placeholder="e.g. http://localhost:11434/v1"
        />
      </FieldRow>
      <FieldRow label="API Key">
        <SettingsInput
          type="password"
          value={apiKey}
          onChange={setApiKey}
          onBlur={() => updateActiveProvider({ apiKey: apiKey.trim() })}
          placeholder={isLocalUrl(baseURL) ? 'ollama' : 'cloud API key'}
        />
      </FieldRow>
      <FieldRow label="Model">
        <SettingsInput
          value={model}
          onChange={setModel}
          onBlur={() => updateActiveProvider({ model: model.trim() })}
          placeholder={isLocalUrl(baseURL) ? 'e.g. gemma2:2b-instruct-fp16' : 'e.g. gemini-2.0-flash'}
        />
      </FieldRow>

      <FieldRow
        label={`Temperature, ${temperature.toFixed(1)}`}
        hint="Lower is more focused and repeatable; higher is more varied."
      >
        <input
          type="range" min={0} max={1} step={0.1} value={temperature}
          aria-label="Temperature"
          aria-valuetext={temperature.toFixed(1)}
          onChange={e => { setTemperature(parseFloat(e.target.value)); save('ai_temperature', parseFloat(e.target.value)) }}
          style={{ accentColor: 'var(--color-secondary)', cursor: 'pointer', width: '100%' }}
        />
      </FieldRow>

      <FieldRow label="Max Tokens" hint="Between 1 and 200,000. Applied when the field loses focus.">
        <SettingsInput
          type="number"
          inputMode="numeric"
          min={1}
          max={200000}
          value={maxTokens}
          // Typed freely, clamped on blur: validating per keystroke fights the
          // user mid-edit, and `parseInt(v) || 0` previously let an empty or
          // malformed field persist 0, which makes generation fail outright.
          onChange={v => setMaxTokens(parseInt(v, 10) || 0)}
          onBlur={() => {
            const clamped = Math.min(200000, Math.max(1, maxTokens || 2048))
            setMaxTokens(clamped)
            save('ai_max_tokens', clamped)
          }}
        />
      </FieldRow>

      <Divider />

      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
          <div style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text-base)' }}>
            Email Writing Voice Context & Sample Drafts ({emailSamples.length}/5)
          </div>
          {emailSamples.length < 5 && (
            <button
              onClick={handleAddSample}
              style={{
                background: 'var(--color-surface-offset)',
                border: '1px solid var(--color-surface-offset)',
                color: 'var(--color-secondary)',
                borderRadius: 'var(--radius-sm)',
                padding: '3px 8px',
                fontSize: '11px',
                fontWeight: 'bold',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '4px'
              }}
            >
              <Plus size={12} />
              <span>Add Draft Sample</span>
            </button>
          )}
        </div>
        <div style={{ fontSize: '11px', color: 'var(--color-text-faint)', marginBottom: '12px', lineHeight: 1.4 }}>
          Add up to 5 email writing samples. When drafting emails, the AI assistant will combine your sample styles to match your exact tone, structure, and writing style.
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {emailSamples.map((sample, idx) => (
            <div
              key={sample.id}
              style={{
                background: 'var(--color-surface-2)',
                border: '1px solid var(--color-surface-offset)',
                borderRadius: 'var(--radius-md)',
                padding: 'var(--space-3)',
                display: 'flex',
                flexDirection: 'column',
                gap: 'var(--space-2)'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-2)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flex: 1 }}>
                  <Mail size={12} style={{ color: 'var(--color-secondary)' }} />
                  <input
                    type="text"
                    value={sample.title}
                    onChange={e => handleSampleChange(sample.id, 'title', e.target.value)}
                    placeholder={`Draft Sample ${idx + 1} Title`}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      borderBottom: '1px solid var(--color-surface-offset)',
                      color: 'var(--color-text-base)',
                      fontSize: '11px',
                      fontWeight: 'bold',
                      outline: 'none',
                      padding: '2px 0',
                      flex: 1
                    }}
                  />
                </div>
                <button
                  onClick={() => handleRemoveSample(sample.id)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--color-text-muted)',
                    cursor: 'pointer',
                    padding: '2px',
                    display: 'flex',
                    alignItems: 'center',
                    borderRadius: 'var(--radius-sm)'
                  }}
                  onMouseEnter={e => (e.currentTarget.style.color = 'var(--color-error)')}
                  onMouseLeave={e => (e.currentTarget.style.color = 'var(--color-text-muted)')}
                  title="Remove sample draft"
                >
                  <Trash2 size={13} />
                </button>
              </div>

              <textarea
                value={sample.body}
                onChange={e => handleSampleChange(sample.id, 'body', e.target.value)}
                placeholder="Paste an email sample here..."
                rows={4}
                style={{
                  width: '100%',
                  background: 'var(--color-surface-1)',
                  border: '1px solid var(--color-surface-offset)',
                  borderRadius: 'var(--radius-sm)',
                  padding: 'var(--space-2)',
                  color: 'var(--color-text-base)',
                  fontSize: '11px',
                  lineHeight: 1.4,
                  resize: 'vertical',
                  outline: 'none',
                  fontFamily: 'inherit',
                  boxSizing: 'border-box'
                }}
              />
            </div>
          ))}
        </div>
      </div>

      <Divider />

      <MemoryVaultManager />

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

// Theme mode (dark / light / system). Rendered in Appearance & Theme
function ThemeModeSettings() {
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

  // Icons rather than emoji: emoji are rendered by the OS font, so they ignore
  // the theme entirely and shift shape between Windows versions.
  const THEME_OPTIONS: { value: typeof theme; Icon: LucideIcon; label: string; desc: string }[] = [
    { value: 'dark',   Icon: Moon,    label: 'Dark',   desc: 'Easy on the eyes' },
    { value: 'light',  Icon: Sun,     label: 'Light',  desc: 'High contrast'    },
    { value: 'system', Icon: MonitorCog, label: 'System', desc: 'Follows OS'    }
  ]

  return (
    <FieldRow label="Interface Theme" hint="Applied instantly and restored on the next launch. The titlebar toggle uses the same setting.">
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
            <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1-5)' }}>
              <opt.Icon size={14} />
              {opt.label}
            </span>
            <span style={{ fontSize: '10px', opacity: 0.6 }}>{opt.desc}</span>
          </button>
        ))}
      </div>
    </FieldRow>
  )
}

// General Settings
function GeneralSettings() {
  const availableContexts = useAppStore(s => s.availableContexts)

  const [defaultContext, setDefaultContext] = useState<string>('')
  const [startView, setStartView] = useState<string>(START_VIEW_LAST_USED)
  const [enabledViews, setEnabledViews] = useState<ViewEnabledMap>(defaultViewEnabledMap)

  useEffect(() => {
    const load = async () => {
      const dc = await window.electronAPI.db.getSetting('default_context')
      if (typeof dc === 'string') setDefaultContext(dc)
      setStartView(await getStringSetting('start_view', START_VIEW_LAST_USED))
      setEnabledViews(await readViewFeatures())
    }
    load().catch(err => console.error('Failed to load general settings:', err))
  }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      <FieldRow
        label="Startup Workspace"
        hint="The workspace loaded when the app starts. Choose “Last used” to always resume where you left off."
      >
        <select
          value={defaultContext}
          onChange={e => {
            setDefaultContext(e.target.value)
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
          <option value="">Last used (default)</option>
          {availableContexts.map(ctx => (
            <option key={ctx} value={ctx}>{ctx}</option>
          ))}
        </select>
      </FieldRow>

      <FieldRow
        label="Startup View"
        hint="The screen shown when the app opens. Disabled views are not listed, and a view turned off later falls back to the first one still enabled."
      >
        <select
          value={startView}
          onChange={e => {
            setStartView(e.target.value)
            setStringSetting('start_view', e.target.value).catch(err => {
              console.error('Failed to save start_view setting:', err)
            })
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
          <option value={START_VIEW_LAST_USED}>Last used (default)</option>
          {VIEW_FEATURES.filter(f => enabledViews[f.view]).map(f => (
            <option key={f.view} value={f.view}>{f.label}</option>
          ))}
        </select>
      </FieldRow>
    </div>
  )
}

// Main SettingsView
export default function SettingsView() {
  const rawTab = useAppStore(s => s.settingsTab)
  const setActiveTab = useAppStore(s => s.setSettingsTab)
  const activeContext = useAppStore(s => s.activeContext)
  const isWindows = window.electronAPI.app.platform === 'win32'
  const aiEnabled = useAiEnabled()

  // Resolve any pre-merge tab id that might still arrive from old navigation paths
  const activeTab: SettingsTab = (LEGACY_TAB_ALIASES[rawTab as string] ?? rawTab) as SettingsTab

  // Each tab renders one or more titled section cards
  const renderTabContent = () => {
    switch (activeTab) {
      case 'general':
        return (
          <>
            <SettingsSection icon={<Settings size={14} />} title="Startup" description="What Checkpoint opens with.">
              <GeneralSettings />
            </SettingsSection>
            {isWindows && (
              <SettingsSection icon={<PanelTop size={14} />} title="Tray & Windows Startup" description="The notification-area icon, and what happens when you sign in or close the window.">
                <StartupSettings />
              </SettingsSection>
            )}
            {isWindows && (
              <SettingsSection icon={<Monitor size={14} />} title="Desktop Widget" description="Always-on-top overlay for glanceable tasks (Windows only).">
                <WidgetSettings />
              </SettingsSection>
            )}
          </>
        )
      case 'contexts':
        return (
          <>
            <SettingsSection icon={<Layers size={14} />} title="Workspaces" description="Isolated contexts with their own boards, logs and notes.">
              <ContextManager />
            </SettingsSection>
            <SettingsSection icon={<Layout size={14} />} title="Kanban Columns" description={`Column names and WIP limits for #${activeContext}.`}>
              <KanbanSettings activeContext={activeContext} />
            </SettingsSection>
          </>
        )
      case 'ai':
        return (
          <SettingsSection icon={<Sparkles size={14} />} title="AI Assistant" description="Connection, generation options, email voice and persistent memory.">
            <AiSettings />
          </SettingsSection>
        )
      case 'appearance':
        return (
          <>
            <SettingsSection icon={<Palette size={14} />} title="Interface" description="Theme mode, text scale and density.">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
                <ThemeModeSettings />
                <Divider />
                <AppearanceSettings />
              </div>
            </SettingsSection>
            <SettingsSection icon={<Paintbrush size={14} />} title="Theme Builder" description="Override individual colors and fonts via the customization engine.">
              <ThemeCustomizer />
            </SettingsSection>
          </>
        )
      case 'hotkeyBinder':
        return (
          <SettingsSection icon={<Keyboard size={14} />} title="Keyboard Shortcuts" description="Global hotkeys registered with the operating system.">
            <HotkeyBinder />
          </SettingsSection>
        )
      case 'features':
        return (
          <>
            <SettingsSection icon={<Zap size={14} />} title="Feature Toggles" description="Enable or disable background subsystems.">
              <FeatureToggleCenter />
            </SettingsSection>
            <SettingsSection icon={<Boxes size={14} />} title="Extensions & Plugins" description="Hot-loaded user plugins from the plugins folder.">
              <ExtensionsTab />
            </SettingsSection>
          </>
        )
      case 'backup':
        return (
          <SettingsSection icon={<Archive size={14} />} title="Database Backup" description="Automated snapshots, retention and restore points.">
            <BackupSettings />
          </SettingsSection>
        )
      case 'storage':
        return (
          <SettingsSection icon={<HardDrive size={14} />} title="Storage & Media" description="Export your data, track attachment usage and clean up unreferenced files.">
            <StorageSettings />
          </SettingsSection>
        )
      case 'sync':
        return (
          <SettingsSection icon={<RefreshCw size={14} />} title="P2P Network Sync" description="Synchronize database and note folders with other machines.">
            <SyncSettings />
          </SettingsSection>
        )
      case 'notifications':
        return (
          <SettingsSection icon={<Bell size={14} />} title="Notifications" description="What Checkpoint tells you about, and when it stays quiet.">
            <NotificationSettings />
          </SettingsSection>
        )
      case 'mcp':
        return (
          <SettingsSection icon={<Plug size={14} />} title="MCP Server" description="Let external AI agents read and edit Checkpoint over a local connection.">
            <McpSettings />
          </SettingsSection>
        )
      case 'about':
        return (
          <SettingsSection icon={<Info size={14} />} title="About" description="Version, credits and diagnostics.">
            <AboutPanel />
          </SettingsSection>
        )
      default:
        return null
    }
  }

  // Switching AI off while its tab is open would otherwise leave the panel
  // showing settings for something that no longer exists.
  useEffect(() => {
    if (!aiEnabled && activeTab === 'ai') setActiveTab('general')
  }, [aiEnabled, activeTab, setActiveTab])

  const activeTabInfo = ALL_TABS.find(t => t.id === activeTab)

  return (
    <div style={{
      display: 'flex',
      height: '100%',
      background: 'var(--color-background)',
      overflow: 'hidden'
    }}>
      {/* Sidebar nav (grouped) */}
      <nav aria-label="Settings sections" style={{
        width: '210px',
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
          marginBottom: 'var(--space-1)'
        }}>
          Settings
        </div>
        {TAB_GROUPS.map(group => (
          <div key={group.group} style={{ display: 'flex', flexDirection: 'column', gap: '2px', marginBottom: 'var(--space-3)' }}>
            <div style={{
              fontSize: '10px',
              fontWeight: 'var(--weight-bold)',
              color: 'var(--color-text-faint)',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              padding: '0 var(--space-3) var(--space-1)'
            }}>
              {group.group}
            </div>
            {group.tabs.filter(tab => tab.id !== 'ai' || aiEnabled).map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                // Which section is open was signalled by colour alone, so it
                // was invisible to screen readers and to anyone who cannot
                // distinguish the accent from the muted foreground.
                aria-current={activeTab === tab.id ? 'page' : undefined}
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
          </div>
        ))}
      </nav>

      {/* Content area */}
      <div style={{
        flex: 1,
        minHeight: 0,
        overflowY: 'auto',
        padding: 'var(--space-6)',
        paddingBottom: 'var(--space-10)'
      }}>
        {/* Centred column, capped so the content never sprawls across a very
            wide monitor. It used to be a fixed 860px pinned hard to the left,
            which left most of a maximised window empty. */}
        <div style={{
          maxWidth: '1400px',
          margin: '0 auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-5)'
        }}>
          {/* Page title + description */}
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
            <p style={{
              margin: 'var(--space-1) 0 0',
              fontSize: 'var(--text-sm)',
              color: 'var(--color-text-muted)'
            }}>
              {activeTabInfo?.description}
            </p>
          </div>

          {/* Tab content. One or more section cards.
              The grid holds ONLY the cards: a full-width title inside it would
              span every track, and `auto-fit` collapses a track only when it is
              genuinely empty, so a single-card tab was left sitting in the
              first of two live columns instead of filling the width. */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 520px), 1fr))',
            gap: 'var(--space-5)',
            alignItems: 'start'
          }}>
            {renderTabContent()}
          </div>
        </div>
      </div>
    </div>
  )
}

// Database Backup Settings Section
function BackupSettings() {
  const confirm = useConfirm()
  const { toast } = useToast()
  const [enabled, setEnabled] = useState(true)
  const [interval, setIntervalVal] = useState('daily')
  const [maxCount, setMaxCount] = useState(10)
  const [customPath, setCustomPath] = useState('')
  const [backups, setBackups] = useState<{
    filename: string
    timestamp: number
    size: number
    kind?: 'scheduled' | 'preRestore'
  }[]>([])

  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [restoring, setRestoring] = useState<string | null>(null)


  const loadStatus = async () => {
    try {
      const status = await window.electronAPI.backup.getStatus()
      setEnabled(status.enabled)
      setIntervalVal(status.interval)
      setMaxCount(status.maxCount)
      setCustomPath(status.path)
      setBackups(status.backups)
    } catch (err) {
      console.error('Failed to load backup status:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadStatus()
  }, [])

  const handleToggle = async (checked: boolean) => {
    try {
      setEnabled(checked)
      await window.electronAPI.db.setSetting('feature_backup', String(checked))
      await window.electronAPI.backup.run('init')
      toast(checked ? 'Backup scheduler activated' : 'Backup scheduler deactivated')
      loadStatus()
    } catch (err) {
      console.error(err)
      toast('Failed to update backup settings')
    }
  }

  const handleIntervalChange = async (val: string) => {
    try {
      setIntervalVal(val)
      await window.electronAPI.db.setSetting('backup_interval', val)
      await window.electronAPI.backup.run('init')
      toast(`Backup schedule set to: ${val}`)
      loadStatus()
    } catch (err) {
      console.error(err)
    }
  }

  const handleMaxCountChange = async (val: number) => {
    const cleanVal = Math.max(1, Math.min(100, val))
    try {
      setMaxCount(cleanVal)
      await window.electronAPI.db.setSetting('backup_max_count', String(cleanVal))
      await window.electronAPI.backup.run('init')
      loadStatus()
    } catch (err) {
      console.error(err)
    }
  }

  const handlePathBlur = async () => {
    try {
      await window.electronAPI.db.setSetting('backup_path', customPath.trim())
      await window.electronAPI.backup.run('init')
      toast('Backup destination path updated')
      loadStatus()
    } catch (err) {
      console.error(err)
    }
  }

  const handleBackupNow = async () => {
    if (running) return
    setRunning(true)
    try {
      await window.electronAPI.backup.run('backup')
      toast('Backup created successfully!')
      loadStatus()
    } catch (err) {
      console.error(err)
      const msg = err instanceof Error ? err.message : String(err)
      toast(`Backup failed: ${msg}`)
    } finally {
      setRunning(false)
    }
  }

  const handleDelete = async (filename: string) => {
    try {
      await window.electronAPI.backup.run('delete', filename)
      toast('Backup archive deleted')
      loadStatus()
    } catch (err) {
      console.error(err)
      toast('Failed to delete backup archive')
    }
  }

  const handleRestore = async (filename: string) => {
    const ok = await confirm({
      title: 'Confirm Database Restore',
      message: `Are you sure you want to restore ${filename}?`,
      warning: 'This will overwrite your current active database. To prevent data loss, a safety backup of your current database is created first.',
      confirmText: 'Yes, Restore Database',
      isDestructive: true
    })
    if (!ok) return

    setRestoring(filename)
    toast('Restoring database, please wait...')
    try {
      await window.electronAPI.backup.run('restore', filename)
      toast('Database restored successfully! App state reloaded.')
      loadStatus()
    } catch (err) {
      console.error(err)
      const msg = err instanceof Error ? err.message : String(err)
      toast(`Restore failed: ${msg}`)
    } finally {
      setRestoring(null)
    }
  }

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    const kb = bytes / 1024
    if (kb < 1024) return `${kb.toFixed(1)} KB`
    const mb = kb / 1024
    return `${mb.toFixed(1)} MB`
  }

  if (loading) return <div style={{ color: 'var(--color-text-faint)', fontSize: 'var(--text-sm)' }}>Loading backup vault…</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      <RowBetween>
        <div>
          <div style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)', color: 'var(--color-text-base)' }}>
            Automated Backups
          </div>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-faint)', marginTop: '2px' }}>
            Periodically saves transactionally consistent snapshots of your active database.
          </div>
        </div>
        <ToggleSwitch checked={enabled} onChange={handleToggle} label="Automated Backups" />
      </RowBetween>

      {enabled && (
        <>
          <Divider />

          {/* Backup Path */}
          <FieldRow label="Backup Directory Path">
            <input
              value={customPath}
              onChange={e => setCustomPath(e.target.value)}
              onBlur={handlePathBlur}
              placeholder="Default: <App Data>/backups"
              style={{
                width: '100%',
                background: 'var(--color-surface-2)',
                border: '1px solid var(--color-surface-offset)',
                color: 'var(--color-text-base)',
                borderRadius: 'var(--radius-md)',
                padding: 'var(--space-2) var(--space-3)',
                fontSize: 'var(--text-sm)',
                outline: 'none'
              }}
            />
          </FieldRow>

          {/* Interval */}
          <FieldRow label="Backup Interval">
            <select
              value={interval}
              onChange={e => handleIntervalChange(e.target.value)}
              style={{
                width: '100%',
                background: 'var(--color-surface-2)',
                border: '1px solid var(--color-surface-offset)',
                color: 'var(--color-text-base)',
                borderRadius: 'var(--radius-md)',
                padding: 'var(--space-2) var(--space-3)',
                fontSize: 'var(--text-sm)',
                outline: 'none',
                cursor: 'pointer'
              }}
            >
              <option value="daily">Daily Check</option>
              <option value="weekly">Weekly Check</option>
              <option value="launch-exit">On Launch and Exit</option>
            </select>
          </FieldRow>

          {/* Max kept backups */}
          <FieldRow label="Rolling Retention Limit">
            <div className="row">
              <input
                type="number"
                min={1}
                max={100}
                value={maxCount}
                onChange={e => handleMaxCountChange(parseInt(e.target.value) || 10)}
                style={{
                  width: '80px',
                  background: 'var(--color-surface-2)',
                  border: '1px solid var(--color-surface-offset)',
                  color: 'var(--color-text-base)',
                  borderRadius: 'var(--radius-md)',
                  padding: 'var(--space-2) var(--space-3)',
                  fontSize: 'var(--text-sm)',
                  outline: 'none',
                  textAlign: 'center'
                }}
              />
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-faint)' }}>
                Maximum number of rolling backup files kept before pruning.
              </span>
            </div>
          </FieldRow>

          <Divider />

          {/* Trigger & List */}
          <div className="row-between">
            <div style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text-base)' }}>
              Backup Archives
            </div>
            <button
              onClick={handleBackupNow}
              disabled={running}
              style={{
                background: 'var(--color-secondary)',
                border: 'none',
                color: 'var(--color-text-inverted)',
                borderRadius: 'var(--radius-md)',
                padding: 'var(--space-1.5) var(--space-4)',
                fontSize: 'var(--text-xs)',
                fontWeight: 'var(--weight-bold)',
                cursor: running ? 'default' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-1.5)',
                transition: 'filter var(--duration-fast)'
              }}
              onMouseEnter={e => (e.currentTarget.style.filter = 'brightness(1.1)')}
              onMouseLeave={e => (e.currentTarget.style.filter = 'none')}
            >
              {running ? 'Creating Backup...' : 'Backup Database Now'}
            </button>
          </div>

          {backups.length === 0 ? (
            <div style={{ padding: 'var(--space-6) 0', textAlign: 'center', color: 'var(--color-text-faint)', fontSize: 'var(--text-xs)' }}>
              No database backups created yet. Click the button above to generate your first snapshot.
            </div>
          ) : (
            <div
              style={{
                border: '1px solid var(--color-surface-offset)',
                borderRadius: 'var(--radius-md)',
                overflow: 'hidden',
                background: 'var(--color-surface-1)'
              }}
            >
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-xs)', textAlign: 'left' }}>
                <thead>
                  <tr style={{ background: 'var(--color-surface-2)', borderBottom: '1px solid var(--color-surface-offset)', color: 'var(--color-text-muted)' }}>
                    <th style={{ padding: 'var(--space-3) var(--space-4)' }}>Archive File</th>
                    <th style={{ padding: 'var(--space-3) var(--space-4)' }}>Date Created</th>
                    <th style={{ padding: 'var(--space-3) var(--space-4)', textAlign: 'right' }}>Compressed Size</th>
                    <th style={{ padding: 'var(--space-3) var(--space-4)', textAlign: 'center', width: '150px' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {backups.map(b => (
                    <tr key={b.filename} style={{ borderBottom: '1px solid var(--color-surface-offset)', color: 'var(--color-text-base)' }}>
                      <td style={{ padding: 'var(--space-2.5) var(--space-4)', fontFamily: 'var(--font-mono)', fontSize: '11px' }}>
                        {b.filename}
                        {b.kind === 'preRestore' && (
                          <span
                            title="Taken automatically just before a restore, so the restore can be undone."
                            style={{
                              marginLeft: 'var(--space-2)',
                              padding: '1px 6px',
                              borderRadius: 'var(--radius-full, 999px)',
                              background: 'var(--color-surface-2)',
                              color: 'var(--color-text-muted)',
                              fontFamily: 'var(--font-sans)',
                              fontSize: '9px',
                              whiteSpace: 'nowrap'
                            }}
                          >
                            before a restore
                          </span>
                        )}
                      </td>
                      <td style={{ padding: 'var(--space-2.5) var(--space-4)', color: 'var(--color-text-muted)' }}>
                        {new Date(b.timestamp).toLocaleString()}
                      </td>
                      <td style={{ padding: 'var(--space-2.5) var(--space-4)', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                        {formatSize(b.size)}
                      </td>
                      <td style={{ padding: 'var(--space-2.5) var(--space-4)', display: 'flex', gap: 'var(--space-2)', justifyContent: 'center' }}>
                        <button
                          onClick={() => handleRestore(b.filename)}
                          disabled={restoring !== null}
                          style={{
                            background: 'var(--color-primary-muted)',
                            border: '1px solid var(--color-primary)',
                            color: 'var(--color-text-base)',
                            padding: '2px 8px',
                            borderRadius: 'var(--radius-sm)',
                            cursor: restoring !== null ? 'default' : 'pointer',
                            fontSize: '10px'
                          }}
                        >
                          {restoring === b.filename ? 'Restoring...' : 'Restore'}
                        </button>
                        <button
                          onClick={() => handleDelete(b.filename)}
                          disabled={restoring !== null}
                          style={{
                            background: 'transparent',
                            border: '1px solid var(--color-surface-offset)',
                            color: 'var(--color-error)',
                            padding: '2px 8px',
                            borderRadius: 'var(--radius-sm)',
                            cursor: restoring !== null ? 'default' : 'pointer',
                            fontSize: '10px'
                          }}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

    </div>
  )
}

function StorageSettings() {
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [pruning, setPruning] = useState(false)
  const [storageInfo, setStorageInfo] = useState<{ fileCount: number; totalSize: number; path: string } | null>(null)
  const [prunedResult, setPrunedResult] = useState<{
    prunedCount: number
    spaceSavedBytes: number
    prunedFiles: string[]
  } | null>(null)

  const loadStorageInfo = async () => {
    setLoading(true)
    try {
      const info = await window.electronAPI.media.getStorageInfo()
      setStorageInfo(info)
    } catch (err) {
      console.error('Failed to load storage info:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadStorageInfo()
  }, [])

  const handlePrune = async () => {
    setPruning(true)
    try {
      const res = await window.electronAPI.media.scanAndPrune()
      setPrunedResult({
        prunedCount: res.prunedCount,
        spaceSavedBytes: res.spaceSavedBytes,
        prunedFiles: res.prunedFiles
      })
      toast(`Successfully pruned ${res.prunedCount} orphaned files!`)
      loadStorageInfo()
    } catch (err) {
      console.error('Failed to prune media:', err)
      toast('Failed to prune media vault')
    } finally {
      setPruning(false)
    }
  }

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    const kb = bytes / 1024
    if (kb < 1024) return `${kb.toFixed(1)} KB`
    const mb = kb / 1024
    return `${mb.toFixed(1)} MB`
  }

  if (loading && !storageInfo) {
    return <div style={{ color: 'var(--color-text-faint)', fontSize: 'var(--text-sm)', padding: 'var(--space-4) 0' }}>Loading storage statistics…</div>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      <div style={{ background: 'var(--color-surface-1)', border: '1px solid var(--color-surface-offset)', borderRadius: 'var(--radius-md)', padding: 'var(--space-4)' }}>
        <ExportPanel />
      </div>

      <div style={{ background: 'var(--color-surface-1)', border: '1px solid var(--color-surface-offset)', borderRadius: 'var(--radius-md)', padding: 'var(--space-4)' }}>
        <div style={{ fontSize: 'var(--text-xs)', textTransform: 'uppercase', color: 'var(--color-text-faint)', fontWeight: 'var(--weight-bold)', marginBottom: 'var(--space-3)' }}>
          Media Vault Statistics
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span style={{ fontSize: '10px', color: 'var(--color-text-muted)' }}>Files count</span>
            <span style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-secondary)' }}>
              {storageInfo?.fileCount ?? 0}
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span style={{ fontSize: '10px', color: 'var(--color-text-muted)' }}>Active disk size</span>
            <span style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-secondary)' }}>
              {formatSize(storageInfo?.totalSize ?? 0)}
            </span>
          </div>
        </div>
        <div style={{ borderTop: '1px solid var(--color-surface-offset)', marginTop: 'var(--space-4)', paddingTop: 'var(--space-3)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <span style={{ fontSize: '10px', color: 'var(--color-text-muted)' }}>Vault Directory Path</span>
          <span style={{ fontSize: '11px', fontFamily: 'var(--font-mono)', color: 'var(--color-text-base)', wordBreak: 'break-all' }}>
            {storageInfo?.path ?? ''}
          </span>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'var(--space-2)' }}>
        <div style={{ flex: 1, paddingRight: 'var(--space-4)' }}>
          <div style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)', color: 'var(--color-text-base)' }}>
            Prune Orphaned Media
          </div>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-faint)', marginTop: '2px', maxWidth: '380px', lineHeight: 1.4 }}>
            Scans all logs, backlog tasks, and markdown notes for media references. Files in the media vault that are no longer linked are permanently deleted.
          </div>
        </div>
        <button
          onClick={handlePrune}
          disabled={pruning || storageInfo?.fileCount === 0}
          style={{
            background: storageInfo?.fileCount === 0 ? 'var(--color-surface-offset)' : 'var(--color-secondary)',
            border: 'none',
            color: storageInfo?.fileCount === 0 ? 'var(--color-text-muted)' : 'var(--color-text-inverted)',
            borderRadius: 'var(--radius-md)',
            padding: 'var(--space-2) var(--space-4)',
            fontSize: 'var(--text-xs)',
            fontWeight: 'var(--weight-bold)',
            cursor: pruning || storageInfo?.fileCount === 0 ? 'default' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-1.5)',
            transition: 'filter var(--duration-fast)',
            flexShrink: 0
          }}
          onMouseEnter={e => { if (storageInfo?.fileCount !== 0) e.currentTarget.style.filter = 'brightness(1.1)' }}
          onMouseLeave={e => { e.currentTarget.style.filter = 'none' }}
        >
          {pruning ? 'Cleaning up...' : 'Scan & Prune Vault'}
        </button>
      </div>

      {prunedResult && prunedResult.prunedCount > 0 && (
        <div style={{
          border: '1px solid var(--color-surface-offset)',
          borderRadius: 'var(--radius-md)',
          background: 'var(--color-surface-2)',
          padding: 'var(--space-4)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-2)'
        }}>
          <div style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text-base)', display: 'flex', justifyContent: 'space-between' }}>
            <span>Cleanup Report</span>
            <span style={{ color: 'var(--color-secondary)' }}>Saved {formatSize(prunedResult.spaceSavedBytes)}</span>
          </div>
          <div style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>
            Successfully deleted {prunedResult.prunedCount} orphaned image files:
          </div>
          <ul style={{ margin: 0, paddingLeft: 'var(--space-4)', fontSize: '10px', fontFamily: 'var(--font-mono)', color: 'var(--color-text-faint)', maxHeight: '100px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '2px' }} className="custom-scrollbar">
            {prunedResult.prunedFiles.map(file => (
              <li key={file}>{file}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

