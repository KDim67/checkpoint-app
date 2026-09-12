import React, { useState, useEffect } from 'react'
import { ToggleSwitch, Divider } from './SettingsSection'
import { useToast } from '../ui/Toast'
import ColorPicker from '../ui/ColorPicker'
import ThemePresets from './ThemePresets'
import {
  DEFAULT_THEME,
  THEME_VAR_NAMES,
  deriveThemeVars,
  type ThemeVariables
} from '../../../../shared/themePresets'
import * as customizerApi from '../../data/customizer'

const COLOR_VARIABLE_LABELS: Record<Exclude<keyof ThemeVariables, '--font-sans'>, { label: string; desc: string }> = {
  '--color-background': { label: 'Canvas Background', desc: 'Base color for the entire workspace background.' },
  '--color-surface-1': { label: 'Panel Base', desc: 'Background color for panels and main container cards.' },
  '--color-surface-2': { label: 'Input Fields', desc: 'Background color for form inputs and nested lists.' },
  '--color-surface-offset': { label: 'Hover States & Borders', desc: 'Visual divider line and list hover background.' },
  '--color-surface-elevated': { label: 'Context Menus & Tooltips', desc: 'Background color for popovers and tooltips.' },
  '--color-primary': { label: 'Primary Brand Color', desc: 'Brand Electric Blue used for links and focus borders.' },
  '--color-secondary': { label: 'Secondary Accent Color', desc: 'Brand Volt Lime used for highlight alerts and selections.' },
  '--color-balance': { label: 'Idle Icons & Outlines', desc: 'Sidebar icons at rest, card outlines, and neutral marks.' },
  '--color-text-base': { label: 'Primary Text', desc: 'Color of normal, high-visibility body text.' },
  '--color-text-muted': { label: 'Muted Labels', desc: 'Secondary details, metadata, and description text.' },
  '--color-text-faint': { label: 'Faint Labels / Placeholders', desc: 'Disabled inputs, metadata timestamps, and placeholder text.' }
}

const FONTS_OPTIONS = [
  { label: 'Inter (Default Sans)', value: "'Inter', sans-serif" },
  { label: 'Outfit (Modern Geometric)', value: "'Outfit', sans-serif" },
  { label: 'Roboto (Clean Classic)', value: "'Roboto', sans-serif" },
  { label: 'Playfair Display (Elegant Serif)', value: "'Playfair Display', serif" },
  { label: 'JetBrains Mono (Technical)', value: "'JetBrains Mono', monospace" }
]

