import React, { useState, useEffect, useCallback } from 'react'
import { Check, Plus, Trash2, X } from 'lucide-react'
import { useToast } from '../ui/Toast'
import {
  BUILT_IN_PRESETS,
  createPreset,
  normalizePresets,
  presetMatches,
  type ThemePreset,
  type ThemeVariables
} from '../../../../shared/themePresets'
import { getStringSetting, setJsonSetting } from '../../lib/settings'

const PRESETS_SETTING_KEY = 'customizer_theme_presets'

/** enough to recognise a theme at a glance */
const SWATCH_KEYS: (keyof ThemeVariables)[] = [
  '--color-background',
  '--color-surface-1',
  '--color-primary',
  '--color-secondary',
  '--color-text-base'
]

interface Props {
  /** so a card can show active and Save can capture it */
  vars: ThemeVariables
  onApply: (vars: ThemeVariables) => void
}

export default function ThemePresets({ vars, onApply }: Props) {
  const { toast } = useToast()
  const [saved, setSaved] = useState<ThemePreset[]>([])
  const [naming, setNaming] = useState(false)
  const [draftName, setDraftName] = useState('')

  useEffect(() => {
    const load = async () => {
      try {
        setSaved(normalizePresets(await getStringSetting(PRESETS_SETTING_KEY, '')))
      } catch (err) {
        console.error('Failed to load theme presets:', err)
      }
    }
    load()
  }, [])

  const persist = useCallback(async (next: ThemePreset[]) => {
    setSaved(next)
    try {
      await setJsonSetting(PRESETS_SETTING_KEY, next)
    } catch (err) {
      console.error('Failed to save theme presets:', err)
      toast('Could not save presets')
    }
  }, [toast])

  const handleSave = async () => {
    // built-ins count, two "Midnight" cards are indistinguishable
    const result = createPreset(draftName, vars, [...BUILT_IN_PRESETS, ...saved], Date.now())
    if ('error' in result) {
      toast(result.error)
      return
    }
    await persist([...saved, result.preset])
    setNaming(false)
    setDraftName('')
    toast(`Saved "${result.preset.name}"`)
  }

  const handleDelete = async (preset: ThemePreset) => {
    await persist(saved.filter(p => p.id !== preset.id))
    toast(`Deleted "${preset.name}"`)
  }

  const all = [...BUILT_IN_PRESETS, ...saved]

  return (
    <div className="col-md">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h4 className="heading-caps">
          Presets
        </h4>

        {!naming && (
          <button type="button" className="btn-secondary btn-small" onClick={() => setNaming(true)}>
            <Plus size={12} aria-hidden="true" />
            Save current as a preset
          </button>
        )}
      </div>

      {naming && (
        <div className="row">
          <input
            autoFocus
            value={draftName}
            onChange={e => setDraftName(e.target.value)}
            // electron has no window.prompt; Enter saves, Escape cancels
            onKeyDown={e => {
              if (e.key === 'Enter') handleSave()
              if (e.key === 'Escape') { setNaming(false); setDraftName('') }
            }}
            placeholder="Preset name"
            aria-label="Preset name"
            className="input-md"
            style={{ flex: 1, background: 'var(--color-surface-2)' }}
          />
          <button type="button" className="btn-primary btn-small" onClick={handleSave}>
            Save
          </button>
          <button
            type="button"
            className="btn-icon"
            onClick={() => { setNaming(false); setDraftName('') }}
            aria-label="Cancel saving the preset"
            title="Cancel"
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      )}

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
        gap: 'var(--space-2)'
      }}>
        {all.map(preset => {
          const active = presetMatches(preset, vars)
          return (
            <div
              key={preset.id}
              style={{
                position: 'relative',
                background: 'var(--color-surface-1)',
                border: `1px solid ${active ? 'var(--color-secondary)' : 'var(--color-surface-offset)'}`,
                borderRadius: 'var(--radius-md)',
                overflow: 'hidden'
              }}
            >
              <button
                type="button"
                onClick={() => onApply(preset.vars)}
                aria-pressed={active}
                title={`Apply ${preset.name}`}
                style={{
                  display: 'block',
                  width: '100%',
                  padding: 'var(--space-2) var(--space-3)',
                  background: 'transparent',
                  border: 'none',
                  textAlign: 'left',
                  cursor: 'pointer',
                  font: 'inherit'
                }}
              >
                <div aria-hidden="true" style={{ display: 'flex', gap: 'var(--space-0-5)', marginBottom: 'var(--space-2)' }}>
                  {SWATCH_KEYS.map(key => (
                    <span
                      key={key}
                      style={{
                        flex: 1,
                        height: 'var(--space-4)',
                        borderRadius: 'var(--radius-sm)',
                        background: preset.vars[key],
                        // near-black or near-white swatches vanish into the card otherwise
                        boxShadow: 'inset 0 0 0 1px rgba(128,128,128,0.25)'
                      }}
                    />
                  ))}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
                  {active && <Check size={12} className="icon-accent" aria-hidden="true" />}
                  <span style={{
                    fontSize: 'var(--text-xs)',
                    fontWeight: 'var(--weight-medium)',
                    color: active ? 'var(--color-secondary)' : 'var(--color-text-base)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}>
                    {preset.name}
                  </span>
                </div>
              </button>

              {!preset.builtIn && (
                <button
                  type="button"
                  onClick={() => handleDelete(preset)}
                  aria-label={`Delete ${preset.name}`}
                  title={`Delete ${preset.name}`}
                  className="text-muted hover-text-error"
                  style={{
                    position: 'absolute',
                    top: 'var(--space-1)',
                    right: 'var(--space-1)',
                    display: 'flex',
                    padding: 'var(--space-1)',
                    background: 'var(--color-surface-2)',
                    border: '1px solid var(--color-surface-offset)',
                    borderRadius: 'var(--radius-sm)',
                    cursor: 'pointer'
                  }}
                >
                  <Trash2 size={13} aria-hidden="true" />
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
