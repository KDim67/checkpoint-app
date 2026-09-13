import { useState, useEffect } from 'react'
import { CheckCircle, AlertCircle, RefreshCw, Plus, Trash2, Mail, ChevronDown, Cloud, Server } from 'lucide-react'
import { FieldRow, SettingsInput, Divider } from './SettingsSection'
import { useToast } from '../ui/Toast'
import { getNumberSetting } from '../../lib/settings'
import { loadProviders, persistProviders, activateProvider, providerFromPreset, isLocalUrl, PROVIDER_PRESETS, type AiProvider, type ProviderPreset } from '../ai/aiProviders'
import { loadEmailSamples, saveEmailSamples, type EmailSample } from '../../lib/emailSamples'
import { MAX_EMAIL_SAMPLES } from '../../../../shared/emailSamples'
import * as aiApi from '../../data/ai'
import { setSetting } from '../../data/settings'
import MemoryVaultManager from './MemoryVaultManager'

// AI Settings
export default function AiSettings() {
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

        // Read as numbers rather than tested for truthiness: temperature 0 is a
        // valid and meaningful setting, and choosing it used to revert to the
        // default on reopen.
        setTemperature(await getNumberSetting('ai_temperature', 0.7))
        setMaxTokens(await getNumberSetting('ai_max_tokens', 2048))
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
    setSetting(key, val).catch(err => {
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
      const res = await aiApi.testConnection(baseURL, apiKey)
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
    <div className="col-lg">
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
          className="range-accent"
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
          <div className="text-label-xs-semibold">
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

        <div className="col-md">
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
              <div className="row-between-gap">
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flex: 1 }}>
                  <Mail size={12} className="text-accent" />
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
            <RefreshCw size={12} className="animate-spin" />
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
              <span className="text-micro-faint">{connectionError}</span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
