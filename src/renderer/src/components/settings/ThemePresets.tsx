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

const PRESETS_SETTING_KEY = 'customizer_theme_presets'

/** The variables worth showing on a card. Enough to recognise a theme at a glance. */
const SWATCH_KEYS: (keyof ThemeVariables)[] = [
  '--color-background',
  '--color-surface-1',
  '--color-primary',
  '--color-secondary',
  '--color-text-base'
]

interface Props {
  /** The live variable set, so a card can show as active and Save can capture it. */
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
        const stored = await window.electronAPI.db.getSetting(PRESETS_SETTING_KEY)
        setSaved(normalizePresets(stored))
      } catch (err) {
        console.error('Failed to load theme presets:', err)
      }
    }
    load()
  }, [])

  const persist = useCallback(async (next: ThemePreset[]) => {
    setSaved(next)
    try {
      await window.electronAPI.db.setSetting(PRESETS_SETTING_KEY, next)
    } catch (err) {
      console.error('Failed to save theme presets:', err)
      toast('Could not save presets')
    }
  }, [toast])

  const handleSave = async () => {
    // Built-ins are included in the duplicate-name check: two entries called
    // "Midnight" would be indistinguishable on the cards.
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h4 style={{
          margin: 0,
          fontSize: 'var(--text-xs)',
          fontWeight: 'var(--weight-bold)',
          color: 'var(--color-text-faint)',
          textTransform: 'uppercase',
          letterSpacing: 'var(--tracking-wider)'
        }}>
          Presets
        </h4>

        {!naming && (
          <button
            onClick={() => setNaming(true)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-1)',
              padding: 'var(--space-1) var(--space-2)',
              background: 'var(--color-surface-2)',
              border: '1px solid var(--color-surface-offset)',
              color: 'var(--color-text-muted)',
              borderRadius: 'var(--radius-md)',
              fontSize: 'var(--text-xs)',
              cursor: 'pointer'
            }}
          >
            <Plus size={12} />
            Save current
          </button>
        )}
      </div>

      {naming && (
        <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
          <input
            autoFocus
            value={draftName}
            onChange={e => setDraftName(e.target.value)}
            // Electron has no window.prompt, so naming happens inline. Enter
            // saves and Escape cancels, which is what a prompt would have given.
            onKeyDown={e => {
              if (e.key === 'Enter') handleSave()
              if (e.key === 'Escape') { setNaming(false); setDraftName('') }
            }}
            placeholder="Preset name"
            aria-label="Preset name"
            style={{
              flex: 1,
              background: 'var(--color-surface-2)',
              border: '1px solid var(--color-surface-offset)',
              color: 'var(--color-text-base)',
              borderRadius: 'var(--radius-md)',
              padding: 'var(--space-1-5) var(--space-3)',
              fontSize: 'var(--text-xs)',
              outline: 'none'
            }}
          />
          <button
            onClick={handleSave}
            style={{
              padding: 'var(--space-1-5) var(--space-3)',
              background: 'var(--color-secondary-muted)',
              border: '1px solid var(--color-secondary)',
              color: 'var(--color-secondary)',
              borderRadius: 'var(--radius-md)',
              fontSize: 'var(--text-xs)',
              fontWeight: 'var(--weight-semibold)',
              cursor: 'pointer'
            }}
          >
            Save
          </button>
          <button
            onClick={() => { setNaming(false); setDraftName('') }}
            aria-label="Cancel saving preset"
            style={{
              display: 'flex',
              padding: 'var(--space-1-5)',
              background: 'transparent',
              border: '1px solid var(--color-surface-offset)',
              color: 'var(--color-text-muted)',
              borderRadius: 'var(--radius-md)',
              cursor: 'pointer'
            }}
          >
            <X size={14} />
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
                onClick={() => onApply(preset.vars)}
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
                <div style={{ display: 'flex', gap: '3px', marginBottom: 'var(--space-2)' }}>
                  {SWATCH_KEYS.map(key => (
                    <span
                      key={key}
                      style={{
                        flex: 1,
                        height: '18px',
                        borderRadius: '3px',
                        background: preset.vars[key],
                        // Without this a near-black or near-white swatch vanishes
                        // into the card it sits on.
                        boxShadow: 'inset 0 0 0 1px rgba(128,128,128,0.25)'
                      }}
                    />
                  ))}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
                  {active && <Check size={12} style={{ color: 'var(--color-secondary)', flexShrink: 0 }} />}
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
                  onClick={() => handleDelete(preset)}
                  aria-label={`Delete ${preset.name}`}
                  title={`Delete ${preset.name}`}
                  style={{
                    position: 'absolute',
                    top: 'var(--space-1)',
                    right: 'var(--space-1)',
                    display: 'flex',
                    padding: '3px',
                    background: 'var(--color-surface-2)',
                    border: '1px solid var(--color-surface-offset)',
                    color: 'var(--color-text-muted)',
                    borderRadius: '4px',
                    cursor: 'pointer'
                  }}
                  onMouseEnter={e => { e.currentTarget.style.color = 'var(--color-error)' }}
                  onMouseLeave={e => { e.currentTarget.style.color = 'var(--color-text-muted)' }}
                >
                  <Trash2 size={11} />
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
