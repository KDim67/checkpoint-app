/** keys and tokens taken out of text that may leave the machine; the clipboard filter matches the same shapes */

/** credentials with a shape of their own, without anchors so they're found inside longer text */
export const TOKEN_SHAPES: RegExp[] = [
  /sk-[A-Za-z0-9_-]{16,}/,                  // OpenAI and the APIs that copied it
  /(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/, // GitHub
  /github_pat_[A-Za-z0-9_]{20,}/,
  /lin_api_[A-Za-z0-9]{20,}/,               // Linear
  /ATATT[A-Za-z0-9_=-]{20,}/,               // Atlassian API token
  /(?:ntn|secret)_[A-Za-z0-9]{30,}/,        // Notion integration secret
  /xox[baprs]-[A-Za-z0-9-]{10,}/,           // Slack
  /AKIA[0-9A-Z]{16}/,                       // AWS access key id
  /AIza[0-9A-Za-z_-]{35}/,                  // Google API key
  /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/ // a JWT
]

export const PRIVATE_KEY = /-----BEGIN [A-Z ]*PRIVATE KEY-----/

const REDACTED = '[redacted]'

// not inside a longer run of token characters, so a shape is only taken whole
const shapes = new RegExp(`(?<![A-Za-z0-9_-])(?:${TOKEN_SHAPES.map(shape => shape.source).join('|')})`, 'g')
const privateKeyBlock = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g
const urlUserinfo = /(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]*@/gi
// a query string is where links carry keys; the address before it says enough
const urlQuery = /(\bhttps?:\/\/[^\s?#"'<>]+)\?[^\s#"'<>]*/gi
const schemeToken = /\b(Bearer|Basic|token)\s+(?!\[redacted\])[A-Za-z0-9._~+/=-]{8,}/gi
const namedSecret =
  /\b((?:x-)?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|auth[_-]?token|client[_-]?secret|token|secret|password|passwd|authorization))(["']?\s*[:=]\s*["']?)(?!(?:Bearer|Basic|token)\b|\[redacted\])([^\s"'&,;})\]]+)/gi
// long hex is how Todoist and many others write keys; a git hash goes with them
const longHex = /(?<![A-Za-z0-9])[a-f0-9]{32,}(?![A-Za-z0-9])/gi
// an unbroken run this long with letters and digits is a key, not a word or a path
const longOpaque = /(?<![A-Za-z0-9_-])(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{40,}(?![A-Za-z0-9_-])/g

/** what looks like a credential becomes [redacted]; a guess like the clipboard's, so the person still reads the rest */
export function redactSecrets(text: string): string {
  return text
    .replace(privateKeyBlock, '[private key redacted]')
    .replace(urlUserinfo, `$1${REDACTED}@`)
    .replace(urlQuery, '$1?[query removed]')
    .replace(schemeToken, `$1 ${REDACTED}`)
    .replace(namedSecret, `$1$2${REDACTED}`)
    .replace(shapes, REDACTED)
    .replace(longHex, REDACTED)
    .replace(longOpaque, REDACTED)
}
