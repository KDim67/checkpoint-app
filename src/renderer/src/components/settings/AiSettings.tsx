import { useState, useEffect, useRef } from 'react'
import { CheckCircle, AlertCircle, RefreshCw, Plus, Trash2, Mail, Cloud, Server, Plug, Brain } from 'lucide-react'
import SettingsSection, { FieldRow, SettingsInput, SettingsSelect } from './SettingsSection'
import { useToast } from '../ui/Toast'
import { getNumberSetting } from '../../lib/settings'
import { loadProviders, persistProviders, activateProvider, saveProviderKey, providerFromPreset, isLocalUrl, PROVIDER_PRESETS, type AiProvider, type ProviderPreset } from '../ai/aiProviders'
import type { AiProviderInput } from '../../../../shared/aiProviders'
import { loadEmailSamples, saveEmailSamples, type EmailSample } from '../../lib/emailSamples'
import { MAX_EMAIL_SAMPLES } from '../../../../shared/emailSamples'
import * as aiApi from '../../data/ai'
import { setSetting } from '../../data/settings'
import MemoryVaultManager from './MemoryVaultManager'
import { useAppStore } from '../../store/appStore'
import { workspaceName } from '../../lib/createWorkspace'

export default function AiSettings() {
  const { toast } = useToast()
  const [baseURL, setBaseURL] = useState('http://localhost:11434/v1')
  // a key being typed; a saved one never comes back from main
  const [keyDraft, setKeyDraft] = useState('')
  const [model, setModel] = useState('llama3')
  const [temperature, setTemperature] = useState(0.7)
  const [maxTokens, setMaxTokens] = useState(2048)
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle')
  const [connectionError, setConnectionError] = useState('')

  // the active one is mirrored into the flat settings
  const [providers, setProviders] = useState<AiProvider[]>([])
  const [activeId, setActiveId] = useState<string>('')
  const [showPresetMenu, setShowPresetMenu] = useState(false)
  const presetMenuRef = useRef<HTMLDivElement>(null)
  const addProviderRef = useRef<HTMLButtonElement>(null)
  const activeWorkspace = useAppStore(s => s.activeWorkspace)
  const workspaceList = useAppStore(s => s.workspaceList)

  const [emailSamples, setEmailSamples] = useState<EmailSample[]>([
    { id: 'sample_1', title: 'Sample email 1', body: '' }
  ])

  // the list of providers to add closes on Escape or a click anywhere else, as menus do
  useEffect(() => {
    if (!showPresetMenu) return
    const onPointer = (event: MouseEvent): void => {
      if (!presetMenuRef.current?.contains(event.target as Node)) setShowPresetMenu(false)
    }
    window.addEventListener('mousedown', onPointer)
    return () => window.removeEventListener('mousedown', onPointer)
  }, [showPresetMenu])

  useEffect(() => {
    const load = async () => {
      try {
        // migrates old flat settings on first run
        const { providers: provs, activeId: active } = await loadProviders()
        setProviders(provs)
        setActiveId(active)
        const activeProv = provs.find(p => p.id === active)
        if (activeProv) {
          setBaseURL(activeProv.baseURL)
          setModel(activeProv.model)
        }

        // as numbers: temperature 0 is valid and used to revert
        setTemperature(await getNumberSetting('ai_temperature', 0.7))
        setMaxTokens(await getNumberSetting('ai_max_tokens', 2048))
        const samples = await loadEmailSamples()
        if (samples.length > 0) setEmailSamples(samples)
      } catch (err) { console.error('Failed to load AI settings:', err) }
    }
    load()
  }, [])

  /** a rejected write used to leave the control showing a value that never saved */
  const save = (key: string, val: string | number): void => {
    setSetting(key, val).catch(err => {
      console.error(`Failed to save ${key}:`, err)
      toast(`Could not save that setting, ${err?.message || 'unknown error'}. Try again.`)
    })
  }

  const activeProvider = providers.find(p => p.id === activeId) || null

  // the AI panel reloads the active provider
  const notifyProviderChanged = (): void => {
    window.dispatchEvent(new CustomEvent('checkpoint-ai-provider-changed'))
  }

  const updateActiveProvider = (patch: Partial<AiProviderInput>) => {
    if (!activeId) return
    const next = providers.map(p => (p.id === activeId ? { ...p, ...patch } : p))
    setProviders(next)
    persistProviders(next, activeId).then(saved => {
      // an address on another site forgets the key, and the field should say so
      if (saved) setProviders(saved.providers)
      notifyProviderChanged()
    })
  }

  const handleKeyBlur = (): void => {
    const key = keyDraft.trim()
    if (!activeId || !key) return
    saveProviderKey(activeId, key).then(saved => {
      if (!saved) {
        toast('Could not save the key. Try again.')
        return
      }
      setProviders(saved.providers)
      setKeyDraft('')
      notifyProviderChanged()
    })
  }

  const handleSwitchProvider = async (id: string) => {
    const p = providers.find(x => x.id === id)
    if (!p) return
    setActiveId(id)
    setBaseURL(p.baseURL); setKeyDraft(''); setModel(p.model)
    setConnectionStatus('idle'); setConnectionError('')
    await activateProvider(id)
    notifyProviderChanged()
  }

  const handleAddPreset = async (preset: ProviderPreset) => {
    const p = providerFromPreset(preset)
    const next = [...providers, p]
    setProviders(next)
    setActiveId(p.id)
    setBaseURL(p.baseURL); setKeyDraft(''); setModel(p.model)
    setShowPresetMenu(false)
    setConnectionStatus('idle'); setConnectionError('')
    const saved = await persistProviders(next, p.id)
    if (saved) setProviders(saved.providers)
    notifyProviderChanged()
  }

  const handleDeleteProvider = async () => {
    if (providers.length <= 1) return
    const next = providers.filter(p => p.id !== activeId)
    const newActive = next[0].id
    setProviders(next)
    setActiveId(newActive)
    setBaseURL(next[0].baseURL); setKeyDraft(''); setModel(next[0].model)
    setConnectionStatus('idle'); setConnectionError('')
    const saved = await persistProviders(next, newActive)
    if (saved) setProviders(saved.providers)
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
      title: `Sample email ${emailSamples.length + 1}`,
      body: ''
    }
    handleUpdateSamples([...emailSamples, newSample])
  }

  const handleRemoveSample = (id: string) => {
    if (emailSamples.length <= 1) {
      handleUpdateSamples([{ id: `sample_${Date.now()}`, title: 'Sample email 1', body: '' }])
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
      const res = await aiApi.testConnection(baseURL, activeId)
      if (res.success) {
        setConnectionStatus('success')
      } else {
        setConnectionStatus('error')
        setConnectionError(res.error || 'The provider did not answer.')
      }
    } catch (err) {
      setConnectionStatus('error')
      setConnectionError((err as Error).message || 'The check could not run.')
    }
  }

  return (
    <>
      <SettingsSection icon={<Plug size={14} />} title="Connection" description="Where the assistant's model runs, and how it answers.">
        <div className="col-lg">
          {/* several connections, switch between them */}
          <FieldRow label="Provider" hint="Each one keeps its own address, key and model.">
            <div
              ref={presetMenuRef}
              style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', position: 'relative', width: '100%' }}
              onKeyDown={event => {
                if (event.key === 'Escape' && showPresetMenu) {
                  event.preventDefault()
                  setShowPresetMenu(false)
                  // the list held the keyboard, so it goes back to the button that opened it
                  addProviderRef.current?.focus()
                }
              }}
            >
              <SettingsSelect
                value={activeId}
                onChange={e => handleSwitchProvider(e.target.value)}
                style={{ flex: 1, minWidth: 0 }}
              >
                {providers.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name}{isLocalUrl(p.baseURL) ? ', on this computer' : ', online'}
                  </option>
                ))}
              </SettingsSelect>
              <button
                ref={addProviderRef}
                type="button"
                className="btn-secondary btn-small"
                aria-expanded={showPresetMenu}
                onClick={() => setShowPresetMenu(v => !v)}
              >
                <Plus size={13} aria-hidden="true" /> Add
              </button>
              <button
                type="button"
                className="btn-icon hover-text-error"
                onClick={handleDeleteProvider}
                disabled={providers.length <= 1}
                aria-label="Delete this provider"
                title={providers.length <= 1 ? 'Keep at least one provider' : 'Delete this provider'}
              >
                <Trash2 size={14} aria-hidden="true" />
              </button>

              {showPresetMenu && (
                <div
                  className="motion-drop"
                  aria-label="Providers to add"
                  style={{ position: 'absolute', top: 'calc(100% + var(--space-1))', right: 0, zIndex: 30, background: 'var(--color-surface-elevated)', border: '1px solid var(--color-surface-offset)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg)', overflow: 'hidden', minWidth: '16rem' }}
                >
                  {PROVIDER_PRESETS.map((preset, index) => (
                    <button
                      key={preset.id}
                      type="button"
                      // the list opens on what it offers, the keyboard already in it
                      autoFocus={index === 0}
                      onClick={() => handleAddPreset(preset)}
                      className="bg-clear hover-bg-offset"
                      style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-0-5)', width: '100%', textAlign: 'left', border: 'none', borderBottom: '1px solid var(--color-surface-offset)', padding: 'var(--space-2) var(--space-3)', cursor: 'pointer' }}
                    >
                      <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1-5)', fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text-base)' }}>
                        {preset.local ? <Server size={13} aria-hidden="true" /> : <Cloud size={13} aria-hidden="true" />}
                        {preset.name}
                      </span>
                      <span className="text-sub">{preset.hint}</span>
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
              inputMode="url"
            />
          </FieldRow>
          <FieldRow
            label="API key"
            hint={activeProvider?.hasKey ? 'Kept encrypted on this computer and never shown again. Moving the address to another site forgets it.' : undefined}
          >
            <SettingsInput
              type="password"
              value={keyDraft}
              onChange={setKeyDraft}
              onBlur={handleKeyBlur}
              placeholder={activeProvider?.hasKey ? 'Saved. Type a new key to replace it' : isLocalUrl(baseURL) ? 'Not needed for a local server' : 'Cloud API key'}
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

          <FieldRow label="Max tokens" hint="The longest answer, between 1 and 200,000. Saved when you leave the field.">
            <SettingsInput
              type="number"
              inputMode="numeric"
              min={1}
              max={200000}
              value={maxTokens}
              // clamped on blur; per-keystroke fights the user, and 0 tokens fails generation
              onChange={v => setMaxTokens(parseInt(v, 10) || 0)}
              onBlur={() => {
                const clamped = Math.min(200000, Math.max(1, maxTokens || 2048))
                setMaxTokens(clamped)
                save('ai_max_tokens', clamped)
              }}
            />
          </FieldRow>

          {/* the check sits with the details it checks */}
          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
            <button
              type="button"
              className="btn-secondary btn-with-icon"
              onClick={handleTest}
              disabled={connectionStatus === 'testing'}
            >
              <RefreshCw size={13} aria-hidden="true" className={connectionStatus === 'testing' ? 'animate-spin' : undefined} />
              {connectionStatus === 'testing' ? 'Testing…' : 'Test connection'}
            </button>
            <div role="status" className="col-2px">
              {connectionStatus === 'success' && (
                <span className="text-hint" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', color: 'var(--color-success)' }}>
                  <CheckCircle size={14} aria-hidden="true" />
                  Connected
                </span>
              )}
              {connectionStatus === 'error' && (
                <>
                  <span className="text-hint" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', color: 'var(--color-error)' }}>
                    <AlertCircle size={14} aria-hidden="true" />
                    Couldn't connect
                  </span>
                  {connectionError && <span className="text-sub">{connectionError}</span>}
                </>
              )}
            </div>
          </div>
        </div>
      </SettingsSection>

      <SettingsSection icon={<Mail size={14} />} title="Email voice" description="Emails you wrote, so the drafts it writes sound like you.">
        <div className="col-md">
          <div className="row-between-gap" style={{ flexWrap: 'wrap' }}>
            <p className="text-sub" style={{ margin: 0, flex: '1 1 16rem' }}>
              Paste up to {MAX_EMAIL_SAMPLES}. Drafts follow their tone, length and the way they open and close.
            </p>
            {emailSamples.length < MAX_EMAIL_SAMPLES && (
              <button type="button" className="btn-secondary btn-small" onClick={handleAddSample}>
                <Plus size={12} aria-hidden="true" />
                Add a sample ({emailSamples.length} of {MAX_EMAIL_SAMPLES})
              </button>
            )}
          </div>

          <ul className="settings-list" aria-label="Email samples">
            {emailSamples.map((sample, idx) => (
              <li key={sample.id} className="settings-list-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                <div className="row-between-gap">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flex: 1, minWidth: 0 }}>
                    <Mail size={14} className="text-accent" aria-hidden="true" />
                    <input
                      type="text"
                      value={sample.title}
                      onChange={e => handleSampleChange(sample.id, 'title', e.target.value)}
                      placeholder={`Sample ${idx + 1}`}
                      aria-label={`Name of sample ${idx + 1}`}
                      className="input-md"
                      style={{ flex: 1, minWidth: 0, background: 'transparent', fontWeight: 'var(--weight-semibold)' }}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemoveSample(sample.id)}
                    className="btn-icon hover-text-error"
                    aria-label={`Remove ${sample.title || `sample ${idx + 1}`}`}
                    title="Remove this sample"
                  >
                    <Trash2 size={14} aria-hidden="true" />
                  </button>
                </div>

                <textarea
                  value={sample.body}
                  onChange={e => handleSampleChange(sample.id, 'body', e.target.value)}
                  placeholder="Paste an email you wrote…"
                  aria-label={`Text of ${sample.title || `sample ${idx + 1}`}`}
                  rows={4}
                  className="input-md"
                  style={{
                    width: '100%',
                    background: 'var(--color-surface-2)',
                    lineHeight: 'var(--leading-normal)',
                    resize: 'vertical',
                    fontFamily: 'inherit'
                  }}
                />
              </li>
            ))}
          </ul>
        </div>
      </SettingsSection>

      <SettingsSection
        icon={<Brain size={14} />}
        title="Memory"
        description={`Facts the assistant keeps for ${workspaceName(activeWorkspace, workspaceList)}, and uses in every chat there.`}
      >
        <MemoryVaultManager />
      </SettingsSection>
    </>
  )
}
