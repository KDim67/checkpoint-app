/** windows doesn't flag secret copies, so this guesses; skipping a recopyable string beats storing a credential */

/** unambiguous shapes, matched first */
const KNOWN_SECRET_PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /^sk-[A-Za-z0-9_-]{16,}$/,              // OpenAI and the APIs that copied it
  /^(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}$/, // GitHub
  /^github_pat_[A-Za-z0-9_]{20,}$/,
  /^xox[baprs]-[A-Za-z0-9-]{10,}$/,       // Slack
  /^AKIA[0-9A-Z]{16}$/,                   // AWS access key id
  /^AIza[0-9A-Za-z_-]{35}$/,              // Google API key
  /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/ // a JWT
]

/** too short and too word-like below this */
const MIN_LENGTH = 8
/** prose above this */
const MAX_LENGTH = 200
/** of lower, upper, digit, symbol */
const REQUIRED_CLASSES = 3

function characterClasses(text: string): number {
  let classes = 0
  if (/[a-z]/.test(text)) classes++
  if (/[A-Z]/.test(text)) classes++
  if (/[0-9]/.test(text)) classes++
  if (/[^A-Za-z0-9]/.test(text)) classes++
  return classes
}

/** one unbroken run, credential length, three classes; paths and URLs excluded first */
export function looksLikeSecret(raw: string): boolean {
  const text = raw.trim()
  if (!text) return false

  if (KNOWN_SECRET_PATTERNS.some(pattern => pattern.test(text))) return true

  // spaces mean a sentence, command or passphrase, can't judge
  if (/\s/.test(text)) return false
  if (text.length < MIN_LENGTH || text.length > MAX_LENGTH) return false

  // URLs and paths, copied constantly
  if (text.includes('://') || text.includes('/') || text.includes('\\')) return false
  // emails, likewise
  if (/^[^@]+@[^@]+\.[^@]+$/.test(text)) return false

  return characterClasses(text) >= REQUIRED_CLASSES
}
