import React, { useEffect, useState } from 'react'
import { ToggleRow, SettingsRowsSkeleton } from './SettingsSection'
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
    return <SettingsRowsSkeleton label="Loading the startup settings" rows={4} />
  }

  return (
    <div className="col-lg">
      {STARTUP_OPTIONS.map(option => {
        const disabled = option.needsTray && !settings.showTrayIcon
        return (
          <ToggleRow
            key={option.key}
            label={option.label}
            description={option.hint}
            checked={settings[option.key]}
            onChange={value => toggle(option.key, value)}
            disabled={disabled}
          />
        )
      })}
    </div>
  )
}
