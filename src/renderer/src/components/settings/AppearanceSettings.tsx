import React, { useState, useEffect } from 'react'
import { FieldRow, ToggleRow, Divider } from './SettingsSection'

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
      <FieldRow label="Font size" hint="Every piece of text in Checkpoint grows or shrinks with it." group>
        <div className="settings-choices">
          {FONT_OPTIONS.map(opt => (
            <button
              key={opt.value}
              type="button"
              className="settings-choice"
              aria-pressed={fontSize === opt.value}
              onClick={() => handleFontSize(opt.value)}
            >
              <span className="settings-choice-label">{opt.label}</span>
              <span className="settings-choice-note">{opt.desc}</span>
            </button>
          ))}
        </div>
      </FieldRow>

      <Divider />

      <ToggleRow
        label="Compact mode"
        description="Tighter cards and rows, so more fits on screen."
        checked={compactMode}
        onChange={handleCompact}
      />

      <Divider />

      <FieldRow
        label="Custom theme file"
        hint="A theme.css placed here sets the colours and sizes Checkpoint draws with, and changes show as you save it."
        group
      >
        <PathRow
          openTitle="Open the folder"
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
