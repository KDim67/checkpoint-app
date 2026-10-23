/** what Settings search can find: each setting by the words on screen, so a result reads the same as where it lands */

import type { SettingsTab } from '../store/appStore'
import { STARTUP_OPTIONS } from '../../../shared/startupSettings'
import { NOTIFICATION_CATEGORIES } from '../../../shared/notificationPolicy'
import { CONNECTION_SERVICES, SERVICES } from '../../../shared/connections'
import { VIEW_FEATURES } from './features'
import { APP_SHORTCUTS, SCOPE_LABELS, VIEW_SHORTCUTS } from './shortcuts'

export interface SettingsEntry {
  /** exactly as the screen says it, the landing looks for this text */
  name: string
  tab: SettingsTab
  /** a heading the setting sits under, shown with the result and narrowing the landing */
  under?: string
  /** other words people search with */
  terms?: readonly string[]
  windowsOnly?: boolean
  needsAi?: boolean
}

/** a section's own words, shared with the command palette */
export const SECTION_TERMS: Record<SettingsTab, readonly string[]> = {
  general: ['startup', 'launch', 'tray', 'widget'],
  appearance: ['colors', 'colours', 'theme', 'font', 'presets', 'dark', 'light'],
  workspaces: ['columns', 'kanban', 'wip', 'limits'],
  ai: ['model', 'provider', 'api key'],
  connections: ['github', 'issues', 'integrations', 'key'],
  hotkeyBinder: ['keys', 'bindings', 'hotkeys', 'rebind', 'mouse', 'buttons'],
  features: ['toggles', 'extensions'],
  notifications: ['alerts', 'quiet hours', 'reminders'],
  backup: ['snapshot', 'restore'],
  storage: ['files', 'disk', 'export', 'csv', 'markdown', 'backup data'],
  sync: ['sync', 'p2p', 'peer', 'lan', 'devices', 'machines'],
  mcp: ['agent', 'tools', 'activity'],
  about: ['version', 'licence', 'license', 'logs', 'credits']
}

const STARTUP_TERMS: Record<string, readonly string[]> = {
  openAtLogin: ['autostart', 'login', 'sign in', 'boot'],
  startMinimised: ['minimised', 'minimized', 'background'],
  closeToTray: ['minimise', 'minimize', 'quit', 'exit'],
  showTrayIcon: ['notification area', 'system tray']
}

