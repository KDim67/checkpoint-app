/**
 * Which settings may travel between paired machines. Two reasons to hold one
 * back, kept apart because they fail differently:
 *
 * - Sensitive. Keys and provider config. Matched broadly, on substrings.
 * - Machine-local. Paths, geometry, ports. Nothing leaks, but the other end
 *   adopts settings describing hardware it does not have.
 *
 * Applied on receive as well as send: an older peer still ships these keys.
 */

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

/** The single question both ends of the sync ask about a settings row. */
export function isSyncableSettingKey(key: string): boolean {
  return !isSensitiveSettingKey(key) && !isMachineLocalSettingKey(key)
}

/** Convenience for filtering a payload's settings rows in one place. */
export function filterSyncableSettings<T extends { key: string }>(rows: T[]): T[] {
  return rows.filter(row => isSyncableSettingKey(row.key))
}
