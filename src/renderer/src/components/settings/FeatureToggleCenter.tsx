import React, { useState, useEffect } from 'react'
import { Webhook, Crosshair, Archive, Activity, Gamepad, RefreshCw, Columns, FileText, ListTodo, Timer, BookOpen, Clipboard, BarChart2, Sparkles, Book } from 'lucide-react'
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

const BACKGROUND_CONFIGS: ToggleConfig[] = [
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
    key: 'sync',
    icon: <RefreshCw size={16} />,
    title: 'Zero-Cloud P2P Sync Engine',
    description: 'Bridges note directories and SQLite database updates directly between machines over Wi-Fi (LAN) or the Internet (WebRTC).',
    warning: 'Disabling closes all active network listeners and WebRTC signaling tunnels.',
    getState: async () => {
      const v = await window.electronAPI.db.getSetting('sync_enabled')
      return v === 'true' || v === true
    },
    toggle: async (active: boolean) => {
      await window.electronAPI.db.setSetting('sync_enabled', String(active))
      if (active) {
        await window.electronAPI.sync.startHost()
      } else {
        await window.electronAPI.sync.stopHost()
      }
      window.dispatchEvent(new CustomEvent('settings-update-sync'))
    }
  }
]

const SIDEBAR_VIEW_CONFIGS: ToggleConfig[] = [
  {
    key: 'view_kanban',
    icon: <Columns size={16} />,
    title: 'Kanban Board View',
    description: 'Visual status wall to track and organize workspace cards.',
    warning: 'Disabling hides the Kanban tab on the left navigation bar.',
    getState: async () => {
      const v = await window.electronAPI.db.getSetting('feature_view_kanban')
      return v !== 'false'
    },
    toggle: async (active: boolean) => {
      await window.electronAPI.db.setSetting('feature_view_kanban', String(active))
      window.dispatchEvent(new CustomEvent('settings-update-features'))
    }
  },
  {
    key: 'view_log',
    icon: <FileText size={16} />,
    title: 'Daily Log View',
    description: 'Chronological activity stream for logging progress, screenshots, and daily context.',
    warning: 'Disabling hides the Log tab on the left navigation bar.',
    getState: async () => {
      const v = await window.electronAPI.db.getSetting('feature_view_log')
      return v !== 'false'
    },
    toggle: async (active: boolean) => {
      await window.electronAPI.db.setSetting('feature_view_log', String(active))
      window.dispatchEvent(new CustomEvent('settings-update-features'))
    }
  },
  {
    key: 'view_backlog',
    icon: <ListTodo size={16} />,
    title: 'Structured Backlog View',
    description: 'Detailed, sortable grid for tracking and prioritizing project tasks.',
    warning: 'Disabling hides the Backlog tab on the left navigation bar.',
    getState: async () => {
      const v = await window.electronAPI.db.getSetting('feature_view_backlog')
      return v !== 'false'
    },
    toggle: async (active: boolean) => {
      await window.electronAPI.db.setSetting('feature_view_backlog', String(active))
      window.dispatchEvent(new CustomEvent('settings-update-features'))
    }
  },
  {
    key: 'view_focus',
    icon: <Timer size={16} />,
    title: 'Focus Timer & Pomodoro',
    description: 'Interactive clock and interruption tracker to maintain high productivity.',
    warning: 'Disabling hides the Focus tab on the left navigation bar.',
    getState: async () => {
      const v = await window.electronAPI.db.getSetting('feature_view_focus')
      return v !== 'false'
    },
    toggle: async (active: boolean) => {
      await window.electronAPI.db.setSetting('feature_view_focus', String(active))
      window.dispatchEvent(new CustomEvent('settings-update-features'))
    }
  },
  {
    key: 'view_notes',
    icon: <BookOpen size={16} />,
    title: 'Obsidian-Style Notes',
    description: 'Local file-based Markdown notes with wiki-link navigation and search.',
    warning: 'Disabling hides the Notes tab on the left navigation bar.',
    getState: async () => {
      const v = await window.electronAPI.db.getSetting('feature_view_notes')
      return v !== 'false'
    },
    toggle: async (active: boolean) => {
      await window.electronAPI.db.setSetting('feature_view_notes', String(active))
      window.dispatchEvent(new CustomEvent('settings-update-features'))
    }
  },
  {
    key: 'view_clipboard',
    icon: <Clipboard size={16} />,
    title: 'Clipboard History Vault',
    description: 'Monitors, saves, and lets you query clipboard copy-paste events.',
    warning: 'Disabling hides the Clipboard tab on the left navigation bar.',
    getState: async () => {
      const v = await window.electronAPI.db.getSetting('feature_view_clipboard')
      return v !== 'false'
    },
    toggle: async (active: boolean) => {
      await window.electronAPI.db.setSetting('feature_view_clipboard', String(active))
      window.dispatchEvent(new CustomEvent('settings-update-features'))
    }
  },
  {
    key: 'view_analytics',
    icon: <BarChart2 size={16} />,
    title: 'Time & App Analytics',
    description: 'Interactive graphs showing active window usage, session durations, and categories.',
    warning: 'Disabling hides the Analytics tab on the left navigation bar.',
    getState: async () => {
      const v = await window.electronAPI.db.getSetting('feature_view_analytics')
      return v !== 'false'
    },
    toggle: async (active: boolean) => {
      await window.electronAPI.db.setSetting('feature_view_analytics', String(active))
      window.dispatchEvent(new CustomEvent('settings-update-features'))
    }
  },
  {
    key: 'view_cookbook',
    icon: <Sparkles size={16} />,
    title: 'AI Assistant Cookbook',
    description: 'Interact with local Ollama models and context configurations.',
    warning: 'Disabling hides the Cookbook tab on the left navigation bar.',
    getState: async () => {
      const v = await window.electronAPI.db.getSetting('feature_view_cookbook')
      return v !== 'false'
    },
    toggle: async (active: boolean) => {
      await window.electronAPI.db.setSetting('feature_view_cookbook', String(active))
      window.dispatchEvent(new CustomEvent('settings-update-features'))
    }
  },
  {
    key: 'view_cheatsheets',
    icon: <Book size={16} />,
    title: 'Quick Cheatsheets & PDFs',
    description: 'Store, view, and read reference documentation/cheatsheets inside Checkpoint.',
    warning: 'Disabling hides the Cheatsheets tab on the left navigation bar.',
    getState: async () => {
      const v = await window.electronAPI.db.getSetting('feature_view_cheatsheets')
      return v !== 'false'
    },
    toggle: async (active: boolean) => {
      await window.electronAPI.db.setSetting('feature_view_cheatsheets', String(active))
      window.dispatchEvent(new CustomEvent('settings-update-features'))
    }
  },
  {
    key: 'gamedev_helpers',
    icon: <Gamepad size={16} />,
    title: 'Game Development Helpers',
    description: 'Unlocks PBR/seamless generators, pixel-art upscaler, sprite atlas tools, batch renamer and dialogue editor.',
    warning: 'Disabling hides the Game Dev tab on the left navigation bar.',
    getState: async () => {
      const v = await window.electronAPI.db.getSetting('feature_gamedev_helpers')
      return v === 'true'
    },
    toggle: async (active: boolean) => {
      await window.electronAPI.db.setSetting('feature_gamedev_helpers', String(active))
      window.dispatchEvent(new CustomEvent('settings-update-features'))
      window.dispatchEvent(new CustomEvent('settings-update-gamedev'))
    }
  }
]

const TOGGLE_CONFIGS = [...BACKGROUND_CONFIGS, ...SIDEBAR_VIEW_CONFIGS]

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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      {/* Background Subsystems Section */}
      <div>
        <div style={{
          fontSize: '11px',
          fontWeight: 'var(--weight-bold)',
          color: 'var(--color-secondary)',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          marginBottom: 'var(--space-3)'
        }}>
          Background Subsystems
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
          {BACKGROUND_CONFIGS.map((cfg, i) => (
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
      </div>

      <div style={{ height: '1px', background: 'var(--color-surface-offset)', margin: 'var(--space-2) 0' }} />

      {/* Workspace Sidebar Views Section */}
      <div>
        <div style={{
          fontSize: '11px',
          fontWeight: 'var(--weight-bold)',
          color: 'var(--color-secondary)',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          marginBottom: 'var(--space-3)'
        }}>
          Workspace Views & Sidebar Customization
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
          {SIDEBAR_VIEW_CONFIGS.map((cfg, i) => (
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
      </div>
    </div>
  )
}
