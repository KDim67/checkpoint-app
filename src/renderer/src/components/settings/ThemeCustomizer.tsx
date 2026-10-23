import React, { useState, useEffect } from 'react'
import { ToggleRow, Divider } from './SettingsSection'
import { useToast, useFailureReport } from '../ui/Toast'
import { useConfirm } from '../ui/ConfirmDialog'
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
  '--color-background': { label: 'Background', desc: 'Behind everything, the window itself.' },
  '--color-surface-1': { label: 'Panels', desc: 'Cards, panels and the sidebar.' },
  '--color-surface-2': { label: 'Fields', desc: 'Text boxes, menus and lists inside a panel.' },
  '--color-surface-offset': { label: 'Lines and hover', desc: 'Dividing lines, and a row under the pointer.' },
  '--color-surface-elevated': { label: 'Menus and tooltips', desc: 'Whatever pops up over the rest.' },
  '--color-primary': { label: 'Primary accent', desc: 'Links, focus rings and the main buttons.' },
  '--color-secondary': { label: 'Secondary accent', desc: 'What is selected or switched on.' },
  '--color-balance': { label: 'Icons and outlines', desc: 'Sidebar icons at rest, card outlines and quiet marks.' },
  '--color-text-base': { label: 'Text', desc: 'Most of the words you read.' },
  '--color-text-muted': { label: 'Secondary text', desc: 'Descriptions, details and labels.' },
  '--color-text-faint': { label: 'Faint text', desc: 'Hints, times, placeholders and switched-off things.' }
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
  const report = useFailureReport()
  const confirm = useConfirm()
  const [engineEnabled, setEngineEnabled] = useState(false)
  const [themeVars, setThemeVars] = useState<ThemeVariables>(DEFAULT_THEME)

  useEffect(() => {
    const load = async () => {
      try {
        const enabled = await customizerApi.getEngineState()
        setEngineEnabled(enabled)

        const stored = await customizerApi.getTheme()
        if (stored && Object.keys(stored).length > 0) {
          // only canonical vars in state, stored tints could drift from their source
          const next = { ...DEFAULT_THEME }
          for (const key of THEME_VAR_NAMES) {
            if (typeof stored[key] === 'string' && stored[key]) next[key] = stored[key]
          }
          setThemeVars(next)
        }
      } catch (err) {
        report('load the theme customizer', err)
      }
    }
    load()
  }, [report])

  useEffect(() => {
    const handleEngineChange = (e: Event) => {
      const detail = (e as CustomEvent<{ enabled: boolean }>).detail
      if (typeof detail?.enabled === 'boolean') {
        setEngineEnabled(detail.enabled)
      } else {
        customizerApi.getEngineState().then(setEngineEnabled).catch(() => {})
      }
    }
    window.addEventListener('customizer-engine-changed', handleEngineChange)
    return () => window.removeEventListener('customizer-engine-changed', handleEngineChange)
  }, [])

  const handleEngineToggle = async (checked: boolean) => {
    try {
      setEngineEnabled(checked)
      await customizerApi.toggleEngine(checked)
      window.dispatchEvent(new CustomEvent('customizer-engine-changed', { detail: { enabled: checked } }))
      toast(checked ? 'Customizations on' : 'Customizations off')
    } catch (err) {
      setEngineEnabled(!checked)
      report(checked ? 'turn your customizations on' : 'turn your customizations off', err)
    }
  }

  /** one path to the engine; tints expanded here so picker, font select and presets agree */
  const applyVars = async (next: ThemeVariables) => {
    setThemeVars(next)
    if (!engineEnabled) return
    try {
      await customizerApi.updateTheme(deriveThemeVars(next))
    } catch (err) {
      report('apply the colours', err)
    }
  }

  const handleColorChange = (name: Exclude<keyof ThemeVariables, '--font-sans'>, hex: string) =>
    applyVars({ ...themeVars, [name]: hex })

  const handleFontChange = (name: '--font-sans', value: string) =>
    applyVars({ ...themeVars, [name]: value })

  const handleApplyPreset = async (vars: ThemeVariables) => {
    await applyVars(vars)
    toast(engineEnabled ? 'Preset applied' : 'Preset picked. Turn customizations on to see it.')
  }

  // every colour and the font go at once, so it's asked about first
  const handleReset = async () => {
    const ok = await confirm({
      title: 'Reset the colours and font?',
      message: "Every colour and the font go back to Checkpoint's own. Presets you saved are kept.",
      confirmText: 'Reset',
      isDestructive: true
    })
    if (!ok) return
    setThemeVars(DEFAULT_THEME)
    if (!engineEnabled) {
      toast('Colours and font reset')
      return
    }
    try {
      await customizerApi.updateTheme({})
      toast('Colours and font reset')
    } catch (err) {
      report('reset the colours', err)
    }
  }

  return (
    <div className="col-xl">
      <ToggleRow
        label="Use my customizations"
        description="The colours and font below, and the plugins you allowed."
        checked={engineEnabled}
        onChange={handleEngineToggle}
      />

      <Divider />

      {/* switched off, the controls are disabled rather than faded, so the keyboard skips them too */}
      <fieldset className="settings-fieldset" disabled={!engineEnabled} aria-label="Colours and font">
        <ThemePresets vars={themeVars} onApply={handleApplyPreset} />

        <Divider />

        <div className="col-md">
          <h4 className="heading-caps">
            Colours
          </h4>
          <ul className="settings-list">
            {Object.entries(COLOR_VARIABLE_LABELS).map(([varName, info]) => {
              const name = varName as Exclude<keyof ThemeVariables, '--font-sans'>
              return (
                <li key={name} className="settings-list-row">
                  <div className="settings-row-text">
                    <span className="field-label">
                      {info.label}
                    </span>
                    <span className="text-sub">
                      {info.desc}
                    </span>
                  </div>
                  <div className="row">
                    <ColorPicker
                      value={themeVars[name]}
                      onCommit={val => handleColorChange(name, val)}
                      showHexInput={false}
                      swatchSize={32}
                      title={`Colour for ${info.label.toLowerCase()}`}
                    />
                    <code style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 'var(--text-xs)',
                      color: 'var(--color-text-muted)',
                      textTransform: 'uppercase',
                      fontVariantNumeric: 'tabular-nums'
                    }}>
                      {themeVars[name]}
                    </code>
                  </div>
                </li>
              )
            })}
          </ul>
        </div>

        <Divider />

        <div className="col-md">
          <h4 className="heading-caps">
            Font
          </h4>
          <ul className="settings-list">
            <li className="settings-list-row">
              <div className="settings-row-text">
                <label htmlFor="theme-font" className="field-label">
                  Font family
                </label>
                <span className="text-sub">
                  Used for headings and text across Checkpoint.
                </span>
              </div>
              <select
                id="theme-font"
                value={themeVars['--font-sans']}
                onChange={e => handleFontChange('--font-sans', e.target.value)}
                className="select-md settings-row-select"
              >
                {FONTS_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </li>
          </ul>
        </div>

        <div>
          <button type="button" className="btn-secondary" onClick={handleReset}>
            Reset colours and font
          </button>
        </div>
      </fieldset>
    </div>
  )
}
