import React, { useEffect, useState } from 'react'
import { KeyRound } from 'lucide-react'
import ModalShell from '../ui/ModalShell'
import * as customizerApi from '../../data/customizer'
import type { PluginInfo } from '../../../../shared/types'
import type { PluginSettingState, PluginSettingValue } from '../../../../shared/pluginSettings'

interface Props {
  plugin: PluginInfo
  onClose: () => void
  onSaved: () => void
}

/** text that the field holds while you edit; a secret starts empty and only a typed value replaces it */
type Draft = Record<string, string | boolean>

const draftOf = (fields: PluginSettingState[]): Draft =>
  Object.fromEntries(fields.map(f => [f.key, f.type === 'boolean' ? f.value === true : f.type === 'secret' ? '' : f.value === null ? '' : String(f.value)]))

/** the fields a plugin asks for; a saved secret is never shown, only replaced or cleared */
export default function PluginSettingsModal({ plugin, onClose, onSaved }: Props): React.JSX.Element {
  const [fields, setFields] = useState<PluginSettingState[] | null>(null)
  const [draft, setDraft] = useState<Draft>({})
  const [cleared, setCleared] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    customizerApi.getPluginSettings(plugin.filename).then(result => {
      if (!result.ok) {
        setError(result.error)
        return
      }
      setFields(result.fields)
      setDraft(draftOf(result.fields))
    }).catch(err => setError(err instanceof Error ? err.message : 'Could not read its settings.'))
  }, [plugin.filename])

  const save = async (): Promise<void> => {
    if (!fields) return
    const changes: Record<string, PluginSettingValue | null> = {}
    for (const field of fields) {
      const value = draft[field.key]
      if (field.type === 'secret') {
        // left empty means keep what is saved
        if (typeof value === 'string' && value !== '') changes[field.key] = value
        else if (cleared.has(field.key)) changes[field.key] = null
      } else if (field.type === 'boolean') {
        changes[field.key] = value === true
      } else {
        changes[field.key] = value === '' ? null : String(value)
      }
    }
    setSaving(true)
    try {
      const result = await customizerApi.savePluginSettings(plugin.filename, changes)
      if (!result.ok) {
        setError(result.error ?? 'Could not save its settings.')
        return
      }
      onSaved()
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <ModalShell label={`Settings for ${plugin.name}`} onClose={onClose} width="460px" closeOnBackdrop={false}>
      <div className="plugin-consent-head">
        <KeyRound size={20} className="plugin-consent-shield" />
        <div>
          <div className="plugin-consent-title">{plugin.name} settings</div>
          <div className="text-sub">Kept on this computer only, and encrypted. A saved secret is never shown again.</div>
        </div>
      </div>

      {fields === null && !error && <div className="text-sub">Reading its settings…</div>}

      {fields && (
        <form className="plugin-settings-form" onSubmit={e => { e.preventDefault(); void save() }}>
          {fields.map(field => {
            const id = `plugin-setting-${field.key}`
            const value = draft[field.key]
            return (
              <div key={field.key} className="plugin-setting">
                {field.type === 'boolean' ? (
                  <label className="plugin-consent-workspace" htmlFor={id}>
                    <input id={id} type="checkbox" checked={value === true} onChange={e => setDraft(d => ({ ...d, [field.key]: e.target.checked }))} />
                    <span>{field.label}</span>
                  </label>
                ) : (
                  <>
                    <label className="text-item" htmlFor={id}>{field.label}</label>
                    <div className="plugin-setting-input">
                      <input
                        id={id}
                        className="plugin-setting-field"
                        type={field.type === 'secret' ? 'password' : field.type === 'number' ? 'number' : 'text'}
                        autoComplete="off"
                        spellCheck={false}
                        value={typeof value === 'string' ? value : ''}
                        placeholder={field.type === 'secret'
                          ? (field.isSet && !cleared.has(field.key) ? 'Saved. Type to replace it.' : 'Not set')
                          : field.default !== null ? `Default: ${String(field.default)}` : ''}
                        onChange={e => setDraft(d => ({ ...d, [field.key]: e.target.value }))}
                      />
                      {field.type === 'secret' && field.isSet && !cleared.has(field.key) && (
                        <button type="button" className="btn-ghost" onClick={() => setCleared(c => new Set(c).add(field.key))}>
                          Clear
                        </button>
                      )}
                    </div>
                  </>
                )}
                {field.description && <div className="text-sub">{field.description}</div>}
              </div>
            )
          })}
        </form>
      )}

      {error && <div className="plugin-setting-error" role="alert">{error}</div>}

      <div className="plugin-consent-actions">
        <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
        <button type="button" className="btn-primary" disabled={!fields || saving} onClick={() => void save()}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </ModalShell>
  )
}