export const SETTINGS_ENTRIES: readonly SettingsEntry[] = [
  { name: 'Startup workspace', tab: 'general', terms: ['open with', 'default workspace'] },
  { name: 'Startup view', tab: 'general', terms: ['first view', 'open on', 'last used'] },
  ...STARTUP_OPTIONS.map(option => ({ name: option.label, tab: 'general' as const, terms: STARTUP_TERMS[option.key], windowsOnly: true })),
  { name: 'Show desktop widget', tab: 'general', terms: ['overlay', 'always on top', 'widget position', 'opacity'], windowsOnly: true },

  { name: 'Interface theme', tab: 'appearance', terms: ['dark', 'light', 'mode', 'system'] },
  { name: 'Font size', tab: 'appearance', terms: ['text size', 'text scale', 'zoom', 'bigger', 'smaller'] },
  { name: 'Compact mode', tab: 'appearance', terms: ['density', 'dense', 'padding'] },
  { name: 'Custom theme file', tab: 'appearance', terms: ['css', 'theme.css', 'tokens'] },
  { name: 'Use my customizations', tab: 'appearance', terms: ['customizer', 'theme engine', 'custom theme', 'plugins'] },
  { name: 'Presets', tab: 'appearance', terms: ['theme preset', 'save theme'] },
  { name: 'Colours', tab: 'appearance', terms: ['colors', 'accent', 'palette', 'background', 'text colour'] },
  { name: 'Font family', tab: 'appearance', terms: ['typeface', 'typography', 'font'] },
  { name: 'Reset colours and font', tab: 'appearance', terms: ['default theme', 'reset theme'] },

  { name: 'Open the Workspaces page', tab: 'workspaces', terms: ['workspaces', 'rename workspace', 'new workspace', 'switch workspace'] },
  { name: 'Kanban Columns', tab: 'workspaces', terms: ['column names', 'rename column'] },
  { name: 'WIP limit', tab: 'workspaces', terms: ['work in progress', 'cards per column'] },

  { name: 'Provider', tab: 'ai', terms: ['openai', 'anthropic', 'claude', 'ollama', 'lm studio', 'connection'], needsAi: true },
  { name: 'Base URL', tab: 'ai', terms: ['endpoint', 'url', 'server'], needsAi: true },
  { name: 'API key', tab: 'ai', terms: ['key', 'token', 'secret'], needsAi: true },
  { name: 'Model', tab: 'ai', needsAi: true },
  { name: 'Temperature', tab: 'ai', terms: ['creativity', 'random'], needsAi: true },
  { name: 'Max tokens', tab: 'ai', terms: ['length', 'output'], needsAi: true },
  { name: 'Test connection', tab: 'ai', terms: ['check'], needsAi: true },
  { name: 'Email voice', tab: 'ai', terms: ['writing style', 'tone', 'samples', 'drafts'], needsAi: true },
  { name: 'Memory', tab: 'ai', terms: ['memories', 'rules', 'lore', 'remember', 'facts'], needsAi: true },

  ...CONNECTION_SERVICES.map(service => ({ name: SERVICES[service].name, tab: 'connections' as const, terms: ['connect', 'disconnect', 'key', 'sync'] })),

  { name: 'Global Shortcuts', tab: 'hotkeyBinder', terms: ['system-wide', 'hotkeys'] },
  { name: 'Open quick capture', tab: 'hotkeyBinder', terms: ['hud', 'spotlight'] },
  { name: 'Open clipboard history', tab: 'hotkeyBinder', terms: ['clipboard'] },
  { name: 'In-App Shortcuts', tab: 'hotkeyBinder', terms: ['keyboard'] },
  ...APP_SHORTCUTS.map(shortcut => ({
    name: shortcut.label,
    tab: 'hotkeyBinder' as const,
    needsAi: shortcut.action.kind === 'toggleAiPanel'
  })),
  { name: 'View Shortcuts', tab: 'hotkeyBinder', terms: ['keyboard'] },
  ...VIEW_SHORTCUTS.map(shortcut => ({ name: shortcut.label, tab: 'hotkeyBinder' as const, under: SCOPE_LABELS[shortcut.scope] })),
  { name: 'Pan the wall with', tab: 'hotkeyBinder', terms: ['mouse', 'right button', 'middle button', 'drag'] },
  { name: 'Open the context menu with', tab: 'hotkeyBinder', terms: ['mouse', 'right click', 'middle click'] },

  { name: 'AI Assistant', tab: 'features', terms: ['turn off ai', 'disable ai', 'model calls'] },
  { name: 'Webhooks', tab: 'features', terms: ['webhook', 'http', 'port', 'token'] },
  { name: 'Quick capture', tab: 'features', terms: ['spotlight', 'hud'] },
  { name: 'Automatic backups', tab: 'features', terms: ['backup'] },
  { name: 'Activity tracking', tab: 'features', terms: ['tracking', 'analytics', 'time'] },
  { name: 'Focused & Clean', tab: 'features', terms: ['layout profile', 'minimal'] },
  { name: 'Full Suite', tab: 'features', terms: ['layout profile', 'everything'] },
  ...VIEW_FEATURES.map(feature => ({ name: feature.label, tab: 'features' as const, terms: ['sidebar', 'show', 'hide', 'view'] })),
  { name: 'Your plugins', tab: 'features', terms: ['plugins', 'extensions', 'scripts'] },

  { name: 'Desktop notifications', tab: 'notifications', terms: ['alerts', 'notify', 'toast'] },
  ...NOTIFICATION_CATEGORIES.map(category => ({ name: category.label, tab: 'notifications' as const })),
  { name: 'Quiet hours', tab: 'notifications', terms: ['do not disturb', 'dnd', 'silent', 'night'] },
  { name: 'Send a test', tab: 'notifications', terms: ['test notification'] },

  { name: 'Automatic backups', tab: 'backup', terms: ['auto backup', 'snapshots', 'schedule'] },
  { name: 'Backup folder', tab: 'backup', terms: ['directory', 'location', 'path'] },
  { name: 'How often', tab: 'backup', terms: ['backup interval', 'daily', 'weekly', 'frequency'] },
  { name: 'Backups to keep', tab: 'backup', terms: ['retention', 'how many', 'prune'] },
  { name: 'Backups', tab: 'backup', terms: ['restore', 'snapshots', 'archives', 'delete backup', 'back up now'] },

  { name: 'Export', tab: 'storage', terms: ['export your data', 'csv', 'json', 'markdown', 'download'] },
  { name: 'Attachments', tab: 'storage', terms: ['media', 'disk', 'size', 'images', 'files'] },
  { name: 'Clean up unused attachments', tab: 'storage', terms: ['prune', 'orphaned', 'unused files', 'delete media'] },

  { name: 'Sync this computer', tab: 'sync', terms: ['turn on sync', 'enable sync'] },
  { name: 'On this network', tab: 'sync', terms: ['wifi', 'lan', 'pair', 'passcode'] },
  { name: 'Connect by address', tab: 'sync', terms: ['ip address', 'vpn', 'tailscale', 'manual'] },
  { name: 'Over the internet', tab: 'sync', terms: ['internet', 'remote', 'code', 'webrtc'] },
  { name: 'Relay Server', tab: 'sync', terms: ['turn', 'firewall', 'relay'] },

  { name: 'MCP server', tab: 'mcp', terms: ['agents', 'claude', 'model context protocol', 'enable'] },
  { name: 'Port', tab: 'mcp', terms: ['mcp port'] },
  { name: 'Access token', tab: 'mcp', terms: ['token', 'regenerate', 'new token'] },
  { name: 'Client configuration', tab: 'mcp', terms: ['config', 'json'] },
  { name: 'Agent Activity', tab: 'mcp', terms: ['undo', 'agent changes', 'recent'] },

  { name: 'App version', tab: 'about', terms: ['version', 'electron', 'chromium', 'node'] },
  { name: 'Check for updates', tab: 'about', terms: ['update', 'upgrade', 'new version'] },
  { name: 'Getting started', tab: 'about', terms: ['tour', 'welcome', 'onboarding'] },
  { name: 'Report a problem', tab: 'about', terms: ['bug', 'issue', 'crash'] },
  { name: 'Show the app log', tab: 'about', terms: ['logs', 'errors', 'diagnostics'] },
  { name: 'Show the update log', tab: 'about', terms: ['logs', 'updates'] },
  { name: 'Database location', tab: 'about', terms: ['data folder', 'where is my data'] },
  { name: 'MIT License', tab: 'about', terms: ['licence', 'copyright'] }
]

