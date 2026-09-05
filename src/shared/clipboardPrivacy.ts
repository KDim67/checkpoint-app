/**
 * Deciding what not to write down.
 *
 * Clipboard history is a plain-text record of everything copied, kept in the
 * database and in the rolling backups. A password pasted out of a manager
 * lands there like anything else, because Windows does not tell us which copy
 * was meant to be secret: Electron reports the clipboard as `text/plain` and
 * the exclusion formats a password manager sets are not visible through its
 * API at all.
 *
 * So this guesses, and guessing is what it is. It will miss real passwords
 * (`hunter2` looks like a word) and it will drop the odd legitimate copy. The
 * bias is deliberate: not recording something the user can copy again is a
 * smaller harm than recording a credential they cannot un-record.
 */

/**
 * Shapes that are a credential and nothing else. Matched first and without
 * qualification, because a leading `sk-` or a PEM header is not ambiguous.
 */
const KNOWN_SECRET_PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /^sk-[A-Za-z0-9_-]{16,}$/,              // OpenAI and the many APIs that copied it
  /^(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}$/, // GitHub
  /^github_pat_[A-Za-z0-9_]{20,}$/,
  /^xox[baprs]-[A-Za-z0-9-]{10,}$/,       // Slack
  /^AKIA[0-9A-Z]{16}$/,                   // AWS access key id
  /^AIza[0-9A-Za-z_-]{35}$/,              // Google API key
  /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/ // a JWT
]

/** Below this a string is too short to be worth protecting, and too word-like. */
const MIN_LENGTH = 8
/** Above this it is prose or a document, not a credential. */
const MAX_LENGTH = 200
/** How many of lower, upper, digit, symbol a password-shaped string mixes. */
const REQUIRED_CLASSES = 3

function characterClasses(text: string): number {
  let classes = 0
  if (/[a-z]/.test(text)) classes++
  if (/[A-Z]/.test(text)) classes++
  if (/[0-9]/.test(text)) classes++
  if (/[^A-Za-z0-9]/.test(text)) classes++
  return classes
}

/**
 * True for something that should not be written to the history.
 *
 * The generic rule wants all of: one unbroken run of characters, a length in
 * credential range, and a mix of at least three character classes. Paths and
 * URLs are excluded before that, since they satisfy it constantly and are
 * exactly the kind of thing people copy in order to find again later.
 */
export function looksLikeSecret(raw: string): boolean {
  const text = raw.trim()
  if (!text) return false

  if (KNOWN_SECRET_PATTERNS.some(pattern => pattern.test(text))) return true

  // Anything with a space in it is a sentence, a command, or a passphrase the
  // heuristic has no hope of judging. Left alone.
  if (/\s/.test(text)) return false
  if (text.length < MIN_LENGTH || text.length > MAX_LENGTH) return false

  // A URL or a path. Copied constantly, and no more secret than a filename.
  if (text.includes('://') || text.includes('/') || text.includes('\\')) return false
  // An email address, likewise.
  if (/^[^@]+@[^@]+\.[^@]+$/.test(text)) return false

  return characterClasses(text) >= REQUIRED_CLASSES
}
