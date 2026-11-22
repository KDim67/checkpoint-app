/** one authored list, not a registry views push into (they unmount); order matters for an empty query */

import type { CommandLike } from '../../../shared/commandMatch'
import type { ActiveView, CreateIntent, SettingsTab } from '../store/appStore'
import type { SavedView } from '../../../shared/savedViews'
import { setSetting } from '../data/settings'
import { openProblemReport } from './reportProblem'
import { SECTION_TERMS } from './settingsSearch'
import { withViewTransition } from './viewTransition'
import { triggerConfetti } from './celebration'
import { animateDiceRoll, animateCoinFlip } from './funAnimations'

function notifyToast(text: string, options?: { duration?: number }) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('checkpoint-toast', { detail: { text, ...options } }))
}

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
  /** goes to the view that owns it and makes one there */
  create: (intent: CreateIntent) => void
}

const VIEWS: { view: ActiveView; label: string; keywords?: string[] }[] = [
  { view: 'kanban', label: 'Kanban', keywords: ['board', 'cards', 'columns'] },
  { view: 'log', label: 'Log', keywords: ['journal', 'timeline', 'entries'] },
  { view: 'backlog', label: 'Backlog', keywords: ['tasks', 'todo'] },
  { view: 'calendar', label: 'Calendar', keywords: ['schedule', 'month', 'week', 'agenda', 'due', 'plan', 'ical', 'events'] },
  { view: 'renewals', label: 'Renewals', keywords: ['expiry', 'expires', 'subscription', 'domain', 'api key', 'certificate', 'licence'] },
  { view: 'focus', label: 'Focus', keywords: ['pomodoro', 'timer', 'session'] },
  { view: 'notes', label: 'Notes', keywords: ['markdown', 'scratchpad', 'writing'] },
  { view: 'wall', label: 'Wall', keywords: ['canvas', 'freeform', 'moodboard', 'sticky', 'whiteboard'] },
  { view: 'clipboard', label: 'Clipboard', keywords: ['history', 'snippets', 'paste'] },
  { view: 'analytics', label: 'Analytics', keywords: ['stats', 'charts', 'metrics'] },
  { view: 'cookbook', label: 'Cookbook', keywords: ['models', 'ai', 'ollama'] },
  { view: 'cheatsheets', label: 'Cheatsheets', keywords: ['reference', 'docs', 'pdf'] },
  { view: 'gamedev', label: 'Game Dev', keywords: ['textures', 'sprites', 'atlas'] },
  { view: 'workspaces', label: 'Workspaces', keywords: ['switch', 'manage', 'projects', 'context', 'rename', 'reorder'] }
]

const SETTINGS_TABS: { tab: SettingsTab; label: string }[] = [
  { tab: 'general', label: 'General' },
  { tab: 'appearance', label: 'Appearance' },
  { tab: 'workspaces', label: 'Board' },
  { tab: 'ai', label: 'AI Assistant' },
  { tab: 'connections', label: 'Connections' },
  { tab: 'hotkeyBinder', label: 'Shortcuts & Mouse' },
  { tab: 'features', label: 'Features & Plugins' },
  { tab: 'notifications', label: 'Notifications' },
  { tab: 'backup', label: 'Database Backup' },
  { tab: 'storage', label: 'Storage & Export' },
  { tab: 'sync', label: 'Device Sync' },
  { tab: 'mcp', label: 'MCP Server' },
  { tab: 'about', label: 'About' }
]

/** same as the titlebar toggle, persisted */
async function applyTheme(theme: 'dark' | 'light'): Promise<void> {
  document.documentElement.setAttribute('data-theme', theme)
  await setSetting('app_theme', theme)
}

/** the palette makes things as well as going places; each lands in its own view */
const CREATE: { intent: CreateIntent; view: ActiveView; label: string; keywords: string[] }[] = [
  { intent: 'card', view: 'kanban', label: 'New card', keywords: ['add', 'create', 'kanban', 'board'] },
  { intent: 'task', view: 'backlog', label: 'New task', keywords: ['add', 'create', 'todo', 'backlog'] },
  { intent: 'note', view: 'notes', label: 'New note', keywords: ['add', 'create', 'write', 'markdown'] },
  { intent: 'sticky', view: 'wall', label: 'New sticky note', keywords: ['add', 'create', 'wall', 'canvas'] },
  { intent: 'wall', view: 'wall', label: 'New wall', keywords: ['add', 'create', 'canvas', 'board', 'whiteboard'] },
  { intent: 'renewal', view: 'renewals', label: 'New renewal', keywords: ['add', 'expiry', 'subscription', 'domain', 'api key', 'certificate'] },
  { intent: 'workspace', view: 'workspaces', label: 'New workspace', keywords: ['add', 'create', 'project', 'context'] }
]

