import React, { useState, useEffect } from 'react'
import { Webhook, Crosshair, Archive, Activity, Gamepad, RefreshCw, Columns, FileText, ListTodo, Timer, BookOpen, Clipboard, BarChart2, Sparkles, Book, LayoutGrid, CalendarClock, Calendar, AlertTriangle, Info, Cpu, PanelLeft } from 'lucide-react'
import SettingsSection, { ToggleSwitch, Divider, SettingsCardSkeleton } from './SettingsSection'
import { AI_FEATURE_KEY, VIEW_FEATURES, readAiEnabled, setAiEnabled, setViewFeature, readLayoutProfile, applyLayoutProfile, type LayoutProfile } from '../../lib/features'
import { WEBHOOK_DEFAULT_PORT } from '../../../../shared/ports'
import { COPIED_FEEDBACK_MS } from '../../lib/timings'
import { getBoolSetting, getNumberSetting, setBoolSetting } from '../../lib/settings'
import * as webhookApi from '../../data/webhook'
import * as hudApi from '../../data/hud'
import * as backupApi from '../../data/backup'
import * as trackerApi from '../../data/tracker'
import * as syncApi from '../../data/sync'

interface ToggleConfig {
  key: string
  icon: React.ReactNode
  title: string
  description: string
  /** what being off means, said only while it is off */
  offNote?: string
  /** something to know before turning it on, said whichever way it is */
  caution?: string
  getState: () => Promise<boolean>
  toggle: (active: boolean) => Promise<void>
}

/** shown, not hidden: loopback is reachable from any page, the token is the only guard */
function WebhookToken(): React.JSX.Element | null {
  const [token, setToken] = useState<string>('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let cancelled = false
    webhookApi.getToken().then(value => {
      if (!cancelled) setToken(value)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  if (!token) return null

  const example = `curl -H "Authorization: Bearer ${token}" -H "Content-Type: application/json" \\
  -d '{"context":"work","title":"Hello"}' http://127.0.0.1:${WEBHOOK_DEFAULT_PORT}/api/v1/log`

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--space-2)',
      margin: 'var(--space-2) 0 0 calc(var(--space-4) + var(--space-3))',
      padding: 'var(--space-3)',
      background: 'var(--color-surface-2)',
      border: '1px solid var(--color-surface-offset)',
      borderRadius: 'var(--radius-md)'
    }}>
      <div className="row-between-gap">
        <span className="text-label-xs-semibold">
          Token
        </span>
        <button
          type="button"
          className="btn-secondary btn-small"
          onClick={() => {
            navigator.clipboard.writeText(token).then(() => {
              setCopied(true)
              setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS)
            }).catch(() => {})
          }}
        >
          {copied ? 'Copied' : 'Copy the token'}
        </button>
      </div>
      <code style={{
        display: 'block', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)',
        color: 'var(--color-text-muted)', wordBreak: 'break-all'
      }}>
        {token}
      </code>
      <span className="text-sub">For example:</span>
      <pre style={{
        margin: 0, fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)',
        color: 'var(--color-text-muted)', whiteSpace: 'pre-wrap', wordBreak: 'break-all'
      }}>{example}</pre>
    </div>
  )
}

