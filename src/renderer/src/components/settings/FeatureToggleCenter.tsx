import React, { useState, useEffect } from 'react'
import { Webhook, Crosshair, Archive, Activity, Gamepad, RefreshCw, Columns, FileText, ListTodo, Timer, BookOpen, Clipboard, BarChart2, Sparkles, Book, LayoutGrid } from 'lucide-react'
import { ToggleSwitch, Divider, RowBetween } from './SettingsSection'
import { AI_FEATURE_KEY, VIEW_FEATURES, readAiEnabled, setAiEnabled, setViewFeature } from '../../lib/features'
import { getBoolSetting } from '../../lib/settings'
import { WEBHOOK_DEFAULT_PORT } from '../../../../shared/ports'

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
      // Reuse whichever port the gateway is already listening on. A literal
      // here moved it off the port main had started it on, so every external
      // tool posting to the documented port stopped being delivered.
      const stored = await window.electronAPI.db.getSetting('webhook_port')
      const port = parseInt(String(stored ?? ''), 10) || WEBHOOK_DEFAULT_PORT
      await window.electronAPI.webhook.toggle(active, port)
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
      // Persisting the flag alone left the old timers running and armed no new
      // ones, so the warning above only came true on the next launch.
      // initializeBackupScheduler clears then re-arms, so it is right either way.
      await window.electronAPI.backup.run('init')
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

/**
 * Per-view copy. The setting key, label and default live in lib/features so
 * this panel, the Sidebar and App's redirect guard cannot disagree about them.
 */
/**
 * Per-view copy, keyed by settings key. The key, label and default live in
 * lib/features so this panel, the Sidebar and App's redirect guard cannot
 * disagree about them.
 */
const VIEW_COPY: Record<string, { key: string; icon: React.ReactNode; description: string; warning: string }> = {
  'feature_view_kanban': {
    key: 'view_kanban',
    icon: <Columns size={16} />,
    description: 'Visual status wall to track and organize workspace cards.',
    warning: 'Disabling hides the Kanban tab on the left navigation bar.'
  },
  'feature_view_log': {
    key: 'view_log',
    icon: <FileText size={16} />,
    description: 'Chronological activity stream for logging progress, screenshots, and daily context.',
    warning: 'Disabling hides the Log tab on the left navigation bar.'
  },
  'feature_view_backlog': {
    key: 'view_backlog',
    icon: <ListTodo size={16} />,
    description: 'Detailed, sortable grid for tracking and prioritizing project tasks.',
    warning: 'Disabling hides the Backlog tab on the left navigation bar.'
  },
  'feature_view_focus': {
    key: 'view_focus',
    icon: <Timer size={16} />,
    description: 'Interactive clock and interruption tracker to maintain high productivity.',
    warning: 'Disabling hides the Focus tab on the left navigation bar.'
  },
  'feature_view_notes': {
    key: 'view_notes',
    icon: <BookOpen size={16} />,
    description: 'Local file-based Markdown notes with wiki-link navigation and search.',
    warning: 'Disabling hides the Notes tab on the left navigation bar.'
  },
  'feature_view_wall': {
    key: 'view_wall',
    icon: <LayoutGrid size={16} />,
    description: 'Freeform canvas for arranging cards, notes, images and reference material.',
    warning: 'Disabling hides the Wall tab on the left navigation bar.'
  },
  'feature_view_clipboard': {
    key: 'view_clipboard',
    icon: <Clipboard size={16} />,
    description: 'Monitors, saves, and lets you query clipboard copy-paste events.',
    warning: 'Disabling hides the Clipboard tab on the left navigation bar.'
  },
  'feature_view_analytics': {
    key: 'view_analytics',
    icon: <BarChart2 size={16} />,
    description: 'Interactive graphs showing active window usage, session durations, and categories.',
    warning: 'Disabling hides the Analytics tab on the left navigation bar.'
  },
  'feature_view_cookbook': {
    key: 'view_cookbook',
    icon: <Sparkles size={16} />,
    description: 'Interact with local Ollama models and context configurations.',
    warning: 'Disabling hides the Cookbook tab on the left navigation bar.'
  },
  'feature_view_cheatsheets': {
    key: 'view_cheatsheets',
    icon: <Book size={16} />,
    description: 'Store, view, and read reference documentation/cheatsheets inside Checkpoint.',
    warning: 'Disabling hides the Cheatsheets tab on the left navigation bar.'
  },
  'feature_gamedev_helpers': {
    key: 'gamedev_helpers',
    icon: <Gamepad size={16} />,
    description: 'Unlocks PBR/seamless generators, pixel-art upscaler, sprite atlas tools, batch renamer and dialogue editor.',
    warning: 'Disabling hides the Game Dev tab on the left navigation bar.'
  }
}

