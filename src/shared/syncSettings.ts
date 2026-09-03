/**
 * Which settings are allowed to travel between paired machines.
 *
 * Two separate reasons to hold a key back, kept separate because they fail
 * differently:
 *
 * - **Sensitive**, API keys and provider config. Leaking these is a security
 *   problem, so the rules here are deliberately broad and match on substrings.
 * - **Machine-local**, paths, window geometry, listening ports, OS launch
 *   integration. Nothing leaks, but the receiving machine adopts settings that
 *   describe hardware it doesn't have: a laptop pointed at the desktop's backup
 *   directory, or a window restored onto a monitor that isn't there.
 *
 * Pure, and in shared/, so the same rules apply on send and on receive. Receive
 * matters as much as send: a peer running an older build still ships these keys,
 * and filtering only outbound would let its settings overwrite ours.
 */

/** Keys that must never leave this machine, credentials and provider config. */
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
 * Keys that describe *this* machine rather than the user's preferences.
 *
 * Named explicitly rather than inferred, so adding a genuinely shareable setting
 * never needs a second thought. The suffix rules below are the safety net for
 * keys added later that follow the same shape.
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
 * screen, none of which survive the trip to different hardware.
 */
const MACHINE_LOCAL_SUFFIXES = ['_path', '_port', '_bounds', '_position']

export function isMachineLocalSettingKey(key: string): boolean {
  const k = key.toLowerCase()
  if (MACHINE_LOCAL_KEYS.has(k)) return true
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
