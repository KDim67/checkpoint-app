/**
 * What the command palette can do.
 *
 * One authored list rather than a registry the views push into. Views mount and
 * unmount as you navigate, so a push-based registry would only ever contain the
 * commands for wherever you already are, precisely the commands you least need
 * a palette to reach. Everything here is driven through the store or the IPC
 * bridge, both of which are available whatever is on screen.
 *
 * Order is meaningful: `rankCommands` preserves it for an empty query, so the
 * palette opens on navigation rather than on whatever sorts first.
 */

import type { CommandLike } from '../../../shared/commandMatch'
import type { ActiveView, SettingsTab } from '../store/appStore'

export interface Command extends CommandLike {
  /** Shown on the right of the row, a shortcut hint or the current value. */
  hint?: string
  run: () => void | Promise<void>
}

/** The store surface the commands need. Passed in so this module stays testable. */
export interface CommandContext {
  setView: (view: ActiveView) => void
  setContext: (context: string) => void
  setSettingsTab: (tab: SettingsTab) => void
  setRightPanelContent: (content: 'item-detail' | 'ai-chat' | 'git' | null) => void
  toggleRightPanel: (content?: 'item-detail' | 'ai-chat' | 'git' | null) => void
  /** Workspaces available to switch to. */
  contexts: string[]
  activeContext: string
  /** Views the user has switched off are not offered. */
  enabledViews: Partial<Record<ActiveView, boolean>>
}

const VIEWS: { view: ActiveView; label: string; keywords?: string[] }[] = [
  { view: 'kanban', label: 'Kanban', keywords: ['board', 'cards', 'columns'] },
  { view: 'log', label: 'Log', keywords: ['journal', 'timeline', 'entries'] },
  { view: 'backlog', label: 'Backlog', keywords: ['tasks', 'todo'] },
  { view: 'focus', label: 'Focus', keywords: ['pomodoro', 'timer', 'session'] },
  { view: 'notes', label: 'Notes', keywords: ['markdown', 'scratchpad', 'writing'] },
  { view: 'clipboard', label: 'Clipboard', keywords: ['history', 'snippets', 'paste'] },
  { view: 'analytics', label: 'Analytics', keywords: ['stats', 'charts', 'metrics'] },
  { view: 'cookbook', label: 'Cookbook', keywords: ['models', 'ai', 'ollama'] },
  { view: 'cheatsheets', label: 'Cheatsheets', keywords: ['reference', 'docs', 'pdf'] },
  { view: 'gamedev', label: 'Game Dev', keywords: ['textures', 'sprites', 'atlas'] }
]

const SETTINGS_TABS: { tab: SettingsTab; label: string; keywords?: string[] }[] = [
  { tab: 'general', label: 'General' },
  { tab: 'appearance', label: 'Appearance & Theme', keywords: ['colors', 'theme', 'font', 'presets'] },
  { tab: 'contexts', label: 'Workspaces & Board', keywords: ['contexts', 'columns'] },
  { tab: 'ai', label: 'AI Assistant', keywords: ['model', 'provider', 'api key'] },
  { tab: 'hotkeyBinder', label: 'Keyboard Shortcuts', keywords: ['keys', 'bindings'] },
  { tab: 'features', label: 'Features & Plugins', keywords: ['toggles', 'extensions'] },
  { tab: 'notifications', label: 'Notifications', keywords: ['alerts', 'quiet hours', 'reminders'] },
  { tab: 'backup', label: 'Database Backup', keywords: ['snapshot', 'restore'] },
  { tab: 'storage', label: 'Storage & Media', keywords: ['files', 'disk'] },
  { tab: 'sync', label: 'P2P Network Sync', keywords: ['peer', 'lan', 'devices'] },
  { tab: 'mcp', label: 'MCP Server', keywords: ['agent', 'tools', 'activity'] },
  { tab: 'about', label: 'About' }
]

/** Applies a theme the same way the title-bar toggle does, and persists it. */
async function applyTheme(theme: 'dark' | 'light'): Promise<void> {
  document.documentElement.setAttribute('data-theme', theme)
  await window.electronAPI.db.setSetting('app_theme', theme)
}

export function buildCommands(ctx: CommandContext): Command[] {
  const commands: Command[] = []

  for (const { view, label, keywords } of VIEWS) {
    // A view the user has turned off has no navigation target.
    if (ctx.enabledViews[view] === false) continue
    commands.push({
      id: `view:${view}`,
      label: `Go to ${label}`,
      group: 'Navigation',
      keywords,
      run: () => ctx.setView(view)
    })
  }

  for (const context of ctx.contexts) {
    if (context === ctx.activeContext) continue
    commands.push({
      id: `context:${context}`,
      label: `Switch to ${context}`,
      group: 'Workspace',
      keywords: ['context', 'workspace', 'project'],
      run: () => ctx.setContext(context)
    })
  }

  commands.push(
    {
      id: 'panel:ai',
      label: 'Toggle AI Assistant',
      group: 'Panels',
      keywords: ['chat', 'assistant'],
      run: () => ctx.toggleRightPanel('ai-chat')
    },
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

  return commands
}