/**
 * Copy is written by hand, so a view can be added to VIEW_FEATURES without one.
 * That used to read `undefined.key` and crash the whole Settings screen.
 * Losing every other toggle because one description was missing. A view with no
 * copy now renders with its own label instead.
 */
const SIDEBAR_VIEW_CONFIGS: ToggleConfig[] = VIEW_FEATURES.map(feature => {
  const copy = VIEW_COPY[feature.key] ?? {
    key: feature.key,
    icon: <Columns size={16} />,
    description: '',
    warning: `Disabling hides the ${feature.label} tab on the left navigation bar.`
  }
  return {
    key: copy.key,
    icon: copy.icon,
    title: feature.label,
    description: copy.description,
    warning: copy.warning,
    getState: () => getBoolSetting(feature.key, feature.defaultOn),
    toggle: (active: boolean) => setViewFeature(feature.key, active)
  }
})

/**
 * The assistant and everything that reaches it. Its own section because it is
 * not one view and not a background server: it cuts across the panel, the
 * Cookbook, the card and task buttons, Ask AI, and AI Standup.
 */
const AI_CONFIG: ToggleConfig = {
  key: AI_FEATURE_KEY,
  icon: <Sparkles size={16} />,
  title: 'AI Assistant',
  description: 'The assistant panel and every entry point into it: the Cookbook, AI Standup, AI Assist on a card, and Ask AI on a cheatsheet.',
  warning: 'Disabled. No model is contacted and no AI controls are shown. Saved chats, memories and provider keys are kept.',
  getState: () => readAiEnabled(),
  toggle: (active: boolean) => setAiEnabled(active)
}

const TOGGLE_CONFIGS = [AI_CONFIG, ...BACKGROUND_CONFIGS, ...SIDEBAR_VIEW_CONFIGS]

/** One toggle and its copy. Extracted because both sections drew it verbatim. */
function FeatureRow({ cfg, on, busy, onChange }: {
  cfg: ToggleConfig
  on: boolean
  busy: boolean
  onChange: (value: boolean) => void
}): React.JSX.Element {
  return (
    <RowBetween>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)', flex: 1 }}>
        <span style={{
          color: on ? 'var(--color-secondary)' : 'var(--color-text-faint)',
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
          {!on && (
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
      <ToggleSwitch checked={on} onChange={onChange} disabled={busy} label={cfg.title} />
    </RowBetween>
  )
}

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
      <div>
        <div style={{
          fontSize: '11px',
          fontWeight: 'var(--weight-bold)',
          color: 'var(--color-secondary)',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          marginBottom: 'var(--space-3)'
        }}>
          Assistant
        </div>
        <FeatureRow
          cfg={AI_CONFIG}
          on={states[AI_CONFIG.key] ?? false}
          busy={toggling === AI_CONFIG.key}
          onChange={v => handleToggle(AI_CONFIG, v)}
        />
      </div>

      <div style={{ height: '1px', background: 'var(--color-surface-offset)', margin: 'var(--space-2) 0' }} />

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
              <FeatureRow
                cfg={cfg}
                on={states[cfg.key] ?? false}
                busy={toggling === cfg.key}
                onChange={v => handleToggle(cfg, v)}
              />
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
              <FeatureRow
                cfg={cfg}
                on={states[cfg.key] ?? false}
                busy={toggling === cfg.key}
                onChange={v => handleToggle(cfg, v)}
              />
            </React.Fragment>
          ))}
        </div>
      </div>
    </div>
  )
}
