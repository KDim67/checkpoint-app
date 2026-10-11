import { useState, useEffect } from 'react'
import { Moon, Sun, MonitorCog } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { FieldRow } from './SettingsSection'
import { getStringSetting, setStringSetting } from '../../lib/settings'
import * as customizerApi from '../../data/customizer'
import { injectCustomCss } from '../../lib/themeBoot'
import { useToast, useFailureReport } from '../ui/Toast'

// dark / light / system
export default function ThemeModeSettings() {
  const report = useFailureReport()
  const [theme, setTheme] = useState<'dark' | 'light' | 'system'>('dark')
  const { toast } = useToast()

  useEffect(() => {
    const load = async () => {
      setTheme(await getStringSetting('app_theme', 'dark') as typeof theme)
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
    await setStringSetting('app_theme', t)
    try {
      // a custom palette would override the mode just picked, so it steps aside and says so
      const wasCustom = await customizerApi.getEngineState().catch(() => false)
      await customizerApi.toggleEngine(false)
      // clears the style element, drops data-theme-custom and announces it
      injectCustomCss('')
      window.dispatchEvent(new CustomEvent('customizer-engine-changed', { detail: { enabled: false } }))
      if (wasCustom) {
        toast('Your own colours are switched off so this mode shows. Turn them back on in the Theme Builder below.')
      }
    } catch (err) {
      report('switch off the custom theme', err)
    }
  }

  // icons not emoji, the OS font ignores the theme
  const THEME_OPTIONS: { value: typeof theme; Icon: LucideIcon; label: string; desc: string }[] = [
    { value: 'dark',   Icon: Moon,       label: 'Dark',   desc: 'Easy on the eyes'  },
    { value: 'light',  Icon: Sun,        label: 'Light',  desc: 'Bright and crisp'  },
    { value: 'system', Icon: MonitorCog, label: 'System', desc: 'Follows Windows'   }
  ]

  return (
    <FieldRow label="Interface theme" hint="The theme button in the title bar switches the same setting." group>
      <div className="settings-choices">
        {THEME_OPTIONS.map(opt => (
          <button
            key={opt.value}
            type="button"
            className="settings-choice"
            aria-pressed={theme === opt.value}
            onClick={() => handleTheme(opt.value)}
          >
            <span className="settings-choice-label">
              <opt.Icon size={14} aria-hidden="true" />
              {opt.label}
            </span>
            <span className="settings-choice-note">{opt.desc}</span>
          </button>
        ))}
      </div>
    </FieldRow>
  )
}
