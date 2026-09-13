/** a label, not an account; blank reads as unknown and never blocks anything */

export const DISPLAY_NAME_KEY = 'display_name'

/** fits a real name without wrecking a history line */
export const DISPLAY_NAME_MAX = 32

export function normalizeDisplayName(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  // collapsed, it's rendered inline
  return raw.replace(/\s+/g, ' ').trim().slice(0, DISPLAY_NAME_MAX)
}

/** for builds that recorded no name */
const UNKNOWN_AUTHOR = 'Someone'

export function authorLabel(name: string): string {
  return normalizeDisplayName(name) || UNKNOWN_AUTHOR
}

/** falls back to the account name, not "Someone"; writes nothing, so old entries keep theirs */
export function resolveAuthor(typed: unknown, osUser: unknown): string {
  return normalizeDisplayName(typed) || normalizeDisplayName(osUser)
}

/** minted once; the per-attempt signalling id made removals last until a restart */
export const INSTALL_ID_KEY = 'install_id'

/** '' for anything invalid */
export function readInstallId(raw: unknown): string {
  return typeof raw === 'string' && /^[a-z0-9-]{8,64}$/.test(raw) ? raw : ''
}

export function newInstallId(random = Math.random): string {
  return `${Date.now().toString(36)}-${random().toString(36).slice(2, 12)}`
}
