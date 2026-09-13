/** an allowlist, a missed key stays home; the denylists stay as extra nets; applied on receive too */

/** one by one, adding one should be a decision */
const SYNCABLE_KEY_NAMES = [
  // which workspaces exist and which is in front
  'active_context',
  'contexts_list',
  'default_context',
  'last_active_view',
  'start_view',

  // appearance
  'app_theme',
  'appearance_compact',
  'appearance_font_size',
  'right_panel_width',

  // theme customizer and plugins
  'customizer_active_plugins',
  'customizer_enabled',
  'customizer_shortcuts',
  'customizer_theme_vars',

  // focus timer
  'focus_auto_start_next',
  'focus_chime_enabled',
  'focus_chime_volume',
  'focus_long_break_interval',
  'focus_notifications_enabled',

  // how often to back up, never where
  'backup_interval',
  'backup_max_count',

  // feature switches
  'feature_backup',
  'feature_hud',
  'feature_mcp',
  'feature_tracker',
  'feature_webhook',
  'feature_ai',

  // misc preferences
  'cheatsheet_pins',
  'saved_views',
  'unitySafeMode',
  'widget_enabled',
  'widget_opacity'
]

// lowercased, keys like unitySafeMode mix case
const SYNCABLE_KEYS = new Set(SYNCABLE_KEY_NAMES.map(k => k.toLowerCase()))

/** the key ends in something the user chose */
const SYNCABLE_PREFIXES = [
  'kanban_',                  // board config, legacy keys too
  'backlog_columns_layout_',
  'wall_',                    // wall_<context>, wall_doc_<id>, wall_index_<context>
  'wallview_',                // the wall's pen and rail prefs
  'feature_view_'             // sidebar views
]

/** clipboard capture starts recording, so it never syncs on */
const NEVER_SYNC = new Set(['feature_view_clipboard'])

/** credentials and provider config */
export function isSensitiveSettingKey(key: string): boolean {
  const k = key.toLowerCase()
  return (
    k.startsWith('ai_') ||
    k.startsWith('sync_') ||
    k.includes('api_key') ||
    k.includes('secret') ||
    k.includes('token') ||
    k.includes('preset') ||
    k.includes('openai') ||
    k.includes('gemini') ||
    k.includes('anthropic') ||
    k.includes('groq') ||
    k.includes('ollama')
  )
}

/** named explicitly; the suffix rules catch later ones */
const MACHINE_LOCAL_KEYS = new Set([
  'backup_path',        // a directory on one machine
  'last_backup_time',   // this machine's last backup
  'window_bounds',      // geometry for this display
  'widget_position',    // same
  'webhook_port',       // a port that may be taken elsewhere
  'mcp_port',           // same
  'startup_settings'    // an OS registration, not a preference
])

/** _path, _port, _bounds and _position don't survive other hardware */
const MACHINE_LOCAL_SUFFIXES = ['_path', '_port', '_bounds', '_position']

/** user-named suffixes, so a "port" workspace isn't a socket */
const CONTEXT_SCOPED_PREFIXES = [
  'kanban_',
  'backlog_columns_layout_',
  'wall_'
]

export function isMachineLocalSettingKey(key: string): boolean {
  const k = key.toLowerCase()
  if (MACHINE_LOCAL_KEYS.has(k)) return true
  if (CONTEXT_SCOPED_PREFIXES.some(prefix => k.startsWith(prefix))) return false
  return MACHINE_LOCAL_SUFFIXES.some(suffix => k.endsWith(suffix))
}

/** before the denylists */
function isListedForSync(key: string): boolean {
  const k = key.toLowerCase()
  if (NEVER_SYNC.has(k)) return false
  if (SYNCABLE_KEYS.has(k)) return true
  return SYNCABLE_PREFIXES.some(prefix => k.startsWith(prefix))
}

/** the one question both ends ask */
export function isSyncableSettingKey(key: string): boolean {
  return isListedForSync(key) && !isSensitiveSettingKey(key) && !isMachineLocalSettingKey(key)
}

export function filterSyncableSettings<T extends { key: string }>(rows: T[]): T[] {
  return rows.filter(row => isSyncableSettingKey(row.key))
}