const BACKGROUND_CONFIGS: ToggleConfig[] = [
  {
    key: 'webhook',
    icon: <Webhook size={16} />,
    title: 'Webhooks',
    description: 'Lets scripts and tools on this computer add entries through a local web address, using the token below.',
    getState: async () => {
      return getBoolSetting('feature_webhook', true)
    },
    toggle: async (active: boolean) => {
      await setBoolSetting('feature_webhook', active)
      // reuse the running port, a literal moved it and broke external posts
      const port = await getNumberSetting('webhook_port', WEBHOOK_DEFAULT_PORT)
      await webhookApi.toggle(active, port)
    }
  },
  {
    key: 'hud',
    icon: <Crosshair size={16} />,
    title: 'Quick capture',
    description: 'A bar you open from anywhere with a shortcut, to jot down a task or a log entry.',
    offNote: 'Its shortcut does nothing while this is off.',
    getState: async () => {
      return getBoolSetting('feature_hud', true)
    },
    toggle: async (active: boolean) => {
      await setBoolSetting('feature_hud', active)
      await hudApi.toggle(active)
    }
  },
  {
    key: 'backup',
    icon: <Archive size={16} />,
    title: 'Automatic backups',
    description: 'Copies your data on a schedule. How often, and how many to keep, are under Database Backup.',
    offNote: 'Backups already made are kept, and Back up now still works.',
    getState: async () => {
      return getBoolSetting('feature_backup', true)
    },
    toggle: async (active: boolean) => {
      await setBoolSetting('feature_backup', active)
      // re-arm now, persisting the flag left the old timers running
      await backupApi.run('init')
    }
  },
  {
    key: 'tracker',
    icon: <Activity size={16} />,
    title: 'Activity tracking',
    description: 'Notes which app is in front while you work, for the timeline in Analytics.',
    getState: async () => {
      try { return await trackerApi.getState() }
      catch { return false }
    },
    toggle: async (active: boolean) => {
      await setBoolSetting('feature_tracker', active)
      await trackerApi.toggle(active)
    }
  },
  {
    key: 'sync',
    icon: <RefreshCw size={16} />,
    title: 'Device Sync',
    description: 'Keeps your own computers in step, over your network or the internet, with no cloud in between.',
    offNote: 'Other computers can\'t find or reach this one while it is off.',
    getState: async () => {
      return getBoolSetting('sync_enabled', false)
    },
    toggle: async (active: boolean) => {
      await setBoolSetting('sync_enabled', active)
      if (active) {
        await syncApi.startHost()
      } else {
        await syncApi.stopHost()
      }
      window.dispatchEvent(new CustomEvent('settings-update-sync'))
    }
  }
]

/** keyed by settings key; key, label and default live in lib/features so nothing disagrees */
const VIEW_COPY: Record<string, { key: string; icon: React.ReactNode; description: string; offNote?: string; caution?: string }> = {
  'feature_view_kanban': {
    key: 'view_kanban',
    icon: <Columns size={16} />,
    description: 'Cards in columns, moved along as the work moves.'
  },
  'feature_view_log': {
    key: 'view_log',
    icon: <FileText size={16} />,
    description: 'What you did each day, with notes and screenshots.'
  },
  'feature_view_backlog': {
    key: 'view_backlog',
    icon: <ListTodo size={16} />,
    description: 'Every task in a table you can sort, filter and plan from.'
  },
  'feature_view_calendar': {
    key: 'view_calendar',
    icon: <Calendar size={16} />,
    description: 'Due dates, repeating tasks, renewals and focus sessions by month, week or agenda.'
  },
  'feature_view_renewals': {
    key: 'view_renewals',
    icon: <CalendarClock size={16} />,
    description: 'Keys, subscriptions, domains and certificates that expire, with warnings before they do.',
    offNote: 'Warnings for what is already tracked keep coming. Turn those off under Notifications.'
  },
  'feature_view_focus': {
    key: 'view_focus',
    icon: <Timer size={16} />,
    description: 'A focus timer with breaks, and a place to jot down what interrupted you.'
  },
  'feature_view_notes': {
    key: 'view_notes',
    icon: <BookOpen size={16} />,
    description: 'Markdown notes kept as files on this computer, with links between them and search.'
  },
  'feature_view_wall': {
    key: 'view_wall',
    icon: <LayoutGrid size={16} />,
    description: 'A canvas for arranging cards, notes, images and reference material freely.'
  },
  'feature_view_clipboard': {
    key: 'view_clipboard',
    icon: <Clipboard size={16} />,
    description: 'Keeps every piece of text you copy, so you can search back through them.',
    caution: 'Copies are kept as plain text in Checkpoint and its backups. Anything a password manager marks as private is skipped, '
      + 'and so is text that looks like a password or key, but browser extensions don\'t mark their copies.'
  },
  'feature_view_analytics': {
    key: 'view_analytics',
    icon: <BarChart2 size={16} />,
    description: 'Charts of the apps you used, your focus sessions and where the time went.'
  },
  'feature_view_cookbook': {
    key: 'view_cookbook',
    icon: <Sparkles size={16} />,
    description: 'Ready-made prompts and the models you can run them with.'
  },
  'feature_view_cheatsheets': {
    key: 'view_cheatsheets',
    icon: <Book size={16} />,
    description: 'Reference sheets and PDFs, kept and read inside Checkpoint.'
  },
  'feature_gamedev_helpers': {
    key: 'gamedev_helpers',
    icon: <Gamepad size={16} />,
    description: 'Texture and pixel-art tools, sprite atlases, a batch renamer and a dialogue editor.'
  }
}

