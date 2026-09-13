import React, { useState, useEffect } from 'react'
import { FieldRow, ToggleSwitch, Divider, RowBetween } from './SettingsSection'

// components only, or Fast Refresh reloads the page; import applyFontSize from lib/fontScale
import { applyFontSize, type FontSize } from '../../lib/fontScale'
import { getBoolSetting, getEnumSetting, setBoolSetting, setStringSetting } from '../../lib/settings'
import PathRow from './PathRow'
import * as appApi from '../../data/app'

function applyCompactMode(enabled: boolean): void {
  if (enabled) {
    document.documentElement.setAttribute('data-compact', 'true')
  } else {
    document.documentElement.removeAttribute('data-compact')
  }
}

export default function AppearanceSettings() {
  const [fontSize, setFontSize] = useState<FontSize>('medium')
  const [compactMode, setCompactMode] = useState(false)
  const [themePath, setThemePath] = useState('')

  useEffect(() => {
    const load = async () => {
      try {
        const size = await getEnumSetting('appearance_font_size', ['small', 'medium', 'large'] as const, 'medium')
        setFontSize(size)
        applyFontSize(size)
        const compact = await getBoolSetting('appearance_compact', false)
        setCompactMode(compact)
        applyCompactMode(compact)

        const home = await appApi.getDataPath()
        // theme lives at ~/.config/checkpoint/theme.css
        const platform = appApi.platform()
        const configDir = platform === 'win32'
          ? home.replace(/\\AppData\\Roaming.*/, '') + '\\.config\\checkpoint'
          : `${home}/.config/checkpoint`
        setThemePath(`${configDir}\\theme.css`.replace(/\\\\/g, '\\'))
      } catch (err) {
        console.error('Failed to load appearance settings:', err)
      }
    }
    load()
  }, [])

  const handleFontSize = async (size: FontSize) => {
    setFontSize(size)
    applyFontSize(size)
    await setStringSetting('appearance_font_size', size)
  }

  const handleCompact = async (enabled: boolean) => {
    setCompactMode(enabled)
    applyCompactMode(enabled)
    await setBoolSetting('appearance_compact', enabled)
  }

  const FONT_OPTIONS: { value: FontSize; label: string; desc: string }[] = [
    { value: 'small',  label: 'Small',  desc: '90%'   },
    { value: 'medium', label: 'Medium', desc: '100%'  },
    { value: 'large',  label: 'Large',  desc: '112%'  }
  ]

  return (
    <div className="col-xl">
      <FieldRow label="Font Size" hint="Scales all text proportionally across the entire app.">
        <div className="flex-gap">
          {FONT_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => handleFontSize(opt.value)}
              style={{
                flex: 1,
                padding: 'var(--space-2) var(--space-3)',
                background: fontSize === opt.value
                  ? 'var(--color-secondary-muted)'
                  : 'var(--color-surface-2)',
                border: `1px solid ${fontSize === opt.value ? 'var(--color-secondary)' : 'var(--color-surface-offset)'}`,
                borderRadius: 'var(--radius-md)',
                color: fontSize === opt.value ? 'var(--color-secondary)' : 'var(--color-text-muted)',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '2px',
                transition: 'all 100ms ease'
              }}
            >
              <span className="text-sm-semibold">
                {opt.label}
              </span>
              <span className="text-micro-dim">{opt.desc}</span>
            </button>
          ))}
        </div>
      </FieldRow>

      <Divider />

      <RowBetween>
        <div>
          <div className="text-item">
            Compact Mode
          </div>
          <div className="text-sub">
            Reduces card padding and row heights for denser information density.
          </div>
        </div>
        <ToggleSwitch checked={compactMode} onChange={handleCompact} label="Compact Mode" />
      </RowBetween>

      <Divider />

      <FieldRow
        label="Custom Theme File"
        hint="Drop a theme.css here to override CSS tokens. Changes are hot-reloaded instantly."
      >
        <PathRow
          openTitle="Open folder in Explorer"
          onOpen={() => {
            const dir = themePath.replace(/[/\\][^/\\]+$/, '')
            appApi.openExternal(`file://${dir}`)
          }}
        >
          {themePath || 'Loading…'}
        </PathRow>
      </FieldRow>
    </div>
  )
}
