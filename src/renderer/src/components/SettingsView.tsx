import React, { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
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
  Mail
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
import ThemeCustomizer from './settings/ThemeCustomizer'
import HotkeyBinder from './settings/HotkeyBinder'
import ExtensionsTab from './settings/ExtensionsTab'
import { useToast } from './ui/Toast'
import { useAppStore } from '../store/appStore'

// Tab definition
type SettingsTab =
  | 'general'
  | 'contexts'
  | 'kanban'
  | 'ai'
  | 'appearance'
  | 'themeCustomizer'
  | 'hotkeyBinder'
  | 'extensions'
  | 'widget'
  | 'features'
  | 'backup'
  | 'about'

const TABS: { id: SettingsTab; label: string; icon: React.ReactNode }[] = [
  { id: 'general',          label: 'General',             icon: <Settings size={14} /> },
  { id: 'contexts',         label: 'Contexts',            icon: <Layers size={14} /> },
  { id: 'kanban',           label: 'Kanban',              icon: <Layout size={14} /> },
  { id: 'ai',               label: 'AI',                  icon: <Sparkles size={14} /> },
  { id: 'appearance',       label: 'Appearance',          icon: <Palette size={14} /> },
  { id: 'themeCustomizer',  label: 'Theme Builder',       icon: <Paintbrush size={14} /> },
  { id: 'hotkeyBinder',     label: 'Keyboard Shortcuts',  icon: <Keyboard size={14} /> },
  { id: 'extensions',       label: 'Extensions & Plugins',icon: <Boxes size={14} /> },
  { id: 'widget',           label: 'Widget',              icon: <Monitor size={14} /> },
  { id: 'features',         label: 'Feature Toggles',     icon: <Zap size={14} /> },
  { id: 'backup',           label: 'Database Backup',     icon: <Archive size={14} /> },
  { id: 'about',            label: 'About',               icon: <Info size={14} /> }
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
  // Track local (not-yet-saved) edits to column names separately
  const [localNames, setLocalNames] = useState<Record<string, string>>({})

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      try {
        const key = `kanban_columns_${activeContext}`
        const val = await window.electronAPI.db.getSetting(key)
        if (val) {
          const parsed = JSON.parse(val as string) as ColumnConfig[]
          setColumns(parsed)
          setLocalNames(Object.fromEntries(parsed.map(c => [c.id, c.name])))
        } else {
          const defaults: ColumnConfig[] = [
            { id: 'open',        name: 'Backlog',     wipLimit: null },
            { id: 'in_progress', name: 'In Progress', wipLimit: null },
            { id: 'in_review',   name: 'In Review',   wipLimit: null },
            { id: 'done',        name: 'Done',         wipLimit: null }
          ]
          setColumns(defaults)
          setLocalNames(Object.fromEntries(defaults.map(c => [c.id, c.name])))
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

interface EmailSample {
  id: string
  title: string
  body: string
}

function MemoryVaultManager() {
  const activeContext = useAppStore(s => s.activeContext)
  const [memories, setMemories] = useState<any[]>([])
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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
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
  const [baseURL, setBaseURL] = useState('http://localhost:11434/v1')
  const [apiKey, setApiKey] = useState('ollama')
  const [model, setModel] = useState('llama3')
  const [temperature, setTemperature] = useState(0.7)
  const [maxTokens, setMaxTokens] = useState(2048)
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle')
  const [connectionError, setConnectionError] = useState('')

  const [emailSamples, setEmailSamples] = useState<EmailSample[]>(() => {
    try {
      const stored = localStorage.getItem('checkpoint_email_writing_samples')
      if (stored) return JSON.parse(stored)
      const legacy = localStorage.getItem('checkpoint_email_writing_style')
      if (legacy) {
        return [{ id: 'sample_1', title: 'Sample Email 1', body: legacy }]
      }
    } catch {}
    return [{ id: 'sample_1', title: 'Sample Email 1', body: '' }]
  })

  useEffect(() => {
    const load = async () => {
      try {
        const dbBaseUrl  = await window.electronAPI.db.getSetting('ai_base_url')
        const dbApiKey   = await window.electronAPI.db.getSetting('ai_api_key')
        const dbModel    = await window.electronAPI.db.getSetting('ai_model')
        const dbTemp     = await window.electronAPI.db.getSetting('ai_temperature')
        const dbMaxToks  = await window.electronAPI.db.getSetting('ai_max_tokens')
        const dbSamples  = await window.electronAPI.db.getSetting('ai_email_writing_samples')
        if (dbBaseUrl)  setBaseURL(dbBaseUrl as string)
        if (dbApiKey)   setApiKey(dbApiKey as string)
        if (dbModel)    setModel(dbModel as string)
        if (dbTemp)     setTemperature(Number(dbTemp))
        if (dbMaxToks)  setMaxTokens(Number(dbMaxToks))
        if (dbSamples) {
          try {
            const parsed = JSON.parse(dbSamples as string)
            if (Array.isArray(parsed) && parsed.length > 0) {
              setEmailSamples(parsed)
              localStorage.setItem('checkpoint_email_writing_samples', dbSamples as string)
            }
          } catch {}
        }
      } catch (err) { console.error('Failed to load AI settings:', err) }
    }
    load()
  }, [])

  const save = (key: string, val: string | number) =>
    window.electronAPI.db.setSetting(key, val)

  const handleUpdateSamples = (updated: EmailSample[]) => {
    const capped = updated.slice(0, 5)
    setEmailSamples(capped)
    const str = JSON.stringify(capped)
    try {
      localStorage.setItem('checkpoint_email_writing_samples', str)
      // Also sync first sample body to legacy key for compatibility
      if (capped.length > 0) {
        localStorage.setItem('checkpoint_email_writing_style', capped[0].body)
      }
    } catch {}
    save('ai_email_writing_samples', str)
  }

  const handleAddSample = () => {
    if (emailSamples.length >= 5) return
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

// General Settings
function GeneralSettings() {
  const activeContext = useAppStore(s => s.activeContext)
  const availableContexts = useAppStore(s => s.availableContexts)
  const setContext = useAppStore(s => s.setContext)

  const [theme, setTheme] = useState<'dark' | 'light' | 'system'>('dark')
  const [defaultContext, setDefaultContext] = useState<string>('default')

  useEffect(() => {
    const load = async () => {
      const t = await window.electronAPI.db.getSetting('app_theme')
      if (t) setTheme(t as typeof theme)

      const dc = await window.electronAPI.db.getSetting('default_context')
      if (dc) setDefaultContext(dc)
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
  const activeTab = useAppStore(s => s.settingsTab)
  const setActiveTab = useAppStore(s => s.setSettingsTab)
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
      case 'themeCustomizer': return <ThemeCustomizer />
      case 'hotkeyBinder': return <HotkeyBinder />
      case 'extensions': return <ExtensionsTab />
      case 'widget':     return <WidgetSettings />
      case 'features':   return <FeatureToggleCenter />
      case 'backup':     return <BackupSettings />
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
        minHeight: 0,
        height: '100%',
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

// Database Backup Settings Section
function BackupSettings() {
  const { toast } = useToast()
  const [enabled, setEnabled] = useState(true)
  const [interval, setIntervalVal] = useState('daily')
  const [maxCount, setMaxCount] = useState(10)
  const [customPath, setCustomPath] = useState('')
  const [backups, setBackups] = useState<{ filename: string; timestamp: number; size: number }[]>([])

  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [restoring, setRestoring] = useState<string | null>(null)

  const [confirmRestoreFile, setConfirmRestoreFile] = useState<string | null>(null)

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
    setConfirmRestoreFile(null)
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
        <ToggleSwitch checked={enabled} onChange={handleToggle} />
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
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
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
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
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
                      </td>
                      <td style={{ padding: 'var(--space-2.5) var(--space-4)', color: 'var(--color-text-muted)' }}>
                        {new Date(b.timestamp).toLocaleString()}
                      </td>
                      <td style={{ padding: 'var(--space-2.5) var(--space-4)', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                        {formatSize(b.size)}
                      </td>
                      <td style={{ padding: 'var(--space-2.5) var(--space-4)', display: 'flex', gap: 'var(--space-2)', justifyContent: 'center' }}>
                        <button
                          onClick={() => setConfirmRestoreFile(b.filename)}
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

      {confirmRestoreFile && createPortal(
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(4px)',
            zIndex: 11000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 'var(--space-4)'
          }}
        >
          <div
            style={{
              background: 'var(--color-surface-1)',
              border: '1px solid var(--color-surface-offset)',
              borderRadius: 'var(--radius-lg)',
              width: '100%',
              maxWidth: '420px',
              padding: 'var(--space-6)',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)',
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-4)'
            }}
          >
            <h3 style={{ margin: 0, fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text-base)' }}>
              Confirm Database Restore
            </h3>
            <p style={{ margin: 0, fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
              Are you sure you want to restore <strong style={{ color: 'var(--color-secondary)', fontFamily: 'var(--font-mono)' }}>{confirmRestoreFile}</strong>?
            </p>
            <div
              style={{
                fontSize: '11px',
                color: 'var(--color-warning)',
                background: 'var(--color-warning-muted)',
                border: '1px solid var(--color-warning)',
                padding: 'var(--space-3)',
                borderRadius: 'var(--radius-md)',
                lineHeight: 1.4
              }}
            >
              ⚠️ <strong>Warning:</strong> This will overwrite your current active database! To prevent data loss, a safety backup of your current database will be automatically created first.
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-3)', marginTop: 'var(--space-2)' }}>
              <button
                onClick={() => setConfirmRestoreFile(null)}
                style={{
                  background: 'transparent',
                  border: '1px solid var(--color-surface-offset)',
                  color: 'var(--color-text-base)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '6px 12px',
                  fontSize: 'var(--text-xs)',
                  cursor: 'pointer'
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => handleRestore(confirmRestoreFile)}
                style={{
                  background: 'var(--color-error)',
                  border: 'none',
                  color: 'white',
                  borderRadius: 'var(--radius-sm)',
                  padding: '6px 12px',
                  fontSize: 'var(--text-xs)',
                  fontWeight: 'var(--weight-bold)',
                  cursor: 'pointer'
                }}
              >
                Yes, Restore Database
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
