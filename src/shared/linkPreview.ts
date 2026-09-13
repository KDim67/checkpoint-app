/** what a pasted page says about itself; read from the head with patterns, since main has no DOM */

export interface LinkPreview {
  title?: string
  description?: string
  /** http(s) or data:, the site's favicon.ico when the page names none */
  iconUrl?: string
}

/** what main hands the renderer; the icon is already in media */
export interface PagePreview {
  title?: string
  description?: string
  /** media filename */
  icon?: string
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'', nbsp: ' ' }

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] === '#') {
      const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10)
      // past the last code point fromCodePoint throws
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole
    }
    return ENTITIES[name.toLowerCase()] ?? whole
  })
}

/** collapsed and capped, a page's essay of a description isn't a card */
function clean(raw: string | undefined, max: number): string | undefined {
  if (!raw) return undefined
  const text = decodeEntities(raw).replace(/\s+/g, ' ').trim()
  if (!text) return undefined
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text
}

function attributes(tag: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of tag.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g)) {
    out[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? ''
  }
  return out
}

// main fetches whatever this returns, so nothing it shouldn't reach
const ICON_PROTOCOLS = new Set(['http:', 'https:', 'data:'])

function resolveIcon(href: string | undefined, base: string): string | undefined {
  if (!href) return undefined
  try {
    const url = new URL(decodeEntities(href.trim()), base)
    return ICON_PROTOCOLS.has(url.protocol) ? url.href : undefined
  } catch {
    return undefined
  }
}

export function parseLinkPreview(html: string, pageUrl: string): LinkPreview {
  // everything lives in the head; a body can quote markup
  const headEnd = html.search(/<\/head\s*>/i)
  const head = headEnd === -1 ? html : html.slice(0, headEnd)

  const meta = new Map<string, string>()
  for (const tag of head.match(/<meta\b[^>]*>/gi) ?? []) {
    const a = attributes(tag)
    const key = (a.property || a.name || '').toLowerCase()
    // first wins, pages repeat their tags
    if (key && a.content !== undefined && !meta.has(key)) meta.set(key, a.content)
  }

  let icon: string | undefined
  let touchIcon: string | undefined
  for (const tag of head.match(/<link\b[^>]*>/gi) ?? []) {
    const a = attributes(tag)
    const rel = (a.rel ?? '').toLowerCase().split(/\s+/)
    // mask-icon never matches: it's a one-colour silhouette meant for tinting
    if (!icon && rel.includes('icon')) icon = resolveIcon(a.href, pageUrl)
    else if (!touchIcon && rel.some(r => r.startsWith('apple-touch-icon'))) touchIcon = resolveIcon(a.href, pageUrl)
  }

  const titleTag = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(head)?.[1]
  const pick = (...values: (string | undefined)[]): string | undefined => values.find(v => v?.trim())

  return {
    title: clean(pick(meta.get('og:title'), meta.get('twitter:title'), titleTag), 300),
    description: clean(pick(meta.get('og:description'), meta.get('twitter:description'), meta.get('description')), 400),
    iconUrl: icon ?? touchIcon ?? resolveIcon('/favicon.ico', pageUrl)
  }
}

/** the server's charset, else a meta one near the top, else utf-8 */
export function decodeHtmlBytes(bytes: Uint8Array, contentType: string | null): string {
  const declared = /charset=["']?([\w-]+)/i.exec(contentType ?? '')?.[1]
    ?? /<meta[^>]+charset=["']?([\w-]+)/i.exec(new TextDecoder('latin1').decode(bytes.subarray(0, 2048)))?.[1]
  try {
    return new TextDecoder(declared ?? 'utf-8').decode(bytes)
  } catch {
    // an unknown label throws, utf-8 is the web's default
    return new TextDecoder('utf-8').decode(bytes)
  }
}

/** by the bytes first: servers label favicons as text or octet-stream all the time */
export function iconExtension(bytes: Uint8Array, contentType: string | null): string | null {
  if (bytes.byteLength === 0) return null
  const starts = (...signature: number[]): boolean => signature.every((b, i) => bytes[i] === b)

  if (starts(0x89, 0x50, 0x4e, 0x47)) return 'png'
  if (starts(0x00, 0x00, 0x01, 0x00)) return 'ico'
  if (starts(0xff, 0xd8, 0xff)) return 'jpg'
  if (starts(0x47, 0x49, 0x46, 0x38)) return 'gif'
  if (starts(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'webp'

  // svg is text: trust the type, or markup that opens with it
  const type = (contentType ?? '').split(';')[0].trim().toLowerCase()
  if (type === 'image/svg+xml') return 'svg'
  const head = new TextDecoder('utf-8').decode(bytes.subarray(0, 512)).toLowerCase()
  return /^\s*(<\?xml[^>]*>\s*)?<svg[\s>]/.test(head) ? 'svg' : null
}
