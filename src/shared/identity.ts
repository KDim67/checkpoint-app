/**
 * Who you are, for the parts of Checkpoint that have to name somebody.
 *
 * Nothing here is an account. It is a label you choose, stored on this machine,
 * and sent to whoever you share a board with so their card history can say who
 * changed what. A workspace shared with nobody never needs it, which is why it
 * is optional and why every surface reads a blank one as "unknown" rather than
 * refusing to work.
 */

export const DISPLAY_NAME_KEY = 'display_name'

/** Long enough for a real name, short enough not to wreck a one-line history entry. */
export const DISPLAY_NAME_MAX = 32

export function normalizeDisplayName(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  // Collapsed because this is rendered inline in a sentence.
  return raw.replace(/\s+/g, ' ').trim().slice(0, DISPLAY_NAME_MAX)
}

/** Last resort, for an entry written by a build that recorded no name at all. */
export const UNKNOWN_AUTHOR = 'Someone'

export function authorLabel(name: string): string {
  return normalizeDisplayName(name) || UNKNOWN_AUTHOR
}

/**
 * Who to credit when the name field was left alone.
 *
 * Falling back to the account name beats crediting "Someone": on a board
 * shared between two people, every entry saying the same non-name would be
 * exactly as useless as no attribution. It is also a name the other person
 * stands a chance of recognising.
 *
 * Nothing is written by this. The setting stays empty until it is typed, so
 * changing your Windows account name changes what new entries say and does
 * not rewrite the ones already recorded.
 */
export function resolveAuthor(typed: unknown, osUser: unknown): string {
  return normalizeDisplayName(typed) || normalizeDisplayName(osUser)
}

/**
 * This install's own id, minted once and kept.
 *
 * A guest sends it with its connection offer so a host can refuse someone it
 * has removed. The id a guest publishes for signalling is minted per attempt
 * and so survives nothing, which made a removal last only until they restarted.
 */
export const INSTALL_ID_KEY = 'install_id'

/** A valid id, or '' for anything that is not one. */
export function readInstallId(raw: unknown): string {
  return typeof raw === 'string' && /^[a-z0-9-]{8,64}$/.test(raw) ? raw : ''
}

export function newInstallId(random = Math.random): string {
  return `${Date.now().toString(36)}-${random().toString(36).slice(2, 12)}`
}
