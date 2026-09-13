/** one authored list, not a registry views push into (they unmount); order matters for an empty query */

import type { CommandLike } from '../../../shared/commandMatch'
import type { ActiveView, SettingsTab } from '../store/appStore'
import type { SavedView } from '../../../shared/savedViews'
import { setSetting } from '../data/settings'

export interface Command extends CommandLike {
  /** shortcut hint or current value */
  hint?: string
  run: () => void | Promise<void>
}

/** passed in so this stays testable */
export interface CommandContext {
  setView: (view: ActiveView) => void
  setWorkspace: (slug: string) => void
  setSettingsTab: (tab: SettingsTab) => void
  setRightPanelContent: (content: 'item-detail' | 'ai-chat' | 'git' | null) => void
  toggleRightPanel: (content?: 'item-detail' | 'ai-chat' | 'git' | null) => void
  workspaces: string[]
  activeWorkspace: string
  /** switched-off views aren't offered */
  enabledViews: Partial<Record<ActiveView, boolean>>
  /** AI off hides the panel and its tab */
  aiEnabled: boolean
  /** so a view is one keystroke away */
  savedViews: SavedView[]
  applyView: (id: string) => void
}

const VIEWS: { view: ActiveView; label: string; keywords?: string[] }[] = [
  { view: 'kanban', label: 'Kanban', keywords: ['board', 'cards', 'columns'] },
  { view: 'log', label: 'Log', keywords: ['journal', 'timeline', 'entries'] },
  { view: 'backlog', label: 'Backlog', keywords: ['tasks', 'todo'] },
  { view: 'focus', label: 'Focus', keywords: ['pomodoro', 'timer', 'session'] },
  { view: 'notes', label: 'Notes', keywords: ['markdown', 'scratchpad', 'writing'] },
  { view: 'wall', label: 'Wall', keywords: ['canvas', 'freeform', 'moodboard', 'sticky', 'whiteboard'] },
  { view: 'clipboard', label: 'Clipboard', keywords: ['history', 'snippets', 'paste'] },
  { view: 'analytics', label: 'Analytics', keywords: ['stats', 'charts', 'metrics'] },
  { view: 'cookbook', label: 'Cookbook', keywords: ['models', 'ai', 'ollama'] },
  { view: 'cheatsheets', label: 'Cheatsheets', keywords: ['reference', 'docs', 'pdf'] },
  { view: 'gamedev', label: 'Game Dev', keywords: ['textures', 'sprites', 'atlas'] }
]

const SETTINGS_TABS: { tab: SettingsTab; label: string; keywords?: string[] }[] = [
  { tab: 'general', label: 'General' },
  { tab: 'appearance', label: 'Appearance & Theme', keywords: ['colors', 'theme', 'font', 'presets'] },
  { tab: 'workspaces', label: 'Workspaces & Board', keywords: ['workspaces', 'context', 'columns'] },
  { tab: 'ai', label: 'AI Assistant', keywords: ['model', 'provider', 'api key'] },
  { tab: 'hotkeyBinder', label: 'Shortcuts & Mouse', keywords: ['keys', 'bindings', 'hotkeys', 'rebind', 'mouse', 'buttons'] },
  { tab: 'features', label: 'Features & Plugins', keywords: ['toggles', 'extensions'] },
  { tab: 'notifications', label: 'Notifications', keywords: ['alerts', 'quiet hours', 'reminders'] },
  { tab: 'backup', label: 'Database Backup', keywords: ['snapshot', 'restore'] },
  { tab: 'storage', label: 'Storage & Export', keywords: ['files', 'disk', 'export', 'csv', 'markdown', 'backup data'] },
  { tab: 'sync', label: 'Device Sync', keywords: ['sync', 'p2p', 'peer', 'lan', 'devices', 'machines'] },
  { tab: 'mcp', label: 'MCP Server', keywords: ['agent', 'tools', 'activity'] },
  { tab: 'about', label: 'About' }
]

/** same as the titlebar toggle, persisted */
async function applyTheme(theme: 'dark' | 'light'): Promise<void> {
  document.documentElement.setAttribute('data-theme', theme)
  await setSetting('app_theme', theme)
}

export function buildCommands(ctx: CommandContext): Command[] {
  const commands: Command[] = []

  for (const { view, label, keywords } of VIEWS) {
    // no target for a disabled view
    if (ctx.enabledViews[view] === false) continue
    commands.push({
      id: `view:${view}`,
      label: `Go to ${label}`,
      group: 'Navigation',
      keywords,
      run: () => ctx.setView(view)
    })
  }

  for (const slug of ctx.workspaces) {
    if (slug === ctx.activeWorkspace) continue
    commands.push({
      // prefixed to keep ids distinct
      id: `workspace:${slug}`,
      label: `Switch to ${slug}`,
      group: 'Workspace',
      keywords: ['context', 'workspace', 'project'],
      run: () => ctx.setWorkspace(slug)
    })
  }

  for (const view of ctx.savedViews) {
    commands.push({
      id: `savedview:${view.id}`,
      label: view.name,
      group: 'Views',
      keywords: ['view', 'filter', 'saved', 'overdue', 'tasks'],
      run: () => ctx.applyView(view.id)
    })
  }

  if (ctx.aiEnabled) {
    commands.push({
      id: 'panel:ai',
      label: 'Toggle AI Assistant',
      group: 'Panels',
      keywords: ['chat', 'assistant'],
      run: () => ctx.toggleRightPanel('ai-chat')
    })
  }

  commands.push(
    {
      id: 'panel:git',
      label: 'Toggle Git Panel',
      group: 'Panels',
      keywords: ['commits', 'branch', 'status'],
      run: () => ctx.toggleRightPanel('git')
    },
    {
      id: 'panel:close',
      label: 'Close Right Panel',
      group: 'Panels',
      run: () => ctx.setRightPanelContent(null)
    },
    {
      id: 'theme:dark',
      label: 'Theme: Dark',
      group: 'Appearance',
      keywords: ['night', 'colors'],
      run: () => applyTheme('dark')
    },
    {
      id: 'theme:light',
      label: 'Theme: Light',
      group: 'Appearance',
      keywords: ['day', 'colors'],
      run: () => applyTheme('light')
    }
  )

  for (const { tab, label, keywords } of SETTINGS_TABS) {
    if (tab === 'ai' && !ctx.aiEnabled) continue
    commands.push({
      id: `settings:${tab}`,
      label: `Settings: ${label}`,
      group: 'Settings',
      keywords,
      run: () => {
        ctx.setSettingsTab(tab)
        ctx.setView('settings')
      }
    })
  }

  // also in Settings > About, but nobody looks there
  commands.push({
    id: 'help:tour',
    label: 'Show the getting started tour',
    group: 'Help',
    keywords: ['onboarding', 'welcome', 'walkthrough', 'intro', 'guide', 'shortcuts', 'help', 'again'],
    run: () => { window.dispatchEvent(new CustomEvent('replay-onboarding')) }
  })

  return commands
}