export function buildCommands(ctx: CommandContext): Command[] {
  const commands: Command[] = []

  for (const { intent, view, label, keywords } of CREATE) {
    if (ctx.enabledViews[view] === false) continue
    commands.push({ id: `create:${intent}`, label, group: 'Create', keywords, run: () => ctx.create(intent) })
  }

  for (const { view, label, keywords } of VIEWS) {
    // no target for a disabled view
    if (ctx.enabledViews[view] === false) continue
    commands.push({
      id: `view:${view}`,
      label: `Go to ${label}`,
      group: 'Navigation',
      keywords,
      run: () => withViewTransition(() => ctx.setView(view))
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

  for (const { tab, label } of SETTINGS_TABS) {
    if (tab === 'ai' && !ctx.aiEnabled) continue
    commands.push({
      id: `settings:${tab}`,
      label: `Settings: ${label}`,
      group: 'Settings',
      keywords: [...SECTION_TERMS[tab]],
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

  commands.push({
    id: 'help:report',
    label: 'Report a problem',
    group: 'Help',
    keywords: ['bug', 'issue', 'crash', 'error', 'broken', 'feedback', 'log', 'github'],
    run: () => openProblemReport()
  })

  // Fun & Quick Utilities
  commands.push(
    {
      id: 'fun:roll',
      label: 'Roll a Die (/roll)',
      group: 'Fun & Utilities',
      keywords: ['/roll', 'dice', 'd6', 'd20', 'random', 'roll', 'tabletop', 'game'],
      run: async () => {
        const { d6, d20 } = await animateDiceRoll()
        const result = `🎲 Rolled ${d6} (d6) and ${d20} (d20)${d20 === 20 ? ' — Critical Hit! 🔥' : d20 === 1 ? ' — Critical Miss! 💀' : ''}`
        try { await navigator.clipboard?.writeText(result) } catch {}
        notifyToast(result, { duration: 5000 })
      }
    },
    {
      id: 'fun:flip',
      label: 'Flip a Coin (/flip)',
      group: 'Fun & Utilities',
      keywords: ['/flip', 'coin', 'toss', 'heads', 'tails', 'random', 'choice'],
      run: async () => {
        const outcome = await animateCoinFlip()
        const result = `🪙 Coin landed on: ${outcome}!`
        try { await navigator.clipboard?.writeText(outcome) } catch {}
        notifyToast(result, { duration: 4000 })
      }
    },
    {
      id: 'fun:decide',
      label: 'Decide For Me (/decide)',
      group: 'Fun & Utilities',
      keywords: ['/decide', 'choose', 'random', 'pick', 'choice'],
      run: () => {
        const answers = [
          'Yes, absolutely! 🚀', 'Better not right now 🛑', 'Go for it! ✨',
          'Signs point to yes 🔮', 'Flip another coin 🪙', 'Without a doubt 💯',
          'Ask again after coffee ☕', 'The stars say yes ⭐', 'Hard no 🧱',
          'Sleep on it 😴', 'My sources say no 🔍', 'Definitely! 🎯'
        ]
        const pick = answers[Math.floor(Math.random() * answers.length)]
        notifyToast(`🎯 Decider says: ${pick}`, { duration: 5000 })
      }
    },
    {
      id: 'fun:confetti',
      label: 'Throw Confetti! (/confetti)',
      group: 'Fun & Utilities',
      keywords: ['/confetti', 'celebrate', 'party', 'fireworks', 'yay'],
      run: () => {
        void triggerConfetti()
        notifyToast('🎉 Woohoo! Celebrating your progress!', { duration: 3000 })
      }
    },
    {
      id: 'fun:shrug',
      label: 'Copy ¯\_(ツ)_/¯ (/shrug)',
      group: 'Fun & Utilities',
      keywords: ['/shrug', 'ascii', 'kaomoji', 'emoji', 'shrug'],
      run: async () => {
        try { await navigator.clipboard?.writeText('¯\_(ツ)_/¯') } catch {}
        notifyToast('¯\_(ツ)_/¯ copied to clipboard!')
      }
    },
    {
      id: 'fun:tableflip',
      label: 'Copy (╯°□°)╯︵ ┻━┻ (/tableflip)',
      group: 'Fun & Utilities',
      keywords: ['/tableflip', 'ascii', 'rage', 'kaomoji', 'tableflip'],
      run: async () => {
        try { await navigator.clipboard?.writeText('(╯°□°)╯︵ ┻━┻') } catch {}
        notifyToast('(╯°□°)╯︵ ┻━┻ copied to clipboard!')
      }
    },
    {
      id: 'fun:unflip',
      label: 'Copy ┬─┬ノ( º _ ºノ) (/unflip)',
      group: 'Fun & Utilities',
      keywords: ['/unflip', 'ascii', 'calm', 'kaomoji', 'unflip', 'table'],
      run: async () => {
        try { await navigator.clipboard?.writeText('┬─┬ノ( º _ ºノ)') } catch {}
        notifyToast('┬─┬ノ( º _ ºノ) copied to clipboard!')
      }
    },
    {
      id: 'fun:motivate',
      label: 'Daily Dev Motivation (/motivate)',
      group: 'Fun & Utilities',
      keywords: ['/motivate', 'quote', 'inspiration', 'daily', 'wisdom'],
      run: () => {
        const quotes = [
          '✨ "Done is better than perfect." — Keep shipping!',
          '🛠️ "First make it work, then make it right, then make it fast."',
          '💡 "Small, steady commits turn into massive milestones."',
          '🎮 "Great games are not made; they are iterated into greatness."',
          '☕ "Code. Test. Breathe. You got this!"',
          '🧗 "Every expert was once a beginner."',
          '🔥 "Ship today what you can improve tomorrow."',
          '🌱 "Progress, not perfection."',
          '🎯 "Focus on impact, not hours."',
          '🚀 "The best time to refactor was last sprint. The second best is now."'
        ]
        const quote = quotes[Math.floor(Math.random() * quotes.length)]
        notifyToast(quote, { duration: 6000 })
      }
    }
  )

  return commands
}
