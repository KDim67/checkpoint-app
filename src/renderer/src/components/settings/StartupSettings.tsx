import React, { useEffect, useState } from 'react'
import { ToggleSwitch, RowBetween } from './SettingsSection'
import { useToast } from '../ui/Toast'
import {
  DEFAULT_STARTUP_SETTINGS,
  STARTUP_OPTIONS,
  type StartupSettings as Settings
} from '../../../../shared/startupSettings'
import * as trayApi from '../../data/tray'

/** same switches and IPC as the tray panel, one description of each */
export default function StartupSettings(): React.JSX.Element {
  const { toast } = useToast()
  const [settings, setSettings] = useState<Settings>(DEFAULT_STARTUP_SETTINGS)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    trayApi.getStartup()
      .then(s => { setSettings(s); setLoaded(true) })
      .catch(err => { console.error('Failed to load startup settings:', err); setLoaded(true) })

    // the tray panel has these too, keep both in step
    return trayApi.onStartupChanged(setSettings)
  }, [])

  const toggle = async (key: keyof Settings, value: boolean) => {
    const next = { ...settings, [key]: value }
    setSettings(next)
    try {
      // main reconciles, no tray icon forces the dependents off
      setSettings(await trayApi.setStartup(next))
    } catch (err) {
      console.error(err)
      toast('Could not save startup settings')
    }
  }

  if (!loaded) {
    return <div className="text-hint-faint">Loading…</div>
  }

  return (
    <div className="col-lg">
      {STARTUP_OPTIONS.map(option => {
        const disabled = option.needsTray && !settings.showTrayIcon
        return (
          <RowBetween key={option.key}>
            <div style={{ opacity: disabled ? 0.5 : 1 }}>
              <div className="text-item">
                {option.label}
              </div>
              <div className="text-sub">
                {option.hint}
              </div>
            </div>
            <ToggleSwitch
              checked={settings[option.key]}
              onChange={value => toggle(option.key, value)}
              disabled={disabled}
              label={option.label}
            />
          </RowBetween>
        )
      })}
    </div>
  )
}
