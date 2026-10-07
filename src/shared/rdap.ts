/** RDAP, the registries' own successor to whois: which registry to ask, and what its answer says about expiry */

export const RDAP_BOOTSTRAP_URL = 'https://data.iana.org/rdap/dns.json'

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** domain ending to its registry's addresses, from IANA's bootstrap file; https only, the answer is trusted */
export function parseBootstrap(json: unknown): Record<string, string[]> | null {
  if (!isObject(json) || !Array.isArray(json.services)) return null
  const out: Record<string, string[]> = {}
  for (const service of json.services) {
    if (!Array.isArray(service) || !Array.isArray(service[0]) || !Array.isArray(service[1])) continue
    const urls = service[1].filter((u): u is string => typeof u === 'string' && /^https:\/\//i.test(u))
    if (!urls.length) continue
    for (const ending of service[0]) {
      if (typeof ending === 'string' && ending) out[ending.toLowerCase()] = urls
    }
  }
  return Object.keys(out).length ? out : null
}

/** longest ending first; IANA lists single labels today, the format allows more */
export function rdapBaseFor(services: Record<string, string[]>, host: string): string | null {
  const labels = host.split('.')
  for (let i = 0; i < labels.length; i++) {
    const urls = services[labels.slice(i).join('.')]
    if (urls) return urls[0]
  }
  return null
}

export const rdapDomainUrl = (base: string, name: string): string =>
  `${base.endsWith('/') ? base : `${base}/`}domain/${encodeURIComponent(name)}`

/** second levels registries sell under, so co.uk is never mistaken for a domain someone owns */
const SECOND_LEVELS = new Set(['co', 'com', 'net', 'org', 'gov', 'gob', 'ac', 'edu', 'mil', 'nic', 'ltd', 'plc', 'or', 'ne', 'go'])

/**
 * a subdomain has no record of its own, so labels come off the front until a registry answers;
 * this finds acme.co.uk from app.acme.co.uk without carrying a list of every domain ending
 */
export function candidateNames(host: string): string[] {
  const labels = host.split('.').filter(Boolean)
  const out: string[] = []
  for (let i = 0; labels.length - i >= 2; i++) {
    const rest = labels.slice(i)
    if (i > 0 && rest.length === 2 && SECOND_LEVELS.has(rest[0])) break
    out.push(rest.join('.'))
  }
  return out
}

/** the expiration event's date; null when the registry doesn't publish one, as some don't */
export function expirationFrom(json: unknown): number | null {
  if (!isObject(json) || !Array.isArray(json.events)) return null
  for (const event of json.events) {
    if (!isObject(event) || typeof event.eventAction !== 'string') continue
    if (event.eventAction.toLowerCase() !== 'expiration') continue
    const at = typeof event.eventDate === 'string' ? Date.parse(event.eventDate) : NaN
    if (Number.isFinite(at)) return at
  }
  return null
}

/** seconds or a date, as the header allows; null when it says neither */
export function retryAfterMs(header: string | null, now: number): number | null {
  if (!header) return null
  const seconds = Number(header)
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000
  const at = Date.parse(header)
  return Number.isFinite(at) ? Math.max(0, at - now) : null
}