/** a view without copy renders its label; missing copy used to crash Settings */
const SIDEBAR_VIEW_CONFIGS: ToggleConfig[] = VIEW_FEATURES.map(feature => {
  const copy = VIEW_COPY[feature.key] ?? {
    key: feature.key,
    icon: <Columns size={16} />,
    description: ''
  }
  return {
    key: copy.key,
    icon: copy.icon,
    title: feature.label,
    description: copy.description,
    offNote: copy.offNote,
    caution: copy.caution,
    getState: () => getBoolSetting(feature.key, feature.defaultOn),
    toggle: (active: boolean) => setViewFeature(feature.key, active)
  }
})

/** its own section, it cuts across many views */
const AI_CONFIG: ToggleConfig = {
  key: AI_FEATURE_KEY,
  icon: <Sparkles size={16} />,
  title: 'AI Assistant',
  description: 'The assistant panel and every way into it: the Cookbook, AI Standup, AI Assist on a card, and Ask AI on a cheatsheet.',
  offNote: 'No model is contacted and no AI buttons show. Saved chats, memories and keys are kept.',
  getState: () => readAiEnabled(),
  toggle: (active: boolean) => setAiEnabled(active)
}

const TOGGLE_CONFIGS = [AI_CONFIG, ...BACKGROUND_CONFIGS, ...SIDEBAR_VIEW_CONFIGS]

function FeatureRow({ cfg, on, busy, onChange }: {
  cfg: ToggleConfig
  on: boolean
  busy: boolean
  onChange: (value: boolean) => void
}): React.JSX.Element {
  const id = React.useId()
  const note = !on && cfg.offNote
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--space-4)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)', flex: 1, minWidth: 0 }}>
        <span aria-hidden="true" style={{
          display: 'flex',
          color: on ? 'var(--color-secondary)' : 'var(--color-text-faint)',
          marginTop: 'var(--space-0-5)',
          flexShrink: 0,
          transition: 'color var(--duration-normal) var(--ease-default)'
        }}>
          {cfg.icon}
        </span>
        <div className="min-w-0">
          <label htmlFor={id} className="text-item" style={{ display: 'block', cursor: busy ? 'default' : 'pointer' }}>
            {cfg.title}
          </label>
          {cfg.description && (
            <div id={`${id}-description`} className="text-sub" style={{ lineHeight: 'var(--leading-normal)' }}>
              {cfg.description}
            </div>
          )}
          {cfg.caution && (
            <div className="settings-note" data-tone="warning">
              <AlertTriangle size={12} aria-hidden="true" />
              {cfg.caution}
            </div>
          )}
          {note && (
            <div className="settings-note">
              <Info size={12} aria-hidden="true" />
              {note}
            </div>
          )}
        </div>
      </div>
      <ToggleSwitch
        id={id}
        checked={on}
        onChange={onChange}
        disabled={busy}
        describedBy={cfg.description ? `${id}-description` : undefined}
      />
    </div>
  )
}