export default function ThemeCustomizer() {
  const { toast } = useToast()
  const [engineEnabled, setEngineEnabled] = useState(false)
  const [themeVars, setThemeVars] = useState<ThemeVariables>(DEFAULT_THEME)

  useEffect(() => {
    const load = async () => {
      try {
        const enabled = await customizerApi.getEngineState()
        setEngineEnabled(enabled)

        const stored = await customizerApi.getTheme()
        if (stored && Object.keys(stored).length > 0) {
          // Only the canonical variables are kept in state. Earlier writes also
          // stored the derived tints, and carrying those around meant a later
          // save could persist a tint that no longer matched its source colour.
          const next = { ...DEFAULT_THEME }
          for (const key of THEME_VAR_NAMES) {
            if (typeof stored[key] === 'string' && stored[key]) next[key] = stored[key]
          }
          setThemeVars(next)
        }
      } catch (err) {
        console.error('Failed to load customizer state:', err)
      }
    }
    load()
  }, [])

  const handleEngineToggle = async (checked: boolean) => {
    try {
      setEngineEnabled(checked)
      await customizerApi.toggleEngine(checked)
      toast(checked ? 'Customization Engine activated' : 'Customization Engine deactivated')
    } catch (err) {
      console.error(err)
      toast('Failed to toggle customization engine')
    }
  }

  /**
   * The single path from a variable change to the engine.
   *
   * The derived tints are expanded here rather than folded into state, so the
   * colour picker, the font select and a preset all produce the same result.
   * Previously only the picker derived them, which meant applying a saved set
   * of variables left the old primary and secondary tints in place.
   */
  const applyVars = async (next: ThemeVariables) => {
    setThemeVars(next)
    if (!engineEnabled) return
    try {
      await customizerApi.updateTheme(deriveThemeVars(next))
    } catch (err) {
      console.error(err)
    }
  }

  const handleColorChange = (name: Exclude<keyof ThemeVariables, '--font-sans'>, hex: string) =>
    applyVars({ ...themeVars, [name]: hex })

  const handleFontChange = (name: '--font-sans', value: string) =>
    applyVars({ ...themeVars, [name]: value })

  const handleApplyPreset = async (vars: ThemeVariables) => {
    await applyVars(vars)
    toast(engineEnabled ? 'Preset applied' : 'Preset loaded (enable the engine to apply it)')
  }

  const handleReset = async () => {
    setThemeVars(DEFAULT_THEME)
    if (engineEnabled) {
      try {
        await customizerApi.updateTheme({})
        toast('Custom theme colors reset to default')
      } catch (err) {
        console.error(err)
      }
    } else {
      toast('Defaults restored (enable customization engine to apply)')
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      <div style={{
        background: 'var(--color-surface-2)',
        border: '1px solid var(--color-surface-offset)',
        borderRadius: 'var(--radius-lg)',
        padding: 'var(--space-4)'
      }}>
        <div className="row-between">
          <div>
            <h3 style={{ margin: 0, fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text-base)' }}>
              Enable Customizer Engine
            </h3>
            <p style={{ margin: 'var(--space-1) 0 0 0', fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
              Turns on theme variable overriding and user plugins.
            </p>
          </div>
          <ToggleSwitch checked={engineEnabled} onChange={handleEngineToggle} label="Enable Customizer Engine" />
        </div>
      </div>

      <Divider />

      <div style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-4)',
        opacity: engineEnabled ? 1 : 0.5,
        pointerEvents: engineEnabled ? 'auto' : 'none',
        transition: 'opacity 200ms ease'
      }}>
        <ThemePresets vars={themeVars} onApply={handleApplyPreset} />

        <Divider />

        <h4 style={{ margin: 0, fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-faint)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-wider)' }}>
          Color Scheme Overrides
        </h4>

        {Object.entries(COLOR_VARIABLE_LABELS).map(([varName, info]) => {
          const name = varName as Exclude<keyof ThemeVariables, '--font-sans'>
          return (
            <div
              key={name}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: 'var(--space-2) var(--space-3)',
                background: 'var(--color-surface-1)',
                border: '1px solid var(--color-surface-offset)',
                borderRadius: 'var(--radius-md)'
              }}
            >
              <div style={{ marginRight: 'var(--space-4)', flex: 1 }}>
                <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)', color: 'var(--color-text-base)', display: 'block' }}>
                  {info.label}
                </span>
                <span style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>
                  {info.desc}
                </span>
              </div>
              <div className="row">
                <ColorPicker
                  value={themeVars[name]}
                  onCommit={val => handleColorChange(name, val)}
                  showHexInput={false}
                  swatchSize={32}
                  title={`Color for ${info.label}`}
                />
                <code style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '11px',
                  color: 'var(--color-text-muted)',
                  textTransform: 'uppercase',
                  background: 'var(--color-surface-2)',
                  padding: '2px 6px',
                  borderRadius: '4px'
                }}>
                  {themeVars[name]}
                </code>
              </div>
            </div>
          )
        })}

        <Divider />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <h4 style={{ margin: 0, fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-faint)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-wider)' }}>
            Typography Customization
          </h4>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: 'var(--space-2) var(--space-3)',
              background: 'var(--color-surface-1)',
              border: '1px solid var(--color-surface-offset)',
              borderRadius: 'var(--radius-md)'
            }}
          >
            <div style={{ marginRight: 'var(--space-4)', flex: 1 }}>
              <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)', color: 'var(--color-text-base)', display: 'block' }}>
                Primary Font Family
              </span>
              <span style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>
                Select the font family used across primary headers and text.
              </span>
            </div>
            <div>
              <select
                value={themeVars['--font-sans']}
                onChange={e => handleFontChange('--font-sans', e.target.value)}
                style={{
                  background: 'var(--color-surface-2)',
                  border: '1px solid var(--color-surface-offset)',
                  color: 'var(--color-text-base)',
                  borderRadius: 'var(--radius-md)',
                  padding: 'var(--space-1-5) var(--space-3)',
                  fontSize: 'var(--text-xs)',
                  outline: 'none',
                  cursor: 'pointer'
                }}
              >
                {FONTS_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div style={{ marginTop: 'var(--space-2)' }}>
          <button
            onClick={handleReset}
            style={{
              padding: 'var(--space-2) var(--space-4)',
              background: 'var(--color-surface-offset)',
              border: '1px solid var(--color-surface-offset)',
              color: 'var(--color-text-base)',
              borderRadius: 'var(--radius-md)',
              fontSize: 'var(--text-xs)',
              fontWeight: 'var(--weight-semibold)',
              cursor: 'pointer',
              transition: 'all 100ms ease'
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--color-surface-elevated)'}
            onMouseLeave={e => e.currentTarget.style.background = 'var(--color-surface-offset)'}
          >
            Reset to Defaults
          </button>
        </div>
      </div>
    </div>
  )
}

