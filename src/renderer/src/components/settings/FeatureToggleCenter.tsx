import React, { useState, useEffect } from 'react'
import { Webhook, Crosshair, Archive, Activity, Gamepad } from 'lucide-react'
import { ToggleSwitch, Divider, RowBetween } from './SettingsSection'

interface ToggleConfig {
  key: string
  icon: React.ReactNode
  title: string
  description: string
  warning: string
  getState: () => Promise<boolean>
  toggle: (active: boolean) => Promise<void>
}

const TOGGLE_CONFIGS: ToggleConfig[] = [
  {
    key: 'webhook',
    icon: <Webhook size={16} />,
    title: 'Local Webhook Gateway',
    description: 'Receives events from external tools via a local HTTP port.',
    warning: 'Disabling closes the active socket immediately (server.close()).',
    getState: async () => {
      const v = await window.electronAPI.db.getSetting('feature_webhook')
      return v !== 'false'
    },
    toggle: async (active: boolean) => {
      await window.electronAPI.db.setSetting('feature_webhook', String(active))
      await window.electronAPI.webhook.toggle(active, 9374)
    }
  },
  {
    key: 'hud',
    icon: <Crosshair size={16} />,
    title: 'Global Quick-Capture HUD',
    description: 'Borderless overlay launched via a global hotkey for rapid task capture.',
    warning: 'Disabling unregisters the hotkey and destroys the HUD window.',
    getState: async () => {
      const v = await window.electronAPI.db.getSetting('feature_hud')
      return v !== 'false'
    },
    toggle: async (active: boolean) => {
      await window.electronAPI.db.setSetting('feature_hud', String(active))
      await window.electronAPI.hud.toggle(active)
    }
  },
  {
    key: 'backup',
    icon: <Archive size={16} />,
    title: 'Zero-Config Backup Vaulting',
    description: 'Automatically creates timestamped SQLite database snapshots.',
    warning: 'Disabling clears all scheduled backup intervals immediately.',
    getState: async () => {
      const v = await window.electronAPI.db.getSetting('feature_backup')
      return v !== 'false'
    },
    toggle: async (active: boolean) => {
      await window.electronAPI.db.setSetting('feature_backup', String(active))
      // Backup scheduler reads this setting on its next tick, graceful deconstruction
    }
  },
  {
    key: 'tracker',
    icon: <Activity size={16} />,
    title: 'Passive Activity Tracker',
    description: 'Monitors active window focus to build a passive work timeline.',
    warning: 'Disabling terminates the active window focus scanning loop.',
    getState: async () => {
      try { return await window.electronAPI.tracker.getState() }
      catch { return false }
    },
    toggle: async (active: boolean) => {
      await window.electronAPI.db.setSetting('feature_tracker', String(active))
      await window.electronAPI.tracker.toggle(active)
    }
  },
  {
    key: 'gamedev_helpers',
    icon: <Gamepad size={16} />,
    title: 'Game Development Helpers',
    description: 'Unlocks a specialized tab with batch asset renamer, frame budget calculator, dialogue editor, and shader color palette code exporters.',
    warning: 'Disabling hides the sidebar workspace and resets active sub-views.',
    getState: async () => {
      const v = await window.electronAPI.db.getSetting('feature_gamedev_helpers')
      return v === 'true'
    },
    toggle: async (active: boolean) => {
      await window.electronAPI.db.setSetting('feature_gamedev_helpers', String(active))
      // Sidebar will pick it up on mount/events or store sync. We can also emit a custom window event to force Sidebar updates
      window.dispatchEvent(new CustomEvent('settings-update-gamedev'))
    }
  }
]

export default function FeatureToggleCenter() {
  const [states, setStates] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(true)
  const [toggling, setToggling] = useState<string | null>(null)

  useEffect(() => {
    const loadAll = async () => {
      const results: Record<string, boolean> = {}
      await Promise.all(
        TOGGLE_CONFIGS.map(async cfg => {
          try { results[cfg.key] = await cfg.getState() }
          catch { results[cfg.key] = false }
        })
      )
      setStates(results)
      setLoading(false)
    }
    loadAll()
  }, [])

  const handleToggle = async (cfg: ToggleConfig, newValue: boolean) => {
    setToggling(cfg.key)
    try {
      await cfg.toggle(newValue)
      setStates(prev => ({ ...prev, [cfg.key]: newValue }))
    } catch (err) {
      console.error(`Failed to toggle ${cfg.key}:`, err)
    } finally {
      setToggling(null)
    }
  }

  if (loading) {
    return (
      <div style={{ color: 'var(--color-text-faint)', fontSize: 'var(--text-sm)' }}>
        Loading feature states…
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
      {TOGGLE_CONFIGS.map((cfg, i) => (
        <React.Fragment key={cfg.key}>
          {i > 0 && <Divider />}
          <RowBetween>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)', flex: 1 }}>
              <span style={{
                color: states[cfg.key] ? 'var(--color-secondary)' : 'var(--color-text-faint)',
                marginTop: '2px',
                flexShrink: 0,
                transition: 'color 150ms ease'
              }}>
                {cfg.icon}
              </span>
              <div>
                <div style={{
                  fontSize: 'var(--text-sm)',
                  fontWeight: 'var(--weight-medium)',
                  color: 'var(--color-text-base)'
                }}>
                  {cfg.title}
                </div>
                <div style={{
                  fontSize: 'var(--text-xs)',
                  color: 'var(--color-text-faint)',
                  marginTop: '2px',
                  lineHeight: 1.5
                }}>
                  {cfg.description}
                </div>
                {!states[cfg.key] && (
                  <div style={{
                    fontSize: '11px',
                    color: 'var(--color-warning)',
                    marginTop: '4px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}>
                    ⚡ {cfg.warning}
                  </div>
                )}
              </div>
            </div>
            <ToggleSwitch
              checked={states[cfg.key] ?? false}
              onChange={v => handleToggle(cfg, v)}
              disabled={toggling === cfg.key}
            />
          </RowBetween>
        </React.Fragment>
      ))}
    </div>
  )
}
