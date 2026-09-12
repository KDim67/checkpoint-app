/**
 * Which settings may travel between paired machines.
 *
 * An allowlist. A key nobody has thought about does not sync, which is the
 * safe direction to be wrong in: a setting that should travel and does not is
 * a papercut, a credential that travels and should not is a breach. This used
 * to be a denylist of substrings, so a future key called `github_pat` or
 * `license_key` would have been shipped to a paired machine silently.
 *
 * The two denylists below survive as second and third nets. They cost nothing
 * and they catch the case where a key is added to the allowlist by mistake.
 *
 * Applied on receive as well as send: an older peer still ships these keys.
 */

/**
 * Settings that describe the person rather than the machine.
 *
 * Listed one by one on purpose. Adding a setting here should be a decision,
 * and the whole point of the list is that forgetting to make it means the
 * setting stays home.
 */
const SYNCABLE_KEY_NAMES = [
  // Which workspaces exist and which one is in front
  'active_context',
  'contexts_list',
  'default_context',
  'last_active_view',
  'start_view',

  // Appearance
  'app_theme',
  'appearance_compact',
  'appearance_font_size',
  'right_panel_width',

  // The theme customizer and its plugins
  'customizer_active_plugins',
  'customizer_enabled',
  'customizer_shortcuts',
  'customizer_theme_vars',

  // Focus timer
  'focus_auto_start_next',
  'focus_chime_enabled',
  'focus_chime_volume',
  'focus_long_break_interval',
  'focus_notifications_enabled',

  // How often to back up, but never where to (that is a path on one machine)
  'backup_interval',
  'backup_max_count',

  // Which features are switched on
  'feature_backup',
  'feature_hud',
  'feature_mcp',
  'feature_tracker',
  'feature_webhook',
  'feature_ai',

  // Odds and ends that are preferences
  'cheatsheet_pins',
  'saved_views',
  'unitySafeMode',
  'widget_enabled',
  'widget_opacity'
]

// Compared lower-case, because a key may be written either way and one of
// them, unitySafeMode, actually is. Derived rather than hand-lowered so the
// list above stays readable as the real key names.
const SYNCABLE_KEYS = new Set(SYNCABLE_KEY_NAMES.map(k => k.toLowerCase()))

/**
 * Families whose key ends in something the user chose, so they cannot be
 * listed one by one. All of them are workspace content or view preferences.
 */
const SYNCABLE_PREFIXES = [
  'kanban_',                  // board configuration, including the legacy keys
  'backlog_columns_layout_',
  'wall_',                    // wall_<context>, wall_doc_<id>, wall_index_<context>
  'wallview_',                // the Wall's own pen and rail preferences
  'feature_view_'             // which views are in the sidebar
]

/**
 * Held back whatever the lists above say.
 *
 * `feature_view_clipboard` decides whether every copy is written to the
 * database, not merely whether a tab is visible. Syncing it on would start
 * recording on a machine whose owner never asked for it, which is the whole
 * thing that switch was made opt-in to avoid.
 */
const NEVER_SYNC = new Set(['feature_view_clipboard'])

/** Keys that must never leave this machine. Credentials and provider config. */
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

/**
 * Named explicitly, so adding a shareable setting never needs a second thought.
 * The suffix rules below catch later keys of the same shape.
 */
const MACHINE_LOCAL_KEYS = new Set([
  'backup_path',        // a directory that exists on one machine
  'last_backup_time',   // when *this* machine last ran a backup
  'window_bounds',      // geometry, tied to this display arrangement
  'widget_position',    // same
  'webhook_port',       // a port this machine binds; may be taken on the other
  'mcp_port',           // same
  'startup_settings'    // launch-on-login is an OS registration, not a preference
])

/**
 * Shapes that are machine-local by construction. A key ending in _path names a
 * filesystem location, _port a socket to bind, _bounds/_position a place on a
 * screen. None of which survive the trip to different hardware.
 */
const MACHINE_LOCAL_SUFFIXES = ['_path', '_port', '_bounds', '_position']

/**
 * Families whose key ends in a name the user chose, so the suffix rules can't
 * be trusted on them: a context called "port" would produce kanban_board_port
 * and be mistaken for a socket. These are per-workspace board configuration and
 * are meant to travel. See shared/boardModel.
 */
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

/** True for a key the allowlist recognises, before the denylists get a say. */
function isListedForSync(key: string): boolean {
  const k = key.toLowerCase()
  if (NEVER_SYNC.has(k)) return false
  if (SYNCABLE_KEYS.has(k)) return true
  return SYNCABLE_PREFIXES.some(prefix => k.startsWith(prefix))
}

/** The single question both ends of the sync ask about a settings row. */
export function isSyncableSettingKey(key: string): boolean {
  return isListedForSync(key) && !isSensitiveSettingKey(key) && !isMachineLocalSettingKey(key)
}

/** Convenience for filtering a payload's settings rows in one place. */
export function filterSyncableSettings<T extends { key: string }>(rows: T[]): T[] {
  return rows.filter(row => isSyncableSettingKey(row.key))
}
