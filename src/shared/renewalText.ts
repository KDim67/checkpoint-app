/** words in, a guessed renewal out; and a look for keys pasted where they would sync */

import { parseDueText, parseNaturalDate } from './naturalDate'

/** prefixes providers put on live keys, matched before the general shape so the common ones never miss */
const KNOWN_KEY = /(?:sk-(?:proj-|ant-)?[A-Za-z0-9_-]{16,}|[sr]k_(?:live|test)_[A-Za-z0-9]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|xox[abposr]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{30,}|glpat-[A-Za-z0-9_-]{20,})/

const TOKEN = /[A-Za-z0-9_\-+/=.]{24,}/g

/** long, unbroken and mixing letters with digits, as keys are and words and links aren't */
function keyShaped(token: string): boolean {
  if (/^https?:/i.test(token) || token.includes('://')) return false
  if (!/\d/.test(token) || !/[A-Za-z]/.test(token)) return false
  // account and project ids are written this way, and are no use to anyone alone
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token)) return false
  // a dotted name is a host or a file, not a key
  if (/^[\w-]+(\.[\w-]+)+$/.test(token) && !/[A-Z]/.test(token)) return false
  const mixedCase = /[a-z]/.test(token) && /[A-Z]/.test(token)
  return mixedCase || token.length >= 32
}

/** the first thing that looks like a key, so it can be cut down to a hint; null when there is none */
export function looksLikeSecret(text: string): string | null {
  if (!text) return null
  const known = KNOWN_KEY.exec(text)
  if (known) return known[0]
  for (const match of text.matchAll(TOKEN)) {
    if (keyShaped(match[0])) return match[0]
  }
  return null
}

/** the key taken out, leaving the text around it tidy */
export function withoutSecret(text: string, secret: string): string {
  return text.split(secret).join('').replace(/[ \t]{2,}/g, ' ').replace(/^[ \t]+|[ \t]+$/gm, '')
}

const HOST = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/

/** what someone pastes, a link or a bare name, as the host it names; null when it names none */
export function normalizeHost(input: string): string | null {
  let text = (input ?? '').trim().toLowerCase()
  if (!text) return null
  if (!/^[a-z][a-z0-9+.-]*:\/\//.test(text)) text = `http://${text}`
  let host: string
  try {
    // the URL parser also writes names in other scripts as punycode
    host = new URL(text).hostname
  } catch {
    return null
  }
  host = host.replace(/\.$/, '').replace(/^www\./, '')
  return HOST.test(host) ? host : null
}

export interface RenewalGuess {
  title: string
  kind: string
  /** undefined when no date was written */
  expiresAt: number | undefined
  /** a domain or host to look up */
  target: string | null
}

const KIND_WORDS: [RegExp, string][] = [
  [/\b(cert|certs|certificate|ssl|tls)\b/i, 'certificate'],
  [/\b(api|key|keys|token|secret)\b/i, 'api_key'],
  [/\b(sub|subs|subscription|plan|membership)\b/i, 'subscription'],
  [/\b(licence|license|licences|licenses)\b/i, 'licence'],
  [/\bdomain\b/i, 'domain']
]

/** the date at the end, "20 jan" or "next friday", and the words before it */
function splitDate(text: string, now: number): { rest: string; at: number | undefined } {
  const words = text.split(/\s+/).filter(Boolean)
  // longest tail first, so "20 jan 2027" isn't read as "2027"
  for (let take = Math.min(4, words.length - 1); take >= 1; take--) {
    const at = parseDueText(words.slice(-take).join(' '), now)
    if (typeof at === 'number') return { rest: words.slice(0, -take).join(' '), at }
  }
  const natural = parseNaturalDate(text, now)
  if (natural.dueAt !== null && natural.cleanedText) return { rest: natural.cleanedText, at: natural.dueAt }
  return { rest: text.trim(), at: undefined }
}

/** "acme.dev", "openai key 20 jan", "workspace sub 3 may": a name, a kind and maybe a date */
export function parseRenewalText(input: string, now: number = Date.now()): RenewalGuess {
  const { rest, at } = splitDate((input ?? '').trim(), now)
  const words = rest.split(/\s+/).filter(Boolean)
  const kind = KIND_WORDS.find(([pattern]) => pattern.test(rest))?.[1] ?? null
  const hosts = words.map(normalizeHost)
  const host = hosts.find((h): h is string => h !== null) ?? null

  // a name and nothing else is a domain; with "cert" beside it, the site's certificate
  if (host && (kind === 'certificate' || kind === 'domain' || words.length === 1)) {
    const resolved = kind === 'certificate' ? 'certificate' : 'domain'
    const title = words.length === 1 || resolved === 'domain' ? host : rest
    return { title, kind: resolved, expiresAt: at, target: host }
  }
  return { title: rest, kind: kind ?? 'other', expiresAt: at, target: null }
}