/** case, accents and punctuation never decide a match, and & reads as and */
export function searchable(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

const startsAWord = (text: string, word: string): boolean => text.startsWith(word) || text.includes(` ${word}`)

/** how well one typed word fits; 0 rules the entry out */
function fit(word: string, name: string, terms: string[], where: string): number {
  if (startsAWord(name, word)) return 3
  if (name.includes(word) || terms.some(term => startsAWord(term, word))) return 2
  if (terms.some(term => term.includes(word))) return 1
  return startsAWord(where, word) ? 1 : 0
}

/** every typed word has to be found; the name outranks other words, and earlier entries win ties */
export function searchSettings<T extends SettingsEntry>(entries: readonly T[], query: string, whereOf: (entry: T) => string): T[] {
  const typed = searchable(query)
  if (!typed) return []
  const words = typed.split(' ')
  const ranked: { entry: T; score: number }[] = []
  for (const entry of entries) {
    const name = searchable(entry.name)
    const terms = (entry.terms ?? []).map(searchable)
    const where = searchable(whereOf(entry))
    let score = name === typed ? 5 : name.startsWith(typed) ? 2 : 0
    for (const word of words) {
      const points = fit(word, name, terms, where)
      if (points === 0) { score = -1; break }
      score += points
    }
    if (score > 0) ranked.push({ entry, score })
  }
  return ranked.sort((a, b) => b.score - a.score).map(hit => hit.entry)
}