export default function FeatureToggleCenter() {
  const [states, setStates] = useState<Record<string, boolean>>({})
  const [profile, setProfile] = useState<LayoutProfile>('focused')
  const [loading, setLoading] = useState(true)
  const [toggling, setToggling] = useState<string | null>(null)

  const reloadStates = async (): Promise<Record<string, boolean>> => {
    const results: Record<string, boolean> = {}
    await Promise.all(
      TOGGLE_CONFIGS.map(async cfg => {
        try { results[cfg.key] = await cfg.getState() }
        catch { results[cfg.key] = false }
      })
    )
    return results
  }

  useEffect(() => {
    const loadAll = async () => {
      const [currentProfile, results] = await Promise.all([
        readLayoutProfile(),
        reloadStates()
      ])
      setProfile(currentProfile)
      setStates(results)
      setLoading(false)
    }
    loadAll()
  }, [])

  const handleSelectProfile = async (targetProfile: LayoutProfile) => {
    setProfile(targetProfile)
    await applyLayoutProfile(targetProfile)
    const results = await reloadStates()
    setStates(results)
  }

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
    return <SettingsCardSkeleton label="Loading the features" rows={5} />
  }

  const rows = (configs: ToggleConfig[]) => (
    <div className="col-xs">
      {configs.map((cfg, i) => (
        <React.Fragment key={cfg.key}>
          {i > 0 && <Divider />}
          <FeatureRow
            cfg={cfg}
            on={states[cfg.key] ?? false}
            busy={toggling === cfg.key}
            onChange={v => handleToggle(cfg, v)}
          />
          {cfg.key === 'webhook' && states.webhook && <WebhookToken />}
        </React.Fragment>
      ))}
    </div>
  )

  const profiles: { id: LayoutProfile; name: string; description: string; testId: string }[] = [
    {
      id: 'focused',
      name: 'Focused & Clean',
      description: 'Kanban, Wall, Notes, Focus and the rest of the everyday views, with Log, Cheatsheets, Analytics and Clipboard hidden.',
      testId: 'profile-focused-btn'
    },
    {
      id: 'full',
      name: 'Full Suite',
      description: 'Log, Cheatsheets and Analytics shown as well. Clipboard stays off until you turn it on.',
      testId: 'profile-full-btn'
    }
  ]

  return (
    <>
      <SettingsSection icon={<Sparkles size={14} />} title="Assistant" description="The AI features, everywhere at once.">
        {rows([AI_CONFIG])}
      </SettingsSection>

      <SettingsSection icon={<Cpu size={14} />} title="Background" description="Things that run while you work, without a page of their own.">
        {rows(BACKGROUND_CONFIGS)}
      </SettingsSection>

      <SettingsSection icon={<PanelLeft size={14} />} title="Sidebar views" description="The pages in the sidebar. Pick a starting set, then turn single views on or off.">
        <div className="col-lg">
          <div
            role="radiogroup"
            aria-label="Starting set"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 16rem), 1fr))',
              gap: 'var(--space-3)'
            }}
          >
            {profiles.map(option => {
              const chosen = profile === option.id
              return (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={chosen}
                  data-testid={option.testId}
                  onClick={() => handleSelectProfile(option.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 'var(--space-3)',
                    padding: 'var(--space-3)',
                    background: chosen ? 'var(--color-secondary-muted)' : 'var(--color-surface-2)',
                    border: `1px solid ${chosen ? 'var(--color-secondary)' : 'var(--color-surface-offset)'}`,
                    borderRadius: 'var(--radius-md)',
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'border-color var(--duration-fast) var(--ease-default), background var(--duration-fast) var(--ease-default)'
                  }}
                >
                  <span aria-hidden="true" style={{
                    width: 'var(--space-4)', height: 'var(--space-4)', borderRadius: 'var(--radius-full)',
                    border: `2px solid ${chosen ? 'var(--color-secondary)' : 'var(--color-text-faint)'}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 'var(--space-0-5)'
                  }}>
                    {chosen && (
                      <span style={{ width: 'var(--space-2)', height: 'var(--space-2)', borderRadius: 'var(--radius-full)', background: 'var(--color-secondary)' }} />
                    )}
                  </span>
                  <span className="min-w-0" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                    <span className="text-item-strong">
                      {option.name}
                    </span>
                    <span className="text-hint" style={{ lineHeight: 'var(--leading-normal)' }}>
                      {option.description}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>

          {rows(SIDEBAR_VIEW_CONFIGS)}
        </div>
      </SettingsSection>
    </>
  )
}
